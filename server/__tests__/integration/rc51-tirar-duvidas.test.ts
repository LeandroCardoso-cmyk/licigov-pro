/**
 * RC-5.1 — Business Domain "Tirar Dúvidas" (Institutional Consultation)
 *
 * Valida o domínio institucional de consulta normativa (NÃO um chat): fluxo completo reutilizando
 * executeCognitiveTask → Resolver → Retrieval → ContextPackage → AIExecutionEngine; resposta
 * fundamentada/explicável/auditável; PERSISTÊNCIA durável (repository); isolamento multi-tenant;
 * semântica de identidade (execution/answer/replay); replay safety. Zero regressões.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";
import { answerConsultation, getOfficialCorpus, listTenantHistory, getConsultationForTenant, getConsultationSources } from "../../services/institutionalConsultationService";
import { InMemoryConsultationRepository, setConsultationRepository } from "../../services/institutionalConsultationRepository";
import {
  sanitizeQuestion, buildConsultationAnswer, INITIAL_CONSULTATION_SUGGESTIONS, CONSULTATION_DOMAIN_NAME, CONSULTATION_DOMAIN_CODE,
  computeExecutionId, computeAnswerId,
} from "../../domain/institutionalConsultation";
import { resolveInstitutionalContextPackage } from "../../services/institutionalIntegration/institutionalKnowledgeIntegration";

const MS = MOREIRA_SALES_TENANT_ID;
const OTHER = 888888;
let n = 0;
const clock = () => { n += 5; return n; };
let seq = 0;
const ask = (tenantId: number, question: string, userId = 1, correlationId?: string) =>
  answerConsultation({ organizationId: tenantId, userId, question, correlationId: correlationId ?? `c:${tenantId}:${question}:${++seq}`, now: clock, createdAt: () => `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z` });

beforeEach(() => { getOfficialCorpus(); setConsultationRepository(new InMemoryConsultationRepository()); });

describe("RC-5.1 — Tirar Dúvidas (Institutional Consultation)", () => {

  describe("Criação do domínio", () => {
    it("expõe nome/código e sugestões iniciais expansíveis", () => {
      expect(CONSULTATION_DOMAIN_NAME).toBe("Tirar Dúvidas");
      expect(CONSULTATION_DOMAIN_CODE).toBe("institutional_consultation");
      expect(INITIAL_CONSULTATION_SUGGESTIONS.length).toBeGreaterThanOrEqual(5);
      expect(sanitizeQuestion("  linha1\n\tlinha2  ")).toBe("linha1 linha2");
    });
  });

  describe("Fluxo completo (executeCognitiveTask → ContextPackage → engine)", () => {
    it("consulta simples retorna resposta estruturada e fundamentada, e persiste", async () => {
      const a = await ask(MS, "Como aplicar os benefícios da LC 123 para microempresas?");
      for (const f of ["answerId", "executionId", "status", "correlationId", "replayId", "replayOfExecutionId", "contextReplayHash", "answer", "foundation", "documents", "passages", "citations", "observations", "explainabilityLines", "limitations", "hasSufficientBasis"]) expect(a, f).toHaveProperty(f);
      expect(a.status).toBe("completed");
      expect(a.hasSufficientBasis).toBe(true);
      expect(a.documents.length).toBeGreaterThan(0);
      expect(a.citations.length).toBe(a.passages.length);
      // persistido e recuperável
      const rec = await getConsultationForTenant(MS, a.executionId);
      expect(rec!.status).toBe("completed");
      expect(rec!.answerId).toBe(a.answerId);
      expect((await getConsultationSources(MS, a.executionId)).length).toBe(a.passages.length);
    });
  });

  describe("Consulta com legislação federal / estadual / municipal", () => {
    it("federal: recupera a Lei 14.133 / LC 123", async () => {
      const a = await ask(MS, "microempresas e empresas de pequeno porte na licitação");
      expect(a.documents.some(d => d.jurisdiction === "federal")).toBe(true);
    });
    it("estadual/municipal: além do federal", async () => {
      const a = await ask(MS, "tratamento diferenciado microempresas Moreira Sales contratações");
      const esferas = new Set(a.documents.map(d => d.jurisdiction));
      expect(esferas.has("federal")).toBe(true);
      expect(esferas.has("municipal") || esferas.has("estadual")).toBe(true);
    });
    it("municipal: o tenant de Moreira Sales recupera a Lei Municipal 769", async () => {
      const a = await ask(MS, "tratamento diferenciado microempresas Moreira Sales contratações");
      expect(a.documents.some(d => d.jurisdiction === "municipal")).toBe(true);
    });
  });

  describe("Explainability", () => {
    it("exibe as normas utilizadas (Esta resposta foi construída utilizando…)", async () => {
      const a = await ask(MS, "benefícios LC 123 microempresas");
      expect(a.explainabilityLines.length).toBeGreaterThan(0);
      expect(a.explainabilityLines.every(l => l.startsWith("✓ "))).toBe(true);
    });
  });

  describe("Limitações (nunca inventar fundamento)", () => {
    it("estado 'limited' sem base documental, sem inventar fundamento", () => {
      const pkg = resolveInstitutionalContextPackage(getOfficialCorpus(), { tenantId: MS, taskType: "LEGAL_ANALYSIS", query: "zxqwvk plmnbv qwzzxy", correlationId: "empty" });
      const a = buildConsultationAnswer({ tenantId: MS, userId: 1, question: "zxqwvk plmnbv qwzzxy", engineContent: "", contextPackage: pkg, executionId: "e1", createdAt: "2026-01-01T00:00:00.000Z" });
      expect(a.status).toBe("limited");
      expect(a.hasSufficientBasis).toBe(false);
      expect(a.limitations.length).toBeGreaterThan(0);
      expect(a.answer).toMatch(/não foi possível localizar base documental/i);
    });
  });

  describe("Histórico durável e auditoria", () => {
    it("registra a consulta recuperável pelo repository", async () => {
      const a = await ask(MS, "quando devo utilizar pregão");
      const hist = await listTenantHistory(MS);
      expect(hist.some(e => e.executionId === a.executionId)).toBe(true);
      expect(hist[0].correlationId.length).toBeGreaterThan(0);
    });
  });

  describe("Tenant Isolation", () => {
    it("outro tenant jamais recupera a norma municipal de Moreira Sales", async () => {
      const outro = await ask(OTHER, "tratamento diferenciado microempresas contratações municipais");
      expect(outro.documents.some(d => d.jurisdiction === "municipal")).toBe(false);
      expect(outro.documents.some(d => d.jurisdiction === "federal")).toBe(true);
    });
  });

  describe("Semântica de identidade & Replay Safety", () => {
    it("contextReplayHash estável; executionId/answerId distintos por execução nova", async () => {
      const a = await ask(MS, "sistema de registro de preços", 1, "corr-A");
      const b = await ask(MS, "sistema de registro de preços", 1, "corr-B");
      expect(a.contextReplayHash).toBe(b.contextReplayHash);  // mesmo contexto
      expect(a.executionId).not.toBe(b.executionId);          // nova execução
      expect(a.answerId).not.toBe(b.answerId);                // nova resposta
      expect(a.replayId).toBeNull();
      expect(a.replayOfExecutionId).toBeNull();
      // helpers determinísticos
      expect(computeExecutionId(MS, "corr-A")).toBe(a.executionId);
      expect(computeAnswerId(a.executionId)).toBe(a.answerId);
    });
  });
});
