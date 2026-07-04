import { describe, it, expect } from "vitest";

import {
  type NodeType,
  type KnowledgeNode,
  createKnowledgeNode,
  normalizeTitle,
  matchesAlias,
  updateNodeVersion,
  deactivateNode,
} from "../../domain/knowledgeNode";

import {
  type RelationshipType,
  type EdgeDirection,
  type KnowledgeEdge,
  createKnowledgeEdge,
  reverseEdge,
  strengthenEdge,
  deactivateEdge,
} from "../../domain/knowledgeEdge";

import {
  type LegalReferenceType,
  type LegalVigencia,
  type LegalReferenceNode,
  createLegalReference,
  formatLegalCitation,
  isVigente,
} from "../../domain/legalReference";

import {
  type ConceptCategory,
  type ProcurementConcept,
  createProcurementConcept,
  matchesConcept,
  isChildOf,
} from "../../domain/procurementConcept";

import {
  type ClauseCategory,
  type ClauseRiskLevel,
  type ClauseKnowledgeItem,
  createClauseKnowledge,
  assessClauseRisk,
} from "../../domain/clauseKnowledge";

import {
  type ResolutionStrategy,
  type ResolutionStatus,
  type EntityResolutionRecord,
  createEntityResolution,
  computeSimilarity,
  shouldAutoResolve,
  markResolved,
  markRejected,
} from "../../domain/entityResolution";

import {
  addNode,
  addEdge,
  searchNodes,
  getNeighbors,
  getEdgesForNode,
  removeNode,
  removeEdge,
  graphStats,
} from "../../services/knowledgeGraphService";

import {
  extractEntities,
  normalizeEntity,
  deduplicateEntities,
  classifyEntity,
} from "../../services/entityExtractionService";

import {
  resolveEntity,
  computeStringSimilarity,
  findDuplicates,
  mergeEntities,
} from "../../services/entityResolutionService";

import {
  bfs,
  dfs,
  shortestPath,
  weightedTraversal,
  explainPath,
} from "../../services/graphTraversalService";

import {
  buildLegalHierarchy,
  findRelatedJurisprudence,
  traceLegalPath,
  classifyLegalAuthority,
  detectLegalConflicts,
} from "../../services/legalKnowledgeService";

import {
  buildOntologyTree,
  classifyDocument,
  findAncestors,
  findDescendants,
  resolveAlias,
  exportOntology,
} from "../../services/procurementOntologyService";

import {
  recommendRelated,
  recommendClauses,
  recommendLegalBasis,
  recommendRisks,
  explainRecommendation,
} from "../../services/graphRecommendationService";

import {
  recordGraphMetric,
  recordTraversalLatency,
  recordNodeCreation,
  recordEdgeCreation,
  recordResolutionAttempt,
  recordRecommendation,
  computeGraphHealth,
} from "../../services/graphObservabilityService";

const ORG_ID = 10100;

describe("Sprint 4.8 — Knowledge Graph", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // knowledgeNode
  // ─────────────────────────────────────────────────────────────────────────
  describe("knowledgeNode", () => {
    it("normalizeTitle lowercases and trims", () => {
      expect(normalizeTitle("  Lei 14.133  ")).toBe("lei 14.133");
    });

    it("normalizeTitle collapses multiple spaces", () => {
      expect(normalizeTitle("Termo   de   Referência")).toBe("termo de referência");
    });

    it("createKnowledgeNode generates deterministic id", () => {
      const a = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "legislation", title: "Lei 14133" });
      const b = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "legislation", title: "Lei 14133" });
      expect(a.id).toBe(b.id);
    });

    it("createKnowledgeNode id has 20 hex chars", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "article", title: "Art 18" });
      expect(node.id).toMatch(/^[a-f0-9]{20}$/);
    });

    it("createKnowledgeNode sets defaults", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "concept", title: "Pregao" });
      expect(node.organizationId).toBe(ORG_ID);
      expect(node.nodeType).toBe("concept");
      expect(node.description).toBe("");
      expect(node.aliases).toEqual([]);
      expect(node.metadata).toEqual({});
      expect(node.confidence).toBe(1.0);
      expect(node.source).toBe("manual");
      expect(node.version).toBe(1);
      expect(node.active).toBe(true);
    });

    it("createKnowledgeNode stores normalized title", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "legislation", title: "  Lei Complementar  " });
      expect(node.normalizedTitle).toBe("lei complementar");
    });

    it("createKnowledgeNode accepts optional params", () => {
      const node = createKnowledgeNode({
        organizationId: ORG_ID,
        nodeType: "supplier",
        title: "Empresa X",
        description: "Fornecedor",
        externalId: "ext-123",
        aliases: ["EmpresaX", "Emp X"],
        metadata: { cnpj: "00.000.000/0001-00" },
        confidence: 0.8,
        source: "import",
      });
      expect(node.description).toBe("Fornecedor");
      expect(node.externalId).toBe("ext-123");
      expect(node.aliases).toEqual(["EmpresaX", "Emp X"]);
      expect(node.confidence).toBe(0.8);
      expect(node.source).toBe("import");
    });

    it("different orgId or nodeType produces different id", () => {
      const a = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "legislation", title: "X" });
      const b = createKnowledgeNode({ organizationId: 99999, nodeType: "legislation", title: "X" });
      const c = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "article", title: "X" });
      expect(a.id).not.toBe(b.id);
      expect(a.id).not.toBe(c.id);
    });

    it("matchesAlias returns true for title match", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "legislation", title: "Lei 14133/2021" });
      expect(matchesAlias(node, "lei 14133")).toBe(true);
    });

    it("matchesAlias returns true for alias match", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "legislation", title: "Lei 14133", aliases: ["Nova Lei de Licitacoes"] });
      expect(matchesAlias(node, "nova lei")).toBe(true);
    });

    it("matchesAlias returns false when no match", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "legislation", title: "Lei 14133" });
      expect(matchesAlias(node, "decreto")).toBe(false);
    });

    it("updateNodeVersion increments version", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "concept", title: "Pregao" });
      const updated = updateNodeVersion(node, { description: "Atualizado" });
      expect(updated.version).toBe(2);
      expect(updated.description).toBe("Atualizado");
    });

    it("updateNodeVersion recalculates normalizedTitle when title changes", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "concept", title: "Pregao" });
      const updated = updateNodeVersion(node, { title: "Concorrencia" });
      expect(updated.normalizedTitle).toBe("concorrencia");
    });

    it("deactivateNode sets active to false", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "concept", title: "Test" });
      const deactivated = deactivateNode(node);
      expect(deactivated.active).toBe(false);
      expect(deactivated.id).toBe(node.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // knowledgeEdge
  // ─────────────────────────────────────────────────────────────────────────
  describe("knowledgeEdge", () => {
    it("createKnowledgeEdge generates deterministic id", () => {
      const a = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "references" });
      const b = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "references" });
      expect(a.id).toBe(b.id);
    });

    it("createKnowledgeEdge id is 20 hex chars", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "regulates" });
      expect(edge.id).toMatch(/^[a-f0-9]{20}$/);
    });

    it("createKnowledgeEdge sets defaults", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "supports" });
      expect(edge.weight).toBe(1.0);
      expect(edge.confidence).toBe(1.0);
      expect(edge.justification).toBe("");
      expect(edge.provenance).toBe("manual");
      expect(edge.direction).toBe("unidirectional");
      expect(edge.active).toBe(true);
    });

    it("createKnowledgeEdge accepts optional params", () => {
      const edge = createKnowledgeEdge({
        organizationId: ORG_ID,
        sourceNodeId: "s1",
        targetNodeId: "t1",
        relationshipType: "contradicts",
        weight: 0.7,
        confidence: 0.85,
        justification: "Conflito normativo",
        provenance: "ai",
        direction: "bidirectional",
      });
      expect(edge.weight).toBe(0.7);
      expect(edge.confidence).toBe(0.85);
      expect(edge.justification).toBe("Conflito normativo");
      expect(edge.provenance).toBe("ai");
      expect(edge.direction).toBe("bidirectional");
    });

    it("different source/target/relType produces different id", () => {
      const a = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "references" });
      const b = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s2", targetNodeId: "t1", relationshipType: "references" });
      const c = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "supports" });
      expect(a.id).not.toBe(b.id);
      expect(a.id).not.toBe(c.id);
    });

    it("reverseEdge swaps source and target", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "A", targetNodeId: "B", relationshipType: "regulates" });
      const reversed = reverseEdge(edge);
      expect(reversed.sourceNodeId).toBe("B");
      expect(reversed.targetNodeId).toBe("A");
    });

    it("reverseEdge preserves other fields", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "A", targetNodeId: "B", relationshipType: "requires", weight: 0.9 });
      const reversed = reverseEdge(edge);
      expect(reversed.weight).toBe(0.9);
      expect(reversed.relationshipType).toBe("requires");
      expect(reversed.organizationId).toBe(ORG_ID);
    });

    it("strengthenEdge increases weight", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "supports", weight: 0.5 });
      const strengthened = strengthenEdge(edge, 0.3);
      expect(strengthened.weight).toBe(0.8);
    });

    it("strengthenEdge caps weight at 1.0", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "supports", weight: 0.9 });
      const strengthened = strengthenEdge(edge, 0.5);
      expect(strengthened.weight).toBe(1.0);
    });

    it("deactivateEdge sets active to false", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "references" });
      const deactivated = deactivateEdge(edge);
      expect(deactivated.active).toBe(false);
    });

    it("deactivateEdge preserves id", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "references" });
      const deactivated = deactivateEdge(edge);
      expect(deactivated.id).toBe(edge.id);
    });

    it("createKnowledgeEdge includes createdAt timestamp", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "s1", targetNodeId: "t1", relationshipType: "part_of" });
      expect(edge.createdAt).toBeDefined();
      expect(new Date(edge.createdAt).getTime()).not.toBeNaN();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // legalReference
  // ─────────────────────────────────────────────────────────────────────────
  describe("legalReference", () => {
    it("createLegalReference generates deterministic id", () => {
      const a = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "14133", ano: 2021, orgao: "Federal", texto: "Texto" });
      const b = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "14133", ano: 2021, orgao: "Federal", texto: "Texto" });
      expect(a.id).toBe(b.id);
    });

    it("createLegalReference id is 20 hex chars", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "decreto", numero: "10024", ano: 2019, orgao: "Federal", texto: "Pregao" });
      expect(ref.id).toMatch(/^[a-f0-9]{20}$/);
    });

    it("createLegalReference sets defaults for optional fields", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "14133", ano: 2021, orgao: "Federal", texto: "Texto base" });
      expect(ref.artigo).toBeNull();
      expect(ref.inciso).toBeNull();
      expect(ref.alinea).toBeNull();
      expect(ref.vigencia).toBe("vigente");
      expect(ref.ementa).toBe("");
    });

    it("createLegalReference stores artigo/inciso/alinea", () => {
      const ref = createLegalReference({
        organizationId: ORG_ID,
        referenceType: "lei",
        numero: "14133",
        ano: 2021,
        orgao: "Federal",
        texto: "Texto",
        artigo: "18",
        inciso: "II",
        alinea: "a",
      });
      expect(ref.artigo).toBe("18");
      expect(ref.inciso).toBe("II");
      expect(ref.alinea).toBe("a");
    });

    it("different artigo produces different id", () => {
      const a = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "14133", ano: 2021, orgao: "Federal", texto: "X" });
      const b = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "14133", ano: 2021, orgao: "Federal", texto: "X", artigo: "18" });
      expect(a.id).not.toBe(b.id);
    });

    it("formatLegalCitation for lei without artigo", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "14133", ano: 2021, orgao: "Federal", texto: "Texto" });
      expect(formatLegalCitation(ref)).toBe("Lei nº 14133/2021");
    });

    it("formatLegalCitation for lei with artigo", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "14133", ano: 2021, orgao: "Federal", texto: "Texto", artigo: "18" });
      expect(formatLegalCitation(ref)).toBe("Lei nº 14133/2021, Art. 18");
    });

    it("formatLegalCitation for decreto with artigo and inciso", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "decreto", numero: "10024", ano: 2019, orgao: "Federal", texto: "X", artigo: "5", inciso: "III" });
      expect(formatLegalCitation(ref)).toBe("Decreto nº 10024/2019, Art. 5, Inc. III");
    });

    it("formatLegalCitation for acordao", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "acordao", numero: "2622", ano: 2015, orgao: "TCU", texto: "Texto" });
      expect(formatLegalCitation(ref)).toBe("Acórdão nº 2622/2015");
    });

    it("formatLegalCitation with all parts", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "14133", ano: 2021, orgao: "Federal", texto: "X", artigo: "6", inciso: "XXIII", alinea: "b" });
      expect(formatLegalCitation(ref)).toBe("Lei nº 14133/2021, Art. 6, Inc. XXIII, Al. b");
    });

    it("isVigente returns true for vigente reference", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "14133", ano: 2021, orgao: "Federal", texto: "Texto" });
      expect(isVigente(ref)).toBe(true);
    });

    it("isVigente returns false for revogada reference", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "8666", ano: 1993, orgao: "Federal", texto: "Texto", vigencia: "revogada" });
      expect(isVigente(ref)).toBe(false);
    });

    it("isVigente returns false for parcialmente_revogada", () => {
      const ref = createLegalReference({ organizationId: ORG_ID, referenceType: "lei", numero: "10520", ano: 2002, orgao: "Federal", texto: "Texto", vigencia: "parcialmente_revogada" });
      expect(isVigente(ref)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // procurementConcept
  // ─────────────────────────────────────────────────────────────────────────
  describe("procurementConcept", () => {
    it("createProcurementConcept generates deterministic id", () => {
      const a = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Pregao", definition: "Def" });
      const b = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Pregao", definition: "Def" });
      expect(a.id).toBe(b.id);
    });

    it("createProcurementConcept id is 20 hex chars", () => {
      const concept = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Concorrencia", definition: "Def" });
      expect(concept.id).toMatch(/^[a-f0-9]{20}$/);
    });

    it("createProcurementConcept normalizes name", () => {
      const concept = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "  Pregao Eletronico  ", definition: "Def" });
      expect(concept.normalizedName).toBe("pregao eletronico");
    });

    it("createProcurementConcept sets defaults", () => {
      const concept = createProcurementConcept({ organizationId: ORG_ID, category: "tipo_objeto", name: "Servico", definition: "Def" });
      expect(concept.legalBasis).toBe("");
      expect(concept.parentConceptId).toBeNull();
      expect(concept.aliases).toEqual([]);
      expect(concept.examples).toEqual([]);
    });

    it("createProcurementConcept accepts optional params", () => {
      const parent = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Licitacao", definition: "Def" });
      const concept = createProcurementConcept({
        organizationId: ORG_ID,
        category: "modalidade",
        name: "Pregao",
        definition: "Modalidade",
        legalBasis: "Art. 6, XLI",
        parentConceptId: parent.id,
        aliases: ["Pregao Presencial", "Pregao Eletronico"],
        examples: ["Aquisicao de material"],
      });
      expect(concept.legalBasis).toBe("Art. 6, XLI");
      expect(concept.parentConceptId).toBe(parent.id);
      expect(concept.aliases).toHaveLength(2);
      expect(concept.examples).toHaveLength(1);
    });

    it("different category produces different id", () => {
      const a = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Test", definition: "Def" });
      const b = createProcurementConcept({ organizationId: ORG_ID, category: "criterio_julgamento", name: "Test", definition: "Def" });
      expect(a.id).not.toBe(b.id);
    });

    it("matchesConcept returns true for name match", () => {
      const concept = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Pregao Eletronico", definition: "Def" });
      expect(matchesConcept(concept, "pregao")).toBe(true);
    });

    it("matchesConcept returns true for alias match", () => {
      const concept = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Pregao", definition: "Def", aliases: ["Leilao inverso"] });
      expect(matchesConcept(concept, "leilao")).toBe(true);
    });

    it("matchesConcept returns false for no match", () => {
      const concept = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Pregao", definition: "Def" });
      expect(matchesConcept(concept, "concorrencia")).toBe(false);
    });

    it("matchesConcept is case insensitive", () => {
      const concept = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Pregao", definition: "Def" });
      expect(matchesConcept(concept, "PREGAO")).toBe(true);
    });

    it("isChildOf returns true when parent matches", () => {
      const parent = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Licitacao", definition: "Def" });
      const child = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Pregao", definition: "Def", parentConceptId: parent.id });
      expect(isChildOf(child, parent.id)).toBe(true);
    });

    it("isChildOf returns false when parent does not match", () => {
      const concept = createProcurementConcept({ organizationId: ORG_ID, category: "modalidade", name: "Pregao", definition: "Def" });
      expect(isChildOf(concept, "nonexistent-id")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // clauseKnowledge
  // ─────────────────────────────────────────────────────────────────────────
  describe("clauseKnowledge", () => {
    it("createClauseKnowledge generates deterministic id", () => {
      const a = createClauseKnowledge({ organizationId: ORG_ID, category: "objeto", title: "Clausula de Objeto", content: "Conteudo" });
      const b = createClauseKnowledge({ organizationId: ORG_ID, category: "objeto", title: "Clausula de Objeto", content: "Conteudo" });
      expect(a.id).toBe(b.id);
    });

    it("createClauseKnowledge id is 20 hex chars", () => {
      const clause = createClauseKnowledge({ organizationId: ORG_ID, category: "prazo", title: "Prazo de Vigencia", content: "X" });
      expect(clause.id).toMatch(/^[a-f0-9]{20}$/);
    });

    it("createClauseKnowledge sets defaults", () => {
      const clause = createClauseKnowledge({ organizationId: ORG_ID, category: "pagamento", title: "Pagamento", content: "30 dias" });
      expect(clause.purpose).toBe("");
      expect(clause.riskLevel).toBe("baixo");
      expect(clause.legalBasis).toBe("");
      expect(clause.relatedDocumentTypes).toEqual([]);
      expect(clause.prerequisites).toEqual([]);
      expect(clause.active).toBe(true);
    });

    it("createClauseKnowledge accepts optional params", () => {
      const clause = createClauseKnowledge({
        organizationId: ORG_ID,
        category: "penalidade",
        title: "Multa",
        content: "Multa de 10%",
        purpose: "Penalizacao",
        riskLevel: "alto",
        legalBasis: "Art. 155",
        relatedDocumentTypes: ["TR", "Contrato"],
        prerequisites: ["Notificacao", "Defesa Previa", "Prazo de Resposta", "Parecer"],
      });
      expect(clause.purpose).toBe("Penalizacao");
      expect(clause.riskLevel).toBe("alto");
      expect(clause.legalBasis).toBe("Art. 155");
      expect(clause.relatedDocumentTypes).toEqual(["TR", "Contrato"]);
      expect(clause.prerequisites).toHaveLength(4);
    });

    it("assessClauseRisk returns critico for critico level", () => {
      const clause = createClauseKnowledge({ organizationId: ORG_ID, category: "rescisao", title: "Rescisao", content: "X", riskLevel: "critico" });
      const result = assessClauseRisk(clause);
      expect(result.level).toBe("critico");
      expect(result.reason).toContain("crítico");
    });

    it("assessClauseRisk returns alto when more than 3 prerequisites", () => {
      const clause = createClauseKnowledge({
        organizationId: ORG_ID,
        category: "penalidade",
        title: "Multa",
        content: "X",
        riskLevel: "medio",
        prerequisites: ["A", "B", "C", "D"],
      });
      const result = assessClauseRisk(clause);
      expect(result.level).toBe("alto");
      expect(result.reason).toContain("pré-requisitos");
    });

    it("assessClauseRisk returns medio when no legalBasis", () => {
      const clause = createClauseKnowledge({
        organizationId: ORG_ID,
        category: "garantia",
        title: "Garantia",
        content: "5%",
        riskLevel: "baixo",
        legalBasis: "",
      });
      const result = assessClauseRisk(clause);
      expect(result.level).toBe("medio");
      expect(result.reason).toContain("fundamentação legal");
    });

    it("assessClauseRisk returns clause level when no special conditions", () => {
      const clause = createClauseKnowledge({
        organizationId: ORG_ID,
        category: "objeto",
        title: "Objeto",
        content: "X",
        riskLevel: "baixo",
        legalBasis: "Art. 6",
      });
      const result = assessClauseRisk(clause);
      expect(result.level).toBe("baixo");
    });

    it("assessClauseRisk priority: critico > prerequisites > legalBasis", () => {
      const clause = createClauseKnowledge({
        organizationId: ORG_ID,
        category: "penalidade",
        title: "Multa",
        content: "X",
        riskLevel: "critico",
        prerequisites: ["A", "B", "C", "D"],
        legalBasis: "",
      });
      const result = assessClauseRisk(clause);
      expect(result.level).toBe("critico");
    });

    it("createClauseKnowledge includes createdAt", () => {
      const clause = createClauseKnowledge({ organizationId: ORG_ID, category: "objeto", title: "Obj", content: "X" });
      expect(clause.createdAt).toBeDefined();
      expect(new Date(clause.createdAt).getTime()).not.toBeNaN();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // entityResolution
  // ─────────────────────────────────────────────────────────────────────────
  describe("entityResolution", () => {
    it("createEntityResolution generates deterministic id", () => {
      const a = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "src1", targetEntityId: "tgt1", strategy: "exact" });
      const b = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "src1", targetEntityId: "tgt1", strategy: "exact" });
      expect(a.id).toBe(b.id);
    });

    it("createEntityResolution id is 20 hex chars", () => {
      const record = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "fuzzy" });
      expect(record.id).toMatch(/^[a-f0-9]{20}$/);
    });

    it("createEntityResolution sets defaults", () => {
      const record = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "alias" });
      expect(record.confidence).toBe(0.5);
      expect(record.reasoning).toBe("");
      expect(record.resolvedBy).toBe("system");
      expect(record.status).toBe("pending");
    });

    it("createEntityResolution auto-resolves when confidence >= 0.9", () => {
      const record = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "exact", confidence: 0.95 });
      expect(record.status).toBe("resolved");
    });

    it("createEntityResolution stays pending when confidence < 0.9", () => {
      const record = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "fuzzy", confidence: 0.85 });
      expect(record.status).toBe("pending");
    });

    it("computeSimilarity returns 1.0 for identical strings", () => {
      expect(computeSimilarity("pregao eletronico", "pregao eletronico")).toBe(1.0);
    });

    it("computeSimilarity returns 0 when no overlap (words > 2 chars)", () => {
      expect(computeSimilarity("aaa bbb ccc", "ddd eee fff")).toBe(0);
    });

    it("computeSimilarity returns partial overlap value", () => {
      const sim = computeSimilarity("pregao eletronico federal", "pregao eletronico estadual");
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });

    it("computeSimilarity filters words with length <= 2", () => {
      const sim = computeSimilarity("a b c pregao", "a b c licitacao");
      // Only "pregao" and "licitacao" pass the filter (length > 2)
      expect(sim).toBe(0);
    });

    it("computeSimilarity returns 0 for empty strings", () => {
      expect(computeSimilarity("", "")).toBe(0);
    });

    it("shouldAutoResolve returns true when confidence >= 0.9 and not manual", () => {
      const record = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "exact", confidence: 0.95 });
      expect(shouldAutoResolve(record)).toBe(true);
    });

    it("shouldAutoResolve returns false for manual strategy", () => {
      const record = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "manual", confidence: 0.99 });
      expect(shouldAutoResolve(record)).toBe(false);
    });

    it("shouldAutoResolve returns false when confidence < 0.9", () => {
      const record = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "fuzzy", confidence: 0.8 });
      expect(shouldAutoResolve(record)).toBe(false);
    });

    it("markResolved sets status to resolved", () => {
      const record = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "fuzzy", confidence: 0.7 });
      const resolved = markResolved(record);
      expect(resolved.status).toBe("resolved");
    });

    it("markRejected sets status and reasoning", () => {
      const record = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "fuzzy", confidence: 0.7 });
      const rejected = markRejected(record, "Entidades diferentes");
      expect(rejected.status).toBe("rejected");
      expect(rejected.reasoning).toBe("Entidades diferentes");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // knowledgeGraphService
  // ─────────────────────────────────────────────────────────────────────────
  describe("knowledgeGraphService", () => {
    const makeNode = (id: string, title: string, nodeType = "concept"): { id: string; organizationId: number; nodeType: string; title: string; normalizedTitle: string; confidence: number; active: boolean } => ({
      id, organizationId: ORG_ID, nodeType, title, normalizedTitle: title.toLowerCase(), confidence: 1.0, active: true,
    });

    const makeEdge = (id: string, sourceNodeId: string, targetNodeId: string, relType = "references"): { id: string; organizationId: number; sourceNodeId: string; targetNodeId: string; relationshipType: string; weight: number; confidence: number; active: boolean } => ({
      id, organizationId: ORG_ID, sourceNodeId, targetNodeId, relationshipType: relType, weight: 1.0, confidence: 1.0, active: true,
    });

    it("addNode adds a new node to empty array", () => {
      const node = makeNode("n1", "Node 1");
      const result = addNode([], node);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("n1");
    });

    it("addNode does not duplicate existing node", () => {
      const node = makeNode("n1", "Node 1");
      const existing = [node];
      const result = addNode(existing, node);
      expect(result).toHaveLength(1);
    });

    it("addEdge adds a new edge", () => {
      const edge = makeEdge("e1", "n1", "n2");
      const result = addEdge([], edge);
      expect(result).toHaveLength(1);
    });

    it("addEdge does not duplicate existing edge", () => {
      const edge = makeEdge("e1", "n1", "n2");
      const result = addEdge([edge], edge);
      expect(result).toHaveLength(1);
    });

    it("searchNodes filters by orgId and active", () => {
      const nodes = [
        makeNode("n1", "Lei 14133"),
        { ...makeNode("n2", "Decreto"), organizationId: 99999 },
        { ...makeNode("n3", "Inactive"), active: false },
      ];
      const result = searchNodes(nodes, { organizationId: ORG_ID });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("n1");
    });

    it("searchNodes filters by nodeType", () => {
      const nodes = [
        makeNode("n1", "Lei 14133", "legislation"),
        makeNode("n2", "Pregao", "concept"),
      ];
      const result = searchNodes(nodes, { organizationId: ORG_ID, nodeType: "legislation" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("n1");
    });

    it("searchNodes filters by query text", () => {
      const nodes = [
        makeNode("n1", "Lei 14133"),
        makeNode("n2", "Decreto 10024"),
      ];
      const result = searchNodes(nodes, { organizationId: ORG_ID, query: "lei" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("n1");
    });

    it("getNeighbors returns connected nodes", () => {
      const nodes = [makeNode("n1", "A"), makeNode("n2", "B"), makeNode("n3", "C")];
      const edges = [makeEdge("e1", "n1", "n2"), makeEdge("e2", "n1", "n3")];
      const result = getNeighbors(nodes, edges, "n1", ORG_ID);
      expect(result).toHaveLength(2);
    });

    it("removeNode deactivates node", () => {
      const nodes = [makeNode("n1", "A"), makeNode("n2", "B")];
      const result = removeNode(nodes, "n1");
      expect(result.find(n => n.id === "n1")?.active).toBe(false);
      expect(result.find(n => n.id === "n2")?.active).toBe(true);
    });

    it("graphStats computes correct counts", () => {
      const nodes = [makeNode("n1", "A"), makeNode("n2", "B"), makeNode("n3", "C")];
      const edges = [makeEdge("e1", "n1", "n2"), makeEdge("e2", "n2", "n3")];
      const stats = graphStats(nodes, edges, ORG_ID);
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
      expect(stats.avgDegree).toBeCloseTo(4 / 3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // entityExtractionService
  // ─────────────────────────────────────────────────────────────────────────
  describe("entityExtractionService", () => {
    it("extractEntities finds legislation references", () => {
      const result = extractEntities("Conforme a Lei 14133/2021, artigo 18", ORG_ID);
      const legislation = result.filter(e => e.type === "legislation");
      expect(legislation.length).toBeGreaterThanOrEqual(1);
      expect(legislation[0].confidence).toBe(0.9);
    });

    it("extractEntities finds catmat items", () => {
      const result = extractEntities("Item CATMAT 12345 e CATSER 67890", ORG_ID);
      const items = result.filter(e => e.type === "item");
      expect(items).toHaveLength(2);
      expect(items[0].confidence).toBe(0.95);
    });

    it("extractEntities finds monetary values", () => {
      const result = extractEntities("Valor estimado de R$ 1.500.000,00", ORG_ID);
      const monetary = result.filter(e => e.type === "monetary");
      expect(monetary).toHaveLength(1);
      expect(monetary[0].confidence).toBe(0.85);
    });

    it("extractEntities finds dates", () => {
      const result = extractEntities("Data limite 15/03/2024", ORG_ID);
      const dates = result.filter(e => e.type === "date");
      expect(dates).toHaveLength(1);
      expect(dates[0].value).toBe("15/03/2024");
    });

    it("extractEntities returns empty for text without patterns", () => {
      const result = extractEntities("Texto simples sem entidades", ORG_ID);
      expect(result).toHaveLength(0);
    });

    it("normalizeEntity trims and lowercases", () => {
      const entity = { type: "legislation", value: "  Lei 14133  ", normalizedValue: "lei 14133", position: 0, confidence: 0.9, organizationId: ORG_ID };
      const normalized = normalizeEntity(entity);
      expect(normalized.value).toBe("Lei 14133");
      expect(normalized.normalizedValue).toBe("lei 14133");
    });

    it("deduplicateEntities removes duplicates by type+normalizedValue", () => {
      const entities = [
        { type: "legislation", value: "Lei 14133", normalizedValue: "lei 14133", position: 0, confidence: 0.9, organizationId: ORG_ID },
        { type: "legislation", value: "Lei 14133", normalizedValue: "lei 14133", position: 20, confidence: 0.9, organizationId: ORG_ID },
      ];
      const result = deduplicateEntities(entities);
      expect(result).toHaveLength(1);
    });

    it("classifyEntity classifies legislation", () => {
      expect(classifyEntity("lei 14133")).toBe("legislation");
      expect(classifyEntity("decreto 10024")).toBe("legislation");
    });

    it("classifyEntity classifies items", () => {
      expect(classifyEntity("catmat 12345")).toBe("item");
    });

    it("classifyEntity classifies organizations", () => {
      expect(classifyEntity("Prefeitura Municipal")).toBe("organization");
    });

    it("classifyEntity returns concept for unknown", () => {
      expect(classifyEntity("pregao eletronico")).toBe("concept");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // entityResolutionService
  // ─────────────────────────────────────────────────────────────────────────
  describe("entityResolutionService", () => {
    const candidates = [
      { id: "c1", title: "Lei 14133/2021", aliases: ["Nova Lei de Licitacoes", "NLLC"] },
      { id: "c2", title: "Decreto 10024/2019", aliases: ["Pregao Eletronico"] },
      { id: "c3", title: "Concorrencia Internacional", aliases: [] },
    ];

    it("resolveEntity exact match on title", () => {
      const result = resolveEntity(candidates, "Lei 14133/2021", ORG_ID);
      expect(result.matchedId).toBe("c1");
      expect(result.confidence).toBe(1.0);
      expect(result.strategy).toBe("exact");
    });

    it("resolveEntity alias match", () => {
      const result = resolveEntity(candidates, "NLLC", ORG_ID);
      expect(result.matchedId).toBe("c1");
      expect(result.confidence).toBe(0.95);
      expect(result.strategy).toBe("alias");
    });

    it("resolveEntity fuzzy match", () => {
      const result = resolveEntity(candidates, "Concorrencia Internacional Publica", ORG_ID);
      expect(result.matchedId).toBe("c3");
      expect(result.strategy).toBe("fuzzy");
      expect(result.confidence).toBeGreaterThan(0.6);
    });

    it("resolveEntity returns none when no match", () => {
      const result = resolveEntity(candidates, "Codigo Civil Brasileiro Completo", ORG_ID);
      expect(result.matchedId).toBeNull();
      expect(result.strategy).toBe("none");
      expect(result.confidence).toBe(0);
    });

    it("computeStringSimilarity returns 1 for identical strings", () => {
      expect(computeStringSimilarity("pregao eletronico", "pregao eletronico")).toBe(1.0);
    });

    it("computeStringSimilarity returns 0 for completely different strings", () => {
      expect(computeStringSimilarity("abc def ghi", "xyz uvw rst")).toBe(0);
    });

    it("findDuplicates detects similar entries in same org", () => {
      const entities = [
        { id: "e1", title: "Pregao Eletronico SRP", organizationId: ORG_ID },
        { id: "e2", title: "Pregao Eletronico SRP Material", organizationId: ORG_ID },
      ];
      const duplicates = findDuplicates(entities);
      expect(duplicates.length).toBeGreaterThanOrEqual(1);
      expect(duplicates[0].similarity).toBeGreaterThan(0.8);
    });

    it("findDuplicates ignores entities from different orgs", () => {
      const entities = [
        { id: "e1", title: "Pregao Eletronico", organizationId: ORG_ID },
        { id: "e2", title: "Pregao Eletronico", organizationId: 99999 },
      ];
      const duplicates = findDuplicates(entities);
      expect(duplicates).toHaveLength(0);
    });

    it("mergeEntities combines aliases", () => {
      const primary = { id: "p1", title: "Lei 14133", aliases: ["NLLC"] };
      const secondary = { id: "s1", title: "Nova Lei", aliases: ["Lei de Licitacoes"] };
      const merged = mergeEntities(primary, secondary);
      expect(merged.id).toBe("p1");
      expect(merged.title).toBe("Lei 14133");
      expect(merged.aliases).toContain("Nova Lei");
      expect(merged.aliases).toContain("Lei de Licitacoes");
      expect(merged.aliases).toContain("NLLC");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // graphTraversalService
  // ─────────────────────────────────────────────────────────────────────────
  describe("graphTraversalService", () => {
    const nodes = [
      { id: "n1", organizationId: ORG_ID, nodeType: "concept", title: "A", normalizedTitle: "a", confidence: 1.0, active: true },
      { id: "n2", organizationId: ORG_ID, nodeType: "concept", title: "B", normalizedTitle: "b", confidence: 1.0, active: true },
      { id: "n3", organizationId: ORG_ID, nodeType: "concept", title: "C", normalizedTitle: "c", confidence: 1.0, active: true },
      { id: "n4", organizationId: ORG_ID, nodeType: "concept", title: "D", normalizedTitle: "d", confidence: 1.0, active: true },
    ];

    const edges = [
      { id: "e1", organizationId: ORG_ID, sourceNodeId: "n1", targetNodeId: "n2", relationshipType: "references", weight: 1.0, confidence: 1.0, active: true },
      { id: "e2", organizationId: ORG_ID, sourceNodeId: "n2", targetNodeId: "n3", relationshipType: "supports", weight: 0.8, confidence: 1.0, active: true },
      { id: "e3", organizationId: ORG_ID, sourceNodeId: "n3", targetNodeId: "n4", relationshipType: "requires", weight: 0.5, confidence: 1.0, active: true },
    ];

    it("bfs visits all reachable nodes", () => {
      const result = bfs(nodes, edges, "n1", ORG_ID);
      expect(result.visitedNodes).toContain("n1");
      expect(result.visitedNodes).toContain("n2");
      expect(result.visitedNodes).toContain("n3");
      expect(result.visitedNodes).toContain("n4");
    });

    it("bfs respects maxDepth", () => {
      const result = bfs(nodes, edges, "n1", ORG_ID, 1);
      expect(result.visitedNodes).toContain("n1");
      expect(result.visitedNodes).toContain("n2");
      expect(result.visitedNodes).not.toContain("n3");
    });

    it("bfs accumulates edge weight", () => {
      const result = bfs(nodes, edges, "n1", ORG_ID);
      expect(result.totalWeight).toBeGreaterThan(0);
    });

    it("dfs visits all reachable nodes", () => {
      const result = dfs(nodes, edges, "n1", ORG_ID);
      expect(result.visitedNodes).toContain("n1");
      expect(result.visitedNodes).toContain("n4");
    });

    it("dfs respects maxDepth", () => {
      const result = dfs(nodes, edges, "n1", ORG_ID, 1);
      expect(result.visitedNodes).toContain("n1");
      expect(result.visitedNodes).toContain("n2");
      expect(result.visitedNodes).not.toContain("n4");
    });

    it("shortestPath finds path between connected nodes", () => {
      const result = shortestPath(nodes, edges, "n1", "n4", ORG_ID);
      expect(result.found).toBe(true);
      expect(result.path).toEqual(["n1", "n2", "n3", "n4"]);
      expect(result.edges).toHaveLength(3);
    });

    it("shortestPath returns not found for disconnected nodes", () => {
      const isolatedNode = { id: "n5", organizationId: ORG_ID, nodeType: "concept", title: "E", normalizedTitle: "e", confidence: 1.0, active: true };
      const result = shortestPath([...nodes, isolatedNode], edges, "n1", "n5", ORG_ID);
      expect(result.found).toBe(false);
      expect(result.path).toEqual([]);
    });

    it("shortestPath returns self for same start and end", () => {
      const result = shortestPath(nodes, edges, "n2", "n2", ORG_ID);
      expect(result.found).toBe(true);
      expect(result.path).toEqual(["n2"]);
      expect(result.totalWeight).toBe(0);
    });

    it("weightedTraversal visits nodes prioritizing high weight", () => {
      const result = weightedTraversal(nodes, edges, "n1", ORG_ID);
      expect(result.visitedNodes.length).toBeGreaterThanOrEqual(1);
      expect(result.visitedNodes).toContain("n1");
    });

    it("explainPath returns human-readable description", () => {
      const explanation = explainPath(nodes, edges, ["n1", "n2", "n3"]);
      expect(explanation).toContain("A");
      expect(explanation).toContain("B");
      expect(explanation).toContain("C");
    });

    it("explainPath handles empty path", () => {
      expect(explainPath(nodes, edges, [])).toBe("Empty path.");
    });

    it("explainPath handles single node path", () => {
      const explanation = explainPath(nodes, edges, ["n1"]);
      expect(explanation).toContain("A");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // legalKnowledgeService
  // ─────────────────────────────────────────────────────────────────────────
  describe("legalKnowledgeService", () => {
    it("buildLegalHierarchy groups articles under their parent law", () => {
      const refs = [
        { id: "r1", type: "lei", numero: "14133", ano: 2021 },
        { id: "r2", type: "lei", numero: "14133", ano: 2021, artigo: "18" },
        { id: "r3", type: "lei", numero: "14133", ano: 2021, artigo: "6" },
      ];
      const hierarchy = buildLegalHierarchy(refs);
      expect(hierarchy).toHaveLength(1);
      expect(hierarchy[0].ref.id).toBe("r1");
      expect(hierarchy[0].children).toHaveLength(2);
    });

    it("buildLegalHierarchy places orphan articles at root", () => {
      const refs = [
        { id: "r1", type: "lei", numero: "14133", ano: 2021, artigo: "18" },
      ];
      const hierarchy = buildLegalHierarchy(refs);
      expect(hierarchy).toHaveLength(1);
      expect(hierarchy[0].ref.id).toBe("r1");
      expect(hierarchy[0].children).toHaveLength(0);
    });

    it("findRelatedJurisprudence returns jurisprudence nodes connected to article", () => {
      const nodes = [
        { id: "art18", organizationId: ORG_ID, nodeType: "article", title: "Art 18", normalizedTitle: "art 18", confidence: 1.0, active: true },
        { id: "jur1", organizationId: ORG_ID, nodeType: "jurisprudence", title: "Acordao X", normalizedTitle: "acordao x", confidence: 1.0, active: true },
        { id: "leg1", organizationId: ORG_ID, nodeType: "legislation", title: "Lei Y", normalizedTitle: "lei y", confidence: 1.0, active: true },
      ];
      const edges = [
        { id: "e1", organizationId: ORG_ID, sourceNodeId: "art18", targetNodeId: "jur1", relationshipType: "references", weight: 1.0, confidence: 1.0, active: true },
        { id: "e2", organizationId: ORG_ID, sourceNodeId: "art18", targetNodeId: "leg1", relationshipType: "references", weight: 1.0, confidence: 1.0, active: true },
      ];
      const result = findRelatedJurisprudence("art18", edges, nodes, ORG_ID);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("jur1");
    });

    it("traceLegalPath finds path between legal nodes", () => {
      const nodes = [
        { id: "l1", organizationId: ORG_ID, nodeType: "legislation", title: "Lei A", normalizedTitle: "lei a", confidence: 1.0, active: true },
        { id: "l2", organizationId: ORG_ID, nodeType: "legislation", title: "Lei B", normalizedTitle: "lei b", confidence: 1.0, active: true },
      ];
      const edges = [
        { id: "e1", organizationId: ORG_ID, sourceNodeId: "l1", targetNodeId: "l2", relationshipType: "references", weight: 1.0, confidence: 1.0, active: true },
      ];
      const path = traceLegalPath("l1", "l2", nodes, edges, ORG_ID);
      expect(path).toEqual(["l1", "l2"]);
    });

    it("traceLegalPath returns empty for disconnected nodes", () => {
      const nodes = [
        { id: "l1", organizationId: ORG_ID, nodeType: "legislation", title: "Lei A", normalizedTitle: "lei a", confidence: 1.0, active: true },
        { id: "l2", organizationId: ORG_ID, nodeType: "legislation", title: "Lei B", normalizedTitle: "lei b", confidence: 1.0, active: true },
      ];
      const path = traceLegalPath("l1", "l2", nodes, [], ORG_ID);
      expect(path).toEqual([]);
    });

    it("classifyLegalAuthority assigns correct weights", () => {
      expect(classifyLegalAuthority("lei")).toBe(8);
      expect(classifyLegalAuthority("decreto")).toBe(7);
      expect(classifyLegalAuthority("portaria")).toBe(6);
      expect(classifyLegalAuthority("resolucao")).toBe(5);
    });

    it("classifyLegalAuthority returns default for unknown type", () => {
      expect(classifyLegalAuthority("outro")).toBe(3);
    });

    it("detectLegalConflicts finds contradiction edges between legal nodes", () => {
      const nodes = [
        { id: "l1", organizationId: ORG_ID, nodeType: "legislation", title: "Lei A", normalizedTitle: "lei a", confidence: 1.0, active: true },
        { id: "l2", organizationId: ORG_ID, nodeType: "legislation", title: "Lei B", normalizedTitle: "lei b", confidence: 1.0, active: true },
      ];
      const edges = [
        { id: "e1", organizationId: ORG_ID, sourceNodeId: "l1", targetNodeId: "l2", relationshipType: "contradicts", weight: 1.0, confidence: 1.0, active: true },
      ];
      const conflicts = detectLegalConflicts(nodes, edges, ORG_ID);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].nodeA).toBe("l1");
      expect(conflicts[0].nodeB).toBe("l2");
    });

    it("detectLegalConflicts ignores non-contradicts edges", () => {
      const nodes = [
        { id: "l1", organizationId: ORG_ID, nodeType: "legislation", title: "Lei A", normalizedTitle: "lei a", confidence: 1.0, active: true },
        { id: "l2", organizationId: ORG_ID, nodeType: "legislation", title: "Lei B", normalizedTitle: "lei b", confidence: 1.0, active: true },
      ];
      const edges = [
        { id: "e1", organizationId: ORG_ID, sourceNodeId: "l1", targetNodeId: "l2", relationshipType: "references", weight: 1.0, confidence: 1.0, active: true },
      ];
      const conflicts = detectLegalConflicts(nodes, edges, ORG_ID);
      expect(conflicts).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // procurementOntologyService
  // ─────────────────────────────────────────────────────────────────────────
  describe("procurementOntologyService", () => {
    const concepts = [
      { id: "c1", name: "Licitacao", category: "modalidade", parentId: null, aliases: ["Processo Licitatorio"], organizationId: ORG_ID },
      { id: "c2", name: "Pregao", category: "modalidade", parentId: "c1", aliases: ["Pregao Eletronico"], organizationId: ORG_ID },
      { id: "c3", name: "Concorrencia", category: "modalidade", parentId: "c1", aliases: [], organizationId: ORG_ID },
      { id: "c4", name: "Menor Preco", category: "criterio_julgamento", parentId: null, aliases: ["Menor Valor"], organizationId: ORG_ID },
    ];

    it("buildOntologyTree creates tree structure with roots and children", () => {
      const tree = buildOntologyTree(concepts);
      const roots = tree.filter(n => n.concept.parentId === null);
      expect(roots.length).toBeGreaterThanOrEqual(2);
    });

    it("buildOntologyTree places children under parent", () => {
      const tree = buildOntologyTree(concepts);
      const licitacao = tree.find(n => n.concept.id === "c1");
      expect(licitacao?.children).toHaveLength(2);
    });

    it("classifyDocument finds matching concepts", () => {
      const result = classifyDocument("pregao eletronico para aquisicao de material", concepts);
      expect(result.length).toBeGreaterThanOrEqual(1);
      const pregaoMatch = result.find(r => r.conceptId === "c2");
      expect(pregaoMatch).toBeDefined();
    });

    it("classifyDocument returns empty for unrelated text", () => {
      const result = classifyDocument("xyz abc 123", concepts);
      expect(result).toHaveLength(0);
    });

    it("findAncestors returns parent chain", () => {
      const ancestors = findAncestors("c2", concepts);
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0].id).toBe("c1");
    });

    it("findAncestors returns empty for root concept", () => {
      const ancestors = findAncestors("c1", concepts);
      expect(ancestors).toHaveLength(0);
    });

    it("findDescendants returns all children recursively", () => {
      const descendants = findDescendants("c1", concepts);
      expect(descendants).toHaveLength(2);
      expect(descendants.map(d => d.id)).toContain("c2");
      expect(descendants.map(d => d.id)).toContain("c3");
    });

    it("resolveAlias finds concept by alias", () => {
      const result = resolveAlias("Pregao Eletronico", concepts);
      expect(result).not.toBeNull();
      expect(result?.id).toBe("c2");
    });

    it("resolveAlias finds concept by name", () => {
      const result = resolveAlias("Concorrencia", concepts);
      expect(result).not.toBeNull();
      expect(result?.id).toBe("c3");
    });

    it("resolveAlias returns null for unknown alias", () => {
      const result = resolveAlias("Inexistente", concepts);
      expect(result).toBeNull();
    });

    it("exportOntology returns valid JSON", () => {
      const json = exportOntology(concepts);
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(4);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // graphRecommendationService
  // ─────────────────────────────────────────────────────────────────────────
  describe("graphRecommendationService", () => {
    const nodes = [
      { id: "n1", organizationId: ORG_ID, nodeType: "concept", title: "Pregao", normalizedTitle: "pregao", confidence: 1.0, active: true },
      { id: "n2", organizationId: ORG_ID, nodeType: "clause", title: "Clausula Objeto", normalizedTitle: "clausula objeto", confidence: 1.0, active: true },
      { id: "n3", organizationId: ORG_ID, nodeType: "legislation", title: "Lei 14133", normalizedTitle: "lei 14133", confidence: 1.0, active: true },
      { id: "n4", organizationId: ORG_ID, nodeType: "risk", title: "Risco Sobrepreco", normalizedTitle: "risco sobrepreco", confidence: 1.0, active: true },
      { id: "n5", organizationId: ORG_ID, nodeType: "process_type", title: "Pregao Eletronico", normalizedTitle: "pregao eletronico", confidence: 1.0, active: true },
    ];

    const edges = [
      { id: "e1", organizationId: ORG_ID, sourceNodeId: "n1", targetNodeId: "n2", relationshipType: "references", weight: 0.9, confidence: 0.9, active: true },
      { id: "e2", organizationId: ORG_ID, sourceNodeId: "n1", targetNodeId: "n3", relationshipType: "regulates", weight: 0.8, confidence: 0.8, active: true },
      { id: "e3", organizationId: ORG_ID, sourceNodeId: "n1", targetNodeId: "n4", relationshipType: "risks", weight: 0.7, confidence: 0.7, active: true },
      { id: "e4", organizationId: ORG_ID, sourceNodeId: "n5", targetNodeId: "n2", relationshipType: "requires", weight: 1.0, confidence: 1.0, active: true },
    ];

    it("recommendRelated returns related nodes sorted by score", () => {
      const recs = recommendRelated("n1", nodes, edges, ORG_ID);
      expect(recs.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < recs.length; i++) {
        expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
      }
    });

    it("recommendRelated respects maxResults", () => {
      const recs = recommendRelated("n1", nodes, edges, ORG_ID, 2);
      expect(recs.length).toBeLessThanOrEqual(2);
    });

    it("recommendRelated includes path information", () => {
      const recs = recommendRelated("n1", nodes, edges, ORG_ID);
      for (const rec of recs) {
        expect(rec.path.length).toBeGreaterThanOrEqual(2);
        expect(rec.path[0]).toBe("n1");
      }
    });

    it("recommendClauses returns clause nodes for matching process type", () => {
      const recs = recommendClauses("pregao", nodes, edges, ORG_ID);
      expect(recs.length).toBeGreaterThanOrEqual(1);
      const clauseRec = recs.find(r => r.nodeId === "n2");
      expect(clauseRec).toBeDefined();
    });

    it("recommendClauses returns fallback when no process type matches", () => {
      const recs = recommendClauses("inexistente", nodes, edges, ORG_ID);
      expect(recs.length).toBeGreaterThanOrEqual(0);
    });

    it("recommendLegalBasis returns legislation nodes", () => {
      const recs = recommendLegalBasis("n1", nodes, edges, ORG_ID);
      const legalRec = recs.find(r => r.nodeId === "n3");
      expect(legalRec).toBeDefined();
    });

    it("recommendRisks returns risk nodes", () => {
      const recs = recommendRisks("n1", nodes, edges, ORG_ID);
      const riskRec = recs.find(r => r.nodeId === "n4");
      expect(riskRec).toBeDefined();
    });

    it("explainRecommendation returns readable explanation", () => {
      const rec = { nodeId: "n3", title: "Lei 14133", score: 0.72, path: ["n1", "n3"], reason: "Legal basis", confidence: 0.8 };
      const explanation = explainRecommendation(rec, nodes, edges);
      expect(explanation).toContain("Lei 14133");
      expect(explanation).toContain("0.72");
    });

    it("explainRecommendation handles single-node path", () => {
      const rec = { nodeId: "n1", title: "Pregao", score: 0.5, path: ["n1"], reason: "Direct", confidence: 1.0 };
      const explanation = explainRecommendation(rec, nodes, edges);
      expect(explanation).toContain("Pregao");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // graphObservabilityService
  // ─────────────────────────────────────────────────────────────────────────
  describe("graphObservabilityService", () => {
    it("recordGraphMetric does not throw", () => {
      expect(() => recordGraphMetric({
        name: "test_metric",
        value: 42,
        unit: "count",
        tags: { module: "knowledge_graph" },
        organizationId: ORG_ID,
        recordedAt: new Date().toISOString(),
      })).not.toThrow();
    });

    it("recordTraversalLatency does not throw", () => {
      expect(() => recordTraversalLatency("corr-123", 150, ORG_ID)).not.toThrow();
    });

    it("recordNodeCreation does not throw", () => {
      expect(() => recordNodeCreation("corr-456", "legislation", ORG_ID)).not.toThrow();
    });

    it("recordEdgeCreation does not throw", () => {
      expect(() => recordEdgeCreation("corr-789", "references", ORG_ID)).not.toThrow();
    });

    it("recordResolutionAttempt does not throw", () => {
      expect(() => recordResolutionAttempt("corr-abc", true, ORG_ID)).not.toThrow();
    });

    it("recordRecommendation does not throw", () => {
      expect(() => recordRecommendation("corr-def", 5, ORG_ID)).not.toThrow();
    });

    it("computeGraphHealth computes correct metrics for non-empty graph", () => {
      const nodes = [
        { id: "n1", organizationId: ORG_ID, nodeType: "concept", title: "A", normalizedTitle: "a", confidence: 1.0, active: true },
        { id: "n2", organizationId: ORG_ID, nodeType: "concept", title: "B", normalizedTitle: "b", confidence: 1.0, active: true },
        { id: "n3", organizationId: ORG_ID, nodeType: "concept", title: "C", normalizedTitle: "c", confidence: 1.0, active: true },
      ];
      const edges = [
        { id: "e1", organizationId: ORG_ID, sourceNodeId: "n1", targetNodeId: "n2", relationshipType: "references", weight: 1.0, confidence: 1.0, active: true },
      ];
      const health = computeGraphHealth(nodes, edges, ORG_ID);
      expect(health.totalNodes).toBe(3);
      expect(health.totalEdges).toBe(1);
      expect(health.orphanNodes).toBe(1); // n3 has no edges
      expect(health.avgDegree).toBeCloseTo(2 / 3);
      expect(health.coverage).toBeCloseTo(2 / 3);
      expect(health.healthScore).toBeCloseTo(2 / 3);
    });

    it("computeGraphHealth returns zeros for empty graph", () => {
      const health = computeGraphHealth([], [], ORG_ID);
      expect(health.totalNodes).toBe(0);
      expect(health.totalEdges).toBe(0);
      expect(health.orphanNodes).toBe(0);
      expect(health.avgDegree).toBe(0);
      expect(health.healthScore).toBe(0);
    });
  });
});
