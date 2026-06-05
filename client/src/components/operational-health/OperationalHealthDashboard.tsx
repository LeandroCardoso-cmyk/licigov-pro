import React from "react";

interface HealthCategory {
  name:   string;
  score:  number;
  status: "healthy" | "degraded" | "critical";
}

interface Props {
  organizationId:  number;
  overallStatus:   "healthy" | "degraded" | "critical";
  avgScore:        number;
  categories:      HealthCategory[];
  activeIncidents: number;
  activeRisks:     number;
  snapshotAt:      string;
}

const STATUS_COLORS = { healthy: "#16a34a", degraded: "#d97706", critical: "#dc2626" };
const STATUS_LABELS = { healthy: "Saudável", degraded: "Degradado", critical: "Crítico" };
const STATUS_BG     = { healthy: "#dcfce7", degraded: "#fef3c7", critical: "#fee2e2" };

export function OperationalHealthDashboard({
  overallStatus, avgScore, categories, activeIncidents, activeRisks, snapshotAt,
}: Props) {
  const color = STATUS_COLORS[overallStatus];

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0 }}>Saúde Operacional</h2>
        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
          Snapshot: {new Date(snapshotAt).toLocaleString("pt-BR")}
        </span>
      </div>

      {/* Overall status banner */}
      <div
        style={{
          background: STATUS_BG[overallStatus],
          border: `2px solid ${color}`,
          borderRadius: 12,
          padding: "1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        <div style={{ textAlign: "center", minWidth: 80 }}>
          <div style={{ fontSize: "2.5rem", fontWeight: 700, color }}>{avgScore}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Score Médio</div>
        </div>
        <div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600, color }}>
            {STATUS_LABELS[overallStatus]}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            {activeIncidents} incidente(s) ativo(s) · {activeRisks} risco(s) ativo(s)
          </div>
        </div>
      </div>

      {/* Category grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem" }}>
        {categories.map(cat => (
          <div
            key={cat.name}
            style={{
              background: "#f9fafb",
              border: `1px solid ${STATUS_COLORS[cat.status]}33`,
              borderRadius: 8,
              padding: "1rem",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: STATUS_COLORS[cat.status] }}>
              {cat.score}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>{cat.name}</div>
            <div style={{ fontSize: "0.7rem", color: STATUS_COLORS[cat.status], marginTop: "0.2rem" }}>
              {STATUS_LABELS[cat.status]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
