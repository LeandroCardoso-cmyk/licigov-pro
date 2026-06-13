import React from "react";

interface Execution { id: string; model: string; executionType: string; executionStatus: string; latencyMs: number; correlationId: string; createdAt: string; }
interface Props { executions: Execution[]; organizationId: number; }

export function ProviderExecutionViewer({ executions, organizationId }: Props) {
  return (
    <div data-testid="execution-viewer">
      <h3>Executions — Org {organizationId}</h3>
      <div>Total: {executions.length}</div>
      {executions.map(e => (
        <div key={e.id} data-testid={`exec-${e.id}`}>
          <span>{e.model}</span>
          <span>{e.executionType}</span>
          <span>{e.executionStatus}</span>
          <span>{e.latencyMs}ms</span>
          <span>{e.createdAt}</span>
        </div>
      ))}
    </div>
  );
}
