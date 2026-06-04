import React from "react";

interface ReadinessCheck {
  id:          string;
  category:    string;
  name:        string;
  status:      "pass" | "warn" | "fail" | "skipped";
  score:       number;
  message:     string;
  remediation: string | null;
}

interface ReadinessReport {
  organizationId:  number;
  pilotPhase:      string;
  overallScore:    number;
  overallStatus:   "ready" | "needs_attention" | "not_ready";
  checks:          ReadinessCheck[];
  blockers:        string[];
  recommendations: string[];
  generatedAt:     string;
}

interface Props {
  report: ReadinessReport;
}

const STATUS_LABELS: Record<string, string> = {
  ready:            "Pronto",
  needs_attention:  "Atenção Necessária",
  not_ready:        "Não Pronto",
};

const STATUS_COLORS: Record<string, string> = {
  ready:           "#16a34a",
  needs_attention: "#d97706",
  not_ready:       "#dc2626",
};

const CHECK_STATUS_COLORS: Record<string, string> = {
  pass:    "#16a34a",
  warn:    "#d97706",
  fail:    "#dc2626",
  skipped: "#9ca3af",
};

export function PilotReadinessDashboard({ report }: Props) {
  const statusColor = STATUS_COLORS[report.overallStatus] ?? "#6b7280";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 800 }}>
      <h2 style={{ marginBottom: "0.5rem" }}>Dashboard de Prontidão — Piloto</h2>
      <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
        Fase: <strong>{report.pilotPhase}</strong> | Gerado em: {new Date(report.generatedAt).toLocaleString("pt-BR")}
      </p>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "#f3f4f6", borderRadius: 8, padding: "1rem", flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: statusColor }}>{report.overallScore}</div>
          <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>Score Geral (/100)</div>
        </div>
        <div style={{ background: "#f3f4f6", borderRadius: 8, padding: "1rem", flex: 2, display: "flex", alignItems: "center" }}>
          <span style={{ color: statusColor, fontWeight: 600, fontSize: "1.1rem" }}>
            {STATUS_LABELS[report.overallStatus] ?? report.overallStatus}
          </span>
        </div>
      </div>

      {report.blockers.length > 0 && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
          <strong>Bloqueadores</strong>
          <ul style={{ margin: "0.5rem 0 0 0", paddingLeft: "1.2rem" }}>
            {report.blockers.map((b, i) => <li key={i} style={{ color: "#dc2626" }}>{b}</li>)}
          </ul>
        </div>
      )}

      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ marginBottom: "0.75rem" }}>Verificações</h3>
        {report.checks.map(check => (
          <div key={check.id} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.75rem", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 500 }}>{check.name}</span>
              <span style={{ color: CHECK_STATUS_COLORS[check.status] ?? "#6b7280", fontWeight: 600, fontSize: "0.875rem" }}>
                {check.status.toUpperCase()} ({check.score}/100)
              </span>
            </div>
            <div style={{ fontSize: "0.875rem", color: "#6b7280", marginTop: "0.25rem" }}>{check.message}</div>
            {check.remediation && (
              <div style={{ fontSize: "0.8rem", color: "#d97706", marginTop: "0.25rem" }}>⚠ {check.remediation}</div>
            )}
          </div>
        ))}
      </div>

      {report.recommendations.length > 0 && (
        <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: 8, padding: "1rem" }}>
          <strong>Recomendações</strong>
          <ul style={{ margin: "0.5rem 0 0 0", paddingLeft: "1.2rem" }}>
            {report.recommendations.map((r, i) => <li key={i} style={{ color: "#1d4ed8", fontSize: "0.875rem" }}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
