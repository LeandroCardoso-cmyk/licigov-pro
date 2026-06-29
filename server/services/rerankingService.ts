import { createHash } from "crypto";
import { type RetrievalEvidence, createRetrievalEvidence } from "../domain/retrievalEvidence";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export type RerankStrategy = "semantic" | "contextual" | "legal_priority" | "workflow_aware";

export interface RerankInput {
  organizationId: number;
  retrievalSessionId: string;
  candidates: { chunkId: string; originalScore: number; text: string; metadata?: Record<string, unknown> }[];
  strategy: RerankStrategy;
  queryContext?: string;
}

export interface RerankResult {
  rerankedOrder: string[];
  evidences: RetrievalEvidence[];
  rerankLatencyMs: number;
}

function semanticRerank(candidates: RerankInput["candidates"], queryContext: string): { chunkId: string; score: number }[] {
  return candidates.map(c => {
    const contextBoost = queryContext && c.text.toLowerCase().includes(queryContext.toLowerCase().split(" ")[0] ?? "") ? 0.1 : 0;
    return { chunkId: c.chunkId, score: c.originalScore + contextBoost };
  }).sort((a, b) => b.score - a.score);
}

function legalPriorityRerank(candidates: RerankInput["candidates"]): { chunkId: string; score: number }[] {
  return candidates.map(c => {
    const legalBoost = /Art\.\s*\d+|Lei\s*\d+|§\s*\d+/i.test(c.text) ? 0.15 : 0;
    return { chunkId: c.chunkId, score: c.originalScore + legalBoost };
  }).sort((a, b) => b.score - a.score);
}

function contextualRerank(candidates: RerankInput["candidates"], queryContext: string): { chunkId: string; score: number }[] {
  const queryTokens = new Set(queryContext.toLowerCase().split(/\s+/));
  return candidates.map(c => {
    const docTokens = c.text.toLowerCase().split(/\s+/);
    const overlap = docTokens.filter(t => queryTokens.has(t)).length;
    const boost = Math.min(overlap / Math.max(queryTokens.size, 1) * 0.2, 0.2);
    return { chunkId: c.chunkId, score: c.originalScore + boost };
  }).sort((a, b) => b.score - a.score);
}

export function rerank(input: RerankInput): RerankResult {
  const start = Date.now();
  const query = input.queryContext ?? "";
  let scored: { chunkId: string; score: number }[];

  switch (input.strategy) {
    case "legal_priority":
      scored = legalPriorityRerank(input.candidates);
      break;
    case "contextual":
      scored = contextualRerank(input.candidates, query);
      break;
    case "workflow_aware":
      scored = semanticRerank(input.candidates, query);
      break;
    case "semantic":
    default:
      scored = semanticRerank(input.candidates, query);
      break;
  }

  const evidences = scored.map(s => createRetrievalEvidence({
    organizationId: input.organizationId,
    retrievalSessionId: input.retrievalSessionId,
    chunkId: s.chunkId,
    similarityScore: input.candidates.find(c => c.chunkId === s.chunkId)?.originalScore ?? 0,
    rerankScore: s.score,
    finalScore: s.score,
    evidenceType: "reranked",
    rankingReason: `Reranked via ${input.strategy}: score ${s.score.toFixed(4)}`,
  }));

  return {
    rerankedOrder: scored.map(s => s.chunkId),
    evidences,
    rerankLatencyMs: Date.now() - start,
  };
}

export function getRerankStrategies(): RerankStrategy[] {
  return ["semantic", "contextual", "legal_priority", "workflow_aware"];
}
