import React from "react";
interface TraceEntry { stage: string; durationMs: number; candidateCount: number; }
interface Props { trace: TraceEntry[]; sessionId: string; organizationId: number; totalLatencyMs: number; }
export function RetrievalTraceViewer({ trace, sessionId, organizationId, totalLatencyMs }: Props) {
  return (<div data-testid="trace-viewer"><h3>Retrieval Trace — Session {sessionId}</h3><div>Org: {organizationId} | Total: {totalLatencyMs}ms</div>{trace.map((t, i) => (<div key={`${t.stage}-${i}`} data-testid={`trace-${i}`}><span>{t.stage}</span><span>{t.durationMs}ms</span><span>{t.candidateCount} candidates</span></div>))}</div>);
}
