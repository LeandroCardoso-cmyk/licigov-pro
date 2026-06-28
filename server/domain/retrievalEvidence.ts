import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export type EvidenceType = "semantic_match" | "lexical_match" | "hybrid_match" | "contextual_match" | "reranked";

export interface RetrievalEvidence {
  readonly id: string;
  readonly organizationId: number;
  readonly retrievalSessionId: string;
  readonly chunkId: string;
  readonly similarityScore: number;
  readonly bm25Score: number;
  readonly rerankScore: number;
  readonly finalScore: number;
  readonly rankingReason: string;
  readonly semanticExplanation: string;
  readonly evidenceType: EvidenceType;
  readonly createdAt: string;
}

export function createRetrievalEvidence(params: {
  organizationId: number;
  retrievalSessionId: string;
  chunkId: string;
  similarityScore: number;
  bm25Score?: number;
  rerankScore?: number;
  finalScore?: number;
  rankingReason?: string;
  semanticExplanation?: string;
  evidenceType?: EvidenceType;
}): RetrievalEvidence {
  const now = new Date().toISOString();
  const id = sha256(`re:${params.organizationId}:${params.retrievalSessionId}:${params.chunkId}`).slice(0, 20);
  const bm25 = params.bm25Score ?? 0;
  const rerank = params.rerankScore ?? 0;
  const final = params.finalScore ?? (params.similarityScore * 0.6 + bm25 * 0.25 + rerank * 0.15);
  let evidenceType: EvidenceType = params.evidenceType ?? "semantic_match";
  if (!params.evidenceType) {
    if (bm25 > 0 && params.similarityScore > 0) evidenceType = "hybrid_match";
    else if (bm25 > 0) evidenceType = "lexical_match";
    if (rerank > 0) evidenceType = "reranked";
  }
  return {
    id,
    organizationId: params.organizationId,
    retrievalSessionId: params.retrievalSessionId,
    chunkId: params.chunkId,
    similarityScore: params.similarityScore,
    bm25Score: bm25,
    rerankScore: rerank,
    finalScore: final,
    rankingReason: params.rankingReason ?? `Similarity: ${params.similarityScore.toFixed(4)}, BM25: ${bm25.toFixed(4)}, Rerank: ${rerank.toFixed(4)}`,
    semanticExplanation: params.semanticExplanation ?? "Matched via vector similarity search",
    evidenceType,
    createdAt: now,
  };
}

export function compareEvidence(a: RetrievalEvidence, b: RetrievalEvidence): number {
  return b.finalScore - a.finalScore;
}

export function getEvidenceBreakdown(evidence: RetrievalEvidence): {
  similarity: number;
  bm25: number;
  rerank: number;
  final: number;
  type: EvidenceType;
} {
  return {
    similarity: evidence.similarityScore,
    bm25: evidence.bm25Score,
    rerank: evidence.rerankScore,
    final: evidence.finalScore,
    type: evidence.evidenceType,
  };
}
