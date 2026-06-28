import { createHash } from "crypto";
import { type RetrievalSession } from "../domain/retrievalSession";
import { type RetrievalEvidence, getEvidenceBreakdown } from "../domain/retrievalEvidence";

export interface RetrievalExplanation {
  readonly sessionId: string;
  readonly organizationId: number;
  readonly queryText: string;
  readonly strategy: string;
  readonly totalCandidates: number;
  readonly returnedResults: number;
  readonly traceBreakdown: { stage: string; durationMs: number; candidateCount: number }[];
  readonly evidenceBreakdown: { chunkId: string; similarity: number; bm25: number; rerank: number; final: number; type: string }[];
  readonly reasoning: string;
  readonly correlationId: string;
}

export function buildExplanation(session: RetrievalSession, evidences: RetrievalEvidence[]): RetrievalExplanation {
  const traceBreakdown = session.retrievalTrace.map(t => ({
    stage: t.stage, durationMs: t.durationMs, candidateCount: t.candidateCount,
  }));
  const evidenceBreakdown = evidences
    .sort((a, b) => b.finalScore - a.finalScore)
    .map(e => {
      const bd = getEvidenceBreakdown(e);
      return { chunkId: e.chunkId, similarity: bd.similarity, bm25: bd.bm25, rerank: bd.rerank, final: bd.final, type: bd.type };
    });

  const topScore = evidenceBreakdown[0]?.final ?? 0;
  const reasoning = `Retrieved ${evidences.length} results using ${session.retrievalStrategy}. ` +
    `Top score: ${topScore.toFixed(4)}. Reranking: ${session.rerankingEnabled ? "enabled" : "disabled"}. ` +
    `Total latency: ${session.latencyMs}ms across ${session.retrievalTrace.length} stages.`;

  return {
    sessionId: session.id,
    organizationId: session.organizationId,
    queryText: session.queryText,
    strategy: session.retrievalStrategy,
    totalCandidates: session.retrievalTrace[0]?.details?.totalCandidates as number ?? 0,
    returnedResults: evidences.length,
    traceBreakdown,
    evidenceBreakdown,
    reasoning,
    correlationId: session.correlationId,
  };
}

export function formatExplanationForHuman(explanation: RetrievalExplanation): string {
  const lines: string[] = [
    `## Retrieval Explanation`,
    `**Query:** ${explanation.queryText}`,
    `**Strategy:** ${explanation.strategy}`,
    `**Results:** ${explanation.returnedResults} of ${explanation.totalCandidates} candidates`,
    `**Latency:** ${explanation.traceBreakdown.reduce((s, t) => s + t.durationMs, 0)}ms`,
    ``,
    `### Ranking Breakdown`,
  ];
  for (const e of explanation.evidenceBreakdown.slice(0, 5)) {
    lines.push(`- Chunk ${e.chunkId}: final=${e.final.toFixed(4)} (sim=${e.similarity.toFixed(4)}, bm25=${e.bm25.toFixed(4)}, rerank=${e.rerank.toFixed(4)}) [${e.type}]`);
  }
  lines.push(``, `### Reasoning`, explanation.reasoning);
  return lines.join("\n");
}

export function compareExplanations(a: RetrievalExplanation, b: RetrievalExplanation): { differences: string[] } {
  const diffs: string[] = [];
  if (a.strategy !== b.strategy) diffs.push(`Strategy changed: ${a.strategy} → ${b.strategy}`);
  if (a.returnedResults !== b.returnedResults) diffs.push(`Result count changed: ${a.returnedResults} → ${b.returnedResults}`);
  const aTop = a.evidenceBreakdown[0]?.chunkId;
  const bTop = b.evidenceBreakdown[0]?.chunkId;
  if (aTop !== bTop) diffs.push(`Top result changed: ${aTop} → ${bTop}`);
  return { differences: diffs };
}
