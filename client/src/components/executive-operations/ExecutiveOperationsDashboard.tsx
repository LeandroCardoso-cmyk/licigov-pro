import React from "react";

interface DeploymentSummary {
  municipio:    string;
  phase:        string;
  status:       string;
  healthScore:  number;
}

interface Props {
  organizationId:    number;
  deployments:       DeploymentSummary[];
  stabilityScore:    number;
  incidents:         { severity: string }[];
  workflowThroughput: number;
  adoptionRate:      number;
  supportBacklog:    number;
}

export function ExecutiveOperationsDashboard({
  deployments, stabilityScore, incidents, workflowThroughput, adoptionRate, supportBacklog,
}: Props) {
  const critical = incidents.filter(i => i.severity === "critical").length;
  const high     = incidents.filter(i => i.severity === "high").length;
  const stabColor = stabilityScore >= 70 ? "#16a34a" : stabilityScore >= 50 ? "#d97706" : "#dc2626";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 1000 }}>
      <h2 style={{ marginBottom: "1.5rem" }}>Operações Executivas</h2>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Estabilidade",     value: `${stabilityScore}`,    color: stabColor },
          { label: "Throughput/hora",  value: `${workflowThroughput}`, color: "#2563eb" },
          { label: "Adoção %",         value: `${adoptionRate}`,       color: "#7c3aed" },
          { label: "Suporte pendente", value: `${supportBacklog}`,     color: supportBacklog > 10 ? "#dc2626" : "#16a34a" },
          { label: "Incidentes críticos", value: `${critical}`,        color: critical > 0 ? "#dc2626" : "#16a34a" },
          { label: "Incidentes altos",    value: `${high}`,            color: high > 2 ? "#d97706" : "#16a34a" },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Deployments */}
      <h3 style={{ marginBottom: "0.75rem" }}>Deployments Ativos</h3>
      {deployments.length === 0 ? (
        <div style={{ color: "#6b7280", fontSize: "0.875rem" }}>Nenhum deployment ativo.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {deployments.map((d, i) => (
            <div key={i} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>{d.municipio}</span>
              <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{d.phase}</span>
              <span style={{ fontSize: "0.8rem", color: d.status === "in_progress" ? "#2563eb" : d.status === "completed" ? "#16a34a" : "#d97706" }}>{d.status}</span>
              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: d.healthScore >= 70 ? "#16a34a" : "#dc2626" }}>{d.healthScore}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
