/**
 * RC-4.4 — Institutional Legal Ontology
 *
 * Valida a ESTRUTURA do conhecimento jurídico (não o conteúdo): tipos normativos,
 * hierarquia, estrutura interna, conceitos, relacionamentos, classificações — declarativos,
 * consistentes, acíclicos e determinísticos. Independente de qualquer lei/tribunal/país.
 */

import { describe, it, expect } from "vitest";
import {
  NORM_TYPES, ALL_NORM_TYPE_IDS, NORMATIVE_HIERARCHY, ALL_LEGAL_CLASSIFICATIONS,
  getNormType, isNormType, normsByClassification, type NormTypeId,
} from "../../domain/legal/normTypes";
import { NORM_STRUCTURE, ALL_STRUCTURAL_ELEMENT_IDS, structuralPath } from "../../domain/legal/normStructure";
import { LEGAL_CONCEPTS, ALL_LEGAL_CONCEPT_IDS, conceptsByCategory } from "../../domain/legal/legalConcepts";
import {
  validateLegalOntology, LEGAL_ONTOLOGY, ALL_LEGAL_RELATIONSHIP_KINDS, getLegalRelationships,
  toLegalOntologyNodes, toLegalOntologyEdges, legalOntologyFingerprint, getHierarchyLevel,
  getNormDependencies, type LegalRelationshipKind,
} from "../../domain/legal/legalOntology";

describe("RC-4.4 — Institutional Legal Ontology", () => {

  // ─── Part 1 — Elementos jurídicos ───────────────────────────────────────────
  describe("Tipos normativos", () => {
    it("os 15 elementos jurídicos estão modelados com tipo/hierarquia/origem/escopo", () => {
      expect(ALL_NORM_TYPE_IDS).toHaveLength(15);
      for (const id of ALL_NORM_TYPE_IDS) {
        const n = getNormType(id);
        for (const f of ["classification", "origin", "scope", "hierarchyLevel", "dependsOn"]) expect(n, `${id}.${f}`).toHaveProperty(f);
      }
      expect(NORM_TYPES.lei.name).toBe("Lei");
      expect(NORM_TYPES.acordao.origin).toBe("judiciario");
    });
  });

  // ─── Part 2 — Estrutura normativa ───────────────────────────────────────────
  describe("Estrutura normativa interna", () => {
    it("os 10 elementos estruturais têm pai/filhos/nível/posição coerentes", () => {
      expect(ALL_STRUCTURAL_ELEMENT_IDS).toHaveLength(10);
      for (const id of ALL_STRUCTURAL_ELEMENT_IDS) {
        const s = NORM_STRUCTURE[id];
        for (const f of ["parent", "children", "level", "order"]) expect(s, `${id}.${f}`).toHaveProperty(f);
      }
      // caminho hierárquico do item vai da raiz até ele
      const path = structuralPath("item");
      expect(path[0]).toBe("titulo");
      expect(path[path.length - 1]).toBe("item");
    });
  });

  // ─── Part 3 — Conceitos jurídicos ───────────────────────────────────────────
  describe("Conceitos jurídicos estruturais", () => {
    it("os 16 conceitos estão categorizados", () => {
      expect(ALL_LEGAL_CONCEPT_IDS).toHaveLength(16);
      for (const id of ALL_LEGAL_CONCEPT_IDS) expect(LEGAL_CONCEPTS[id].category.length).toBeGreaterThan(0);
      expect(conceptsByCategory("deontico")).toEqual(expect.arrayContaining(["obrigacao", "vedacao", "permissao"]));
    });
  });

  // ─── Part 4 — Relacionamentos ───────────────────────────────────────────────
  describe("Relacionamentos jurídicos", () => {
    it("os 11 tipos de relacionamento estão presentes com extremos válidos", () => {
      const kinds: LegalRelationshipKind[] = [...ALL_LEGAL_RELATIONSHIP_KINDS];
      expect(kinds).toHaveLength(11);
      for (const k of kinds) expect(getLegalRelationships(k).length, k).toBeGreaterThan(0);
      for (const r of getLegalRelationships()) { expect(isNormType(r.from)).toBe(true); expect(isNormType(r.to)).toBe(true); }
    });
  });

  // ─── Part 5 — Hierarquia ────────────────────────────────────────────────────
  describe("Hierarquia normativa", () => {
    it("Lei → Decreto → IN → Portaria → Orientação → Manual → Nota Técnica (níveis crescentes)", () => {
      expect(NORMATIVE_HIERARCHY[0]).toBe("lei");
      for (let i = 1; i < NORMATIVE_HIERARCHY.length; i++) {
        expect(getHierarchyLevel(NORMATIVE_HIERARCHY[i])).toBeGreaterThan(getHierarchyLevel(NORMATIVE_HIERARCHY[i - 1]));
      }
      // dependência aponta para nível superior (menor)
      for (const dep of getNormDependencies("decreto")) expect(getHierarchyLevel(dep)).toBeLessThan(getHierarchyLevel("decreto"));
    });
  });

  // ─── Part 6 — Classificações ────────────────────────────────────────────────
  describe("Classificações (taxonomias)", () => {
    it("as taxonomias existem e classificam os tipos normativos", () => {
      expect(ALL_LEGAL_CLASSIFICATIONS).toEqual(expect.arrayContaining(["norma_primaria", "norma_secundaria", "norma_complementar", "jurisprudencia", "doutrina"]));
      expect(normsByClassification("norma_primaria")).toContain("lei");
      expect(normsByClassification("jurisprudencia")).toContain("acordao");
    });
  });

  // ─── Part 7/10 — Consistência + zero ciclos ─────────────────────────────────
  describe("Consistência do modelo jurídico", () => {
    it("validateLegalOntology é válido (zero erros, zero ciclos, hierarquia válida)", () => {
      const v = validateLegalOntology();
      expect(v.errors, v.errors.join("; ")).toEqual([]);
      expect(v.valid).toBe(true);
    });
    it("o modelo único agrega hierarquia/conceitos/estruturas/relacionamentos/classificações", () => {
      for (const k of ["normTypes", "structure", "concepts", "relationships", "classifications", "hierarchy"]) expect(LEGAL_ONTOLOGY).toHaveProperty(k);
    });
  });

  // ─── Part 8 — Projeção Knowledge Graph ──────────────────────────────────────
  describe("Projeção para Knowledge Graph", () => {
    it("nós (norm/struct/concept/class) e arestas tipadas, determinísticos", () => {
      const nodes = toLegalOntologyNodes();
      const edges = toLegalOntologyEdges();
      expect(nodes.length).toBe(15 + 10 + 16 + ALL_LEGAL_CLASSIFICATIONS.length);
      expect(nodes.some(n => n.id === "norm:lei")).toBe(true);
      expect(edges.some(e => e.type === "hierarquia")).toBe(true);
      expect(edges.some(e => e.type === "contains")).toBe(true);
      expect(edges.some(e => e.type === "classified_as")).toBe(true);
      // arestas referenciam nós existentes
      const nodeIds = new Set(nodes.map(n => n.id));
      for (const e of edges) { expect(nodeIds.has(e.from)).toBe(true); expect(nodeIds.has(e.to)).toBe(true); }
      // determinismo
      expect(toLegalOntologyNodes()).toEqual(nodes);
      expect(toLegalOntologyEdges()).toEqual(edges);
    });
  });

  // ─── Part 9 — Determinismo / Replay Safety ──────────────────────────────────
  describe("Determinismo (Replay Safety)", () => {
    it("fingerprint e validação são determinísticos", () => {
      expect(legalOntologyFingerprint()).toBe(legalOntologyFingerprint());
      expect(legalOntologyFingerprint()).toHaveLength(20);
      const a = validateLegalOntology(); const b = validateLegalOntology();
      expect(a.valid).toBe(b.valid); expect(a.errors).toEqual(b.errors);
    });
    it("independente de lei específica: nenhum id referencia norma concreta (ex.: 14133)", () => {
      const ids: NormTypeId[] = [...ALL_NORM_TYPE_IDS];
      expect(ids.join(",")).not.toMatch(/14\.?133|8\.?666|acordao_\d|lei_\d/);
    });
  });
});
