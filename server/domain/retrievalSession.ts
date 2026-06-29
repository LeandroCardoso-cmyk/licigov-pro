import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export type RetrievalStrategy = "vector_similarity" | "bm25_hybrid" | "weighted_retrieval" | "contextual_expansion";

export interface RetrievalTraceEntry {
  readonly stage: string;
  readonly durationMs: number;
  readonly candidateCount: number;
  readonly details: Record<string, unknown>;
}

export interface RetrievalSession {
  readonly id: string;
  readonly organizationId: number;
  readonly queryText: string;
  readonly normalizedQuery: string;
  readonly retrievalStrategy: RetrievalStrategy;
  readonly rerankingEnabled: boolean;
  readonly embeddingVersion: string;
  readonly retrievedChunks: string[];
  readonly retrievalTrace: RetrievalTraceEntry[];
  readonly explainabilityData: Record<string, unknown>;
  readonly latencyMs: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createRetrievalSession(params: {
  organizationId: number;
  queryText: string;
  retrievalStrategy?: RetrievalStrategy;
  rerankingEnabled?: boolean;
  embeddingVersion?: string;
  correlationId: string;
}): RetrievalSession {
  const now = new Date().toISOString();
  const normalized = params.queryText.toLowerCase().trim();
  const id = sha256(`rs:${params.organizationId}:${params.correlationId}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    queryText: params.queryText,
    normalizedQuery: normalized,
    retrievalStrategy: params.retrievalStrategy ?? "vector_similarity",
    rerankingEnabled: params.rerankingEnabled ?? false,
    embeddingVersion: params.embeddingVersion ?? "v1",
    retrievedChunks: [],
    retrievalTrace: [],
    explainabilityData: {},
    latencyMs: 0,
    correlationId: params.correlationId,
    createdAt: now,
  };
}

export function addTraceEntry(session: RetrievalSession, entry: RetrievalTraceEntry): RetrievalSession {
  const totalLatency = session.retrievalTrace.reduce((s, e) => s + e.durationMs, 0) + entry.durationMs;
  return {
    ...session,
    retrievalTrace: [...session.retrievalTrace, entry],
    latencyMs: totalLatency,
  };
}

export function completeRetrieval(session: RetrievalSession, chunkIds: string[], explainability: Record<string, unknown>): RetrievalSession {
  return {
    ...session,
    retrievedChunks: chunkIds,
    explainabilityData: explainability,
  };
}

export function getRetrievalReplayKey(session: RetrievalSession): string {
  const input = JSON.stringify({
    org: session.organizationId,
    query: session.normalizedQuery,
    strategy: session.retrievalStrategy,
    reranking: session.rerankingEnabled,
    version: session.embeddingVersion,
  });
  return sha256(`replay:${input}`).slice(0, 40);
}
