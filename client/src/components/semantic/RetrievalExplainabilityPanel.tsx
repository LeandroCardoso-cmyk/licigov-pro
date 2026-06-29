import React from "react";
interface Explanation { sessionId: string; queryText: string; strategy: string; returnedResults: number; reasoning: string; evidenceBreakdown: { chunkId: string; final: number; type: string }[]; }
interface Props { explanation: Explanation; organizationId: number; }
export function RetrievalExplainabilityPanel({ explanation, organizationId }: Props) {
  return (<div data-testid="explainability-panel"><h3>Retrieval Explainability — Org {organizationId}</h3><div>Query: {explanation.queryText}</div><div>Strategy: {explanation.strategy}</div><div>Results: {explanation.returnedResults}</div><div data-testid="reasoning">{explanation.reasoning}</div>{explanation.evidenceBreakdown.map((e, i) => (<div key={`${e.chunkId}-${i}`}><span>#{i + 1} {e.chunkId}: {e.final.toFixed(4)} [{e.type}]</span></div>))}</div>);
}
