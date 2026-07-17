/**
 * RC-4.5 — Legal Knowledge Foundation
 *
 * Valida a camada ESTRUTURAL que permite inserir qualquer conhecimento jurídico futuro
 * (SEM Lei 14.133/jurisprudência/acórdãos/doutrina): unidades, referências, projeção,
 * consultas, versionamento, conflitos, validação, explainability, observabilidade.
 * Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import {
  createLegalKnowledgeUnit, isValidUnit, computeKnowledgeLineage, type LegalKnowledgeUnit,
} from "../../domain/legalKnowledge/legalKnowledgeUnit";
import { createKnowledgeReference, ALL_REFERENCE_TYPES } from "../../domain/legalKnowledge/knowledgeReference";
import { structuralSampleBase, createKnowledgeBase } from "../../domain/legalKnowledge/knowledgeBase";
import { projectLegalKnowledge } from "../../domain/legalKnowledge/knowledgeProjection";
import {
  getKnowledge, findByType, findReferences, findRelatedKnowledge, findDependencies,
  findParents, findChildren, findHierarchy, findConflicts,
} from "../../domain/legalKnowledge/knowledgeQueries";
import { buildVersionChains, evolveUnit, isVersionChainConsistent, latestVersion } from "../../domain/legalKnowledge/knowledgeVersion";
import { detectConflicts } from "../../domain/legalKnowledge/knowledgeConflict";
import { validateLegalKnowledge } from "../../domain/legalKnowledge/knowledgeValidation";
import { explainKnowledgeUnit } from "../../domain/legalKnowledge/knowledgeExplainability";
import { recordKnowledgeEvent, getKnowledgeEvents, clearKnowledgeEvents } from "../../services/knowledge/knowledgeObservabilityService";

const ORG = 12600;
const T = "2026-01-01T00:00:00.000Z";
const unit = (over: Partial<Parameters<typeof createLegalKnowledgeUnit>[0]> = {}) =>
  createLegalKnowledgeUnit({ tenantId: ORG, type: "lei", title: "Estrutura", hierarchy: 1, jurisdiction: "federal", sourceReference: "SRC-1", createdAt: T, ...over });

describe("RC-4.5 — Legal Knowledge Foundation", () => {

  // ─── Part 1 — LegalKnowledgeUnit ────────────────────────────────────────────
  describe("LegalKnowledgeUnit (estrutura, multi-tenant, replay-safe)", () => {
    it("possui todos os campos e é determinística (mesmos insumos → mesmo id/replayHash)", () => {
      const a = unit(); const b = unit();
      for (const f of ["id", "tenantId", "type", "title", "hierarchy", "jurisdiction", "validity", "sourceReference", "effectiveDate", "revokedDate", "version", "lineageId", "metadata", "replayHash"]) expect(a, f).toHaveProperty(f);
      expect(a.id).toBe(b.id);
      expect(a.replayHash).toBe(b.replayHash);
      expect(a.replayHash).toHaveLength(32);
      expect(isValidUnit(a)).toBe(true);
    });
    it("multi-tenant: mesmo source em tenants diferentes → linhagens/ids distintos", () => {
      expect(computeKnowledgeLineage({ tenantId: 1, type: "lei", sourceReference: "X" }))
        .not.toBe(computeKnowledgeLineage({ tenantId: 2, type: "lei", sourceReference: "X" }));
    });
  });

  // ─── Part 2 — KnowledgeReference ────────────────────────────────────────────
  describe("KnowledgeReference (com força/direção/explicação)", () => {
    it("os 8 tipos existem; referência tem explicação obrigatória", () => {
      expect(ALL_REFERENCE_TYPES).toHaveLength(8);
      const r = createKnowledgeReference({ from: "a", to: "b", type: "depends_on", explanation: "porque" });
      expect(r.explanation).toBe("porque");
      expect(r.strength).toBeGreaterThan(0);
      expect(r.direction).toBe("unidirectional");
    });
  });

  // ─── Part 5 — Versionamento (append-only) ───────────────────────────────────
  describe("Versionamento (nunca sobrescreve)", () => {
    it("evolveUnit cria nova versão preservando a linhagem; a anterior não muda", () => {
      const v1 = unit();
      const v2 = evolveUnit(v1, { title: "Estrutura rev." }, T);
      expect(v2.version).toBe(2);
      expect(v2.lineageId).toBe(v1.lineageId);
      expect(v2.id).not.toBe(v1.id);
      expect(v1.version).toBe(1); // imutável
      const chain = buildVersionChains([v1, v2])[0];
      expect(chain.versions.map(v => v.version)).toEqual([1, 2]);
      expect(isVersionChainConsistent(chain)).toBe(true);
      expect(latestVersion(chain)!.version).toBe(2);
    });
  });

  // ─── Part 3 — Projection ────────────────────────────────────────────────────
  describe("LegalKnowledgeProjection (determinística)", () => {
    it("projeta nós/arestas com semanticType/weight/importance", () => {
      const base = structuralSampleBase(ORG);
      const p = projectLegalKnowledge(base);
      expect(p.nodes.length).toBe(base.units.length);
      expect(p.edges.length).toBe(base.references.length);
      for (const n of p.nodes) { expect(n.semanticType.length).toBeGreaterThan(0); expect(n.weight).toBeGreaterThan(0); expect(n.importance).toBeGreaterThanOrEqual(0); }
      // determinismo
      expect(projectLegalKnowledge(base)).toEqual(p);
    });
  });

  // ─── Part 4 — Queries ───────────────────────────────────────────────────────
  describe("Knowledge Queries (declarativas, sem banco)", () => {
    const base = structuralSampleBase(ORG);
    const lei = base.units.find(u => u.type === "lei")!;
    const inNorm = base.units.find(u => u.type === "instrucao_normativa")!;
    it("get/findByType/findReferences/findRelated/findDependencies/findParents/findChildren/findHierarchy", () => {
      expect(getKnowledge(base, lei.id)!.type).toBe("lei");
      expect(findByType(base, "decreto").length).toBeGreaterThan(0);
      expect(findReferences(base, lei.id).length).toBeGreaterThan(0);
      expect(findRelatedKnowledge(base, inNorm.id).length).toBeGreaterThan(0);
      expect(findDependencies(base, inNorm.id).map(u => u.type)).toContain("lei");
      expect(findParents(base, inNorm.id).length).toBeGreaterThan(0);
      expect(findChildren(base, lei.id).length).toBeGreaterThan(0);
      expect(findHierarchy(base, inNorm.id).some(u => u.id === inNorm.id)).toBe(true);
    });
  });

  // ─── Part 6 — Conflict Model ────────────────────────────────────────────────
  describe("Conflict Model (representa, não resolve)", () => {
    it("detecta duplicação, referencial e revogação (estrutural)", () => {
      const u1 = unit({ sourceReference: "SRC-A" });
      // duplicação: mesma linhagem+versão, id forçado diferente
      const dup: LegalKnowledgeUnit = { ...u1, id: "outro_id_diferente" };
      const ghostRef = createKnowledgeReference({ from: u1.id, to: "ghost", type: "supports", explanation: "quebrada" });
      const u2 = unit({ sourceReference: "SRC-B" });
      const revokeRef = createKnowledgeReference({ from: u1.id, to: u2.id, type: "revokes", explanation: "revoga vigente" });
      const conflicts = detectConflicts([u1, dup, u2], [ghostRef, revokeRef]);
      const types = conflicts.map(c => c.type);
      expect(types).toContain("duplication");
      expect(types).toContain("referential");
      expect(types).toContain("revocation");
      for (const c of conflicts) { expect(["info", "warning", "critical"]).toContain(c.severity); expect(c.explanation.length).toBeGreaterThan(0); }
    });
    it("temporal: vigência posterior à revogação", () => {
      const bad = unit({ effectiveDate: "2026-05-01T00:00:00.000Z", revokedDate: "2026-01-01T00:00:00.000Z", sourceReference: "SRC-T" });
      expect(detectConflicts([bad], []).some(c => c.type === "temporal")).toBe(true);
    });
  });

  // ─── Part 7 — Validation ────────────────────────────────────────────────────
  describe("validateLegalKnowledge", () => {
    it("base estrutural válida: zero erros", () => {
      const v = validateLegalKnowledge(structuralSampleBase(ORG));
      expect(v.errors, v.errors.join("; ")).toEqual([]);
      expect(v.valid).toBe(true);
    });
    it("detecta referência quebrada, ciclo e id duplicado", () => {
      const a = unit({ sourceReference: "A" }); const b = unit({ sourceReference: "B" });
      // ciclo a→b→a via depends_on
      const r1 = createKnowledgeReference({ from: a.id, to: b.id, type: "depends_on", explanation: "x" });
      const r2 = createKnowledgeReference({ from: b.id, to: a.id, type: "depends_on", explanation: "y" });
      const cyc = validateLegalKnowledge(createKnowledgeBase([a, b], [r1, r2]));
      expect(cyc.valid).toBe(false);
      expect(cyc.errors.some(e => /ciclo/.test(e))).toBe(true);
      // referência quebrada
      const broken = validateLegalKnowledge(createKnowledgeBase([a], [createKnowledgeReference({ from: a.id, to: "ghost", type: "supports", explanation: "z" })]));
      expect(broken.valid).toBe(false);
      // id duplicado
      const dupBase = createKnowledgeBase([a, { ...b, id: a.id }], []);
      expect(validateLegalKnowledge(dupBase).errors.some(e => /duplicado/.test(e))).toBe(true);
    });
  });

  // ─── Part 8 — Explainability ────────────────────────────────────────────────
  describe("Explainability", () => {
    it("explica origem/hierarquia/dependências/referências/versões/relacionamentos/conflitos", () => {
      const base = structuralSampleBase(ORG);
      const inNorm = base.units.find(u => u.type === "instrucao_normativa")!;
      const ex = explainKnowledgeUnit(base, inNorm);
      for (const f of ["origin", "hierarchy", "dependencies", "references", "versions", "relationships", "conflicts", "summary"]) expect(ex, f).toHaveProperty(f);
      expect(ex.origin.type).toBe("instrucao_normativa");
      expect(ex.references.length).toBeGreaterThan(0);
      expect(ex.summary.length).toBeGreaterThan(0);
    });
  });

  // ─── Part 9 — Observabilidade ───────────────────────────────────────────────
  describe("Observabilidade (recuperável por correlationId)", () => {
    it("registra eventos e recupera por correlationId; multi-tenant", () => {
      clearKnowledgeEvents();
      recordKnowledgeEvent({ correlationId: "corr-rc45", tenantId: ORG, type: "knowledgeValidated", detail: "ok", count: 4 });
      recordKnowledgeEvent({ correlationId: "corr-rc45", tenantId: ORG, type: "projectionGenerated", detail: "nodes", count: 4 });
      const evs = getKnowledgeEvents("corr-rc45");
      expect(evs.length).toBe(2);
      expect(evs.map(e => e.type)).toEqual(["knowledgeValidated", "projectionGenerated"]);
      expect(evs[0].tenantId).toBe(ORG);
      expect(getKnowledgeEvents("inexistente")).toEqual([]);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesma base → mesma validação e mesma projeção", () => {
      const b1 = structuralSampleBase(ORG); const b2 = structuralSampleBase(ORG);
      expect(validateLegalKnowledge(b1)).toEqual(validateLegalKnowledge(b2));
      expect(projectLegalKnowledge(b1)).toEqual(projectLegalKnowledge(b2));
      expect(findConflicts(b1)).toEqual(findConflicts(b2));
    });
  });
});
