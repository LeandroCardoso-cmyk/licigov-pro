import React from "react";

interface LatencyRecord { providerId: string; model: string; latencyMs: number; correlationId: string; recordedAt: string; }
interface Props { records: LatencyRecord[]; organizationId: number; }

export function ProviderLatencyAnalytics({ records, organizationId }: Props) {
  const avg = records.length > 0 ? records.reduce((s, r) => s + r.latencyMs, 0) / records.length : 0;
  const max = records.length > 0 ? Math.max(...records.map(r => r.latencyMs)) : 0;
  const min = records.length > 0 ? Math.min(...records.map(r => r.latencyMs)) : 0;
  return (
    <div data-testid="latency-analytics">
      <h3>Latency Analytics — Org {organizationId}</h3>
      <div>Records: {records.length}</div>
      <div data-testid="avg-latency">Avg: {avg.toFixed(1)}ms</div>
      <div>Max: {max}ms</div>
      <div>Min: {min}ms</div>
      {records.map((r, i) => (
        <div key={`${r.correlationId}-${i}`} data-testid={`latency-${i}`}>
          <span>{r.model}</span>
          <span>{r.latencyMs}ms</span>
        </div>
      ))}
    </div>
  );
}
