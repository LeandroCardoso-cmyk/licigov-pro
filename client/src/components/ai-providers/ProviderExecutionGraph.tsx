import React from "react";

interface ExecutionNode { id: string; model: string; status: string; latencyMs: number; fallbackTriggered: boolean; }
interface Props { nodes: ExecutionNode[]; organizationId: number; correlationId: string; }

export function ProviderExecutionGraph({ nodes, organizationId, correlationId }: Props) {
  const completed = nodes.filter(n => n.status === "completed").length;
  const failed = nodes.filter(n => n.status === "failed").length;
  const fallbacks = nodes.filter(n => n.fallbackTriggered).length;
  return (
    <div data-testid="execution-graph">
      <h3>Execution Graph</h3>
      <div>Org: {organizationId} | Correlation: {correlationId}</div>
      <div>Completed: {completed} | Failed: {failed} | Fallbacks: {fallbacks}</div>
      {nodes.map(n => (
        <div key={n.id} data-testid={`node-${n.id}`}>
          <span>{n.model}</span>
          <span>{n.status}</span>
          <span>{n.latencyMs}ms</span>
          {n.fallbackTriggered && <span>FALLBACK</span>}
        </div>
      ))}
    </div>
  );
}
