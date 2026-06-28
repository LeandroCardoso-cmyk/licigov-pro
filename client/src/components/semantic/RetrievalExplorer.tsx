import React from "react";
interface Session { id: string; queryText: string; retrievalStrategy: string; latencyMs: number; retrievedChunks: string[]; correlationId: string; }
interface Props { sessions: Session[]; organizationId: number; }
export function RetrievalExplorer({ sessions, organizationId }: Props) {
  return (<div data-testid="retrieval-explorer"><h3>Retrieval Sessions — Org {organizationId}</h3><div>Total: {sessions.length}</div>{sessions.map(s => (<div key={s.id} data-testid={`session-${s.id}`}><span>{s.queryText}</span><span>{s.retrievalStrategy}</span><span>{s.latencyMs}ms</span><span>{s.retrievedChunks.length} results</span></div>))}</div>);
}
