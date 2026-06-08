import React from "react";

interface Props {
  sessionId?: string;
  targetType?: string;
}

type RuleStatus = "pass" | "fail" | "warn";

interface ValidationResult {
  ruleName: string;
  status: RuleStatus;
  message: string;
  suggestion?: string;
}

const MOCK_RESULTS: ValidationResult[] = [
  { ruleName: "Referência Lei 14133/2021", status: "pass", message: "Referência normativa presente e válida." },
  { ruleName: "Objeto da contratação", status: "pass", message: "Objeto descrito de forma clara e precisa." },
  { ruleName: "Justificativa de contratação", status: "pass", message: "Justificativa apresentada com base em necessidade comprovada." },
  { ruleName: "Pesquisa de preços", status: "pass", message: "Pesquisa realizada com no mínimo 3 fontes conforme IN SEGES 65/2021." },
  { ruleName: "Critério de julgamento", status: "warn", message: "Critério de julgamento não especificado explicitamente.", suggestion: "Incluir critério de menor preço global ou técnica e preço conforme objeto." },
  { ruleName: "Planilha orçamentária", status: "fail", message: "Planilha de custos unitários ausente.", suggestion: "Elaborar planilha orçamentária detalhada com memória de cálculo antes da publicação." },
  { ruleName: "Prazo de vigência", status: "pass", message: "Prazo de 12 meses dentro do limite ordinário legal." },
  { ruleName: "Habilitação técnica", status: "warn", message: "Requisitos de habilitação podem ser excessivamente restritivos.", suggestion: "Revisar requisitos de capacidade técnica para não limitar a competição." },
  { ruleName: "Publicação PNCP", status: "pass", message: "Obrigação de publicação no PNCP prevista na minuta." },
  { ruleName: "Designação de fiscal", status: "fail", message: "Fiscal e gestor do contrato não designados.", suggestion: "Formalizar designação de fiscal e gestor por portaria antes da assinatura." },
];

const PASS_RATE = 0.80;

const STATUS_CONFIG: Record<RuleStatus, { icon: string; color: string; bg: string; label: string }> = {
  pass: { icon: "✓", color: "#10b981", bg: "#ecfdf5", label: "Aprovado" },
  fail: { icon: "✗", color: "#ef4444", bg: "#fef2f2", label: "Reprovado" },
  warn: { icon: "!", color: "#f59e0b", bg: "#fffbeb", label: "Aviso" },
};

function getOverallStatus(results: ValidationResult[]): { label: string; color: string; bg: string } {
  const hasFail = results.some(r => r.status === "fail");
  const hasWarn = results.some(r => r.status === "warn");
  if (hasFail) return { label: "REPROVADO", color: "#ef4444", bg: "#fef2f2" };
  if (hasWarn) return { label: "AVISOS", color: "#f59e0b", bg: "#fffbeb" };
  return { label: "APROVADO", color: "#10b981", bg: "#ecfdf5" };
}

export default function ComplianceValidationPanel({ sessionId = "demo", targetType = "draft" }: Props) {
  const passRate = PASS_RATE;
  const passRatePct = Math.round(passRate * 100);
  const overall = getOverallStatus(MOCK_RESULTS);
  const passColor = passRatePct >= 80 ? "#10b981" : passRatePct >= 60 ? "#f59e0b" : "#ef4444";

  const passCount = MOCK_RESULTS.filter(r => r.status === "pass").length;
  const failCount = MOCK_RESULTS.filter(r => r.status === "fail").length;
  const warnCount = MOCK_RESULTS.filter(r => r.status === "warn").length;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Validação de Conformidade</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Alvo: {targetType}</span>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
        </div>
      </div>

      {/* Overall status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1rem", background: overall.bg, border: `1px solid ${overall.color}`, borderRadius: "0.5rem", marginBottom: "1rem" }}>
        <span style={{ fontSize: "1.125rem", fontWeight: 800, color: overall.color, letterSpacing: "0.05em" }}>
          {overall.label}
        </span>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>Taxa de aprovação</div>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: passColor }}>{passRatePct}%</div>
        </div>
      </div>

      {/* Counters */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <div style={{ flex: 1, textAlign: "center", padding: "0.5rem", background: "#ecfdf5", border: "1px solid #bbf7d0", borderRadius: "0.375rem" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#10b981" }}>{passCount}</div>
          <div style={{ fontSize: "0.7rem", color: "#15803d" }}>Aprovadas</div>
        </div>
        <div style={{ flex: 1, textAlign: "center", padding: "0.5rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "0.375rem" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#f59e0b" }}>{warnCount}</div>
          <div style={{ fontSize: "0.7rem", color: "#92400e" }}>Avisos</div>
        </div>
        <div style={{ flex: 1, textAlign: "center", padding: "0.5rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#ef4444" }}>{failCount}</div>
          <div style={{ fontSize: "0.7rem", color: "#7f1d1d" }}>Reprovadas</div>
        </div>
      </div>

      {/* Results list */}
      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>Resultados por Regra</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {MOCK_RESULTS.map((r, i) => {
            const cfg = STATUS_CONFIG[r.status];
            return (
              <div key={i} style={{ border: `1px solid ${r.status === "fail" ? "#fca5a5" : r.status === "warn" ? "#fde68a" : "#d1fae5"}`, borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: cfg.bg }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: r.suggestion ? "0.375rem" : 0 }}>
                  <span style={{ fontSize: "0.875rem", fontWeight: 700, color: cfg.color, width: "1.25rem", textAlign: "center", flexShrink: 0 }}>{cfg.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#111827" }}>{r.ruleName}</div>
                    <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{r.message}</div>
                  </div>
                  <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: "white", color: cfg.color, border: `1px solid ${cfg.color}`, fontWeight: 600, flexShrink: 0 }}>
                    {cfg.label}
                  </span>
                </div>
                {r.suggestion && (
                  <div style={{ marginLeft: "1.75rem", padding: "0.375rem 0.5rem", background: "white", borderRadius: "0.375rem", border: "1px solid #e5e7eb" }}>
                    <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#374151" }}>Sugestão: </span>
                    <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>{r.suggestion}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
