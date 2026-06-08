import React from "react";

interface Props {
  organizationId?: number;
  sessionId?: string;
}

type RecommendationType = "add" | "modify" | "remove";

interface Recommendation {
  type: RecommendationType;
  content: string;
  priority: number;
}

interface ConflictPair {
  clauseA: string;
  clauseB: string;
  description: string;
}

const MOCK_RECOMMENDATIONS: Recommendation[] = [
  { type: "add", content: "Adicionar referência explícita a: Lei 14133/2021 art. 72", priority: 1 },
  { type: "modify", content: "Revisar fundamentação legal para Dispensa de licitação", priority: 2 },
  { type: "add", content: "Documentar justificativas conforme exigido", priority: 3 },
];

const MOCK_CONFLICTS: ConflictPair[] = [
  { clauseA: "Cláusula 5ª — Prazo de Vigência", clauseB: "Cláusula 12ª — Prorrogação", description: "Prazo máximo de vigência conflita com cláusula de prorrogação automática." },
];

const RISK_SCORE = 0.35;

const TYPE_CONFIG: Record<RecommendationType, { label: string; color: string; bg: string }> = {
  add:    { label: "Adicionar",  color: "#10b981", bg: "#ecfdf5" },
  modify: { label: "Modificar",  color: "#f59e0b", bg: "#fffbeb" },
  remove: { label: "Remover",    color: "#ef4444", bg: "#fef2f2" },
};

export default function ClauseRecommendationPanel({ organizationId = 1, sessionId = "demo" }: Props) {
  const riskPct = Math.round(RISK_SCORE * 100);
  const riskColor = RISK_SCORE > 0.6 ? "#ef4444" : RISK_SCORE > 0.3 ? "#f59e0b" : "#10b981";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Recomendações de Cláusulas</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Org: {organizationId}</span>
        </div>
      </div>

      {/* Risk score */}
      <div style={{ background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "1rem", border: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "#374151" }}>Score de Risco Geral</span>
          <span style={{ fontSize: "1rem", fontWeight: 700, color: riskColor }}>{riskPct}%</span>
        </div>
        <div style={{ height: "7px", background: "#e5e7eb", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${riskPct}%`, background: riskColor }} />
        </div>
      </div>

      {/* Recommendations */}
      <div style={{ marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>
          Recomendações ({MOCK_RECOMMENDATIONS.length})
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {MOCK_RECOMMENDATIONS.map((rec, i) => {
            const cfg = TYPE_CONFIG[rec.type];
            return (
              <div key={i} style={{ border: `1px solid ${cfg.color}`, borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: cfg.bg }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: "white", color: cfg.color, fontWeight: 700, border: `1px solid ${cfg.color}` }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Prioridade {rec.priority}</span>
                  </div>
                </div>
                <p style={{ fontSize: "0.8125rem", color: "#374151", margin: 0 }}>{rec.content}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Conflicts */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", margin: 0 }}>Mapa de Conflitos</h3>
          {MOCK_CONFLICTS.length > 0 && (
            <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", background: "#ef4444", color: "white", fontWeight: 700 }}>
              {MOCK_CONFLICTS.length} conflito{MOCK_CONFLICTS.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {MOCK_CONFLICTS.length === 0 ? (
          <div style={{ padding: "0.75rem", background: "#ecfdf5", borderRadius: "0.5rem", border: "1px solid #bbf7d0", fontSize: "0.875rem", color: "#15803d", textAlign: "center" }}>
            Nenhum conflito detectado
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {MOCK_CONFLICTS.map((c, i) => (
              <div key={i} style={{ border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: "#fef2f2" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.375rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#7f1d1d", background: "white", padding: "0.1rem 0.375rem", borderRadius: "3px", border: "1px solid #fca5a5" }}>
                    {c.clauseA}
                  </span>
                  <span style={{ fontSize: "0.7rem", color: "#ef4444" }}>vs</span>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#7f1d1d", background: "white", padding: "0.1rem 0.375rem", borderRadius: "3px", border: "1px solid #fca5a5" }}>
                    {c.clauseB}
                  </span>
                </div>
                <p style={{ fontSize: "0.8125rem", color: "#374151", margin: 0 }}>{c.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
