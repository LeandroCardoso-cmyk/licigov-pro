import { createHash } from "crypto";
import { type RetrievalSession, type RetrievalStrategy, createRetrievalSession, addTraceEntry, completeRetrieval } from "../domain/retrievalSession";
import { type RetrievalEvidence, createRetrievalEvidence } from "../domain/retrievalEvidence";
import { cosineSimilarity } from "../domain/vectorEmbedding";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

const _sessions = new Map<number, RetrievalSession[]>();
const _evidences = new Map<number, RetrievalEvidence[]>();

function computeBM25(query: string, document: string): number {
  const queryTokens = query.toLowerCase().split(/\s+/);
  const docTokens = document.toLowerCase().split(/\s+/);
  const docLen = docTokens.length;
  const avgLen = 200;
  const k1 = 1.2, b = 0.75;
  let score = 0;
  for (const term of queryTokens) {
    const tf = docTokens.filter(t => t === term).length;
    const idf = Math.log(1 + 1 / (1 + 0.5));
    score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgLen));
  }
  return Math.min(score / Math.max(queryTokens.length, 1), 1);
}

export interface RetrievalInput {
  organizationId: number;
  queryText: string;
  queryVector: number[];
  candidates: { chunkId: string; vector: number[]; text: string }[];
  strategy?: RetrievalStrategy;
  topK?: number;
  rerankingEnabled?: boolean;
  embeddingVersion?: string;
  correlationId: string;
}

export interface RetrievalResult {
  session: RetrievalSession;
  evidences: RetrievalEvidence[];
  rankedChunkIds: string[];
}

export function retrieve(input: RetrievalInput): RetrievalResult {
  const topK = input.topK ?? 10;
  let session = createRetrievalSession({
    organizationId: input.organizationId,
    queryText: input.queryText,
    retrievalStrategy: input.strategy,
    rerankingEnabled: input.rerankingEnabled,
    embeddingVersion: input.embeddingVersion,
    correlationId: input.correlationId,
  });

  const startSimilarity = Date.now();
  const scored = input.candidates.map(c => {
    const simScore = cosineSimilarity(input.queryVector, c.vector);
    const bm25Score = (input.strategy === "bm25_hybrid" || input.strategy === "weighted_retrieval")
      ? computeBM25(input.queryText, c.text) : 0;
    const finalScore = input.strategy === "bm25_hybrid"
      ? simScore * 0.6 + bm25Score * 0.4
      : input.strategy === "weighted_retrieval"
        ? simScore * 0.5 + bm25Score * 0.3
        : simScore;
    return { ...c, simScore, bm25Score, finalScore };
  });
  scored.sort((a, b) => b.finalScore - a.finalScore);
  const topResults = scored.slice(0, topK);

  session = addTraceEntry(session, {
    stage: "similarity_search", durationMs: Date.now() - startSimilarity,
    candidateCount: topResults.length, details: { strategy: input.strategy ?? "vector_similarity", totalCandidates: input.candidates.length },
  });

  const evidences = topResults.map(r => createRetrievalEvidence({
    organizationId: input.organizationId,
    retrievalSessionId: session.id,
    chunkId: r.chunkId,
    similarityScore: r.simScore,
    bm25Score: r.bm25Score,
    finalScore: r.finalScore,
  }));

  const chunkIds = topResults.map(r => r.chunkId);
  session = completeRetrieval(session, chunkIds, { resultCount: chunkIds.length, strategy: input.strategy ?? "vector_similarity" });

  const existingSessions = _sessions.get(input.organizationId) ?? [];
  _sessions.set(input.organizationId, [...existingSessions, session]);
  const existingEvidences = _evidences.get(input.organizationId) ?? [];
  _evidences.set(input.organizationId, [...existingEvidences, ...evidences]);

  return { session, evidences, rankedChunkIds: chunkIds };
}

export function getRetrievalSessions(organizationId: number): RetrievalSession[] {
  return _sessions.get(organizationId) ?? [];
}

export function getRetrievalSession(organizationId: number, sessionId: string): RetrievalSession | null {
  return ((_sessions.get(organizationId) ?? []).find(s => s.id === sessionId)) ?? null;
}

export function getEvidences(organizationId: number, sessionId: string): RetrievalEvidence[] {
  return (_evidences.get(organizationId) ?? []).filter(e => e.retrievalSessionId === sessionId);
}

export function getRetrievalStats(organizationId: number): { totalSessions: number; avgLatencyMs: number; avgResultCount: number } {
  const sessions = _sessions.get(organizationId) ?? [];
  if (sessions.length === 0) return { totalSessions: 0, avgLatencyMs: 0, avgResultCount: 0 };
  const avgLatency = sessions.reduce((s, sess) => s + sess.latencyMs, 0) / sessions.length;
  const avgResults = sessions.reduce((s, sess) => s + sess.retrievedChunks.length, 0) / sessions.length;
  return { totalSessions: sessions.length, avgLatencyMs: avgLatency, avgResultCount: avgResults };
}
