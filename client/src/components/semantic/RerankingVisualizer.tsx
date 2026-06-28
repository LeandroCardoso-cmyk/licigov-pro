import React from "react";
interface RerankResult { chunkId: string; originalScore: number; rerankScore: number; strategy: string; }
interface Props { results: RerankResult[]; organizationId: number; }
export function RerankingVisualizer({ results, organizationId }: Props) {
  return (<div data-testid="reranking-viz"><h3>Reranking Results — Org {organizationId}</h3><div>Items: {results.length}</div>{results.map((r, i) => (<div key={`${r.chunkId}-${i}`} data-testid={`rerank-${i}`}><span>#{i + 1} {r.chunkId}</span><span>Original: {r.originalScore.toFixed(4)}</span><span>Reranked: {r.rerankScore.toFixed(4)}</span><span>[{r.strategy}]</span></div>))}</div>);
}
