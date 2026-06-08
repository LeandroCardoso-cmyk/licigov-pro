import React from "react";

interface HealthData { healthScore: number; status: string; alerts: string[]; }
interface Props { health?: HealthData; traceCount?: number; metricCount?: number; }

export function AgentObservabilityDashboard({ health, traceCount = 0, metricCount = 0 }: Props) {
  const score = health?.healthScore ?? 1;
  const color = score >= 0.8 ? "green" : score >= 0.5 ? "orange" : "red";
  return (
    <div>
      <h3>Dashboard de Observabilidade</h3>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ border: `2px solid ${color}`, padding: 12, borderRadius: 8, minWidth: 120 }}>
          <p style={{ margin: 0, fontSize: 24, color, fontWeight: "bold" }}>{((score) * 100).toFixed(0)}%</p>
          <p style={{ margin: 0 }}>Saúde: {health?.status ?? "N/A"}</p>
        </div>
        <div>
          <p>Traces: {traceCount}</p>
          <p>Métricas: {metricCount}</p>
          {health?.alerts.map((a, i) => <p key={i} style={{ color: "orange" }}>⚠ {a}</p>)}
        </div>
      </div>
    </div>
  );
}
