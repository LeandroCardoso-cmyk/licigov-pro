import React from "react";

interface FailoverEvent { id: string; failedProviderId: string; newProviderId: string | null; reason: string; occurredAt: string; }
interface Props { events: FailoverEvent[]; organizationId: number; }

export function ProviderFailoverTimeline({ events, organizationId }: Props) {
  return (
    <div data-testid="failover-timeline">
      <h3>Failover Timeline — Org {organizationId}</h3>
      <div>Events: {events.length}</div>
      {events.map(e => (
        <div key={e.id} data-testid={`failover-${e.id}`}>
          <span>Failed: {e.failedProviderId}</span>
          <span>New: {e.newProviderId ?? "none"}</span>
          <span>{e.reason}</span>
          <span>{e.occurredAt}</span>
        </div>
      ))}
    </div>
  );
}
