import React from "react";

interface Anomaly {
  id:          string;
  metricType:  string;
  description: string;
  severity:    "info" | "warning" | "critical";
  detectedAt:  string;
}

interface Props {
  anomalies: Anomaly[];
}

const SEV_COLORS  = { info: "#2563eb", warning: "#d97706", critical: "#dc2626" };
const SEV_LABELS  = { info: "Info",    warning: "Alerta",  critical: "Crítico" };
const SEV_BG      = { info: "#eff6ff", warning: "#fef3c7", critical: "#fee2e2" };

export function AnomalyAlertList({ anomalies }: Props) {
  if (anomalies.length === 0) {
    return <div style={{ fontFamily: "sans-serif", color: "#16a34a", padding: "1rem" }}>Nenhuma anomalia ativa.</div>;
  }

  return (
    <div style={{ fontFamily: "sans-serif", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {anomalies.map(a => (
        <div
          key={a.id}
          style={{
            background: SEV_BG[a.severity],
            border: `1px solid ${SEV_COLORS[a.severity]}44`,
            borderRadius: 8,
            padding: "0.75rem 1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.875rem", color: SEV_COLORS[a.severity] }}>
              {SEV_LABELS[a.severity]} — {a.metricType}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#374151", marginTop: "0.2rem" }}>{a.description}</div>
          </div>
          <div style={{ fontSize: "0.7rem", color: "#9ca3af", whiteSpace: "nowrap", marginLeft: "1rem" }}>
            {new Date(a.detectedAt).toLocaleString("pt-BR")}
          </div>
        </div>
      ))}
    </div>
  );
}
