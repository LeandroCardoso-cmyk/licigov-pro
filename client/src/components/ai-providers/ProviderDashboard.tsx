import React from "react";

interface Provider { id: string; providerType: string; providerName: string; enabled: boolean; priority: number; healthStatus: string; latencyScore: number; reliabilityScore: number; costScore: number; circuitBreakerState: string; }

interface Props { providers: Provider[]; organizationId: number; }

export function ProviderDashboard({ providers, organizationId }: Props) {
  const available = providers.filter(p => p.enabled && p.circuitBreakerState === "closed");
  return (
    <div data-testid="provider-dashboard">
      <h2>Provider Dashboard — Org {organizationId}</h2>
      <div>Total: {providers.length} | Available: {available.length}</div>
      {providers.map(p => (
        <div key={p.id} data-testid={`provider-${p.id}`}>
          <span>{p.providerName}</span>
          <span>{p.healthStatus}</span>
          <span>{p.circuitBreakerState}</span>
        </div>
      ))}
    </div>
  );
}
