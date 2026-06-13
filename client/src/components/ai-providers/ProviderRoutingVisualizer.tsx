import React from "react";

interface RoutingChain { providerId: string; providerName: string; providerType: string; priority: number; }
interface Props { chain: RoutingChain[]; strategy: string; organizationId: number; }

export function ProviderRoutingVisualizer({ chain, strategy, organizationId }: Props) {
  return (
    <div data-testid="routing-visualizer">
      <h3>Routing Strategy: {strategy}</h3>
      <div>Org: {organizationId}</div>
      {chain.map((p, i) => (
        <div key={p.providerId} data-testid={`chain-${i}`}>
          <span>{i + 1}. {p.providerName}</span>
          <span>{p.providerType}</span>
          <span>Priority: {p.priority}</span>
        </div>
      ))}
    </div>
  );
}
