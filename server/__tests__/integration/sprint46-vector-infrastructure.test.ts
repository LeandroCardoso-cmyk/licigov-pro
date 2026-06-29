import { describe, it, expect } from "vitest";

// Domain imports
import { createSemanticChunk, getChunkLineage, isChunkDuplicate } from "../../domain/semanticChunk";
import { createVectorEmbedding, cosineSimilarity, normalizeVector, isEmbeddingStale } from "../../domain/vectorEmbedding";
import { createRetrievalSession, addTraceEntry, completeRetrieval, getRetrievalReplayKey } from "../../domain/retrievalSession";
import { createRetrievalEvidence, compareEvidence, getEvidenceBreakdown } from "../../domain/retrievalEvidence";
import { createSemanticCorpus, updateCorpusStats, setIndexingStatus, isCorpusStale, upgradeEmbeddingVersion } from "../../domain/semanticCorpus";
import { createGovernancePolicy, enforceGovernance, isRetentionExpired, deactivatePolicy } from "../../domain/semanticGovernance";

// Service imports
import { chunkText, getChunks, getChunkById, deleteChunks, getChunkingStats } from "../../services/chunkingService";
import { generateEmbedding, batchGenerateEmbeddings, getEmbeddings, getEmbeddingById, getEmbeddingStats, deleteEmbeddings } from "../../services/embeddingService";
import { createVectorIndex, appendToIndex, searchIndex, getIndex, getIndicesByCorpus, rebuildIndex, detectOrphans } from "../../services/vectorIndexService";
import { retrieve, getRetrievalSessions, getRetrievalSession, getEvidences, getRetrievalStats } from "../../services/retrievalService";
import { rerank, getRerankStrategies } from "../../services/rerankingService";
import { createMemoryLink, getMemoryLinks, findCorrelations, findPrecedents, getMemoryStats, deleteMemoryLink } from "../../services/semanticMemoryService";
import { buildExplanation, formatExplanationForHuman, compareExplanations } from "../../services/retrievalExplainabilityService";
import { createReindexJob, approveReindexJob, updateJobProgress, getReindexJobs, getReindexJob, cancelReindexJob } from "../../services/reindexOrchestrationService";

const ORG = 9900;
const ORG2 = 9901;

// ─── Domain: SemanticChunk ───────────────────────────────────────────────────

describe("SemanticChunk", () => {
  it("cria chunk com campos obrigatórios", () => {
    const chunk = createSemanticChunk({ organizationId: ORG, documentId: "doc-1", sourceType: "document", chunkIndex: 0, chunkText: "Texto de teste", chunkStrategy: "paragraph_chunking" });
    expect(chunk.id).toBeDefined();
    expect(chunk.id.length).toBe(20);
    expect(chunk.organizationId).toBe(ORG);
    expect(chunk.documentId).toBe("doc-1");
    expect(chunk.sourceType).toBe("document");
    expect(chunk.chunkIndex).toBe(0);
    expect(chunk.chunkHash).toBeDefined();
    expect(chunk.chunkHash.length).toBe(40);
    expect(chunk.chunkText).toBe("Texto de teste");
    expect(chunk.normalizedText).toBe("texto de teste");
    expect(chunk.chunkStrategy).toBe("paragraph_chunking");
    expect(chunk.language).toBe("pt-BR");
    expect(chunk.tokenCount).toBeGreaterThan(0);
  });

  it("calcula tokenCount automaticamente", () => {
    const chunk = createSemanticChunk({ organizationId: ORG, documentId: "doc-1", sourceType: "document", chunkIndex: 0, chunkText: "ABCDEFGH", chunkStrategy: "paragraph_chunking" });
    expect(chunk.tokenCount).toBe(2);
  });

  it("gera chunkHash determinístico com mesmo input", () => {
    const a = createSemanticChunk({ organizationId: ORG, documentId: "doc-x", sourceType: "document", chunkIndex: 5, chunkText: "mesmo texto", chunkStrategy: "semantic_chunking" });
    const b = createSemanticChunk({ organizationId: ORG, documentId: "doc-x", sourceType: "document", chunkIndex: 5, chunkText: "mesmo texto", chunkStrategy: "semantic_chunking" });
    expect(a.chunkHash).toBe(b.chunkHash);
  });

  it("getChunkLineage retorna linhagem correta", () => {
    const chunk = createSemanticChunk({ organizationId: ORG, documentId: "doc-lin", sourceType: "legal_text", sourceSnapshotId: "snap-1", chunkIndex: 3, chunkText: "lineage test", chunkStrategy: "legal_clause_chunking" });
    const lineage = getChunkLineage(chunk);
    expect(lineage.documentId).toBe("doc-lin");
    expect(lineage.sourceType).toBe("legal_text");
    expect(lineage.chunkIndex).toBe(3);
    expect(lineage.strategy).toBe("legal_clause_chunking");
    expect(lineage.snapshotId).toBe("snap-1");
  });

  it("isChunkDuplicate identifica duplicatas pela hash + org", () => {
    const a = createSemanticChunk({ organizationId: ORG, documentId: "doc-dup", sourceType: "document", chunkIndex: 0, chunkText: "texto igual", chunkStrategy: "paragraph_chunking" });
    const b = createSemanticChunk({ organizationId: ORG, documentId: "doc-dup", sourceType: "document", chunkIndex: 0, chunkText: "texto igual", chunkStrategy: "paragraph_chunking" });
    expect(isChunkDuplicate(a, b)).toBe(true);
  });

  it("isChunkDuplicate retorna false para orgs diferentes", () => {
    const a = createSemanticChunk({ organizationId: ORG, documentId: "doc-dup2", sourceType: "document", chunkIndex: 0, chunkText: "mesmo texto", chunkStrategy: "paragraph_chunking" });
    const b = createSemanticChunk({ organizationId: ORG2, documentId: "doc-dup2", sourceType: "document", chunkIndex: 0, chunkText: "mesmo texto", chunkStrategy: "paragraph_chunking" });
    expect(isChunkDuplicate(a, b)).toBe(false);
  });

  it("suporta todos os 5 source types", () => {
    const types = ["document", "legal_text", "jurisprudence", "template", "manual_entry"] as const;
    for (const st of types) {
      const c = createSemanticChunk({ organizationId: ORG, documentId: `doc-${st}`, sourceType: st, chunkIndex: 0, chunkText: `text-${st}`, chunkStrategy: "paragraph_chunking" });
      expect(c.sourceType).toBe(st);
    }
  });
});

// ─── Domain: VectorEmbedding ─────────────────────────────────────────────────

describe("VectorEmbedding", () => {
  it("cria embedding com campos corretos", () => {
    const emb = createVectorEmbedding({ organizationId: ORG, chunkId: "chunk-1", providerId: "mock", model: "mock-v1", embeddingVersion: "v1", embeddingVector: [0.5, -0.3, 0.8], correlationId: "corr-1" });
    expect(emb.id).toBeDefined();
    expect(emb.id.length).toBe(20);
    expect(emb.organizationId).toBe(ORG);
    expect(emb.chunkId).toBe("chunk-1");
    expect(emb.embeddingVector).toEqual([0.5, -0.3, 0.8]);
    expect(emb.embeddingHash.length).toBe(40);
    expect(emb.deterministicSnapshot).toBeDefined();
  });

  it("gera id determinístico com mesmo input", () => {
    const a = createVectorEmbedding({ organizationId: ORG, chunkId: "c-det", providerId: "mock", model: "m-1", embeddingVersion: "v1", embeddingVector: [1, 0, 0], correlationId: "det-1" });
    const b = createVectorEmbedding({ organizationId: ORG, chunkId: "c-det", providerId: "mock", model: "m-1", embeddingVersion: "v1", embeddingVector: [1, 0, 0], correlationId: "det-2" });
    expect(a.id).toBe(b.id);
    expect(a.embeddingHash).toBe(b.embeddingHash);
  });

  it("cosineSimilarity: vetores idênticos = 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it("cosineSimilarity: vetores ortogonais = 0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });

  it("cosineSimilarity: vetores opostos = -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("cosineSimilarity: vetores vazios = 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("cosineSimilarity: tamanhos diferentes = 0", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it("normalizeVector: norma = 1", () => {
    const norm = normalizeVector([3, 4]);
    const mag = Math.sqrt(norm.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1, 5);
  });

  it("normalizeVector: vetor zero fica zero", () => {
    expect(normalizeVector([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("isEmbeddingStale: detecta versão desatualizada", () => {
    const emb = createVectorEmbedding({ organizationId: ORG, chunkId: "c-stale", providerId: "mock", model: "m1", embeddingVersion: "v1", embeddingVector: [1], correlationId: "s-1" });
    expect(isEmbeddingStale(emb, "v2")).toBe(true);
    expect(isEmbeddingStale(emb, "v1")).toBe(false);
  });
});

// ─── Domain: RetrievalSession ────────────────────────────────────────────────

describe("RetrievalSession", () => {
  it("cria sessão com defaults corretos", () => {
    const s = createRetrievalSession({ organizationId: ORG, queryText: "Teste de busca", correlationId: "corr-rs" });
    expect(s.id.length).toBe(20);
    expect(s.organizationId).toBe(ORG);
    expect(s.queryText).toBe("Teste de busca");
    expect(s.normalizedQuery).toBe("teste de busca");
    expect(s.retrievalStrategy).toBe("vector_similarity");
    expect(s.rerankingEnabled).toBe(false);
    expect(s.embeddingVersion).toBe("v1");
    expect(s.retrievedChunks).toEqual([]);
    expect(s.retrievalTrace).toEqual([]);
    expect(s.latencyMs).toBe(0);
  });

  it("addTraceEntry acumula latência", () => {
    let s = createRetrievalSession({ organizationId: ORG, queryText: "q1", correlationId: "c-trace" });
    s = addTraceEntry(s, { stage: "search", durationMs: 50, candidateCount: 10, details: {} });
    s = addTraceEntry(s, { stage: "rerank", durationMs: 30, candidateCount: 5, details: {} });
    expect(s.retrievalTrace.length).toBe(2);
    expect(s.latencyMs).toBe(80);
  });

  it("completeRetrieval preenche chunks e explainability", () => {
    let s = createRetrievalSession({ organizationId: ORG, queryText: "q2", correlationId: "c-comp" });
    s = completeRetrieval(s, ["c1", "c2"], { reason: "test" });
    expect(s.retrievedChunks).toEqual(["c1", "c2"]);
    expect(s.explainabilityData).toEqual({ reason: "test" });
  });

  it("getRetrievalReplayKey: determinístico com mesmo input", () => {
    const s1 = createRetrievalSession({ organizationId: ORG, queryText: "mesma query", correlationId: "rk-1" });
    const s2 = createRetrievalSession({ organizationId: ORG, queryText: "mesma query", correlationId: "rk-2" });
    expect(getRetrievalReplayKey(s1)).toBe(getRetrievalReplayKey(s2));
    expect(getRetrievalReplayKey(s1).length).toBe(40);
  });

  it("getRetrievalReplayKey: diferente para queries diferentes", () => {
    const s1 = createRetrievalSession({ organizationId: ORG, queryText: "query A", correlationId: "rk-a" });
    const s2 = createRetrievalSession({ organizationId: ORG, queryText: "query B", correlationId: "rk-b" });
    expect(getRetrievalReplayKey(s1)).not.toBe(getRetrievalReplayKey(s2));
  });

  it("suporta 4 estratégias de retrieval", () => {
    const strategies = ["vector_similarity", "bm25_hybrid", "weighted_retrieval", "contextual_expansion"] as const;
    for (const st of strategies) {
      const s = createRetrievalSession({ organizationId: ORG, queryText: "q", retrievalStrategy: st, correlationId: `st-${st}` });
      expect(s.retrievalStrategy).toBe(st);
    }
  });
});

// ─── Domain: RetrievalEvidence ───────────────────────────────────────────────

describe("RetrievalEvidence", () => {
  it("cria evidence com score final calculado", () => {
    const e = createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: "rs-1", chunkId: "c-1", similarityScore: 0.9, bm25Score: 0.5, rerankScore: 0.7 });
    expect(e.id.length).toBe(20);
    expect(e.finalScore).toBeCloseTo(0.9 * 0.6 + 0.5 * 0.25 + 0.7 * 0.15, 4);
    expect(e.evidenceType).toBe("reranked");
  });

  it("detecta tipo hybrid_match quando sim + bm25", () => {
    const e = createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: "rs-2", chunkId: "c-2", similarityScore: 0.8, bm25Score: 0.4 });
    expect(e.evidenceType).toBe("hybrid_match");
  });

  it("detecta tipo semantic_match quando só similarity", () => {
    const e = createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: "rs-3", chunkId: "c-3", similarityScore: 0.9 });
    expect(e.evidenceType).toBe("semantic_match");
  });

  it("compareEvidence ordena por finalScore desc", () => {
    const a = createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: "rs-cmp", chunkId: "c-a", similarityScore: 0.9 });
    const b = createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: "rs-cmp", chunkId: "c-b", similarityScore: 0.5 });
    expect(compareEvidence(a, b)).toBeLessThan(0);
    expect(compareEvidence(b, a)).toBeGreaterThan(0);
  });

  it("getEvidenceBreakdown retorna decomposição correta", () => {
    const e = createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: "rs-bd", chunkId: "c-bd", similarityScore: 0.85, bm25Score: 0.6, rerankScore: 0.7 });
    const bd = getEvidenceBreakdown(e);
    expect(bd.similarity).toBe(0.85);
    expect(bd.bm25).toBe(0.6);
    expect(bd.rerank).toBe(0.7);
    expect(bd.type).toBe("reranked");
  });

  it("id é determinístico com mesmos inputs", () => {
    const a = createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: "rs-det", chunkId: "c-det", similarityScore: 0.5 });
    const b = createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: "rs-det", chunkId: "c-det", similarityScore: 0.5 });
    expect(a.id).toBe(b.id);
  });
});

// ─── Domain: SemanticCorpus ──────────────────────────────────────────────────

describe("SemanticCorpus", () => {
  it("cria corpus com defaults", () => {
    const c = createSemanticCorpus({ organizationId: ORG, corpusType: "legal_base", corpusName: "Lei 14133" });
    expect(c.id.length).toBe(20);
    expect(c.organizationId).toBe(ORG);
    expect(c.corpusType).toBe("legal_base");
    expect(c.corpusName).toBe("Lei 14133");
    expect(c.indexingStrategy).toBe("incremental");
    expect(c.embeddingProvider).toBe("mock");
    expect(c.activeEmbeddingVersion).toBe("v1");
    expect(c.totalChunks).toBe(0);
    expect(c.totalEmbeddings).toBe(0);
    expect(c.indexingStatus).toBe("pending");
    expect(c.lastIndexedAt).toBeNull();
  });

  it("id é determinístico com mesmos parâmetros", () => {
    const a = createSemanticCorpus({ organizationId: ORG, corpusType: "custom", corpusName: "det-corpus" });
    const b = createSemanticCorpus({ organizationId: ORG, corpusType: "custom", corpusName: "det-corpus" });
    expect(a.id).toBe(b.id);
  });

  it("updateCorpusStats atualiza contadores e status", () => {
    const c = createSemanticCorpus({ organizationId: ORG, corpusType: "institutional", corpusName: "inst-1" });
    const updated = updateCorpusStats(c, 100, 95);
    expect(updated.totalChunks).toBe(100);
    expect(updated.totalEmbeddings).toBe(95);
    expect(updated.indexingStatus).toBe("indexed");
    expect(updated.lastIndexedAt).toBeDefined();
  });

  it("setIndexingStatus altera status", () => {
    const c = createSemanticCorpus({ organizationId: ORG, corpusType: "custom", corpusName: "stat-1" });
    const updated = setIndexingStatus(c, "indexing");
    expect(updated.indexingStatus).toBe("indexing");
  });

  it("isCorpusStale: sem lastIndexedAt retorna true", () => {
    const c = createSemanticCorpus({ organizationId: ORG, corpusType: "custom", corpusName: "stale-1" });
    expect(isCorpusStale(c, 1000)).toBe(true);
  });

  it("isCorpusStale: recém indexado retorna false", () => {
    const c = createSemanticCorpus({ organizationId: ORG, corpusType: "custom", corpusName: "fresh-1" });
    const updated = updateCorpusStats(c, 10, 10);
    expect(isCorpusStale(updated, 999999999)).toBe(false);
  });

  it("upgradeEmbeddingVersion atualiza versão e marca stale", () => {
    const c = createSemanticCorpus({ organizationId: ORG, corpusType: "custom", corpusName: "upg-1" });
    const upgraded = upgradeEmbeddingVersion(c, "v2");
    expect(upgraded.activeEmbeddingVersion).toBe("v2");
    expect(upgraded.indexingStatus).toBe("stale");
  });

  it("suporta 5 tipos de corpus", () => {
    const types = ["legal_base", "jurisprudence", "institutional", "templates", "custom"] as const;
    for (const t of types) {
      const c = createSemanticCorpus({ organizationId: ORG, corpusType: t, corpusName: `t-${t}` });
      expect(c.corpusType).toBe(t);
    }
  });
});

// ─── Domain: SemanticGovernance ──────────────────────────────────────────────

describe("SemanticGovernance", () => {
  it("cria política com defaults", () => {
    const p = createGovernancePolicy({ organizationId: ORG, policyName: "default" });
    expect(p.id.length).toBe(20);
    expect(p.organizationId).toBe(ORG);
    expect(p.policyName).toBe("default");
    expect(p.maxEmbeddingsPerDay).toBe(5000);
    expect(p.maxRetrievalsPerDay).toBe(10000);
    expect(p.retentionDays).toBe(365);
    expect(p.active).toBe(true);
    expect(p.requireApprovalForReindex).toBe(true);
  });

  it("enforceGovernance: permite quando dentro dos limites", () => {
    const p = createGovernancePolicy({ organizationId: ORG, policyName: "allow-test" });
    const result = enforceGovernance(p, { chunksToday: 0, embeddingsToday: 0, retrievalsToday: 0, tokensToday: 0 }, { operation: "embed" });
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("enforceGovernance: bloqueia quando excede limite de embeddings", () => {
    const p = createGovernancePolicy({ organizationId: ORG, policyName: "block-test", maxEmbeddingsPerDay: 100 });
    const result = enforceGovernance(p, { chunksToday: 0, embeddingsToday: 100, retrievalsToday: 0, tokensToday: 0 }, { operation: "embed" });
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain("Embedding daily limit exceeded");
  });

  it("enforceGovernance: bloqueia corpus type não permitido", () => {
    const p = createGovernancePolicy({ organizationId: ORG, policyName: "ct-test", allowedCorpusTypes: ["legal_base"] });
    const result = enforceGovernance(p, { chunksToday: 0, embeddingsToday: 0, retrievalsToday: 0, tokensToday: 0 }, { operation: "create", corpusType: "custom" });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toContain("Corpus type not allowed");
  });

  it("enforceGovernance: requer aprovação para reindex", () => {
    const p = createGovernancePolicy({ organizationId: ORG, policyName: "reindex-test" });
    const result = enforceGovernance(p, { chunksToday: 0, embeddingsToday: 0, retrievalsToday: 0, tokensToday: 0 }, { operation: "reindex", isReindex: true });
    expect(result.requiresApproval).toBe(true);
  });

  it("enforceGovernance: calcula quota remaining", () => {
    const p = createGovernancePolicy({ organizationId: ORG, policyName: "quota-test", maxEmbeddingsPerDay: 1000 });
    const result = enforceGovernance(p, { chunksToday: 0, embeddingsToday: 300, retrievalsToday: 0, tokensToday: 0 }, { operation: "embed" });
    expect(result.quotaRemaining.embeddings).toBe(700);
  });

  it("isRetentionExpired: data antiga expirada", () => {
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    expect(isRetentionExpired(oldDate, 365)).toBe(true);
  });

  it("isRetentionExpired: data recente não expirada", () => {
    expect(isRetentionExpired(new Date().toISOString(), 365)).toBe(false);
  });

  it("deactivatePolicy desativa", () => {
    const p = createGovernancePolicy({ organizationId: ORG, policyName: "deact-test" });
    const deactivated = deactivatePolicy(p);
    expect(deactivated.active).toBe(false);
  });
});

// ─── Service: ChunkingService ────────────────────────────────────────────────

describe("ChunkingService", () => {
  const DOC_ORG = 9910;
  const sampleText = "Primeiro parágrafo sobre licitação.\n\nSegundo parágrafo sobre Art. 12 da Lei 14133/2021.\n\nTerceiro parágrafo final.";

  it("paragraph_chunking: divide por parágrafos", () => {
    const chunks = chunkText({ organizationId: DOC_ORG, documentId: "doc-para", text: sampleText, strategy: "paragraph_chunking", sourceType: "document" });
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[1]!.chunkIndex).toBe(1);
  });

  it("legal_clause_chunking: divide por cláusulas legais", () => {
    const legalText = "Art. 12. Obrigações do pregoeiro.\n§ 1º O pregoeiro deve atuar com transparência.\nArt. 13. Comissão de contratação.";
    const chunks = chunkText({ organizationId: DOC_ORG, documentId: "doc-legal", text: legalText, strategy: "legal_clause_chunking", sourceType: "legal_text" });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("sliding_window: cria janelas com overlap", () => {
    const longText = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText({ organizationId: DOC_ORG, documentId: "doc-slide", text: longText, strategy: "sliding_window", sourceType: "document", windowSize: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("hierarchical_chunking: agrupa parágrafos em pares", () => {
    const text = "P1.\n\nP2.\n\nP3.\n\nP4.";
    const chunks = chunkText({ organizationId: DOC_ORG, documentId: "doc-hier", text, strategy: "hierarchical_chunking", sourceType: "document" });
    expect(chunks.length).toBe(2);
  });

  it("getChunks filtra por documentId", () => {
    chunkText({ organizationId: DOC_ORG, documentId: "doc-filter-a", text: "chunk a", strategy: "paragraph_chunking", sourceType: "document" });
    chunkText({ organizationId: DOC_ORG, documentId: "doc-filter-b", text: "chunk b", strategy: "paragraph_chunking", sourceType: "document" });
    const a = getChunks(DOC_ORG, "doc-filter-a");
    expect(a.every(c => c.documentId === "doc-filter-a")).toBe(true);
  });

  it("getChunkById retorna null se não existe", () => {
    expect(getChunkById(DOC_ORG, "inexistente")).toBeNull();
  });

  it("deleteChunks remove por documentId", () => {
    chunkText({ organizationId: DOC_ORG, documentId: "doc-del", text: "a deletar", strategy: "paragraph_chunking", sourceType: "document" });
    const deleted = deleteChunks(DOC_ORG, "doc-del");
    expect(deleted).toBeGreaterThan(0);
    expect(getChunks(DOC_ORG, "doc-del")).toHaveLength(0);
  });

  it("getChunkingStats retorna estatísticas por estratégia", () => {
    const stats = getChunkingStats(DOC_ORG);
    expect(stats.totalChunks).toBeGreaterThan(0);
    expect(stats.totalTokens).toBeGreaterThan(0);
    expect(typeof stats.strategies).toBe("object");
  });
});

// ─── Service: EmbeddingService ───────────────────────────────────────────────

describe("EmbeddingService", () => {
  const EMB_ORG = 9911;

  it("generateEmbedding: produz vetor normalizado de 128 dimensões", () => {
    const emb = generateEmbedding({ organizationId: EMB_ORG, chunkId: "emb-c1", text: "texto de teste", correlationId: "emb-corr-1" });
    expect(emb.embeddingVector.length).toBe(128);
    const mag = Math.sqrt(emb.embeddingVector.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1, 3);
  });

  it("generateEmbedding: determinístico — mesmo texto = mesmo vetor", () => {
    const a = generateEmbedding({ organizationId: EMB_ORG, chunkId: "det-1", text: "deterministic test", correlationId: "det-c1" });
    const b = generateEmbedding({ organizationId: EMB_ORG, chunkId: "det-2", text: "deterministic test", correlationId: "det-c2" });
    expect(a.embeddingVector).toEqual(b.embeddingVector);
  });

  it("batchGenerateEmbeddings: gera múltiplos embeddings", () => {
    const embs = batchGenerateEmbeddings({
      organizationId: EMB_ORG,
      chunks: [{ chunkId: "bc-1", text: "texto 1" }, { chunkId: "bc-2", text: "texto 2" }],
      correlationId: "batch-1",
    });
    expect(embs.length).toBe(2);
    expect(embs[0]!.chunkId).toBe("bc-1");
    expect(embs[1]!.chunkId).toBe("bc-2");
  });

  it("getEmbeddings filtra por chunkId", () => {
    generateEmbedding({ organizationId: EMB_ORG, chunkId: "filt-1", text: "a", correlationId: "f-1" });
    generateEmbedding({ organizationId: EMB_ORG, chunkId: "filt-2", text: "b", correlationId: "f-2" });
    const filtered = getEmbeddings(EMB_ORG, "filt-1");
    expect(filtered.every(e => e.chunkId === "filt-1")).toBe(true);
  });

  it("getEmbeddingStats conta provedores e versões", () => {
    const stats = getEmbeddingStats(EMB_ORG);
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.providers["mock"]).toBeGreaterThan(0);
    expect(stats.versions["v1"]).toBeGreaterThan(0);
  });

  it("deleteEmbeddings remove por chunkId", () => {
    generateEmbedding({ organizationId: EMB_ORG, chunkId: "del-chunk", text: "delete me", correlationId: "del-1" });
    const deleted = deleteEmbeddings(EMB_ORG, "del-chunk");
    expect(deleted).toBeGreaterThan(0);
  });

  it("getEmbeddingById retorna null se não existe", () => {
    expect(getEmbeddingById(EMB_ORG, "inexistente")).toBeNull();
  });
});

// ─── Service: VectorIndexService ─────────────────────────────────────────────

describe("VectorIndexService", () => {
  const IDX_ORG = 9912;

  it("createVectorIndex: cria índice vazio", () => {
    const idx = createVectorIndex({ organizationId: IDX_ORG, corpusId: "corpus-1" });
    expect(idx.id.length).toBe(20);
    expect(idx.organizationId).toBe(IDX_ORG);
    expect(idx.entries).toHaveLength(0);
    expect(idx.status).toBe("ready");
  });

  it("appendToIndex: adiciona embeddings sem duplicar", () => {
    const idx = createVectorIndex({ organizationId: IDX_ORG, corpusId: "corpus-append" });
    const emb = createVectorEmbedding({ organizationId: IDX_ORG, chunkId: "ac-1", providerId: "mock", model: "m1", embeddingVersion: "v1", embeddingVector: [1, 0, 0], correlationId: "ac-1" });
    const updated = appendToIndex(IDX_ORG, idx.id, [emb]);
    expect(updated!.entries).toHaveLength(1);
    const again = appendToIndex(IDX_ORG, idx.id, [emb]);
    expect(again!.entries).toHaveLength(1);
  });

  it("searchIndex: retorna resultados ordenados por similaridade", () => {
    const idx = createVectorIndex({ organizationId: IDX_ORG, corpusId: "corpus-search" });
    const e1 = createVectorEmbedding({ organizationId: IDX_ORG, chunkId: "sc-1", providerId: "mock", model: "m1", embeddingVersion: "v1", embeddingVector: [1, 0, 0], correlationId: "sc-1" });
    const e2 = createVectorEmbedding({ organizationId: IDX_ORG, chunkId: "sc-2", providerId: "mock", model: "m1", embeddingVersion: "v1", embeddingVector: [0, 1, 0], correlationId: "sc-2" });
    appendToIndex(IDX_ORG, idx.id, [e1, e2]);
    const results = searchIndex(IDX_ORG, idx.id, [1, 0, 0], 5);
    expect(results.length).toBe(2);
    expect(results[0]!.chunkId).toBe("sc-1");
    expect(results[0]!.score).toBeCloseTo(1, 3);
  });

  it("getIndex: retorna null se não existe", () => {
    expect(getIndex(IDX_ORG, "inexistente")).toBeNull();
  });

  it("getIndicesByCorpus: filtra por corpus", () => {
    createVectorIndex({ organizationId: IDX_ORG, corpusId: "corpus-byc" });
    const byCorpus = getIndicesByCorpus(IDX_ORG, "corpus-byc");
    expect(byCorpus.length).toBeGreaterThan(0);
    expect(byCorpus.every(i => i.corpusId === "corpus-byc")).toBe(true);
  });

  it("rebuildIndex: substitui todas as entries", () => {
    const idx = createVectorIndex({ organizationId: IDX_ORG, corpusId: "corpus-rebuild" });
    const e1 = createVectorEmbedding({ organizationId: IDX_ORG, chunkId: "rb-1", providerId: "mock", model: "m1", embeddingVersion: "v1", embeddingVector: [1, 0], correlationId: "rb-1" });
    appendToIndex(IDX_ORG, idx.id, [e1]);
    const e2 = createVectorEmbedding({ organizationId: IDX_ORG, chunkId: "rb-2", providerId: "mock", model: "m1", embeddingVersion: "v1", embeddingVector: [0, 1], correlationId: "rb-2" });
    const rebuilt = rebuildIndex(IDX_ORG, idx.id, [e2]);
    expect(rebuilt!.entries).toHaveLength(1);
    expect(rebuilt!.entries[0]!.chunkId).toBe("rb-2");
  });

  it("detectOrphans: identifica embeddings sem chunk válido", () => {
    const idx = createVectorIndex({ organizationId: IDX_ORG, corpusId: "corpus-orphan" });
    const e1 = createVectorEmbedding({ organizationId: IDX_ORG, chunkId: "orph-valid", providerId: "mock", model: "m1", embeddingVersion: "v1", embeddingVector: [1], correlationId: "o-1" });
    const e2 = createVectorEmbedding({ organizationId: IDX_ORG, chunkId: "orph-invalid", providerId: "mock", model: "m1", embeddingVersion: "v1", embeddingVector: [0], correlationId: "o-2" });
    appendToIndex(IDX_ORG, idx.id, [e1, e2]);
    const orphans = detectOrphans(IDX_ORG, idx.id, new Set(["orph-valid"]));
    expect(orphans).toContain(e2.id);
    expect(orphans).not.toContain(e1.id);
  });
});

// ─── Service: RetrievalService ───────────────────────────────────────────────

describe("RetrievalService", () => {
  const RET_ORG = 9913;

  it("retrieve: retorna sessão, evidences e ranking", () => {
    const result = retrieve({
      organizationId: RET_ORG, queryText: "licitação pública", queryVector: [1, 0, 0],
      candidates: [
        { chunkId: "r-1", vector: [1, 0, 0], text: "licitação pública art 12" },
        { chunkId: "r-2", vector: [0, 1, 0], text: "contrato de prestação" },
      ],
      correlationId: "ret-1",
    });
    expect(result.session).toBeDefined();
    expect(result.evidences.length).toBe(2);
    expect(result.rankedChunkIds[0]).toBe("r-1");
  });

  it("retrieve com bm25_hybrid: combina similaridade e BM25", () => {
    const result = retrieve({
      organizationId: RET_ORG, queryText: "pregão eletrônico", queryVector: [0.5, 0.5, 0],
      candidates: [
        { chunkId: "bm-1", vector: [0.5, 0.5, 0], text: "pregão eletrônico modalidade" },
        { chunkId: "bm-2", vector: [0.9, 0, 0], text: "dispensa de licitação" },
      ],
      strategy: "bm25_hybrid", correlationId: "bm25-1",
    });
    expect(result.session.retrievalStrategy).toBe("bm25_hybrid");
    expect(result.evidences.some(e => e.bm25Score > 0)).toBe(true);
  });

  it("retrieve: gera trace com stage similarity_search", () => {
    const result = retrieve({
      organizationId: RET_ORG, queryText: "query trace", queryVector: [1, 0],
      candidates: [{ chunkId: "tr-1", vector: [1, 0], text: "trace test" }],
      correlationId: "trace-1",
    });
    expect(result.session.retrievalTrace.length).toBe(1);
    expect(result.session.retrievalTrace[0]!.stage).toBe("similarity_search");
  });

  it("retrieve: respeita topK", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      chunkId: `tk-${i}`, vector: [Math.random(), Math.random()], text: `chunk ${i}`,
    }));
    const result = retrieve({ organizationId: RET_ORG, queryText: "topk test", queryVector: [1, 0], candidates, topK: 5, correlationId: "topk-1" });
    expect(result.rankedChunkIds.length).toBe(5);
  });

  it("getRetrievalSessions retorna sessões da org", () => {
    const sessions = getRetrievalSessions(RET_ORG);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every(s => s.organizationId === RET_ORG)).toBe(true);
  });

  it("getRetrievalStats calcula médias", () => {
    const stats = getRetrievalStats(RET_ORG);
    expect(stats.totalSessions).toBeGreaterThan(0);
    expect(typeof stats.avgLatencyMs).toBe("number");
    expect(typeof stats.avgResultCount).toBe("number");
  });

  it("isolamento multi-tenant: org diferente não vê sessões", () => {
    const sessions = getRetrievalSessions(99999);
    expect(sessions).toHaveLength(0);
  });
});

// ─── Service: RerankingService ───────────────────────────────────────────────

describe("RerankingService", () => {
  const RR_ORG = 9914;
  const candidates = [
    { chunkId: "rr-1", originalScore: 0.8, text: "Art. 12 da Lei 14133/2021 sobre pregão eletrônico" },
    { chunkId: "rr-2", originalScore: 0.9, text: "contrato administrativo padrão" },
    { chunkId: "rr-3", originalScore: 0.7, text: "dispensa de licitação § 3º" },
  ];

  it("semantic rerank mantém ordem e ajusta scores", () => {
    const result = rerank({ organizationId: RR_ORG, retrievalSessionId: "rr-s1", candidates, strategy: "semantic" });
    expect(result.rerankedOrder.length).toBe(3);
    expect(result.evidences.length).toBe(3);
    expect(result.rerankLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("legal_priority rerank: favorece textos com referências legais", () => {
    const legalCandidates = [
      { chunkId: "lp-1", originalScore: 0.7, text: "Art. 12 da Lei 14133/2021 sobre pregão eletrônico" },
      { chunkId: "lp-2", originalScore: 0.75, text: "contrato administrativo padrão sem referência legal" },
      { chunkId: "lp-3", originalScore: 0.7, text: "dispensa de licitação § 3º com embasamento" },
    ];
    const result = rerank({ organizationId: RR_ORG, retrievalSessionId: "rr-s2", candidates: legalCandidates, strategy: "legal_priority" });
    const topTwo = result.rerankedOrder.slice(0, 2);
    expect(topTwo).toContain("lp-1");
    expect(topTwo).toContain("lp-3");
  });

  it("contextual rerank: usa sobreposição de tokens", () => {
    const result = rerank({ organizationId: RR_ORG, retrievalSessionId: "rr-s3", candidates, strategy: "contextual", queryContext: "licitação pregão" });
    expect(result.rerankedOrder.length).toBe(3);
    expect(result.evidences.every(e => e.evidenceType === "reranked")).toBe(true);
  });

  it("workflow_aware: funciona como semantic com contexto", () => {
    const result = rerank({ organizationId: RR_ORG, retrievalSessionId: "rr-s4", candidates, strategy: "workflow_aware", queryContext: "pregão" });
    expect(result.rerankedOrder.length).toBe(3);
  });

  it("getRerankStrategies retorna 4 estratégias", () => {
    const strategies = getRerankStrategies();
    expect(strategies).toHaveLength(4);
    expect(strategies).toContain("semantic");
    expect(strategies).toContain("contextual");
    expect(strategies).toContain("legal_priority");
    expect(strategies).toContain("workflow_aware");
  });
});

// ─── Service: SemanticMemoryService ──────────────────────────────────────────

describe("SemanticMemoryService", () => {
  const MEM_ORG = 9915;

  it("createMemoryLink: cria link entre chunks", () => {
    const link = createMemoryLink({ organizationId: MEM_ORG, sourceChunkId: "src-1", targetChunkId: "tgt-1", linkType: "correlation", strength: 0.8, correlationId: "ml-1" });
    expect(link.id.length).toBe(20);
    expect(link.organizationId).toBe(MEM_ORG);
    expect(link.sourceChunkId).toBe("src-1");
    expect(link.targetChunkId).toBe("tgt-1");
    expect(link.linkType).toBe("correlation");
    expect(link.strength).toBe(0.8);
  });

  it("createMemoryLink: id determinístico com mesmos inputs", () => {
    const a = createMemoryLink({ organizationId: MEM_ORG, sourceChunkId: "det-s", targetChunkId: "det-t", linkType: "precedent", correlationId: "det-m1" });
    const b = createMemoryLink({ organizationId: MEM_ORG, sourceChunkId: "det-s", targetChunkId: "det-t", linkType: "precedent", correlationId: "det-m2" });
    expect(a.id).toBe(b.id);
  });

  it("getMemoryLinks: filtra por chunkId (source ou target)", () => {
    createMemoryLink({ organizationId: MEM_ORG, sourceChunkId: "ml-a", targetChunkId: "ml-b", linkType: "reuse", correlationId: "ml-f1" });
    const links = getMemoryLinks(MEM_ORG, "ml-a");
    expect(links.length).toBeGreaterThan(0);
    expect(links.every(l => l.sourceChunkId === "ml-a" || l.targetChunkId === "ml-a")).toBe(true);
  });

  it("findCorrelations: filtra apenas correlações", () => {
    createMemoryLink({ organizationId: MEM_ORG, sourceChunkId: "fc-1", targetChunkId: "fc-2", linkType: "correlation", correlationId: "fc-c1" });
    createMemoryLink({ organizationId: MEM_ORG, sourceChunkId: "fc-1", targetChunkId: "fc-3", linkType: "precedent", correlationId: "fc-c2" });
    const correlations = findCorrelations(MEM_ORG, "fc-1");
    expect(correlations.every(l => l.linkType === "correlation")).toBe(true);
  });

  it("findPrecedents: filtra apenas precedentes", () => {
    const precedents = findPrecedents(MEM_ORG, "fc-1");
    expect(precedents.every(l => l.linkType === "precedent")).toBe(true);
  });

  it("getMemoryStats: conta por tipo e calcula média de strength", () => {
    const stats = getMemoryStats(MEM_ORG);
    expect(stats.totalLinks).toBeGreaterThan(0);
    expect(typeof stats.byType).toBe("object");
    expect(stats.avgStrength).toBeGreaterThan(0);
    expect(stats.avgStrength).toBeLessThanOrEqual(1);
  });

  it("deleteMemoryLink: remove link específico", () => {
    const link = createMemoryLink({ organizationId: MEM_ORG, sourceChunkId: "del-s", targetChunkId: "del-t", linkType: "contradiction", correlationId: "del-ml" });
    const deleted = deleteMemoryLink(MEM_ORG, link.id);
    expect(deleted).toBe(true);
  });

  it("deleteMemoryLink: retorna false se não existe", () => {
    expect(deleteMemoryLink(MEM_ORG, "inexistente")).toBe(false);
  });

  it("suporta todos os 5 tipos de link", () => {
    const types = ["correlation", "reuse", "precedent", "contradiction", "evolution"] as const;
    for (const t of types) {
      const link = createMemoryLink({ organizationId: MEM_ORG, sourceChunkId: `lt-${t}-s`, targetChunkId: `lt-${t}-t`, linkType: t, correlationId: `lt-${t}` });
      expect(link.linkType).toBe(t);
    }
  });
});

// ─── Service: RetrievalExplainabilityService ─────────────────────────────────

describe("RetrievalExplainabilityService", () => {
  it("buildExplanation: gera explicação completa", () => {
    const session = createRetrievalSession({ organizationId: ORG, queryText: "explicação teste", correlationId: "exp-1" });
    const sessionWithTrace = addTraceEntry(session, { stage: "search", durationMs: 42, candidateCount: 5, details: { totalCandidates: 10 } });
    const evidences = [
      createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: session.id, chunkId: "ex-1", similarityScore: 0.9, bm25Score: 0.3 }),
      createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: session.id, chunkId: "ex-2", similarityScore: 0.6 }),
    ];
    const explanation = buildExplanation(sessionWithTrace, evidences);
    expect(explanation.sessionId).toBe(session.id);
    expect(explanation.queryText).toBe("explicação teste");
    expect(explanation.strategy).toBe("vector_similarity");
    expect(explanation.returnedResults).toBe(2);
    expect(explanation.traceBreakdown).toHaveLength(1);
    expect(explanation.evidenceBreakdown).toHaveLength(2);
    expect(explanation.reasoning).toContain("Retrieved 2 results");
  });

  it("formatExplanationForHuman: retorna markdown", () => {
    const session = createRetrievalSession({ organizationId: ORG, queryText: "format test", correlationId: "fmt-1" });
    const evidences = [createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: session.id, chunkId: "fmt-c", similarityScore: 0.8 })];
    const explanation = buildExplanation(session, evidences);
    const text = formatExplanationForHuman(explanation);
    expect(text).toContain("## Retrieval Explanation");
    expect(text).toContain("**Query:**");
    expect(text).toContain("### Ranking Breakdown");
  });

  it("compareExplanations: detecta mudanças de estratégia", () => {
    const s1 = createRetrievalSession({ organizationId: ORG, queryText: "q", retrievalStrategy: "vector_similarity", correlationId: "cmp-1" });
    const s2 = createRetrievalSession({ organizationId: ORG, queryText: "q", retrievalStrategy: "bm25_hybrid", correlationId: "cmp-2" });
    const e1 = buildExplanation(s1, []);
    const e2 = buildExplanation(s2, []);
    const cmp = compareExplanations(e1, e2);
    expect(cmp.differences.length).toBeGreaterThan(0);
    expect(cmp.differences.some(d => d.includes("Strategy changed"))).toBe(true);
  });

  it("compareExplanations: detecta mudança de top result", () => {
    const s = createRetrievalSession({ organizationId: ORG, queryText: "q", correlationId: "top-1" });
    const ev1 = [createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: s.id, chunkId: "A", similarityScore: 0.9 })];
    const ev2 = [createRetrievalEvidence({ organizationId: ORG, retrievalSessionId: s.id, chunkId: "B", similarityScore: 0.8 })];
    const exp1 = buildExplanation(s, ev1);
    const exp2 = buildExplanation(s, ev2);
    const cmp = compareExplanations(exp1, exp2);
    expect(cmp.differences.some(d => d.includes("Top result changed"))).toBe(true);
  });
});

// ─── Service: ReindexOrchestrationService ────────────────────────────────────

describe("ReindexOrchestrationService", () => {
  const RDX_ORG = 9916;

  it("createReindexJob: cria job com status correto", () => {
    const job = createReindexJob({ organizationId: RDX_ORG, corpusId: "rdx-corpus", reindexType: "full_reindex", fromVersion: "v1", toVersion: "v2", totalChunks: 500, correlationId: "rdx-1" });
    expect(job.id.length).toBe(20);
    expect(job.status).toBe("running");
    expect(job.totalChunks).toBe(500);
    expect(job.processedChunks).toBe(0);
    expect(job.requiresApproval).toBe(false);
    expect(job.startedAt).toBeDefined();
  });

  it("createReindexJob com requiresApproval: status pending", () => {
    const job = createReindexJob({ organizationId: RDX_ORG, corpusId: "rdx-appr", reindexType: "version_migration", fromVersion: "v1", toVersion: "v2", totalChunks: 100, requiresApproval: true, correlationId: "rdx-2" });
    expect(job.status).toBe("pending");
    expect(job.requiresApproval).toBe(true);
    expect(job.startedAt).toBeNull();
  });

  it("approveReindexJob: aprova job pendente", () => {
    const job = createReindexJob({ organizationId: RDX_ORG, corpusId: "rdx-app2", reindexType: "full_reindex", fromVersion: "v1", toVersion: "v2", totalChunks: 50, requiresApproval: true, correlationId: "rdx-3" });
    const approved = approveReindexJob(RDX_ORG, job.id, "admin@test.com");
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe("approved");
    expect(approved!.approvedBy).toBe("admin@test.com");
    expect(approved!.startedAt).toBeDefined();
  });

  it("approveReindexJob: retorna null se job não está pending", () => {
    const job = createReindexJob({ organizationId: RDX_ORG, corpusId: "rdx-np", reindexType: "full_reindex", fromVersion: "v1", toVersion: "v2", totalChunks: 50, correlationId: "rdx-4" });
    const result = approveReindexJob(RDX_ORG, job.id, "admin");
    expect(result).toBeNull();
  });

  it("updateJobProgress: acumula progresso", () => {
    const job = createReindexJob({ organizationId: RDX_ORG, corpusId: "rdx-prog", reindexType: "incremental", fromVersion: "v1", toVersion: "v2", totalChunks: 100, correlationId: "rdx-5" });
    const p1 = updateJobProgress(RDX_ORG, job.id, 30, 0);
    expect(p1!.processedChunks).toBe(30);
    expect(p1!.status).toBe("running");
    const p2 = updateJobProgress(RDX_ORG, job.id, 70, 0);
    expect(p2!.processedChunks).toBe(100);
    expect(p2!.status).toBe("completed");
    expect(p2!.completedAt).toBeDefined();
  });

  it("updateJobProgress: marca failed se tem falhas", () => {
    const job = createReindexJob({ organizationId: RDX_ORG, corpusId: "rdx-fail", reindexType: "full_reindex", fromVersion: "v1", toVersion: "v2", totalChunks: 10, correlationId: "rdx-6" });
    const result = updateJobProgress(RDX_ORG, job.id, 7, 3);
    expect(result!.status).toBe("failed");
    expect(result!.failedChunks).toBe(3);
  });

  it("getReindexJobs: filtra por corpusId", () => {
    const jobs = getReindexJobs(RDX_ORG, "rdx-corpus");
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every(j => j.corpusId === "rdx-corpus")).toBe(true);
  });

  it("getReindexJob: retorna null se não existe", () => {
    expect(getReindexJob(RDX_ORG, "inexistente")).toBeNull();
  });

  it("cancelReindexJob: cancela job existente", () => {
    const job = createReindexJob({ organizationId: RDX_ORG, corpusId: "rdx-cancel", reindexType: "full_reindex", fromVersion: "v1", toVersion: "v2", totalChunks: 50, correlationId: "rdx-7" });
    const cancelled = cancelReindexJob(RDX_ORG, job.id);
    expect(cancelled!.status).toBe("cancelled");
    expect(cancelled!.completedAt).toBeDefined();
  });

  it("cancelReindexJob: retorna null se não existe", () => {
    expect(cancelReindexJob(RDX_ORG, "inexistente")).toBeNull();
  });

  it("isolamento multi-tenant: outra org não vê jobs", () => {
    expect(getReindexJobs(99998)).toHaveLength(0);
  });
});

// ─── Integração: Pipeline completo ───────────────────────────────────────────

describe("Pipeline Integração", () => {
  const PIPE_ORG = 9917;
  const docText = "Art. 12 da Lei 14.133/2021 estabelece que o processo licitatório observará as regras de transparência.\n\nA Comissão de Contratação deve assegurar a igualdade de condições a todos os concorrentes.";

  it("pipeline completo: chunk → embed → index → retrieve → rerank", () => {
    const chunks = chunkText({ organizationId: PIPE_ORG, documentId: "pipe-doc", text: docText, strategy: "paragraph_chunking", sourceType: "legal_text" });
    expect(chunks.length).toBe(2);

    const embeddings = batchGenerateEmbeddings({
      organizationId: PIPE_ORG, chunks: chunks.map(c => ({ chunkId: c.id, text: c.chunkText })), correlationId: "pipe-emb",
    });
    expect(embeddings.length).toBe(2);

    const index = createVectorIndex({ organizationId: PIPE_ORG, corpusId: "pipe-corpus" });
    const updatedIndex = appendToIndex(PIPE_ORG, index.id, embeddings);
    expect(updatedIndex!.entries.length).toBe(2);

    const queryEmb = generateEmbedding({ organizationId: PIPE_ORG, chunkId: "pipe-query", text: "transparência licitação", correlationId: "pipe-q" });

    const result = retrieve({
      organizationId: PIPE_ORG, queryText: "transparência licitação", queryVector: queryEmb.embeddingVector,
      candidates: chunks.map((c, i) => ({ chunkId: c.id, vector: embeddings[i]!.embeddingVector, text: c.chunkText })),
      strategy: "bm25_hybrid", correlationId: "pipe-ret",
    });
    expect(result.rankedChunkIds.length).toBe(2);

    const reranked = rerank({
      organizationId: PIPE_ORG, retrievalSessionId: result.session.id,
      candidates: result.evidences.map(e => ({
        chunkId: e.chunkId, originalScore: e.finalScore,
        text: chunks.find(c => c.id === e.chunkId)?.chunkText ?? "",
      })),
      strategy: "legal_priority",
    });
    expect(reranked.rerankedOrder.length).toBe(2);

    const explanation = buildExplanation(result.session, result.evidences);
    expect(explanation.returnedResults).toBe(2);
    const humanText = formatExplanationForHuman(explanation);
    expect(humanText).toContain("Retrieval Explanation");
  });

  it("pipeline com memory links: cria e consulta relações", () => {
    const chunks = chunkText({ organizationId: PIPE_ORG, documentId: "pipe-mem-doc", text: "Chunk A sobre licitação.\n\nChunk B sobre contratos.", strategy: "paragraph_chunking", sourceType: "document" });
    expect(chunks.length).toBe(2);

    const link = createMemoryLink({
      organizationId: PIPE_ORG, sourceChunkId: chunks[0]!.id, targetChunkId: chunks[1]!.id,
      linkType: "correlation", strength: 0.75, context: "Ambos sobre contratação pública", correlationId: "pipe-ml",
    });
    expect(link.linkType).toBe("correlation");

    const correlations = findCorrelations(PIPE_ORG, chunks[0]!.id);
    expect(correlations.length).toBeGreaterThan(0);
  });
});
