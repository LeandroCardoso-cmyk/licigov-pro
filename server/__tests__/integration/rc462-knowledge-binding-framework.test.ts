/**
 * RC-4.6.2 — Knowledge Binding Framework
 *
 * Valida a camada que liga NormativeNode (RC-4.6.1) ↔ LegalKnowledgeUnit (RC-4.5), SEM inserir
 * conteúdo jurídico (texto/artigos/incisos/jurisprudência/decretos/pareceres/acórdãos/IA/RAG/banco):
 * binding, versionamento append-only, resolver, queries, projeção KG, explainability, observabilidade.
 * Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import {
  createKnowledgeBinding, isValidBinding, computeBindingLineage, ALL_BINDING_TYPES, isBindingType,
} from "../../domain/legal/binding/knowledgeBinding";
import {
  evolveBinding, supersedeBinding, revokeBinding, buildBindingChains, isBindingChainConsistent, latestBindingVersion,
} from "../../domain/legal/binding/bindingVersion";
import {
  createKnowledgeBindingRegistry, addBinding, getBinding, bindingsForTenant,
} from "../../domain/legal/binding/knowledgeBindingRegistry";
import {
  resolveActiveBindings, listVersions, findByNode, findByKnowledgeUnit, resolveMultiple,
} from "../../domain/legal/binding/knowledgeBindingResolver";
import {
  bindingsByArticle, bindingsByType, knowledgeUnitsOfArticle, articlesOfKnowledgeUnit, versionsOfLineage, listLineages,
} from "../../domain/legal/binding/bindingQueries";
import { projectBindings } from "../../domain/legal/binding/bindingProjection";
import { explainBinding } from "../../domain/legal/binding/bindingExplainability";
import { validateBindingRegistry } from "../../domain/legal/binding/bindingValidation";
import { sampleBindingRegistry } from "../../domain/legal/binding/bindingSample";
import { buildFederalProcurementTree } from "../../domain/legal/normative/normativeTree";
import { findByIdentifier } from "../../domain/legal/normative/normativeQueries";
import { recordBindingEvent, getBindingEvents, clearBindingEvents } from "../../services/legal/bindingObservabilityService";

const ORG = 13200;
const T = "2026-01-01T00:00:00.000Z";
const bind = (over: Partial<Parameters<typeof createKnowledgeBinding>[0]> = {}) =>
  createKnowledgeBinding({ tenantId: ORG, normativeNodeId: "node-1", knowledgeUnitId: "ku-1", bindingType: "PRIMARY", createdAt: T, updatedAt: T, ...over });

describe("RC-4.6.2 — Knowledge Binding Framework", () => {

  // ─── Parts 2, 3 — Binding Model & Types ─────────────────────────────────────
  describe("KnowledgeBinding (modelo + tipos)", () => {
    it("possui todos os campos, é válido e determinístico", () => {
      const a = bind(); const b = bind();
      for (const f of ["bindingId", "tenantId", "normativeNodeId", "knowledgeUnitId", "bindingType", "authority", "scope", "version", "status", "createdAt", "updatedAt", "lineageId", "metadata", "replayHash"]) expect(a, f).toHaveProperty(f);
      expect(isValidBinding(a)).toBe(true);
      expect(a.replayHash).toHaveLength(32);
      expect(a.bindingId).toBe(b.bindingId);
      expect(a.status).toBe("active");
    });
    it("os 6 tipos existem", () => {
      expect(ALL_BINDING_TYPES).toEqual(["PRIMARY", "SECONDARY", "SUPPLEMENTAL", "INTERPRETATIVE", "REFERENCE", "REGULATORY"]);
      expect(isBindingType("REGULATORY")).toBe(true);
      expect(isBindingType("x")).toBe(false);
    });
    it("multi-tenant: mesma ligação em tenants distintos → linhagens/ids distintos", () => {
      expect(computeBindingLineage({ tenantId: 1, normativeNodeId: "n", knowledgeUnitId: "u", bindingType: "PRIMARY" }))
        .not.toBe(computeBindingLineage({ tenantId: 2, normativeNodeId: "n", knowledgeUnitId: "u", bindingType: "PRIMARY" }));
    });
  });

  // ─── Part 4 — Versionamento (append-only) ───────────────────────────────────
  describe("Versionamento (append-only, imutável)", () => {
    it("evolveBinding cria nova versão preservando linhagem; anterior imutável", () => {
      const v1 = bind();
      const v2 = evolveBinding(v1, { status: "superseded" }, T);
      expect(v2.version).toBe(2);
      expect(v2.lineageId).toBe(v1.lineageId);
      expect(v2.bindingId).not.toBe(v1.bindingId);
      expect(v1.status).toBe("active"); // imutável
      const chain = buildBindingChains([v1, v2])[0];
      expect(chain.versions.map(v => v.version)).toEqual([1, 2]);
      expect(isBindingChainConsistent(chain)).toBe(true);
      expect(latestBindingVersion(chain)!.version).toBe(2);
    });
    it("supersede/revoke geram novas versões com status correto", () => {
      const v1 = bind();
      expect(supersedeBinding(v1, T).status).toBe("superseded");
      expect(revokeBinding(v1, T).status).toBe("revoked");
    });
  });

  // ─── Part 1 — Registry ──────────────────────────────────────────────────────
  describe("KnowledgeBindingRegistry (append-only)", () => {
    it("adiciona bindings (idempotente) e isola por tenant", () => {
      let reg = createKnowledgeBindingRegistry();
      const b = bind();
      reg = addBinding(reg, b);
      reg = addBinding(reg, b); // idempotente
      expect(reg.bindings).toHaveLength(1);
      expect(getBinding(reg, b.bindingId)!.bindingType).toBe("PRIMARY");
      reg = addBinding(reg, bind({ tenantId: 999, normativeNodeId: "n2" }));
      expect(bindingsForTenant(reg, ORG)).toHaveLength(1);
    });
  });

  // ─── Part 5 — Resolver ──────────────────────────────────────────────────────
  describe("KnowledgeBindingResolver", () => {
    const reg = sampleBindingRegistry(ORG);
    const tree = buildFederalProcurementTree(ORG);
    it("resolve ativos (última versão active), versões, por nó e por unidade", () => {
      const active = resolveActiveBindings(reg);
      // 3 linhagens (art1 v2, art2, art3), todas active
      expect(active).toHaveLength(3);
      const art1 = findByIdentifier(tree, "Art. 1º")!;
      const art1Active = active.find(b => b.normativeNodeId === art1.id)!;
      expect(art1Active.version).toBe(2); // última versão
      expect(listVersions(reg, art1Active.lineageId).map(v => v.version)).toEqual([1, 2]);
      expect(findByNode(reg, art1.id).length).toBe(2); // v1 + v2
      expect(findByKnowledgeUnit(reg, "ku-placeholder-0001").length).toBe(2);
      expect(resolveMultiple(reg, [art1.id]).length).toBe(1);
    });
  });

  // ─── Part 7 — Queries ───────────────────────────────────────────────────────
  describe("Declarative Queries", () => {
    const reg = sampleBindingRegistry(ORG);
    const tree = buildFederalProcurementTree(ORG);
    it("por artigo/tipo, unidades de um artigo, artigo de uma unidade, versões, lineage", () => {
      const art2 = findByIdentifier(tree, "Art. 2º")!;
      expect(bindingsByArticle(reg, art2.id).length).toBeGreaterThan(0);
      expect(bindingsByType(reg, "PRIMARY").length).toBeGreaterThan(0);
      expect(knowledgeUnitsOfArticle(reg, art2.id)).toContain("ku-placeholder-0002");
      expect(articlesOfKnowledgeUnit(reg, "ku-placeholder-0002")).toContain(art2.id);
      expect(listLineages(reg).length).toBe(3);
      const art1 = findByIdentifier(tree, "Art. 1º")!;
      const lineage = findByNode(reg, art1.id)[0].lineageId;
      expect(versionsOfLineage(reg, lineage).length).toBe(2);
    });
  });

  // ─── Part 6 — Graph Projection ──────────────────────────────────────────────
  describe("Binding Projection (Binding/Unit/Node/Type/Lineage)", () => {
    it("projeta nós e arestas determinísticos", () => {
      const reg = sampleBindingRegistry(ORG);
      const p = projectBindings(reg);
      expect(p.nodes.some(n => n.semanticType === "binding")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "knowledge_unit")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "normative_node")).toBe(true);
      expect(p.nodes.some(n => n.semanticType === "binding_type")).toBe(true);
      expect(p.edges.some(e => e.type === "binds_node")).toBe(true);
      expect(p.edges.some(e => e.type === "binds_unit")).toBe(true);
      expect(p.edges.some(e => e.type === "lineage")).toBe(true);
      expect(projectBindings(reg)).toEqual(p); // determinismo
    });
  });

  // ─── Part 8 — Explainability ────────────────────────────────────────────────
  describe("Explainability", () => {
    it("explica por que existe, quem criou, artigo, unidade, versão, autoridade, escopo", () => {
      const reg = sampleBindingRegistry(ORG);
      const b = resolveActiveBindings(reg)[0];
      const ex = explainBinding(reg, b);
      for (const f of ["reason", "createdBy", "article", "knowledgeUnit", "bindingType", "version", "status", "authority", "scope", "lineageId", "versions", "summary"]) expect(ex, f).toHaveProperty(f);
      expect(ex.reason.length).toBeGreaterThan(0);
      expect(ex.summary.length).toBeGreaterThan(0);
    });
  });

  // ─── Validação ──────────────────────────────────────────────────────────────
  describe("validateBindingRegistry", () => {
    it("registro de exemplo é válido: zero erros", () => {
      const v = validateBindingRegistry(sampleBindingRegistry(ORG));
      expect(v.errors, v.errors.join("; ")).toEqual([]);
      expect(v.valid).toBe(true);
    });
    it("detecta id duplicado", () => {
      const b = bind();
      const dup = createKnowledgeBindingRegistry([b, { ...b }]);
      expect(validateBindingRegistry(dup).valid).toBe(false);
    });
  });

  // ─── Part 9 — Observabilidade ───────────────────────────────────────────────
  describe("Observabilidade (recuperável por correlationId)", () => {
    it("registra eventos e recupera por correlationId; multi-tenant", () => {
      clearBindingEvents();
      recordBindingEvent({ correlationId: "corr-rc462", tenantId: ORG, type: "bindingCreated", subjectId: "b1", detail: "criado", count: 1 });
      recordBindingEvent({ correlationId: "corr-rc462", tenantId: ORG, type: "bindingResolved", subjectId: "b1", detail: "resolvido", count: 1 });
      const evs = getBindingEvents("corr-rc462");
      expect(evs.length).toBe(2);
      expect(evs.map(e => e.type)).toEqual(["bindingCreated", "bindingResolved"]);
      expect(evs[0].tenantId).toBe(ORG);
      expect(getBindingEvents("inexistente")).toEqual([]);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesmo registro → mesma validação, resolução e projeção", () => {
      const r1 = sampleBindingRegistry(ORG); const r2 = sampleBindingRegistry(ORG);
      expect(validateBindingRegistry(r1)).toEqual(validateBindingRegistry(r2));
      expect(resolveActiveBindings(r1).map(b => b.bindingId)).toEqual(resolveActiveBindings(r2).map(b => b.bindingId));
      expect(projectBindings(r1)).toEqual(projectBindings(r2));
    });
  });
});
