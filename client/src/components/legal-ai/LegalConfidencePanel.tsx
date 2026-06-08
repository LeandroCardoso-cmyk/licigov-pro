import React from "react";

interface Props {
  sessionId?: string;
  organizationId?: number;
}

type HealthStatus = "healthy" | "degraded" | "critical";

interface Dimension {
  label: string;
  score: number;
  key: string;
}

const DIMENSIONS: Dimension[] = [
  { key: "compliance",    label: "Conformidade Legal",           score: 0.78 },
  { key: "completeness",  label: "Completude do Documento",      score: 0.85 },
  { key: "correlation",   label: "Correlação Jurisprudencial",   score: 0.72 },
  { key: "risk",          label: "Avaliação de Risco",           score: 0.65 },
];

const OVERALL_CONFIDENCE = 0.75;
const HEALTH: HealthStatus = "healthy";
const LAST_UPDATED = "08/06/2026 09:07:42";

const HEALTH_CONFIG: Record<HealthStatus, { label: string; color: string; bg: string; border: string }> = {
  healthy:  { label: "Saudável",   color: "#10b981", bg: "#ecfdf5", border: "#6ee7b7" },
  degraded: { label: "Degradado",  color: "#f59e0b", bg: "#fffbeb", border: "#fde68a" },
  critical: { label: "Crítico",    color: "#ef4444", bg: "#fef2f2", border: "#fca5a5" },
};

function scoreColor(score: number): string {
  if (score >= 0.75) return "#10b981";
  if (score >= 0.5)  return "#f59e0b";
  return "#ef4444";
}

export default function LegalConfidencePanel({ sessionId = "demo", organizationId = 1 }: Props) {
  const overallPct = Math.round(OVERALL_CONFIDENCE * 100);
  const healthCfg = HEALTH_CONFIG[HEALTH];
  const overallColor = scoreColor(OVERALL_CONFIDENCE);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Confiança Jurídica</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Org: {organizationId}</span>
        </div>
      </div>

      {/* Overall confidence */}
      <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", padding: "1rem", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", marginBottom: "1rem" }}>
        <div style={{ position: "relative", width: "4rem", height: "4rem", flexShrink: 0 }}>
          <div style={{ width: "4rem", height: "4rem", borderRadius: "50%", background: `conic-gradient(${overallColor} ${overallPct * 3.6}deg, #e5e7eb 0deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "2.75rem", height: "2.75rem", borderRadius: "50%", background: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 800, color: overallColor }}>{overallPct}%</span>
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>Score de Confiança Jurídica Geral</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: overallColor }}>{overallPct}%</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.25rem" }}>
            <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: healthCfg.bg, color: healthCfg.color, border: `1px solid ${healthCfg.border}`, fontWeight: 600 }}>
              {healthCfg.label}
            </span>
          </div>
        </div>
      </div>

      {/* Dimension breakdown */}
      <div style={{ marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", marginBottom: "0.625rem" }}>Breakdown por Dimensão</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {DIMENSIONS.map(d => {
            const pct = Math.round(d.score * 100);
            const color = scoreColor(d.score);
            return (
              <div key={d.key} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "0.8125rem", color: "#374151", minWidth: "210px" }}>{d.label}</span>
                <div style={{ flex: 1, height: "8px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "4px", transition: "width 0.3s" }} />
                </div>
                <span style={{ fontSize: "0.8125rem", fontWeight: 700, color, minWidth: "3rem", textAlign: "right" }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: "0.625rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: healthCfg.color, display: "inline-block" }} />
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Indicador: <strong style={{ color: healthCfg.color }}>{healthCfg.label}</strong></span>
        </div>
        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Atualizado em {LAST_UPDATED}</span>
      </div>
    </div>
  );
}
