/**
 * RC-5.0 — Institutional Knowledge Integration Layer
 *
 * Valida a ÚNICA camada de integração entre o Kernel Cognitivo e o Official Knowledge Corpus,
 * mantendo baixo acoplamento: InstitutionalContextResolver, KnowledgeRetrievalService, ContextPackage,
 * integração com o Orchestrator e com o AIExecutionEngine (que apenas CONSOME o pacote). Isolamento
 * multi-tenant, hierarquia Federal→Estado→Município, replay-safe, explainability, observabilidade.
 * Nenhuma IA/chat/interface. Zero regressões.
 */

import { describe, it, expect } from "vitest";
import { buildOfficialKnowledgeCorpus, MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";
import { resolveInstitutionalContext } from "../../domain/institutionalIntegration/institutionalContextResolver";
import { retrieveKnowledge } from "../../services/institutionalIntegration/knowledgeRetrievalService";
import { createContextPackage, CONTEXT_PACKAGE_CONTRACT } from "../../domain/institutionalIntegration/contextPackage";
import {
  resolveInstitutionalContextPackage, executeCognitiveTaskWithInstitutionalContext,
} from "../../services/institutionalIntegration/institutionalKnowledgeIntegration";
import { orchestrateMultiCopilot } from "../../services/workspaceOrchestratorService";
import { executeCognitiveTask } from "../../services/aiExecutionEngine";
import {
  recordIntegrationEvent, getIntegrationEvents, clearIntegrationEvents,
} from "../../services/institutionalIntegration/institutionalIntegrationObservabilityService";

const CORPUS = buildOfficialKnowledgeCorpus({ correlationId: "rc50-suite" });
const QUERY = "microempresas e empresas de pequeno porte tratamento diferenciado";
const pkgFor = (tenantId: number, correlationId = "c") =>
  resolveInstitutionalContextPackage(CORPUS, { tenantId, businessDomain: "processo_licitatorio", taskType: "LEGAL_ANALYSIS", query: QUERY, correlationId });

describe("RC-5.0 — Institutional Knowledge Integration Layer", () => {

  // ─── Componente 1 — Context Resolution ──────────────────────────────────────
  describe("InstitutionalContextResolver (determinístico, sem IA)", () => {
    it("resolve Federal → Estado → Município para o tenant municipal", () => {
      const ctx = resolveInstitutionalContext(CORPUS.registry, { tenantId: MOREIRA_SALES_TENANT_ID, businessDomain: "processo_licitatorio", taskType: "LEGAL_ANALYSIS" });
      expect(ctx.tenantId).toBe(MOREIRA_SALES_TENANT_ID);
      expect(ctx.municipality).toBe("Moreira Sales");
      expect(ctx.state).toBe("PR");
      expect(ctx.hierarchy).toEqual(["federal", "estadual", "municipal"]);
      expect(ctx.applicableDocuments[0].jurisdiction).toBe("federal"); // federal precede
      expect(ctx.applicableDocuments.some(d => d.jurisdiction === "municipal")).toBe(true);
      // determinístico
      expect(resolveInstitutionalContext(CORPUS.registry, { tenantId: MOREIRA_SALES_TENANT_ID, taskType: "LEGAL_ANALYSIS" }).applicableDocuments.length).toBe(ctx.applicableDocuments.length);
    });
  });

  // ─── Componente 2 — Knowledge Retrieval ─────────────────────────────────────
  describe("KnowledgeRetrievalService (só o Corpus, sem sumarização)", () => {
    it("recupera trechos preservando documentId/authority/version/bindingLevel/citation/lineage", () => {
      const ctx = resolveInstitutionalContext(CORPUS.registry, { tenantId: MOREIRA_SALES_TENANT_ID, taskType: "LEGAL_ANALYSIS" });
      const r = retrieveKnowledge(CORPUS, ctx, { query: QUERY });
      expect(r.passages.length).toBeGreaterThan(0);
      expect(r.documentsLoaded.length).toBeGreaterThan(0);
      for (const c of r.citations) {
        expect(c.documentId.length).toBeGreaterThan(0);
        expect(c.authority.length).toBeGreaterThan(0);
        expect(c.version.length).toBeGreaterThan(0);
        expect(c.bindingLevel.length).toBeGreaterThan(0);
        expect(c.lineageId.length).toBeGreaterThan(0);
      }
      // trecho verbatim (sem interpretação)
      expect(r.passages.some(p => /microempresas|pequeno porte/i.test(p.text))).toBe(true);
      // determinismo
      expect(retrieveKnowledge(CORPUS, ctx, { query: QUERY }).passages.map(p => p.blockId)).toEqual(r.passages.map(p => p.blockId));
    });
  });

  // ─── Componente 3 — ContextPackage ──────────────────────────────────────────
  describe("ContextPackage (imutável, replay-safe, versionado)", () => {
    it("possui todos os campos, é imutável e determinístico", () => {
      const pkg = pkgFor(MOREIRA_SALES_TENANT_ID);
      for (const f of ["contextId", "contract", "correlationId", "replayId", "tenantId", "municipality", "state", "businessDomain", "taskType", "hierarchy", "documents", "retrievedPassages", "citations", "bindingLevels", "explainability", "metadata", "replayHash"]) expect(pkg, f).toHaveProperty(f);
      expect(pkg.contract).toBe(CONTEXT_PACKAGE_CONTRACT);
      expect(pkg.replayHash).toHaveLength(32);
      expect(Object.isFrozen(pkg)).toBe(true);
      expect(() => { (pkg as { taskType: string }).taskType = "x"; }).toThrow();
      expect(pkg.bindingLevels).toContain("mandatory");
      // replay: mesma entrada → mesmo replayHash
      expect(pkgFor(MOREIRA_SALES_TENANT_ID).replayHash).toBe(pkg.replayHash);
    });
    it("createContextPackage congela e deriva bindingLevels", () => {
      const p = createContextPackage({ correlationId: "c", tenantId: 1, taskType: "T", hierarchy: ["federal"], documents: [{ documentId: "d", normId: "n", title: "t", authority: "a", jurisdiction: "federal", version: "1.0.0", bindingLevel: "referencia", status: "vigente" }], retrievedPassages: [], citations: [], explainability: [] });
      expect(p.bindingLevels).toEqual(["referencia"]);
    });
  });

  // ─── Multi-Tenant Isolation ─────────────────────────────────────────────────
  describe("Isolamento multi-tenant absoluto", () => {
    it("um tenant nunca acessa documentos municipais de outro tenant", () => {
      const moreira = pkgFor(MOREIRA_SALES_TENANT_ID, "m");
      const outro = pkgFor(999999, "o");
      expect(moreira.documents.some(d => d.jurisdiction === "municipal")).toBe(true);
      expect(outro.documents.some(d => d.jurisdiction === "municipal")).toBe(false);
      // federais são compartilhados
      expect(outro.documents.some(d => d.jurisdiction === "federal")).toBe(true);
    });
  });

  // ─── Hierarquia (Federal / Estadual / Municipal) ────────────────────────────
  describe("Hierarquia normativa", () => {
    it("federal precede; estadual e municipal complementam (não substituem)", () => {
      const pkg = pkgFor(MOREIRA_SALES_TENANT_ID);
      const jurisdictions = pkg.documents.map(d => d.jurisdiction);
      expect(jurisdictions).toContain("federal");
      expect(jurisdictions).toContain("estadual");
      expect(jurisdictions).toContain("municipal");
      expect(pkg.hierarchy).toEqual(["federal", "estadual", "municipal"]);
    });
  });

  // ─── Integração com o Orchestrator ──────────────────────────────────────────
  describe("Integração com o Orchestrator", () => {
    it("orchestrateMultiCopilot resolve o ContextPackage quando `institutional` é informado", async () => {
      const withCtx = await orchestrateMultiCopilot({
        organizationId: MOREIRA_SALES_TENANT_ID, request: QUERY, correlationId: "orch1",
        institutional: { corpus: CORPUS, tenantId: MOREIRA_SALES_TENANT_ID, taskType: "LEGAL_ANALYSIS", businessDomain: "processo_licitatorio" },
      });
      expect(withCtx.contextPackage).toBeTruthy();
      expect(withCtx.contextPackage!.documents.length).toBeGreaterThan(0);
      // retrocompatível: sem `institutional` → sem contextPackage (fluxo inalterado)
      const withoutCtx = await orchestrateMultiCopilot({ organizationId: MOREIRA_SALES_TENANT_ID, request: QUERY, correlationId: "orch2" });
      expect(withoutCtx.contextPackage).toBeUndefined();
      expect(withoutCtx.consolidated).toBeTruthy();
    });
  });

  // ─── Integração com o AIExecutionEngine ─────────────────────────────────────
  describe("Integração com o AIExecutionEngine (apenas consome o pacote)", () => {
    it("o engine consome o ContextPackage e registra sua referência", async () => {
      const { execution, contextPackage } = await executeCognitiveTaskWithInstitutionalContext(CORPUS, {
        tenantId: MOREIRA_SALES_TENANT_ID, taskType: "LEGAL_ANALYSIS", query: QUERY, correlationId: "eng1",
        cognitive: { task: "LEGAL_ANALYSIS", userId: "u1", query: QUERY },
      });
      expect(execution.institutionalContextRef).toBe(contextPackage.replayHash);
      // documentos do pacote entram nos documentos usados pelo engine
      expect(execution.response.explainability.documentsUsed.length).toBeGreaterThan(0);
    });
    it("sem ContextPackage o engine mantém o comportamento anterior (zero regressões)", async () => {
      const e = await executeCognitiveTask({ task: "LEGAL_ANALYSIS", tenantId: 1, userId: "u", correlationId: "eng2", query: "x" });
      expect(e.institutionalContextRef).toBeUndefined();
      expect(e.validation.valid).toBe(true);
    });
  });

  // ─── Explainability ─────────────────────────────────────────────────────────
  describe("Explainability", () => {
    it("cada documento recuperado registra autoridade/versão/bindingLevel/lineage", () => {
      const pkg = pkgFor(MOREIRA_SALES_TENANT_ID);
      expect(pkg.explainability.length).toBeGreaterThan(0);
      for (const e of pkg.explainability) {
        expect(e.reason.length).toBeGreaterThan(0);
        expect(e.authority.length).toBeGreaterThan(0);
        expect(e.version.length).toBeGreaterThan(0);
        expect(e.bindingLevel.length).toBeGreaterThan(0);
        expect(e.lineageId.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Observabilidade ────────────────────────────────────────────────────────
  describe("Observabilidade (correlationId/replayId)", () => {
    it("registra contextResolution/knowledgeRetrieval/documents recuperáveis", () => {
      clearIntegrationEvents();
      resolveInstitutionalContextPackage(CORPUS, { tenantId: MOREIRA_SALES_TENANT_ID, taskType: "LEGAL_ANALYSIS", query: QUERY, correlationId: "obs1" });
      const evs = getIntegrationEvents("obs1");
      const types = evs.map(e => e.type);
      expect(types).toContain("contextResolution");
      expect(types).toContain("knowledgeRetrieval");
      expect(types).toContain("contextPackageBuilt");
      expect(evs.every(e => e.tenantId === MOREIRA_SALES_TENANT_ID)).toBe(true);
      expect(getIntegrationEvents("inexistente")).toEqual([]);
      // registro manual
      clearIntegrationEvents();
      recordIntegrationEvent({ correlationId: "obs2", replayId: "r", tenantId: 1, businessDomain: null, taskType: "T", type: "documentsIgnored", detail: "x", count: 0, retrievalTimeMs: 0 });
      expect(getIntegrationEvents("obs2")).toHaveLength(1);
    });
  });

  // ─── Replay Safety ──────────────────────────────────────────────────────────
  describe("Replay Safety", () => {
    it("mesma entrada → mesmo contexto, documentos, trechos e replayHash", () => {
      const a = pkgFor(MOREIRA_SALES_TENANT_ID, "ra");
      const b = pkgFor(MOREIRA_SALES_TENANT_ID, "rb");
      expect(a.replayHash).toBe(b.replayHash);
      expect(a.documents.map(d => d.documentId)).toEqual(b.documents.map(d => d.documentId));
      expect(a.retrievedPassages.map(p => p.blockId)).toEqual(b.retrievedPassages.map(p => p.blockId));
    });
  });
});
