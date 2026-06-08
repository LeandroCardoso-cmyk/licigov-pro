import React from "react";

interface SafetyCheck { passed: boolean; safetyLevel: string; recommendation: string; findings: string[]; }
interface Props { check?: SafetyCheck; }

const LEVEL_COLOR: Record<string, string> = { safe: "green", low_risk: "#8bc34a", medium_risk: "orange", high_risk: "red", critical: "darkred", blocked: "black" };

export function SafetyValidationPanel({ check }: Props) {
  if (!check) return <p>Sem verificação de segurança.</p>;
  return (
    <div style={{ border: `2px solid ${LEVEL_COLOR[check.safetyLevel] ?? "gray"}`, padding: 12, borderRadius: 6 }}>
      <h4>Verificação de Segurança</h4>
      <p>Nível: <strong style={{ color: LEVEL_COLOR[check.safetyLevel] }}>{check.safetyLevel}</strong></p>
      <p>Status: {check.passed ? "✓ Passou" : "✗ Falhou"}</p>
      <p>Recomendação: <strong>{check.recommendation}</strong></p>
      {check.findings.length > 0 && <ul>{check.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
    </div>
  );
}
