import React from "react";

interface Props {
  sessionId?: string;
  organizationId?: number;
}

const MOCK_PREMISES = [
  { legalBasis: "Lei 14133/2021 art. 72", content: "A dispensa de licitação deve ser formalmente justificada com documentação probatória." },
  { legalBasis: "Lei 14133/2021 art. 75", content: "Os valores limites para dispensa devem ser observados conforme categoria de objeto." },
  { legalBasis: "Decreto 10.947/2022", content: "A publicação no PNCP é obrigatória para contratações acima do limite fixado." },
  { legalBasis: "TCU Acórdão 2089/2021", content: "A pesquisa de preços deve contemplar no mínimo três fontes independentes." },
  { legalBasis: "IN SEGES 65/2021", content: "O termo de referência deve especificar critérios de sustentabilidade aplicáveis." },
];

const MOCK_INFERENCES = [
  "Com base nas premissas identificadas, o processo de contratação exige ETP e TR com justificativa expressa.",
  "A modalidade pregão eletrônico é aplicável dado o objeto de natureza comum e valor acima do limite de dispensa.",
  "A publicação no PNCP deve ocorrer no prazo de 10 dias úteis após a assinatura do instrumento contratual.",
];

const COMPLIANCE_SCORE = 0.78;
const RISK_SCORE = 0.35;
const CONTRADICTIONS = 0;

export default function LegalReasoningViewer({ sessionId = "demo", organizationId = 1 }: Props) {
  const compliancePct = Math.round(COMPLIANCE_SCORE * 100);
  const riskPct = Math.round(RISK_SCORE * 100);

  const riskColor = RISK_SCORE > 0.6 ? "#ef4444" : RISK_SCORE > 0.3 ? "#f59e0b" : "#10b981";
  const complianceColor = COMPLIANCE_SCORE >= 0.7 ? "#10b981" : COMPLIANCE_SCORE >= 0.5 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Raciocínio Jurídico</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Org: {organizationId}</span>
        </div>
      </div>

      {/* Scores */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ flex: 1, background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>Conformidade</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: complianceColor }}>{compliancePct}%</div>
          <div style={{ height: "5px", background: "#e5e7eb", borderRadius: "3px", marginTop: "0.25rem" }}>
            <div style={{ height: "100%", width: `${compliancePct}%`, background: complianceColor, borderRadius: "3px" }} />
          </div>
        </div>
        <div style={{ flex: 1, background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>Risco</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: riskColor }}>{riskPct}%</div>
          <div style={{ height: "5px", background: "#e5e7eb", borderRadius: "3px", marginTop: "0.25rem" }}>
            <div style={{ height: "100%", width: `${riskPct}%`, background: riskColor, borderRadius: "3px" }} />
          </div>
        </div>
        <div style={{ flex: 1, background: "#f9fafb", borderRadius: "0.5rem", padding: "0.75rem", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>Contradições</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: CONTRADICTIONS > 0 ? "#ef4444" : "#10b981" }}>{CONTRADICTIONS}</span>
            {CONTRADICTIONS > 0 && (
              <span style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem", background: "#ef4444", color: "white", borderRadius: "9999px", fontWeight: 600 }}>
                {CONTRADICTIONS} detectadas
              </span>
            )}
            {CONTRADICTIONS === 0 && (
              <span style={{ fontSize: "0.7rem", color: "#10b981" }}>nenhuma</span>
            )}
          </div>
        </div>
      </div>

      {/* Premises */}
      <div style={{ marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>
          Premissas ({MOCK_PREMISES.length})
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {MOCK_PREMISES.slice(0, 5).map((p, i) => (
            <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: "white", borderLeft: "3px solid #3b82f6" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#3b82f6", marginBottom: "0.2rem" }}>{p.legalBasis}</div>
              <div style={{ fontSize: "0.8125rem", color: "#374151" }}>{p.content}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Inferences */}
      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#374151" }}>
          Inferências ({MOCK_INFERENCES.length})
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {MOCK_INFERENCES.slice(0, 3).map((inf, i) => (
            <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: "white", borderLeft: "3px solid #8b5cf6" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#8b5cf6", flexShrink: 0, marginTop: "0.1rem" }}>#{i + 1}</span>
                <span style={{ fontSize: "0.8125rem", color: "#374151" }}>{inf}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
