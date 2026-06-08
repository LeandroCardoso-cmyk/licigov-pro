import React from "react";

interface Props {
  sessionId?: string;
  organizationId?: number;
}

type RiskLevel = "critical" | "high" | "medium" | "low";

interface Risk {
  type: string;
  level: RiskLevel;
  description: string;
  probability: number;
  impact: number;
  riskScore: number;
  mitigation: string[];
}

const MOCK_RISKS: Risk[] = [
  {
    type: "Dispensa de licitação",
    level: "high",
    description: "Risco identificado: Dispensa de licitação sem justificativa formal adequada.",
    probability: 0.6,
    impact: 0.8,
    riskScore: 0.48,
    mitigation: [
      "Elaborar DFD com fundamentação legal expressa.",
      "Documentar a singularidade do objeto ou urgência comprovada.",
      "Incluir parecer jurídico antes da formalização.",
    ],
  },
  {
    type: "Risco de prazo",
    level: "low",
    description: "Risco de descumprimento de prazo legal para publicação no PNCP.",
    probability: 0.3,
    impact: 0.4,
    riskScore: 0.12,
    mitigation: [
      "Cadastrar lembrete de publicação no sistema.",
      "Designar responsável pela publicação com antecedência mínima de 3 dias.",
    ],
  },
  {
    type: "Habilitação restritiva",
    level: "medium",
    description: "Critérios de habilitação podem ser considerados restritivos e limitar competição.",
    probability: 0.5,
    impact: 0.5,
    riskScore: 0.25,
    mitigation: [
      "Revisar exigências de qualificação técnica conforme TCU Acórdão 2089/2021.",
      "Justificar cada requisito de habilitação com base em necessidade real.",
    ],
  },
];

const TOTAL_RISK_SCORE = 0.35;

const LEVEL_CONFIG: Record<RiskLevel, { color: string; bg: string; label: string; order: number }> = {
  critical: { color: "#ef4444", bg: "#fef2f2", label: "Crítico",  order: 1 },
  high:     { color: "#f97316", bg: "#fff7ed", label: "Alto",     order: 2 },
  medium:   { color: "#f59e0b", bg: "#fffbeb", label: "Médio",    order: 3 },
  low:      { color: "#10b981", bg: "#ecfdf5", label: "Baixo",    order: 4 },
};

export default function LegalRiskViewer({ sessionId = "demo", organizationId = 1 }: Props) {
  const totalPct = Math.round(TOTAL_RISK_SCORE * 100);
  const totalColor = TOTAL_RISK_SCORE > 0.6 ? "#ef4444" : TOTAL_RISK_SCORE > 0.3 ? "#f59e0b" : "#10b981";
  const totalLabel = TOTAL_RISK_SCORE > 0.6 ? "ALTO" : TOTAL_RISK_SCORE > 0.3 ? "MÉDIO" : "BAIXO";

  const sortedRisks = [...MOCK_RISKS].sort((a, b) => LEVEL_CONFIG[a.level].order - LEVEL_CONFIG[b.level].order);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Avaliação de Riscos Jurídicos</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Org: {organizationId}</span>
        </div>
      </div>

      {/* Total risk score */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.875rem 1rem", background: "#f9fafb", border: `2px solid ${totalColor}`, borderRadius: "0.5rem", marginBottom: "1rem" }}>
        <div style={{ width: "3.5rem", height: "3.5rem", borderRadius: "50%", background: totalColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: "1rem", fontWeight: 800, color: "white" }}>{totalPct}%</span>
        </div>
        <div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Score de Risco Total</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: totalColor }}>{totalLabel}</div>
          <div style={{ height: "6px", background: "#e5e7eb", borderRadius: "3px", width: "160px", marginTop: "0.25rem" }}>
            <div style={{ height: "100%", width: `${totalPct}%`, background: totalColor, borderRadius: "3px" }} />
          </div>
        </div>
      </div>

      {/* Summary by level */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {(["critical", "high", "medium", "low"] as RiskLevel[]).map(level => {
          const count = MOCK_RISKS.filter(r => r.level === level).length;
          const cfg = LEVEL_CONFIG[level];
          return (
            <div key={level} style={{ flex: 1, textAlign: "center", padding: "0.375rem", background: cfg.bg, border: `1px solid ${cfg.color}`, borderRadius: "0.375rem" }}>
              <div style={{ fontSize: "1.125rem", fontWeight: 700, color: cfg.color }}>{count}</div>
              <div style={{ fontSize: "0.65rem", color: cfg.color }}>{cfg.label}</div>
            </div>
          );
        })}
      </div>

      {/* Risk list */}
      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>
          Riscos Identificados ({sortedRisks.length})
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {sortedRisks.map((risk, i) => {
            const cfg = LEVEL_CONFIG[risk.level];
            const probPct = Math.round(risk.probability * 100);
            const impactPct = Math.round(risk.impact * 100);
            const scorePct = Math.round(risk.riskScore * 100);
            return (
              <div key={i} style={{ border: `1px solid ${cfg.color}`, borderRadius: "0.5rem", overflow: "hidden" }}>
                <div style={{ padding: "0.625rem 0.75rem", background: cfg.bg }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: "white", color: cfg.color, fontWeight: 700, border: `1px solid ${cfg.color}` }}>
                        {cfg.label}
                      </span>
                      <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#111827" }}>{risk.type}</span>
                    </div>
                    <span style={{ fontSize: "0.875rem", fontWeight: 700, color: cfg.color }}>{scorePct}%</span>
                  </div>
                  <p style={{ fontSize: "0.8125rem", color: "#374151", margin: "0 0 0.5rem" }}>{risk.description}</p>

                  {/* Probability / Impact bars */}
                  <div style={{ display: "flex", gap: "1rem" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                        <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>Probabilidade</span>
                        <span style={{ fontSize: "0.7rem", color: "#374151", fontWeight: 600 }}>{probPct}%</span>
                      </div>
                      <div style={{ height: "5px", background: "#e5e7eb", borderRadius: "3px" }}>
                        <div style={{ height: "100%", width: `${probPct}%`, background: cfg.color, borderRadius: "3px" }} />
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                        <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>Impacto</span>
                        <span style={{ fontSize: "0.7rem", color: "#374151", fontWeight: 600 }}>{impactPct}%</span>
                      </div>
                      <div style={{ height: "5px", background: "#e5e7eb", borderRadius: "3px" }}>
                        <div style={{ height: "100%", width: `${impactPct}%`, background: cfg.color, borderRadius: "3px" }} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mitigations */}
                <div style={{ padding: "0.5rem 0.75rem", background: "white", borderTop: `1px solid ${cfg.color}` }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" }}>Sugestões de Mitigação:</div>
                  <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                    {risk.mitigation.map((m, j) => (
                      <li key={j} style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.125rem" }}>{m}</li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
