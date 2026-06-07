import React from "react";

interface DriftPoint {
  timestamp: string;
  driftScore: number;
  label: string;
}

interface StaleAlert {
  id: string;
  fragment: string;
  severity: "low" | "medium" | "high";
  message: string;
}

interface ContextDriftPanelProps {
  organizationId: number;
}

const SEVERITY_CONFIG = {
  low:    { color: "#10b981", bg: "#ecfdf5", label: "Baixo"  },
  medium: { color: "#f59e0b", bg: "#fffbeb", label: "Médio"  },
  high:   { color: "#ef4444", bg: "#fef2f2", label: "Alto"   },
};

const DRIFT_THRESHOLD = 0.7;

const MOCK_DRIFT_POINTS: DriftPoint[] = [
  { timestamp: "09:00", driftScore: 0.12, label: "Início da sessão" },
  { timestamp: "09:15", driftScore: 0.24, label: "Após 1ª consulta" },
  { timestamp: "09:32", driftScore: 0.38, label: "Inserção de doc" },
  { timestamp: "09:50", driftScore: 0.51, label: "Refinamento" },
  { timestamp: "10:08", driftScore: 0.67, label: "Múltiplas revisões" },
  { timestamp: "10:25", driftScore: 0.82, label: "Divergência alta" },
];

const MOCK_STALE_ALERTS: StaleAlert[] = [
  { id: "a1", fragment: "Contexto Normativo v1.2", severity: "high",   message: "Fragmento desatualizado — nova versão disponível desde 10:00" },
  { id: "a2", fragment: "Histórico de Sessão",     severity: "medium", message: "Mais de 45 min sem atualização do histórico" },
  { id: "a3", fragment: "Template de Edital",      severity: "low",    message: "Template com versão anterior ao último ajuste do usuário" },
];

const CURRENT_DRIFT = MOCK_DRIFT_POINTS[MOCK_DRIFT_POINTS.length - 1].driftScore;

function MiniChart({ points }: { points: DriftPoint[] }) {
  const maxScore = 1;
  const chartH = 72;
  const chartW = 280;
  const padX = 8;
  const padY = 8;

  const xs = points.map((_, i) => padX + (i / (points.length - 1)) * (chartW - padX * 2));
  const ys = points.map(p => chartH - padY - (p.driftScore / maxScore) * (chartH - padY * 2));

  const lineD = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x} ${ys[i]}`).join(" ");
  const areaD = `${lineD} L ${xs[xs.length - 1]} ${chartH - padY} L ${xs[0]} ${chartH - padY} Z`;
  const thresholdY = chartH - padY - (DRIFT_THRESHOLD / maxScore) * (chartH - padY * 2);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={chartW} height={chartH} style={{ display: "block" }}>
        <defs>
          <linearGradient id="driftGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <line x1={padX} y1={thresholdY} x2={chartW - padX} y2={thresholdY} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" opacity={0.6} />
        <text x={chartW - padX + 2} y={thresholdY + 4} fontSize="9" fill="#ef4444" opacity={0.8}>0.7</text>
        <path d={areaD} fill="url(#driftGrad)" />
        <path d={lineD} fill="none" stroke="#f97316" strokeWidth={2} strokeLinejoin="round" />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={3} fill={points[i].driftScore >= DRIFT_THRESHOLD ? "#ef4444" : "#f97316"} />
        ))}
        {points.map((p, i) => (
          <text key={`t${i}`} x={xs[i]} y={chartH} fontSize="8" fill="#9ca3af" textAnchor="middle">{p.timestamp}</text>
        ))}
      </svg>
    </div>
  );
}

export default function ContextDriftPanel({ organizationId: _organizationId }: ContextDriftPanelProps) {
  const isDriftAlert = CURRENT_DRIFT >= DRIFT_THRESHOLD;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Painel de Drift Contextual</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Score atual:</span>
          <span style={{
            fontWeight: 700,
            fontSize: "1rem",
            color: isDriftAlert ? "#ef4444" : "#f59e0b",
            padding: "0.125rem 0.5rem",
            background: isDriftAlert ? "#fef2f2" : "#fffbeb",
            borderRadius: "0.375rem",
            border: `1px solid ${isDriftAlert ? "#fca5a5" : "#fde68a"}`,
          }}>
            {CURRENT_DRIFT.toFixed(2)} {isDriftAlert ? "⚠" : ""}
          </span>
        </div>
      </div>

      {isDriftAlert && (
        <div style={{ marginBottom: "1rem", padding: "0.625rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ color: "#ef4444", fontSize: "1rem" }}>⚠</span>
          <span style={{ fontSize: "0.8125rem", color: "#991b1b", fontWeight: 500 }}>
            Drift contextual acima do limiar (0.7). Recomenda-se atualização do contexto.
          </span>
        </div>
      )}

      <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.8125rem", fontWeight: 500, marginBottom: "0.5rem", color: "#374151" }}>Evolução do drift ao longo do tempo</div>
        <MiniChart points={MOCK_DRIFT_POINTS} />
        <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ width: "16px", height: "2px", background: "#ef4444", display: "inline-block", opacity: 0.6 }} />
          <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Limiar de alerta (0.7)</span>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>
          Alertas de Contexto Desatualizado ({MOCK_STALE_ALERTS.length})
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {MOCK_STALE_ALERTS.map(alert => {
            const cfg = SEVERITY_CONFIG[alert.severity];
            return (
              <div key={alert.id} style={{ padding: "0.625rem 0.75rem", background: cfg.bg, border: `1px solid ${cfg.color}30`, borderRadius: "0.5rem", borderLeft: `3px solid ${cfg.color}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                  <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{alert.fragment}</span>
                  <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: cfg.color, color: "white" }}>
                    {cfg.label}
                  </span>
                </div>
                <p style={{ fontSize: "0.8125rem", color: "#374151", margin: 0 }}>{alert.message}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
