import React from "react";

interface DeploymentSummary {
  municipio:         string;
  phase:             string;
  status:            string;
  healthScore:       number;
  rolloutPercentage: number;
}

interface Props {
  deployment: DeploymentSummary;
}

export function DeploymentHealthCard({ deployment }: Props) {
  const { municipio, phase, status, healthScore, rolloutPercentage } = deployment;
  const scoreColor = healthScore >= 70 ? "#16a34a" : healthScore >= 50 ? "#d97706" : "#dc2626";
  const statusBg   = status === "completed" ? "#dcfce7" : status === "failed" || status === "rolled_back" ? "#fee2e2" : status === "paused" ? "#fef3c7" : "#eff6ff";

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.25rem", minWidth: 200, fontFamily: "sans-serif" }}>
      <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>{municipio}</div>
      <div style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.75rem" }}>Fase: {phase}</div>

      {/* Health gauge */}
      <div style={{ textAlign: "center", margin: "0.75rem 0" }}>
        <div style={{ display: "inline-block", width: 64, height: 64, borderRadius: "50%", border: `6px solid ${scoreColor}`, lineHeight: "52px", fontSize: "1.1rem", fontWeight: 700, color: scoreColor }}>
          {healthScore}
        </div>
        <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "0.25rem" }}>Health Score</div>
      </div>

      {/* Rollout bar */}
      <div style={{ marginBottom: "0.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
          <span>Rollout</span><span>{rolloutPercentage}%</span>
        </div>
        <div style={{ background: "#e5e7eb", borderRadius: 4, height: 6 }}>
          <div style={{ background: "#2563eb", height: 6, borderRadius: 4, width: `${rolloutPercentage}%` }} />
        </div>
      </div>

      <div style={{ background: statusBg, borderRadius: 4, padding: "0.25rem 0.5rem", textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#374151" }}>
        {status}
      </div>
    </div>
  );
}
