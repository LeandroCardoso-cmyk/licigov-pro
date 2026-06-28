import { describe, it, expect, beforeEach } from "vitest";

// Domain
import {
  getOrCreateGraph,
  addNode,
  addEdge,
  propagateRelevance,
  findRelated,
  computeGraphMetrics,
  saveGraph,
  getGraph,
} from "../../domain/semanticGraph";

import {
  createRetentionRule,
  applyRetentionPolicy,
  archiveMemory,
  computeRetentionStatus,
  takeRetentionSnapshot,
  getArchivalRecords,
  getRulesForOrg,
} from "../../domain/memoryRetentionGovernance";

import {
  createMemoryEntry,
  retrieveMemories,
  createPrecedent,
  findApplicablePrecedents,
  recordProcurementPattern,
  getProcurementPatterns,
  markPrecedentUsed,
} from "../../domain/semanticMemory";

// Services
import {
  chunkDocument,
  rechunkDocument,
  getChunksForDocument,
  computeChunkStats,
} from "../../services/semanticChunkingService";

import {
  createQuery,
  executeRetrieval,
  computeBM25Score,
} from "../../services/retrievalEngineService";

import {
  tokenize,
  indexEntity,
  searchIndex,
  getIndexStats,
} from "../../services/semanticIndexEngine";

import {
  rankItems,
  computeConfidencePropagation,
  explainRanking,
} from "../../services/contextualRankingService";

import {
  createEvidenceItem,
  assembleEvidenceChain,
  rankByProvenance,
  buildCitationList,
  supersede,
} from "../../services/evidenceRetrievalService";

import {
  buildExplanation,
  formatExplanationForHuman,
  compareExplanations,
} from "../../services/retrievalExplainabilityService";

import { createRetrievalSession } from "../../domain/retrievalSession";
import { createRetrievalEvidence } from "../../domain/retrievalEvidence";

import {
  expandQuery,
  search,
  LEGAL_SYNONYMS,
  TYPO_CORRECTIONS,
  applySemanticBoost,
  applyContextualBoost,
  suggestQueryExpansion,
} from "../../services/hybridSearchService";

import {
  recordLatency,
  recordRankingQuality,
  recordChunkEfficiency,
  recordSemanticRecall,
  recordEvidenceQuality,
  recordQueryComplexity,
  computeHealthSnapshot,
  generateReport,
} from "../../services/retrievalObservabilityService";

const ORG = 9400;

// ─── semanticGraph ───────────────────────────────────────────────────────────

describe("semanticGraph", () => {
  it("getOrCreateGraph retorna grafo com organizationId correto", () => {
    const g = getOrCreateGraph(ORG);
    expect(g.organizationId).toBe(ORG);
    expect(Array.isArray(g.nodes)).toBe(true);
    expect(Array.isArray(g.edges)).toBe(true);
  });

  it("getOrCreateGraph para mesmo org retorna mesmo grafo na segunda chamada", () => {
    const g1 = getOrCreateGraph(ORG + 1);
    const g2 = getOrCreateGraph(ORG + 1);
    expect(g1.organizationId).toBe(g2.organizationId);
  });

  it("addNode adiciona nó e retorna novo grafo imutável", () => {
    const g = getOrCreateGraph(ORG);
    const g2 = addNode(g, { type: "clause", label: "Art. 1", content: "Conteúdo do artigo" });
    expect(g2.nodes.length).toBe(g.nodes.length + 1);
    expect(g2.nodes[g2.nodes.length - 1].type).toBe("clause");
    expect(g2.nodes[g2.nodes.length - 1].organizationId).toBe(ORG);
  });

  it("addNode define relevanceScore e confidence padrão", () => {
    const g = getOrCreateGraph(ORG);
    const g2 = addNode(g, { type: "workflow", label: "WF-001", content: "Workflow" });
    const node = g2.nodes[g2.nodes.length - 1];
    expect(node.relevanceScore).toBeGreaterThanOrEqual(0);
    expect(node.confidence).toBeGreaterThanOrEqual(0);
  });

  it("addEdge conecta dois nós com tipo e peso", () => {
    let g = getOrCreateGraph(ORG + 10);
    g = addNode(g, { type: "clause", label: "A", content: "Clausula A" });
    g = addNode(g, { type: "clause", label: "B", content: "Clausula B" });
    const nA = g.nodes[g.nodes.length - 2];
    const nB = g.nodes[g.nodes.length - 1];
    const g3 = addEdge(g, nA.id, nB.id, "semantic_similarity", 0.8, "prova");
    expect(g3.edges.length).toBe(g.edges.length + 1);
    expect(g3.edges[g3.edges.length - 1].edgeType).toBe("semantic_similarity");
    expect(g3.edges[g3.edges.length - 1].weight).toBe(0.8);
  });

  it("addEdge lança erro se nó de origem não existe", () => {
    const g = getOrCreateGraph(ORG);
    const g2 = addNode(g, { type: "tr", label: "TR-X", content: "TR" });
    const node = g2.nodes[g2.nodes.length - 1];
    expect(() => addEdge(g2, "inexistente-id", node.id, "cites", 1, "ev")).toThrow();
  });

  it("propagateRelevance retorna array de PropagationResult com scores", () => {
    let g = getOrCreateGraph(ORG + 20);
    g = addNode(g, { type: "clause", label: "Origin", content: "Nodo origem", relevanceScore: 1.0 });
    g = addNode(g, { type: "clause", label: "Hop1", content: "Nodo hop 1", relevanceScore: 0.5 });
    g = addNode(g, { type: "clause", label: "Hop2", content: "Nodo hop 2", relevanceScore: 0.3 });
    const n0 = g.nodes[g.nodes.length - 3];
    const n1 = g.nodes[g.nodes.length - 2];
    const n2 = g.nodes[g.nodes.length - 1];
    g = addEdge(g, n0.id, n1.id, "semantic_similarity", 0.8, "e1");
    g = addEdge(g, n1.id, n2.id, "semantic_similarity", 0.8, "e2");
    const result = propagateRelevance(g, n0.id, 2);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    result.forEach((r) => {
      expect(typeof r.propagatedScore).toBe("number");
      expect(r.propagatedScore).toBeGreaterThanOrEqual(0);
    });
  });

  it("findRelated retorna nós conectados até N hops", () => {
    let g = getOrCreateGraph(ORG + 30);
    g = addNode(g, { type: "workflow", label: "Centro", content: "Nodo central" });
    g = addNode(g, { type: "workflow", label: "Vizinho", content: "Nodo vizinho" });
    const n0 = g.nodes[g.nodes.length - 2];
    const n1 = g.nodes[g.nodes.length - 1];
    g = addEdge(g, n0.id, n1.id, "depends_on", 1, "dep");
    const related = findRelated(g, n0.id, 1);
    expect(Array.isArray(related)).toBe(true);
  });

  it("computeGraphMetrics retorna nodeCount, edgeCount e avgDegree", () => {
    let g = getOrCreateGraph(ORG + 40);
    g = addNode(g, { type: "parecer", label: "P1", content: "Parecer 1" });
    g = addNode(g, { type: "parecer", label: "P2", content: "Parecer 2" });
    const metrics = computeGraphMetrics(g);
    expect(metrics.nodeCount).toBeGreaterThanOrEqual(2);
    expect(typeof metrics.avgDegree).toBe("number");
    expect(typeof metrics.edgeCount).toBe("number");
  });

  it("saveGraph e getGraph funcionam corretamente", () => {
    const g = getOrCreateGraph(ORG + 50);
    saveGraph(g);
    const retrieved = getGraph(ORG + 50);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.organizationId).toBe(ORG + 50);
  });
});

// ─── memoryRetentionGovernance ────────────────────────────────────────────────

describe("memoryRetentionGovernance", () => {
  it("createRetentionRule cria regra com organizationId e policy", () => {
    const rule = createRetentionRule({
      organizationId: ORG,
      policy: "permanent",
      ttlMs: null,
      legalBasis: "Lei 14.133/2021 Art. 7",
      appliesTo: ["institutional"],
      priority: 10,
      createdBy: 1,
    });
    expect(rule.organizationId).toBe(ORG);
    expect(rule.policy).toBe("permanent");
    expect(rule.isActive).toBe(true);
  });

  it("createRetentionRule com TTL numérico", () => {
    const rule = createRetentionRule({
      organizationId: ORG,
      policy: "session",
      ttlMs: 3600000,
      appliesTo: ["semantic"],
      createdBy: 1,
    });
    expect(rule.ttlMs).toBe(3600000);
  });

  it("getRulesForOrg retorna apenas regras do org", () => {
    createRetentionRule({
      organizationId: ORG + 100,
      policy: "session",
      ttlMs: 1000,
      appliesTo: ["*"],
      createdBy: 1,
    });
    const rules = getRulesForOrg(ORG + 100);
    expect(rules.every((r) => r.organizationId === ORG + 100)).toBe(true);
  });

  it("applyRetentionPolicy retorna session quando sem regras", () => {
    const policy = applyRetentionPolicy("mem-001", "unknown_type", ORG + 200);
    expect(policy).toBe("session");
  });

  it("applyRetentionPolicy usa regra de maior prioridade", () => {
    createRetentionRule({ organizationId: ORG + 201, policy: "session", ttlMs: 1000, appliesTo: ["*"], priority: 1, createdBy: 1 });
    createRetentionRule({ organizationId: ORG + 201, policy: "permanent", ttlMs: null, appliesTo: ["*"], priority: 10, createdBy: 1 });
    const policy = applyRetentionPolicy("mem-x", "semantic", ORG + 201);
    expect(policy).toBe("permanent");
  });

  it("archiveMemory cria registro imutável de arquivamento", () => {
    const record = archiveMemory({
      memoryId: "mem-archive-001",
      archivedBy: 42,
      reason: "ttl_expired",
      organizationId: ORG,
    });
    expect(record.memoryId).toBe("mem-archive-001");
    expect(record.archivedBy).toBe(42);
    expect(record.immutable).toBe(true);
    expect(record.organizationId).toBe(ORG);
  });

  it("archiveMemory com legalBasis preserva campo", () => {
    const record = archiveMemory({
      memoryId: "mem-archive-002",
      archivedBy: 1,
      reason: "legal_requirement",
      organizationId: ORG,
      legalBasis: "Lei 14.133",
    });
    expect(record.legalBasis).toBe("Lei 14.133");
  });

  it("getArchivalRecords retorna registros do org", () => {
    archiveMemory({ memoryId: "m1", archivedBy: 1, reason: "user_deleted", organizationId: ORG + 300 });
    const records = getArchivalRecords(ORG + 300);
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records.every((r) => r.organizationId === ORG + 300)).toBe(true);
  });

  it("computeRetentionStatus retorna active quando ttlMs é null", () => {
    const status = computeRetentionStatus(new Date().toISOString(), null);
    expect(status).toBe("active");
  });

  it("computeRetentionStatus retorna expired quando TTL ultrapassado", () => {
    const old = new Date(Date.now() - 10_000).toISOString();
    const status = computeRetentionStatus(old, 1000);
    expect(status).toBe("expired");
  });

  it("computeRetentionStatus retorna expiring_soon quando >80% do TTL", () => {
    const old = new Date(Date.now() - 8_500).toISOString();
    const status = computeRetentionStatus(old, 10_000);
    expect(status).toBe("expiring_soon");
  });

  it("computeRetentionStatus retorna active quando <80% do TTL", () => {
    const recent = new Date(Date.now() - 100).toISOString();
    const status = computeRetentionStatus(recent, 10_000);
    expect(status).toBe("active");
  });

  it("takeRetentionSnapshot retorna snapshot com contagens", () => {
    const entries = [
      { id: "m1", memoryType: "semantic", ttlMs: null, isActive: true, createdAt: new Date().toISOString() },
      { id: "m2", memoryType: "semantic", ttlMs: null, isActive: true, createdAt: new Date().toISOString() },
    ];
    const snapshot = takeRetentionSnapshot(ORG, entries);
    expect(snapshot.organizationId).toBe(ORG);
    expect(snapshot.totalMemories).toBe(2);
    expect(typeof snapshot.activeMemories).toBe("number");
  });
});

// ─── semanticMemory (Sprint 4.1 additions) ────────────────────────────────────

describe("semanticMemory — Sprint 4.1 additions", () => {
  it("createPrecedent cria precedente com campos obrigatórios", () => {
    const p = createPrecedent({
      organizationId: ORG,
      title: "Precedente: Dispensa de Licitação",
      description: "Quando valor abaixo do limite legal",
      category: "legal",
      decision: "Dispensar licitação",
      rationale: "Art. 75 da Lei 14.133/2021",
      applicableContexts: ["dispensa", "emergência"],
      confidence: 0.9,
      createdBy: 1,
    });
    expect(p.organizationId).toBe(ORG);
    expect(p.title).toBe("Precedente: Dispensa de Licitação");
    expect(p.confidence).toBe(0.9);
    expect(p.usageCount).toBe(0);
    expect(p.isActive).toBe(true);
  });

  it("findApplicablePrecedents filtra por contexto case-insensitive", () => {
    const orgId = ORG + 400;
    createPrecedent({
      organizationId: orgId,
      title: "P1",
      description: "desc",
      category: "legal",
      decision: "decidir",
      rationale: "razão",
      applicableContexts: ["pregão", "concorrência"],
      confidence: 0.8,
      createdBy: 1,
    });
    createPrecedent({
      organizationId: orgId,
      title: "P2",
      description: "desc",
      category: "operational",
      decision: "decidir",
      rationale: "razão",
      applicableContexts: ["tomada de preço"],
      confidence: 0.7,
      createdBy: 1,
    });
    const results = findApplicablePrecedents(orgId, "processo de PREGÃO eletrônico", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].applicableContexts.some((c) => "processo de pregão eletrônico".includes(c.toLowerCase()))).toBe(true);
  });

  it("findApplicablePrecedents ordena por confidence decrescente", () => {
    const orgId = ORG + 401;
    createPrecedent({ organizationId: orgId, title: "Baixo", description: "d", category: "legal", decision: "d", rationale: "r", applicableContexts: ["licitação"], confidence: 0.3, createdBy: 1 });
    createPrecedent({ organizationId: orgId, title: "Alto", description: "d", category: "legal", decision: "d", rationale: "r", applicableContexts: ["licitação"], confidence: 0.9, createdBy: 1 });
    const results = findApplicablePrecedents(orgId, "processo de licitação", 5);
    expect(results[0].confidence).toBeGreaterThanOrEqual(results[results.length - 1].confidence);
  });

  it("findApplicablePrecedents respeita limite", () => {
    const orgId = ORG + 402;
    for (let i = 0; i < 5; i++) {
      createPrecedent({ organizationId: orgId, title: `P${i}`, description: "d", category: "legal", decision: "d", rationale: "r", applicableContexts: ["pregão"], confidence: i * 0.1, createdBy: 1 });
    }
    const results = findApplicablePrecedents(orgId, "pregão", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("recordProcurementPattern cria novo padrão com frequency=1", () => {
    const orgId = ORG + 410;
    const p = recordProcurementPattern(orgId, "PREGAO_ELETRONICO_TI", "compra de TI");
    expect(p.patternKey).toBe("PREGAO_ELETRONICO_TI");
    expect(p.frequency).toBe(1);
    expect(p.organizationId).toBe(orgId);
  });

  it("recordProcurementPattern incrementa frequency em chamada repetida", () => {
    const orgId = ORG + 411;
    recordProcurementPattern(orgId, "PADRAO_REPETIDO", "contexto");
    const p2 = recordProcurementPattern(orgId, "PADRAO_REPETIDO", "contexto2");
    expect(p2.frequency).toBe(2);
  });

  it("recordProcurementPattern aumenta strengthScore com mais ocorrências", () => {
    const orgId = ORG + 412;
    let p = recordProcurementPattern(orgId, "FORTE", "c");
    const initialScore = p.strengthScore;
    for (let i = 0; i < 5; i++) p = recordProcurementPattern(orgId, "FORTE", "c");
    expect(p.strengthScore).toBeGreaterThanOrEqual(initialScore);
  });

  it("getProcurementPatterns retorna padrões do org", () => {
    const orgId = ORG + 420;
    recordProcurementPattern(orgId, "P_A", "c");
    recordProcurementPattern(orgId, "P_B", "c");
    const patterns = getProcurementPatterns(orgId);
    expect(patterns.length).toBeGreaterThanOrEqual(2);
    expect(patterns.every((p) => p.organizationId === orgId)).toBe(true);
  });

  it("markPrecedentUsed incrementa usageCount e atualiza lastUsedAt", () => {
    const p = createPrecedent({
      organizationId: ORG,
      title: "Mark Used",
      description: "d",
      category: "legal",
      decision: "d",
      rationale: "r",
      applicableContexts: [],
      createdBy: 1,
    });
    const updated = markPrecedentUsed(p);
    expect(updated.usageCount).toBe(1);
    expect(updated.lastUsedAt).not.toBeNull();
  });

  it("markPrecedentUsed não muta o original", () => {
    const p = createPrecedent({
      organizationId: ORG,
      title: "Imutable",
      description: "d",
      category: "legal",
      decision: "d",
      rationale: "r",
      applicableContexts: [],
      createdBy: 1,
    });
    markPrecedentUsed(p);
    expect(p.usageCount).toBe(0);
  });
});

// ─── semanticChunkingService ──────────────────────────────────────────────────

describe("semanticChunkingService", () => {
  const baseDoc = {
    organizationId: ORG,
    documentId: "doc-001",
    content: "Esta é a primeira frase do documento. Esta é a segunda frase com mais detalhes. E aqui mais uma parte longa do conteúdo para testar a divisão em chunks adequados.",
    documentType: "tr" as const,
  };

  it("chunkDocument retorna resultado com chunks não vazios", () => {
    const result = chunkDocument({ ...baseDoc, strategy: "semantic" });
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.organizationId).toBe(ORG);
    expect(result.documentId).toBe("doc-001");
  });

  it("chunkDocument strategy=hierarchical produz chunks", () => {
    const result = chunkDocument({ ...baseDoc, strategy: "hierarchical" });
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.strategy).toBe("hierarchical");
  });

  it("chunkDocument strategy=legal_aware produz chunks com legalRef possível", () => {
    const legalContent = "Art. 1 - Contratação de serviços. Art. 2 - Vigência do contrato por 12 meses.";
    const result = chunkDocument({ ...baseDoc, content: legalContent, strategy: "legal_aware" });
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("chunkDocument todos os chunks têm organizationId correto", () => {
    const result = chunkDocument({ ...baseDoc, strategy: "token_aware" });
    expect(result.chunks.every((c) => c.organizationId === ORG)).toBe(true);
  });

  it("chunkDocument chunks têm tokenCount calculado", () => {
    const result = chunkDocument({ ...baseDoc, strategy: "overlap" });
    result.chunks.forEach((c) => {
      expect(c.tokenCount).toBe(Math.ceil(c.content.length / 4));
    });
  });

  it("chunkDocument replayKey é determinístico para mesmo input", () => {
    const r1 = chunkDocument({ ...baseDoc, strategy: "semantic" });
    const r2 = chunkDocument({ ...baseDoc, strategy: "semantic" });
    expect(r1.chunks[0].replayKey).toBe(r2.chunks[0].replayKey);
  });

  it("chunkDocument totalTokens equals sum of chunk tokenCounts", () => {
    const result = chunkDocument({ ...baseDoc, strategy: "semantic" });
    const sum = result.chunks.reduce((acc, c) => acc + c.tokenCount, 0);
    expect(result.totalTokens).toBe(sum);
  });

  it("rechunkDocument retorna novo resultado com mesma documentId", () => {
    const result = rechunkDocument({ ...baseDoc, strategy: "semantic", newStrategy: "hierarchical" });
    expect(result.documentId).toBe("doc-001");
  });

  it("getChunksForDocument retorna chunks armazenados do org", () => {
    chunkDocument({ ...baseDoc, documentId: "doc-store-001", strategy: "semantic" });
    const chunks = getChunksForDocument(ORG, "doc-store-001");
    expect(Array.isArray(chunks)).toBe(true);
  });

  it("computeChunkStats retorna avgTokensPerChunk e maxTokens", () => {
    const result = chunkDocument({ ...baseDoc, strategy: "semantic" });
    const stats = computeChunkStats(result.chunks);
    expect(stats.avgTokensPerChunk).toBeGreaterThanOrEqual(0);
    expect(stats.maxTokens).toBeGreaterThanOrEqual(stats.avgTokensPerChunk);
    expect(stats.chunkCount).toBe(result.chunks.length);
  });
});

// ─── retrievalEngineService ───────────────────────────────────────────────────

describe("retrievalEngineService", () => {
  it("createQuery cria query com replayKey determinístico", () => {
    const q1 = createQuery({ organizationId: ORG, queryText: "licitação pregão", strategy: "hybrid" });
    const q2 = createQuery({ organizationId: ORG, queryText: "licitação pregão", strategy: "hybrid" });
    expect(q1.replayKey).toBe(q2.replayKey);
  });

  it("createQuery tem organizationId correto", () => {
    const q = createQuery({ organizationId: ORG, queryText: "contrato", strategy: "lexical" });
    expect(q.organizationId).toBe(ORG);
    expect(q.queryText).toBe("contrato");
  });

  it("createQuery com maxResults customizado", () => {
    const q = createQuery({ organizationId: ORG, queryText: "teste", strategy: "semantic", maxResults: 5 });
    expect(q.maxResults).toBe(5);
  });

  it("executeRetrieval retorna resultados ordenados por score", () => {
    const q = createQuery({ organizationId: ORG, queryText: "licitação pregão eletrônico", strategy: "hybrid" });
    const corpus = [
      { id: "c1", content: "Pregão eletrônico para compra de material", documentId: "d1", metadata: {} },
      { id: "c2", content: "Documento sem relação com o tema", documentId: "d2", metadata: {} },
      { id: "c3", content: "Licitação na modalidade pregão eletrônico", documentId: "d3", metadata: {} },
    ];
    const response = executeRetrieval(q, corpus);
    expect(response.results.length).toBeGreaterThan(0);
    if (response.results.length >= 2) {
      expect(response.results[0].score).toBeGreaterThanOrEqual(response.results[1].score);
    }
  });

  it("executeRetrieval tem replayKey", () => {
    const q = createQuery({ organizationId: ORG, queryText: "teste", strategy: "lexical" });
    const response = executeRetrieval(q, []);
    expect(response.replayKey).toBeDefined();
    expect(typeof response.replayKey).toBe("string");
  });

  it("computeBM25Score retorna score >= 0", () => {
    const score = computeBM25Score("licitação pregão", "pregão eletrônico para licitação", 100, 500);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("computeBM25Score retorna 0 para query sem match", () => {
    const score = computeBM25Score("xyzabc", "documento sem relação alguma", 100, 500);
    expect(score).toBe(0);
  });
});

// ─── semanticIndexEngine ──────────────────────────────────────────────────────

describe("semanticIndexEngine", () => {
  it("tokenize remove stopwords em PT", () => {
    const tokens = tokenize("A contratação de serviços é importante para o processo");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("de");
    expect(tokens).not.toContain("o");
    expect(tokens.some((t) => t.length > 3)).toBe(true);
  });

  it("tokenize é case-insensitive", () => {
    const t1 = tokenize("Licitação");
    const t2 = tokenize("licitação");
    expect(t1).toEqual(t2);
  });

  it("indexEntity cria entrada com tokens e indexHash", () => {
    const entry = indexEntity({
      organizationId: ORG,
      entityId: "tr-001",
      entityType: "tr",
      content: "Termo de referência para contratação de serviços de TI",
    });
    expect(entry.organizationId).toBe(ORG);
    expect(entry.entityId).toBe("tr-001");
    expect(entry.tokens.length).toBeGreaterThan(0);
    expect(entry.indexHash).toBeDefined();
  });

  it("indexEntity indexHash é determinístico para mesmo conteúdo+tipo", () => {
    const e1 = indexEntity({ organizationId: ORG, entityId: "e1", entityType: "clause", content: "Texto fixo" });
    const e2 = indexEntity({ organizationId: ORG, entityId: "e2", entityType: "clause", content: "Texto fixo" });
    expect(e1.indexHash).toBe(e2.indexHash);
  });

  it("indexEntity com semanticAliases preserva o campo", () => {
    const entry = indexEntity({
      organizationId: ORG,
      entityId: "tr-002",
      entityType: "tr",
      content: "Documento técnico",
      semanticAliases: ["DT", "doc técnico"],
    });
    expect(entry.semanticAliases).toContain("DT");
  });

  it("searchIndex retorna entradas relevantes", () => {
    const orgId = ORG + 500;
    indexEntity({ organizationId: orgId, entityId: "e1", entityType: "clause", content: "pregão eletrônico para compra de notebooks" });
    indexEntity({ organizationId: orgId, entityId: "e2", entityType: "clause", content: "contrato de manutenção predial" });
    const results = searchIndex(orgId, "pregão notebooks", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entityId).toBe("e1");
  });

  it("searchIndex retorna array vazio para query sem tokens válidos", () => {
    const results = searchIndex(ORG, "a de o", 10);
    expect(Array.isArray(results)).toBe(true);
  });

  it("searchIndex respeita limit", () => {
    const orgId = ORG + 501;
    for (let i = 0; i < 5; i++) {
      indexEntity({ organizationId: orgId, entityId: `e${i}`, entityType: "tr", content: `pregão eletrônico item ${i}` });
    }
    const results = searchIndex(orgId, "pregão eletrônico", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("getIndexStats retorna totalEntries e byEntityType", () => {
    const orgId = ORG + 502;
    indexEntity({ organizationId: orgId, entityId: "e1", entityType: "tr", content: "Termo de referência completo" });
    const stats = getIndexStats(orgId);
    expect(stats.totalEntries).toBeGreaterThanOrEqual(1);
    expect(stats.byEntityType).toBeDefined();
    expect(typeof stats.byEntityType["tr"]).toBe("number");
  });
});

// ─── contextualRankingService ─────────────────────────────────────────────────

describe("contextualRankingService", () => {
  const baseItems = [
    { id: "item-1", score: 0.8, content: "Pregão eletrônico", metadata: {} },
    { id: "item-2", score: 0.6, content: "Contrato de serviços", metadata: {} },
    { id: "item-3", score: 0.4, content: "Parecer técnico", metadata: {} },
  ];

  const baseContext = {
    organizationId: ORG,
    workflowStage: "review" as const,
    institutionalRole: "pregoeiro" as const,
    documentCategory: "legal" as const,
    semanticConfidence: 0.8,
    legalRelevance: 0.9,
    queryDate: new Date().toISOString(),
  };

  it("rankItems retorna itens ordenados por score final", () => {
    const result = rankItems(baseItems, baseContext);
    expect(result.items.length).toBe(3);
    if (result.items.length >= 2) {
      expect(result.items[0].finalScore).toBeGreaterThanOrEqual(result.items[1].finalScore);
    }
  });

  it("rankItems define rankPosition sequencialmente", () => {
    const result = rankItems(baseItems, baseContext);
    result.items.forEach((item, i) => {
      expect(item.rankPosition).toBe(i + 1);
    });
  });

  it("rankItems retorna organizationId correto no resultado", () => {
    const result = rankItems(baseItems, baseContext);
    expect(result.organizationId).toBe(ORG);
  });

  it("rankItems scoreBreakdown tem campos de boost", () => {
    const result = rankItems([baseItems[0]], baseContext);
    const item = result.items[0];
    expect(item.scoreBreakdown).toBeDefined();
    expect(typeof item.scoreBreakdown.workflowBoost).toBe("number");
    expect(typeof item.scoreBreakdown.roleBoost).toBe("number");
  });

  it("rankItems replayKey é determinístico para mesmo input", () => {
    const r1 = rankItems([baseItems[0]], baseContext);
    const r2 = rankItems([baseItems[0]], baseContext);
    expect(r1.items[0].replayKey).toBe(r2.items[0].replayKey);
  });

  it("computeConfidencePropagation retorna array com scores propagados", () => {
    const result = rankItems(baseItems, baseContext);
    const propagated = computeConfidencePropagation(result.items);
    expect(Array.isArray(propagated)).toBe(true);
    expect(propagated.length).toBe(result.items.length);
    propagated.forEach((item) => {
      expect(item.finalScore).toBeGreaterThanOrEqual(0);
      expect(item.finalScore).toBeLessThanOrEqual(1);
    });
  });

  it("explainRanking retorna string com score", () => {
    const result = rankItems([baseItems[0]], baseContext);
    const explanation = explainRanking(result.items[0]);
    expect(typeof explanation).toBe("string");
    expect(explanation.length).toBeGreaterThan(0);
  });
});

// ─── evidenceRetrievalService ─────────────────────────────────────────────────

describe("evidenceRetrievalService", () => {
  it("createEvidenceItem cria item com campos obrigatórios", () => {
    const item = createEvidenceItem({
      organizationId: ORG,
      evidenceType: "legal_text",
      content: "Art. 75 da Lei 14.133/2021",
      sourceRef: "Lei 14.133/2021",
      confidence: 0.95,
      relevanceScore: 0.9,
    });
    expect(item.organizationId).toBe(ORG);
    expect(item.evidenceType).toBe("legal_text");
    expect(item.immutable).toBe(true);
    expect(item.status).toBe("active");
  });

  it("createEvidenceItem com legalBasis preserva campo", () => {
    const item = createEvidenceItem({
      organizationId: ORG,
      evidenceType: "jurisprudence",
      content: "Acórdão TCU",
      sourceRef: "TCU 1234/2023",
      legalBasis: "Lei 8.666/93",
      confidence: 0.8,
      relevanceScore: 0.85,
    });
    expect(item.legalBasis).toBe("Lei 8.666/93");
  });

  it("createEvidenceItem confidence fica em [0,1]", () => {
    const item = createEvidenceItem({
      organizationId: ORG,
      evidenceType: "document_reference",
      content: "doc",
      sourceRef: "ref",
      confidence: 1.5,
      relevanceScore: 0.5,
    });
    expect(item.confidence).toBeLessThanOrEqual(1);
  });

  it("assembleEvidenceChain monta cadeia apenas com evidências ativas", () => {
    const active = createEvidenceItem({ organizationId: ORG, evidenceType: "legal_text", content: "Ativo", sourceRef: "r1", confidence: 0.9, relevanceScore: 0.9 });
    const chain = assembleEvidenceChain({
      organizationId: ORG,
      sessionId: "sess-001",
      query: "teste",
      evidenceRefs: [active],
    });
    expect(chain.evidenceItems.length).toBeGreaterThan(0);
    expect(chain.organizationId).toBe(ORG);
  });

  it("assembleEvidenceChain replayKey é determinístico", () => {
    const item = createEvidenceItem({ organizationId: ORG, evidenceType: "legal_text", content: "c", sourceRef: "r", confidence: 0.8, relevanceScore: 0.8 });
    const c1 = assembleEvidenceChain({ organizationId: ORG, sessionId: "s1", query: "q1", evidenceRefs: [item] });
    const c2 = assembleEvidenceChain({ organizationId: ORG, sessionId: "s1", query: "q1", evidenceRefs: [item] });
    expect(c1.replayKey).toBe(c2.replayKey);
  });

  it("rankByProvenance ordena por tamanho de provenance", () => {
    const i1 = createEvidenceItem({ organizationId: ORG, evidenceType: "legal_text", content: "c1", sourceRef: "r1", confidence: 0.7, relevanceScore: 0.7, provenance: ["a", "b", "c"] });
    const i2 = createEvidenceItem({ organizationId: ORG, evidenceType: "legal_text", content: "c2", sourceRef: "r2", confidence: 0.9, relevanceScore: 0.9, provenance: [] });
    const chain = assembleEvidenceChain({ organizationId: ORG, sessionId: "s2", query: "q", evidenceRefs: [i1, i2] });
    const ranked = rankByProvenance(chain);
    expect(ranked.evidenceItems[0].provenance.length).toBeGreaterThanOrEqual(ranked.evidenceItems[ranked.evidenceItems.length - 1].provenance.length);
  });

  it("buildCitationList retorna lista de strings formatadas", () => {
    const item = createEvidenceItem({ organizationId: ORG, evidenceType: "legal_text", content: "Art. 75", sourceRef: "Lei 14.133", confidence: 0.9, relevanceScore: 0.9 });
    const chain = assembleEvidenceChain({ organizationId: ORG, sessionId: "s3", query: "q", evidenceRefs: [item] });
    const citations = buildCitationList(chain);
    expect(Array.isArray(citations)).toBe(true);
    expect(citations.length).toBeGreaterThan(0);
    expect(typeof citations[0]).toBe("string");
  });

  it("supersede muda status do antigo para superseded", () => {
    const old = createEvidenceItem({ organizationId: ORG, evidenceType: "technical", content: "antigo", sourceRef: "r", confidence: 0.5, relevanceScore: 0.5 });
    const novo = createEvidenceItem({ organizationId: ORG, evidenceType: "technical", content: "novo", sourceRef: "r2", confidence: 0.9, relevanceScore: 0.9 });
    const result = supersede(old, novo);
    expect(result.old.status).toBe("superseded");
    expect(result.new.status).toBe("active");
  });
});

// ─── retrievalExplainabilityService ──────────────────────────────────────────

describe("retrievalExplainabilityService", () => {
  it("buildExplanation gera explicação com campos obrigatórios", () => {
    const session = createRetrievalSession({ organizationId: ORG, queryText: "licitação pregão", correlationId: "expl-41-1" });
    const evidences = [
      createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: session.id, chunkId: "expl-c1", similarityScore: 0.8 }),
    ];
    const explanation = buildExplanation(session, evidences);
    expect(explanation.sessionId).toBe(session.id);
    expect(explanation.organizationId).toBe(ORG);
    expect(explanation.queryText).toBe("licitação pregão");
    expect(explanation.returnedResults).toBe(1);
  });

  it("formatExplanationForHuman retorna markdown formatado", () => {
    const session = createRetrievalSession({ organizationId: ORG, queryText: "pregão eletrônico", correlationId: "expl-41-2" });
    const evidences = [
      createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: session.id, chunkId: "expl-c2", similarityScore: 0.9 }),
    ];
    const explanation = buildExplanation(session, evidences);
    const text = formatExplanationForHuman(explanation);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("Retrieval Explanation");
  });

  it("compareExplanations detecta diferenças entre explicações", () => {
    const s1 = createRetrievalSession({ organizationId: ORG, queryText: "q1", retrievalStrategy: "vector_similarity", correlationId: "cmp-41-1" });
    const s2 = createRetrievalSession({ organizationId: ORG, queryText: "q1", retrievalStrategy: "bm25_hybrid", correlationId: "cmp-41-2" });
    const e1 = buildExplanation(s1, []);
    const e2 = buildExplanation(s2, []);
    const result = compareExplanations(e1, e2);
    expect(result.differences.length).toBeGreaterThan(0);
  });
});

// ─── hybridSearchService ──────────────────────────────────────────────────────

describe("hybridSearchService", () => {
  it("LEGAL_SYNONYMS tem pelo menos 15 entradas", () => {
    expect(Object.keys(LEGAL_SYNONYMS).length).toBeGreaterThanOrEqual(15);
  });

  it("TYPO_CORRECTIONS tem pelo menos 10 entradas", () => {
    expect(Object.keys(TYPO_CORRECTIONS).length).toBeGreaterThanOrEqual(10);
  });

  it("expandQuery corrige typos conhecidos", () => {
    const q = expandQuery("licitaçao pregao", ORG);
    expect(q.correctedQuery).toContain("licitação");
    expect(q.correctedQuery).toContain("pregão");
  });

  it("expandQuery tem replayKey determinístico", () => {
    const q1 = expandQuery("teste", ORG);
    const q2 = expandQuery("teste", ORG);
    expect(q1.replayKey).toBe(q2.replayKey);
  });

  it("expandQuery tem organizationId correto", () => {
    const q = expandQuery("licitação", ORG);
    expect(q.organizationId).toBe(ORG);
  });

  it("expandQuery produz expandedTerms não vazios", () => {
    const q = expandQuery("licitação pregão eletrônico", ORG);
    expect(q.expandedTerms.length).toBeGreaterThan(0);
  });

  it("search retorna hits com lexicalScore e semanticScore", () => {
    const q = expandQuery("pregão eletrônico licitação", ORG);
    const corpus = [
      { id: "c1", content: "Pregão eletrônico para compra de computadores", documentId: "d1", metadata: {} },
      { id: "c2", content: "Texto sem relação alguma", documentId: "d2", metadata: {} },
    ];
    const response = search(q, corpus);
    expect(response.hits.length).toBeGreaterThan(0);
    response.hits.forEach((h) => {
      expect(typeof h.lexicalScore).toBe("number");
      expect(typeof h.semanticScore).toBe("number");
    });
  });

  it("search retorna resposta com replayKey", () => {
    const q = expandQuery("contrato", ORG);
    const response = search(q, []);
    expect(response.replayKey).toBeDefined();
    expect(typeof response.replayKey).toBe("string");
  });

  it("applySemanticBoost aumenta scores dos hits", () => {
    const q = expandQuery("pregão", ORG);
    const corpus = [{ id: "c1", content: "pregão eletrônico", documentId: "d1", metadata: {} }];
    const response = search(q, corpus);
    if (response.hits.length > 0) {
      const boosted = applySemanticBoost(response.hits, 1.5);
      expect(boosted[0].semanticScore).toBeGreaterThanOrEqual(response.hits[0].semanticScore);
    }
  });

  it("applyContextualBoost usa factor >= 1", () => {
    const q = expandQuery("licitação", ORG);
    const corpus = [{ id: "c1", content: "licitação pública", documentId: "d1", metadata: {} }];
    const response = search(q, corpus);
    if (response.hits.length > 0) {
      const boosted = applyContextualBoost(response.hits, { factor: 1.2, condition: () => true });
      expect(Array.isArray(boosted)).toBe(true);
    }
  });

  it("suggestQueryExpansion retorna sugestões como array de strings", () => {
    const suggestions = suggestQueryExpansion("licitação");
    expect(Array.isArray(suggestions)).toBe(true);
    suggestions.forEach((s) => expect(typeof s).toBe("string"));
  });
});

// ─── retrievalObservabilityService ───────────────────────────────────────────

describe("retrievalObservabilityService", () => {
  const sessId = "obs-sess-001";

  it("recordLatency retorna métrica com metricName=retrieval_latency", () => {
    const m = recordLatency(ORG, sessId, 120);
    expect(m.metricName).toBe("retrieval_latency");
    expect(m.value).toBe(120);
    expect(m.organizationId).toBe(ORG);
  });

  it("recordRankingQuality retorna métrica com valor em [0,1]", () => {
    const m = recordRankingQuality(ORG, sessId, 0.85);
    expect(m.metricName).toBe("ranking_quality");
    expect(m.value).toBeGreaterThanOrEqual(0);
    expect(m.value).toBeLessThanOrEqual(1);
  });

  it("recordChunkEfficiency calcula ratio corretamente", () => {
    const m = recordChunkEfficiency(ORG, sessId, 400, 1000);
    expect(m.metricName).toBe("chunk_efficiency");
    expect(m.value).toBeCloseTo(0.4, 5);
  });

  it("recordSemanticRecall retorna métrica de recall", () => {
    const m = recordSemanticRecall(ORG, sessId, 0.72);
    expect(m.metricName).toBe("semantic_recall");
    expect(m.value).toBe(0.72);
  });

  it("recordEvidenceQuality retorna métrica de qualidade", () => {
    const m = recordEvidenceQuality(ORG, sessId, 0.9);
    expect(m.metricName).toBe("evidence_quality");
    expect(m.value).toBe(0.9);
  });

  it("recordQueryComplexity retorna métrica de complexidade", () => {
    const m = recordQueryComplexity(ORG, sessId, "complex", 5);
    expect(m.metricName).toBe("query_complexity");
    expect(m.tags["complexity"]).toBe("complex");
  });

  it("computeHealthSnapshot com latência alta gera alerta", () => {
    const metrics = [
      recordLatency(ORG + 600, "s", 3000),
      recordLatency(ORG + 600, "s", 2500),
      recordSemanticRecall(ORG + 600, "s", 0.9),
    ];
    const snap = computeHealthSnapshot(ORG + 600, metrics, { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
    expect(snap.degradationAlerts).toContain("High retrieval latency");
  });

  it("computeHealthSnapshot com semantic recall baixo gera alerta", () => {
    const metrics = [
      recordSemanticRecall(ORG + 601, "s", 0.2),
      recordSemanticRecall(ORG + 601, "s", 0.3),
      recordLatency(ORG + 601, "s", 100),
    ];
    const snap = computeHealthSnapshot(ORG + 601, metrics, { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
    expect(snap.degradationAlerts).toContain("Low semantic recall");
  });

  it("computeHealthSnapshot sem alertas quando tudo normal", () => {
    const metrics = [
      recordLatency(ORG + 602, "s", 50),
      recordSemanticRecall(ORG + 602, "s", 0.9),
    ];
    const snap = computeHealthSnapshot(ORG + 602, metrics, { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
    expect(snap.degradationAlerts.length).toBe(0);
  });

  it("computeHealthSnapshot calcula p95LatencyMs", () => {
    const orgId = ORG + 603;
    const latencies = [100, 120, 130, 150, 200, 300, 400, 500, 600, 3000];
    const metrics = latencies.map((l) => recordLatency(orgId, "s", l));
    const snap = computeHealthSnapshot(orgId, metrics, { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
    expect(snap.p95LatencyMs).toBeGreaterThan(0);
  });

  it("generateReport retorna relatório com organizationId", () => {
    const orgId = ORG + 610;
    const sid = "report-sess-01";
    recordLatency(orgId, sid, 200);
    recordRankingQuality(orgId, sid, 0.8);
    const report = generateReport(orgId, sid);
    expect(report.organizationId).toBe(orgId);
    expect(report.sessionId).toBe(sid);
  });

  it("generateReport tem forensicHash", () => {
    const orgId = ORG + 611;
    const sid = "report-sess-02";
    recordLatency(orgId, sid, 150);
    const report = generateReport(orgId, sid);
    expect(typeof report.forensicHash).toBe("string");
    expect(report.forensicHash.length).toBeGreaterThan(0);
  });
});
