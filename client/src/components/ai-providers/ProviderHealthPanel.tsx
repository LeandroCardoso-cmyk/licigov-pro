import React from "react";

interface HealthData { providerId: string; healthScore: number; avgLatencyMs: number; errorRate: number; fallbackRate: number; }
interface Props { health: HealthData; providerName: string; }

export function ProviderHealthPanel({ health, providerName }: Props) {
  const status = health.healthScore > 0.8 ? "healthy" : health.healthScore > 0.5 ? "degraded" : "unavailable";
  return (
    <div data-testid="health-panel">
      <h3>{providerName} Health</h3>
      <div data-testid="health-status">{status}</div>
      <div>Score: {(health.healthScore * 100).toFixed(1)}%</div>
      <div>Avg Latency: {health.avgLatencyMs.toFixed(0)}ms</div>
      <div>Error Rate: {(health.errorRate * 100).toFixed(2)}%</div>
      <div>Fallback Rate: {(health.fallbackRate * 100).toFixed(2)}%</div>
    </div>
  );
}
