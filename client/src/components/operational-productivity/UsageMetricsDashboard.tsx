import React from "react";

interface FeatureUsage {
  feature:     string;
  usageCount:  number;
  uniqueUsers: number;
}

interface UsageAlert {
  id:          string;
  type:        string;
  severity:    "info" | "warning" | "critical";
  description: string;
  detectedAt:  string;
}

interface Props {
  featureUsage: FeatureUsage[];
  alerts:       UsageAlert[];
}

const SEVERITY_COLORS: Record<string, string> = {
  info:     "#1d4ed8",
  warning:  "#d97706",
  critical: "#dc2626",
};

export function UsageMetricsDashboard({ featureUsage, alerts }: Props) {
  const totalUsage = featureUsage.reduce((s, f) => s + f.usageCount, 0);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h3 style={{ marginBottom: "1rem" }}>Métricas de Uso</h3>

      {alerts.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          {alerts.map(a => (
            <div
              key={a.id}
              style={{
                background: a.severity === "critical" ? "#fef2f2" : a.severity === "warning" ? "#fffbeb" : "#eff6ff",
                border: `1px solid`,
                borderColor: SEVERITY_COLORS[a.severity],
                borderRadius: 6, padding: "0.5rem 0.75rem", marginBottom: "0.5rem",
                fontSize: "0.875rem", color: SEVERITY_COLORS[a.severity],
              }}
            >
              <strong>{a.severity.toUpperCase()}</strong>: {a.description}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: "0.5rem", color: "#6b7280", fontSize: "0.875rem" }}>
        Total de interações: <strong>{totalUsage}</strong>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
        <thead>
          <tr style={{ background: "#f3f4f6" }}>
            <th style={{ padding: "0.5rem", textAlign: "left" }}>Funcionalidade</th>
            <th style={{ padding: "0.5rem", textAlign: "right" }}>Uso Total</th>
            <th style={{ padding: "0.5rem", textAlign: "right" }}>Usuários Únicos</th>
            <th style={{ padding: "0.5rem", textAlign: "right" }}>% do Total</th>
          </tr>
        </thead>
        <tbody>
          {featureUsage.map(f => (
            <tr key={f.feature} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={{ padding: "0.5rem" }}>{f.feature}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{f.usageCount}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{f.uniqueUsers}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>
                {totalUsage > 0 ? ((f.usageCount / totalUsage) * 100).toFixed(1) : "0.0"}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
