import React from "react";

interface GovernancePolicyItem {
  id:         string;
  name:       string;
  policyType: string;
  isActive:   boolean;
  lastAudit?: string;
}

interface Props {
  policies:         GovernancePolicyItem[];
  complianceScores: Record<string, number>;
}

export function GovernancePolicyList({ policies, complianceScores }: Props) {
  if (policies.length === 0) {
    return <div style={{ fontFamily: "sans-serif", color: "#6b7280", padding: "1rem" }}>Nenhuma política cadastrada.</div>;
  }

  return (
    <div style={{ fontFamily: "sans-serif", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {policies.map(p => {
        const score = complianceScores[p.id] ?? 100;
        const scoreColor = score >= 80 ? "#16a34a" : score >= 60 ? "#d97706" : "#dc2626";
        return (
          <div key={p.id} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{p.name}</div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{p.policyType} · {p.isActive ? "Ativa" : "Inativa"}</div>
              {p.lastAudit && <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Última auditoria: {new Date(p.lastAudit).toLocaleDateString("pt-BR")}</div>}
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: scoreColor }}>{score}</div>
              <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>Compliance</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
