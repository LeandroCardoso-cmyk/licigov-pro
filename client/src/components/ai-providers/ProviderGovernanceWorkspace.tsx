import React from "react";

interface Policy { id: string; policyName: string; active: boolean; }
interface Metrics { totalRequests: number; totalErrors: number; totalFallbacks: number; avgLatencyMs: number; }
interface Props { policies: Policy[]; metrics: Metrics; organizationId: number; }

export function ProviderGovernanceWorkspace({ policies, metrics, organizationId }: Props) {
  const activePolicies = policies.filter(p => p.active);
  const errorRate = metrics.totalRequests > 0 ? (metrics.totalErrors / metrics.totalRequests * 100).toFixed(2) : "0.00";
  return (
    <div data-testid="governance-workspace">
      <h2>Governance Workspace — Org {organizationId}</h2>
      <div data-testid="policy-count">Active Policies: {activePolicies.length}</div>
      <div data-testid="metrics-summary">
        <span>Requests: {metrics.totalRequests}</span>
        <span>Errors: {metrics.totalErrors}</span>
        <span>Error Rate: {errorRate}%</span>
        <span>Fallbacks: {metrics.totalFallbacks}</span>
        <span>Avg Latency: {metrics.avgLatencyMs.toFixed(1)}ms</span>
      </div>
      {activePolicies.map(p => (
        <div key={p.id} data-testid={`gov-policy-${p.id}`}>
          <span>{p.policyName}</span>
        </div>
      ))}
    </div>
  );
}
