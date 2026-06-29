import React from "react";
interface Evidence { chunkId: string; similarityScore: number; bm25Score: number; rerankScore: number; finalScore: number; evidenceType: string; }
interface Props { evidences: Evidence[]; sessionId: string; organizationId: number; }
export function RetrievalEvidenceGraph({ evidences, sessionId, organizationId }: Props) {
  const sorted = [...evidences].sort((a, b) => b.finalScore - a.finalScore);
  return (<div data-testid="evidence-graph"><h3>Evidence Graph — Session {sessionId}</h3><div>Org: {organizationId} | Results: {evidences.length}</div>{sorted.map((e, i) => (<div key={`${e.chunkId}-${i}`} data-testid={`evidence-${i}`}><span>#{i + 1} Chunk: {e.chunkId}</span><span>Final: {e.finalScore.toFixed(4)}</span><span>Sim: {e.similarityScore.toFixed(4)}</span><span>BM25: {e.bm25Score.toFixed(4)}</span><span>[{e.evidenceType}]</span></div>))}</div>);
}
