import { describe, it, expect } from "vitest";

// Domain
import { createKnowledgeNode, updateNodeVersion } from "../../domain/knowledgeNode";
import { createKnowledgeEdge, computeDeterministicKey } from "../../domain/knowledgeEdge";
import { createEntityResolution, buildSimilarityMetadata } from "../../domain/entityResolution";

// Ontology validation
import {
  validateEdge,
  validateEdgeInstance,
  allowedRelationships,
} from "../../services/ontologyValidationService";

// Traversal
import {
  buildAdjacencyMap,
  bfs,
  dfs,
  dijkstra,
  type GraphNode,
  type GraphEdge,
} from "../../services/graphTraversalService";

// Persistence (degrada graciosamente sem DB)
import {
  insertKnowledgeNode,
  getKnowledgeNodeById,
  searchKnowledgeNodes,
  nodeBelongsToOrg,
  graphStatistics,
  loadSubgraph,
  insertKnowledgeEdge,
  getEdgesForNode,
  insertEntityResolution,
  listEntityResolutions,
  insertGraphChangeLog,
  recordGraphMetricRow,
} from "../../db/knowledgeGraph";

// RAG integration
import {
  retrieveFromKnowledgeGraph,
  retrieveAll,
  weightedMerge,
} from "../../services/institutionalRetrievalService";

const ORG_ID = 10101;

describe("Sprint 4.8.1 — Knowledge Graph Operational Wiring", () => {

  // ─── Domain expansion: replay safety + lineage ─────────────────────────────

  describe("domain: node lineage & replay", () => {
    it("createKnowledgeNode inclui campos de lineage", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "legislation", title: "Lei 14.133", correlationId: "corr-1", createdBy: "u42" });
      expect(node.correlationId).toBe("corr-1");
      expect(node.createdBy).toBe("u42");
      expect(node.updatedBy).toBe("u42");
      expect(node.graphVersion).toBe(1);
      expect(node.lineageId).toMatch(/^[a-f0-9]{20}$/);
    });

    it("lineageId é determinístico (mesmo input → mesmo lineage)", () => {
      const a = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "article", title: "Art. 75" });
      const b = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "article", title: "Art. 75" });
      expect(a.lineageId).toBe(b.lineageId);
    });

    it("correlationId default é vazio (não Date.now)", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "concept", title: "Pregão" });
      expect(node.correlationId).toBe("");
    });

    it("updateNodeVersion registra updatedBy e incrementa versão", () => {
      const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "concept", title: "Pregão", createdBy: "u1" });
      const updated = updateNodeVersion(node, { description: "x" }, "u2");
      expect(updated.updatedBy).toBe("u2");
      expect(updated.version).toBe(2);
      expect(updated.createdBy).toBe("u1");
    });
  });

  describe("domain: edge deterministic key & replay hash", () => {
    it("edge.id == deterministicKey", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "a", targetNodeId: "b", relationshipType: "regulates" });
      expect(edge.id).toBe(edge.deterministicKey);
    });

    it("computeDeterministicKey é estável e igual ao id da aresta", () => {
      const key = computeDeterministicKey({ organizationId: ORG_ID, sourceNodeId: "a", targetNodeId: "b", relationshipType: "regulates" });
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "a", targetNodeId: "b", relationshipType: "regulates" });
      expect(key).toBe(edge.id);
    });

    it("replayHash é determinístico para o mesmo estado semântico", () => {
      const a = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "a", targetNodeId: "b", relationshipType: "regulates", weight: 0.8, confidence: 0.9 });
      const b = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "a", targetNodeId: "b", relationshipType: "regulates", weight: 0.8, confidence: 0.9 });
      expect(a.replayHash).toBe(b.replayHash);
    });

    it("replayHash muda quando o peso muda", () => {
      const a = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "a", targetNodeId: "b", relationshipType: "regulates", weight: 0.8 });
      const b = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "a", targetNodeId: "b", relationshipType: "regulates", weight: 0.5 });
      expect(a.replayHash).not.toBe(b.replayHash);
    });

    it("ontologyValidationResult default é unvalidated", () => {
      const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "a", targetNodeId: "b", relationshipType: "regulates" });
      expect(edge.ontologyValidationResult).toBe("unvalidated");
    });
  });

  describe("domain: entity resolution evidence", () => {
    it("createEntityResolution inclui evidence/trace/similarityMetadata", () => {
      const rec = createEntityResolution({
        organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "fuzzy",
        resolutionEvidence: ["match título"], resolutionTrace: ["step1", "step2"],
        similarityMetadata: buildSimilarityMetadata("pregão eletrônico", "pregão eletrônico federal"),
      });
      expect(rec.resolutionEvidence).toEqual(["match título"]);
      expect(rec.resolutionTrace).toHaveLength(2);
      expect(rec.similarityMetadata?.algorithm).toBe("dice-token-set");
    });

    it("buildSimilarityMetadata computa overlap determinístico", () => {
      const meta = buildSimilarityMetadata("pregão eletrônico federal", "pregão eletrônico municipal");
      expect(meta.overlapTokens).toBe(2);
      expect(meta.score).toBeGreaterThan(0);
      expect(meta.score).toBeLessThan(1);
    });
  });

  // ─── Ontology validation engine ────────────────────────────────────────────

  describe("ontologyValidationService", () => {
    it("aceita relacionamento válido: legislation regulates article", () => {
      const r = validateEdge("legislation", "article", "regulates");
      expect(r.valid).toBe(true);
      expect(r.violations).toHaveLength(0);
    });

    it("aceita cadeia: clause applies_to technical_requirement", () => {
      expect(validateEdge("clause", "technical_requirement", "applies_to").valid).toBe(true);
    });

    it("aceita jurisprudence references legislation", () => {
      expect(validateEdge("jurisprudence", "legislation", "references").valid).toBe(true);
    });

    it("rejeita relacionamento inválido: supplier regulates legislation", () => {
      const r = validateEdge("supplier", "legislation", "regulates");
      expect(r.valid).toBe(false);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
    });

    it("rejeita risks de contract para legislation", () => {
      expect(validateEdge("contract", "legislation", "risks").valid).toBe(false);
    });

    it("references é genérico (permitido entre quaisquer tipos)", () => {
      expect(validateEdge("supplier", "process", "references").valid).toBe(true);
      expect(validateEdge("document", "risk", "related_to").valid).toBe(true);
    });

    it("validateEdgeInstance rejeita auto-referência em supersedes", () => {
      const r = validateEdgeInstance({
        sourceNodeId: "n1", targetNodeId: "n1",
        sourceNodeType: "legislation", targetNodeType: "legislation",
        relationshipType: "supersedes",
      });
      expect(r.valid).toBe(false);
      expect(r.violations.some(v => v.includes("Auto-referência"))).toBe(true);
    });

    it("validateEdgeInstance permite auto-referência quando não estrutural", () => {
      const r = validateEdgeInstance({
        sourceNodeId: "n1", targetNodeId: "n1",
        sourceNodeType: "concept", targetNodeType: "concept",
        relationshipType: "related_to",
      });
      expect(r.valid).toBe(true);
    });

    it("allowedRelationships retorna relações válidas entre dois tipos", () => {
      const allowed = allowedRelationships("legislation", "article");
      expect(allowed).toContain("regulates");
      expect(allowed).toContain("references");
      expect(allowed).not.toContain("supplies");
    });
  });

  // ─── Traversal: adjacency map, iterative DFS, Dijkstra ─────────────────────

  describe("graphTraversalService — wiring", () => {
    const mkNode = (id: string): GraphNode => ({
      id, organizationId: ORG_ID, nodeType: "concept", title: id, normalizedTitle: id, confidence: 1, active: true,
    });
    const mkEdge = (id: string, s: string, t: string, w = 1): GraphEdge => ({
      id, organizationId: ORG_ID, sourceNodeId: s, targetNodeId: t, relationshipType: "related_to", weight: w, confidence: 1, active: true,
    });

    it("buildAdjacencyMap indexa arestas por nó (O(V+E))", () => {
      const edges = [mkEdge("e1", "a", "b"), mkEdge("e2", "b", "c")];
      const map = buildAdjacencyMap(edges);
      expect(map.get("b")).toHaveLength(2);
      expect(map.get("a")).toHaveLength(1);
    });

    it("DFS iterativo não estoura pilha em grafo grande (5000 nós encadeados)", () => {
      const N = 5000;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      for (let i = 0; i < N; i++) nodes.push(mkNode(`n${i}`));
      for (let i = 0; i < N - 1; i++) edges.push(mkEdge(`e${i}`, `n${i}`, `n${i + 1}`));
      const result = dfs(nodes, edges, "n0", ORG_ID, N);
      expect(result.visitedNodes.length).toBe(N);
    });

    it("DFS respeita maxDepth", () => {
      const nodes = [mkNode("a"), mkNode("b"), mkNode("c")];
      const edges = [mkEdge("e1", "a", "b"), mkEdge("e2", "b", "c")];
      const result = dfs(nodes, edges, "a", ORG_ID, 1);
      expect(result.visitedNodes).toContain("a");
      expect(result.visitedNodes).toContain("b");
      expect(result.visitedNodes).not.toContain("c");
    });

    it("Dijkstra prefere caminho mais forte (maior peso) mesmo com mais saltos", () => {
      const nodes = [mkNode("n1"), mkNode("n2"), mkNode("n3"), mkNode("n4")];
      const edges = [
        mkEdge("weak", "n1", "n4", 0.2),   // 1 salto, fraco (cost 0.8)
        mkEdge("s1", "n1", "n2", 0.95),
        mkEdge("s2", "n2", "n3", 0.95),
        mkEdge("s3", "n3", "n4", 0.95),    // 3 saltos, forte (cost ~0.15)
      ];
      const result = dijkstra(nodes, edges, "n1", "n4", ORG_ID);
      expect(result.found).toBe(true);
      expect(result.path).toEqual(["n1", "n2", "n3", "n4"]);
    });

    it("Dijkstra retorna found=false para nós desconectados", () => {
      const nodes = [mkNode("a"), mkNode("b")];
      const result = dijkstra(nodes, [], "a", "b", ORG_ID);
      expect(result.found).toBe(false);
      expect(result.path).toEqual([]);
    });

    it("Dijkstra para o mesmo nó retorna caminho trivial", () => {
      const nodes = [mkNode("a")];
      const result = dijkstra(nodes, [], "a", "a", ORG_ID);
      expect(result.found).toBe(true);
      expect(result.path).toEqual(["a"]);
    });

    it("Dijkstra é determinístico (mesma entrada → mesmo caminho)", () => {
      const nodes = [mkNode("n1"), mkNode("n2"), mkNode("n3")];
      const edges = [mkEdge("e1", "n1", "n2", 0.9), mkEdge("e2", "n2", "n3", 0.9)];
      const a = dijkstra(nodes, edges, "n1", "n3", ORG_ID);
      const b = dijkstra(nodes, edges, "n1", "n3", ORG_ID);
      expect(a.path).toEqual(b.path);
    });

    it("BFS não visita nós de outro tenant", () => {
      const nodes = [mkNode("a"), mkNode("b"), { ...mkNode("x"), organizationId: 99999 }];
      const edges = [mkEdge("e1", "a", "b"), mkEdge("e2", "a", "x")];
      const result = bfs(nodes, edges, "a", ORG_ID);
      expect(result.visitedNodes).not.toContain("x");
    });
  });

  // ─── Persistence: graceful degradation (test env has no DB) ────────────────

  describe("persistence — degradação graciosa sem DB", () => {
    const node = createKnowledgeNode({ organizationId: ORG_ID, nodeType: "concept", title: "Teste" });
    const edge = createKnowledgeEdge({ organizationId: ORG_ID, sourceNodeId: "a", targetNodeId: "b", relationshipType: "related_to" });

    it("insertKnowledgeNode retorna null sem DB (não lança)", async () => {
      await expect(insertKnowledgeNode(node)).resolves.toBeNull();
    });

    it("getKnowledgeNodeById retorna null sem DB", async () => {
      await expect(getKnowledgeNodeById("x", ORG_ID)).resolves.toBeNull();
    });

    it("searchKnowledgeNodes retorna [] sem DB", async () => {
      await expect(searchKnowledgeNodes(ORG_ID, { query: "x" })).resolves.toEqual([]);
    });

    it("nodeBelongsToOrg retorna false sem DB", async () => {
      await expect(nodeBelongsToOrg("x", ORG_ID)).resolves.toBe(false);
    });

    it("graphStatistics retorna zeros sem DB", async () => {
      await expect(graphStatistics(ORG_ID)).resolves.toEqual({ totalNodes: 0, totalEdges: 0, avgDegree: 0 });
    });

    it("loadSubgraph retorna grafo vazio sem DB", async () => {
      await expect(loadSubgraph(ORG_ID, "x")).resolves.toEqual({ nodes: [], edges: [] });
    });

    it("insertKnowledgeEdge / getEdgesForNode degradam sem lançar", async () => {
      await expect(insertKnowledgeEdge(edge)).resolves.toBeNull();
      await expect(getEdgesForNode("a", ORG_ID)).resolves.toEqual([]);
    });

    it("insertEntityResolution / listEntityResolutions degradam sem lançar", async () => {
      const rec = createEntityResolution({ organizationId: ORG_ID, sourceEntityId: "s", targetEntityId: "t", strategy: "exact" });
      await expect(insertEntityResolution(rec)).resolves.toBeNull();
      await expect(listEntityResolutions(ORG_ID)).resolves.toEqual([]);
    });

    it("insertGraphChangeLog / recordGraphMetricRow são no-op sem DB", async () => {
      await expect(insertGraphChangeLog({
        organizationId: ORG_ID, entityType: "node", entityId: "x", operation: "create",
        beforeState: null, afterState: { a: 1 }, changedBy: "u1", correlationId: "c1",
      })).resolves.toBeUndefined();
      await expect(recordGraphMetricRow({
        organizationId: ORG_ID, correlationId: "c1", metricName: "m", metricValue: 1,
      })).resolves.toBeUndefined();
    });
  });

  // ─── RAG integration ───────────────────────────────────────────────────────

  describe("RAG integration", () => {
    it("retrieveFromKnowledgeGraph retorna [] sem DB (degradação)", async () => {
      await expect(retrieveFromKnowledgeGraph("licitação", ORG_ID)).resolves.toEqual([]);
    });

    it("retrieveAll inclui graphChunks no resultado", async () => {
      const results = await retrieveAll("contratação", ORG_ID);
      expect(results).toHaveProperty("graphChunks");
      expect(Array.isArray(results.graphChunks)).toBe(true);
    });

    it("weightedMerge integra graphChunks com peso do grafo", () => {
      const merged = weightedMerge({
        chunks: [],
        legalRefs: [],
        similarTRs: [],
        history: [],
        evidence: [],
        graphChunks: [
          { id: "g1", content: "Lei —[regulates]→ Art. 18", similarity: 0.8, source: "knowledge_graph", chunkType: "graph_relationship", organizationId: ORG_ID },
        ],
      });
      expect(merged).toHaveLength(1);
      expect(merged[0].source).toBe("knowledge_graph");
      // peso graph default 1.15 → similaridade amplificada
      expect(merged[0].similarity).toBeCloseTo(0.8 * 1.15);
    });

    it("weightedMerge funciona sem graphChunks (retrocompatível)", () => {
      const merged = weightedMerge({ chunks: [], legalRefs: [], similarTRs: [], history: [], evidence: [] });
      expect(Array.isArray(merged)).toBe(true);
    });
  });
});
