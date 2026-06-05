import React from "react";

interface HealthMetric {
  name:         string;
  currentValue: number;
  targetValue:  number;
  unit:         string;
  slaStatus:    "meeting" | "warning" | "breaching";
}

interface Props {
  healthSnapshot: {
    overallSlaScore:  number;
    healthMetrics:    HealthMetric[];
    breachingMetrics: string[];
    warningMetrics:   string[];
  };
}

const STATUS_COLORS = { meeting: "#16a34a", warning: "#d97706", breaching: "#dc2626" };
const STATUS_LABELS = { meeting: "OK", warning: "Atenção", breaching: "Violação" };

export function SlaMonitorDashboard({ healthSnapshot }: Props) {
  const { overallSlaScore, healthMetrics, breachingMetrics, warningMetrics } = healthSnapshot;
  const scoreColor = overallSlaScore >= 80 ? "#16a34a" : overallSlaScore >= 60 ? "#d97706" : "#dc2626";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2.5rem", fontWeight: 700, color: scoreColor }}>{overallSlaScore}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>SLA Score</div>
        </div>
        <div>
          {breachingMetrics.length > 0 && (
            <div style={{ color: "#dc2626", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
              Violações: {breachingMetrics.join(", ")}
            </div>
          )}
          {warningMetrics.length > 0 && (
            <div style={{ color: "#d97706", fontSize: "0.875rem" }}>
              Alertas: {warningMetrics.join(", ")}
            </div>
          )}
          {breachingMetrics.length === 0 && warningMetrics.length === 0 && (
            <div style={{ color: "#16a34a", fontSize: "0.875rem" }}>Todos os SLAs dentro do alvo</div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem" }}>
        {healthMetrics.map(m => (
          <div key={m.name} style={{ background: "#f9fafb", border: `2px solid ${STATUS_COLORS[m.slaStatus]}44`, borderRadius: 8, padding: "0.75rem" }}>
            <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>{m.name}</div>
            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{m.currentValue} <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{m.unit}</span></div>
            <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Alvo: {m.targetValue} {m.unit}</div>
            <div style={{ marginTop: "0.4rem", fontSize: "0.75rem", fontWeight: 600, color: STATUS_COLORS[m.slaStatus] }}>
              {STATUS_LABELS[m.slaStatus]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
