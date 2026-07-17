/**
 * RC-4.6.1 — Federal Procurement Corpus · Normative Foundation (Lei nº 14.133/2021)
 *
 * Valida a FUNDAÇÃO NORMATIVA — a estrutura permanente para ingestão incremental da Lei 14.133
 * (e de qualquer norma futura), SEM texto jurídico/Knowledge Units/IA/RAG/banco: modelo normativo,
 * hierarquia oficial, árvore estrutural, cross references, projeção KG, consultas, explainability,
 * observabilidade. Multi-tenant, replay-safe, determinístico.
 */

import { describe, it, expect } from "vitest";
import {
  NORMATIVE_HIERARCHY, ALL_NORMATIVE_LEVELS, isNormativeLevel, getNormativeLevel,
  canContain, levelPath, normativeDepth,
} from "../../domain/legal/normative/normativeHierarchy";
import { createNormativeNode, isValidNormativeNode, computeNormativeLineage, normativeNodeId } from "../../domain/legal/normative/normativeNode";
import {
  createNormativeReference, createNormativeRelationship, ALL_REFERENCE_TYPES, isReferenceType,
} from "../../domain/legal/normative/normativeReference";
import { buildFederalProcurementTree, createNormativeTree, LEI_14133_NORM_ID } from "../../domain/legal/normative/normativeTree";
import { projectNormativeTree } from "../../domain/legal/normative/normativeProjection";
import {
  findNode, findByIdentifier, findByType, parentOf, childrenOf, ancestorsOf, descendantsOf, referencesOf, referencesByType,
} from "../../domain/legal/normative/normativeQueries";
import { explainNode } from "../../domain/legal/normative/normativeExplainability";
import { validateNormativeTree } from "../../domain/legal/normative/normativeValidation";
import { recordNormativeEvent, getNormativeEvents, clearNormativeEvents } from "../../services/legal/normativeObservabilityService";

const ORG = 13100;

describe("RC-4.6.1 — Normative Foundation (Lei nº 14.133/2021)", () => {

  // ─── Part 2 — Hierarquia Oficial ────────────────────────────────────────────
  describe("Hierarquia normativa", () => {
    it("declara os 11 níveis (Lei → Item) monotônicos", () => {
      expect(ALL_NORMATIVE_LEVELS).toEqual(["lei", "livro", "titulo", "capitulo", "secao", "subsecao", "artigo", "paragrafo", "inciso", "alinea", "item"]);
      expect(isNormativeLevel("artigo")).toBe(true);
      expect(isNormativeLevel("xyz")).toBe(false);
      expect(getNormativeLevel("lei").depth).toBe(0);
      expect(normativeDepth("item")).toBe(10);
      // contenção: níveis intermediários opcionais
      expect(canContain("capitulo", "artigo")).toBe(true);
      expect(canContain("artigo", "capitulo")).toBe(false);
      expect(levelPath("artigo")).toEqual(["lei", "livro", "titulo", "capitulo", "secao", "subsecao", "artigo"]);
    });
  });

  // ─── Part 1 — Normative Model ───────────────────────────────────────────────
  describe("NormativeNode (estrutura reutilizável, multi-tenant, replay-safe)", () => {
    it("cria nó válido, determinístico, com knowledgeUnitId null (Part 4)", () => {
      const n = createNormativeNode({ tenantId: ORG, normId: "x", type: "artigo", identifier: "Art. 1º" });
      for (const f of ["id", "tenantId", "normId", "type", "identifier", "displayName", "parent", "children", "order", "authority", "scope", "knowledgeUnitId", "version", "lineageId", "metadata", "replayHash"]) expect(n, f).toHaveProperty(f);
      expect(n.knowledgeUnitId).toBeNull();
      expect(isValidNormativeNode(n)).toBe(true);
      expect(n.replayHash).toHaveLength(32);
      const n2 = createNormativeNode({ tenantId: ORG, normId: "x", type: "artigo", identifier: "Art. 1º" });
      expect(n.id).toBe(n2.id);
      expect(normativeNodeId(ORG, "x", "artigo", "Art. 1º")).toBe(n.id);
    });
    it("multi-tenant: mesma norma em tenants distintos → linhagens/ids distintos", () => {
      expect(computeNormativeLineage({ tenantId: 1, normId: "x" })).not.toBe(computeNormativeLineage({ tenantId: 2, normId: "x" }));
    });
  });

  // ─── Part 5 — Cross References ──────────────────────────────────────────────
  describe("Cross References & Relationships", () => {
    it("os 5 tipos existem; referência/relação têm explicação", () => {
      expect(ALL_REFERENCE_TYPES).toHaveLength(5);
      expect(isReferenceType("remissao")).toBe(true);
      const ref = createNormativeReference({ from: "a", to: "b", type: "remissao", explanation: "porque" });
      expect(ref.explanation).toBe("porque");
      expect(ref.direction).toBe("unidirectional");
      const corr = createNormativeReference({ from: "a", to: "b", type: "correlacao", explanation: "x" });
      expect(corr.direction).toBe("bidirectional");
      const rel = createNormativeRelationship({ source: "a", target: "b", type: "dependencia", explanation: "dep" });
      expect(rel.strength).toBeGreaterThan(0);
    });
  });

  // ─── Part 3 — Federal Procurement Tree ──────────────────────────────────────
  describe("Árvore estrutural da Lei nº 14.133", () => {
    const tree = buildFederalProcurementTree(ORG);
    it("cria nós estruturais (sem conteúdo) com raiz Lei e knowledgeUnitId null", () => {
      expect(tree.normId).toBe(LEI_14133_NORM_ID);
      expect(tree.nodes.length).toBeGreaterThan(10);
      expect(tree.nodes.every(n => n.knowledgeUnitId === null)).toBe(true);
      const raiz = findNode(tree, tree.root)!;
      expect(raiz.type).toBe("lei");
      expect(raiz.parent).toBeNull();
      // cobre múltiplos níveis
      const tipos = new Set(tree.nodes.map(n => n.type));
      for (const t of ["lei", "titulo", "capitulo", "secao", "subsecao", "artigo", "paragrafo", "inciso", "alinea", "item"]) expect(tipos.has(t as never)).toBe(true);
    });
    it("determinismo: mesma org → mesma árvore", () => {
      const a = buildFederalProcurementTree(ORG);
      const b = buildFederalProcurementTree(ORG);
      expect(a.nodes.map(n => n.replayHash)).toEqual(b.nodes.map(n => n.replayHash));
      expect(a.root).toBe(b.root);
    });
  });

  // ─── Validação ──────────────────────────────────────────────────────────────
  describe("validateNormativeTree", () => {
    it("árvore da Lei nº 14.133 é válida: zero erros", () => {
      const v = validateNormativeTree(buildFederalProcurementTree(ORG));
      expect(v.errors, v.errors.join("; ")).toEqual([]);
      expect(v.valid).toBe(true);
    });
    it("detecta hierarquia invertida (pai não superior)", () => {
      const lei = createNormativeNode({ tenantId: ORG, normId: "n", type: "lei", identifier: "L", children: [] });
      // artigo como pai de um titulo (inversão)
      const artigo = createNormativeNode({ tenantId: ORG, normId: "n", type: "artigo", identifier: "A", children: [normativeNodeId(ORG, "n", "titulo", "T")] });
      const titulo = createNormativeNode({ tenantId: ORG, normId: "n", type: "titulo", identifier: "T", parent: artigo.id });
      const bad = createNormativeTree("n", lei.id, [lei, artigo, titulo], []);
      expect(validateNormativeTree(bad).valid).toBe(false);
    });
  });

  // ─── Part 6 — Graph Projection ──────────────────────────────────────────────
  describe("Normative Projection (Hierarchy/Nodes/Relationships/References/Lineage)", () => {
    it("projeta nós e arestas determinísticos", () => {
      const tree = buildFederalProcurementTree(ORG);
      const p = projectNormativeTree(tree);
      expect(p.nodes.length).toBe(tree.nodes.length);
      expect(p.edges.some(e => e.type === "contains")).toBe(true);
      expect(p.edges.some(e => e.type === "lineage")).toBe(true);
      expect(p.edges.some(e => e.type === "remissao")).toBe(true);
      expect(projectNormativeTree(tree)).toEqual(p);
    });
  });

  // ─── Part 7 — Declarative Queries ───────────────────────────────────────────
  describe("Queries declarativas", () => {
    const tree = buildFederalProcurementTree(ORG);
    it("localiza artigo, sobe/desce hierarquia, lista ancestrais/descendentes/referências", () => {
      const art1 = findByIdentifier(tree, "Art. 1º")!;
      expect(art1.type).toBe("artigo");
      expect(findByType(tree, "artigo").length).toBeGreaterThan(1);
      // desce: Art. 1º tem § 1º
      expect(childrenOf(tree, art1.id).some(c => c.type === "paragrafo")).toBe(true);
      // sobe: pai do Art. 1º é um capítulo
      expect(parentOf(tree, art1.id)!.type).toBe("capitulo");
      // ancestrais chegam à Lei
      expect(ancestorsOf(tree, art1.id).some(a => a.type === "lei")).toBe(true);
      // descendentes do título I incluem artigos
      const tituloI = findByIdentifier(tree, "Título I")!;
      expect(descendantsOf(tree, tituloI.id).some(d => d.type === "artigo")).toBe(true);
      // referências do Art. 2º
      const art2 = findByIdentifier(tree, "Art. 2º")!;
      expect(referencesOf(tree, art2.id).length).toBeGreaterThan(0);
      expect(referencesByType(tree, "remissao").length).toBeGreaterThan(0);
    });
  });

  // ─── Part 8 — Explainability ────────────────────────────────────────────────
  describe("Explainability", () => {
    it("explica origem/posição/ancestrais/descendentes/referências/lineage", () => {
      const tree = buildFederalProcurementTree(ORG);
      const art1 = findByIdentifier(tree, "Art. 1º")!;
      const ex = explainNode(tree, art1);
      for (const f of ["origin", "position", "ancestors", "children", "descendants", "references", "dependencies", "lineageId", "knowledgeUnitId", "summary"]) expect(ex, f).toHaveProperty(f);
      expect(ex.origin.normId).toBe(LEI_14133_NORM_ID);
      expect(ex.ancestors.length).toBeGreaterThan(0);
      expect(ex.knowledgeUnitId).toBeNull();
      expect(ex.summary.length).toBeGreaterThan(0);
    });
  });

  // ─── Part 9 — Observabilidade ───────────────────────────────────────────────
  describe("Observabilidade (recuperável por correlationId)", () => {
    it("registra eventos e recupera por correlationId; multi-tenant", () => {
      clearNormativeEvents();
      recordNormativeEvent({ correlationId: "corr-rc461", tenantId: ORG, type: "hierarchyCreated", subjectId: LEI_14133_NORM_ID, detail: "árvore", count: 16 });
      recordNormativeEvent({ correlationId: "corr-rc461", tenantId: ORG, type: "graphProjected", subjectId: LEI_14133_NORM_ID, detail: "kg", count: 16 });
      const evs = getNormativeEvents("corr-rc461");
      expect(evs.length).toBe(2);
      expect(evs.map(e => e.type)).toEqual(["hierarchyCreated", "graphProjected"]);
      expect(evs[0].tenantId).toBe(ORG);
      expect(getNormativeEvents("inexistente")).toEqual([]);
    });
  });

  // ─── Determinismo / Replay Safety ───────────────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("mesma árvore → mesma validação e mesma projeção", () => {
      const t1 = buildFederalProcurementTree(ORG); const t2 = buildFederalProcurementTree(ORG);
      expect(validateNormativeTree(t1)).toEqual(validateNormativeTree(t2));
      expect(projectNormativeTree(t1)).toEqual(projectNormativeTree(t2));
    });
  });
});
