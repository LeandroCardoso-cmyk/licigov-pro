import React from "react";

type DegradationLevel = "none" | "mild" | "moderate" | "severe" | "critical";
type StabilityTrend   = "improving" | "stable" | "degrading";

interface Props {
  score:            number;
  degradationLevel: DegradationLevel;
  trend:            StabilityTrend;
}

const DEGRADATION_LABELS: Record<DegradationLevel, string> = {
  none:     "Nenhuma",
  mild:     "Leve",
  moderate: "Moderada",
  severe:   "Severa",
  critical: "Crítica",
};

const TREND_LABELS: Record<StabilityTrend, string> = {
  improving: "Melhorando",
  stable:    "Estável",
  degrading: "Degradando",
};

export function StabilityScoreGauge({ score, degradationLevel, trend }: Props) {
  const color =
    score >= 70 ? "#16a34a" :
    score >= 50 ? "#d97706" :
    "#dc2626";
  const trendColor = trend === "improving" ? "#16a34a" : trend === "degrading" ? "#dc2626" : "#6b7280";

  return (
    <div style={{ fontFamily: "sans-serif", display: "inline-flex", flexDirection: "column", alignItems: "center", padding: "1rem" }}>
      <div style={{
        width: 96, height: 96, borderRadius: "50%",
        border: `8px solid ${color}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: "1.75rem", color,
        background: "#fff",
      }}>
        {score}
      </div>
      <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#374151" }}>Score de Estabilidade</div>
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.2rem" }}>
        Degradação: {DEGRADATION_LABELS[degradationLevel]}
      </div>
      <div style={{ fontSize: "0.75rem", color: trendColor, marginTop: "0.2rem", fontWeight: 600 }}>
        {TREND_LABELS[trend]}
      </div>
    </div>
  );
}
