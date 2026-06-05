import React from "react";

interface AuditEvent {
  id:            string;
  action:        string;
  outcome:       "compliant" | "non_compliant" | "waived" | "escalated";
  actor:         number;
  justification: string;
  occurredAt:    string;
}

interface Props {
  auditTrail: {
    policyId:        string;
    events:          AuditEvent[];
    complianceScore: number;
    lastAuditAt:     string;
  };
}

const OUTCOME_COLORS  = { compliant: "#16a34a", non_compliant: "#dc2626", waived: "#d97706", escalated: "#7c3aed" };
const OUTCOME_LABELS  = { compliant: "Conforme", non_compliant: "Não conforme", waived: "Dispensado", escalated: "Escalado" };

export function ComplianceAuditLog({ auditTrail }: Props) {
  const { events, complianceScore, lastAuditAt } = auditTrail;
  const scoreColor = complianceScore >= 80 ? "#16a34a" : complianceScore >= 60 ? "#d97706" : "#dc2626";

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem", maxWidth: 700 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: scoreColor }}>{complianceScore}</div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Score de Compliance</div>
        </div>
        <div style={{ fontSize: "0.75rem", color: "#9ca3af", textAlign: "right" }}>
          Última auditoria:<br />{new Date(lastAuditAt).toLocaleString("pt-BR")}
        </div>
      </div>

      {events.length === 0 ? (
        <div style={{ color: "#6b7280", fontSize: "0.875rem" }}>Nenhum evento de auditoria.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {[...events].reverse().map(ev => (
            <div key={ev.id} style={{ background: "#f9fafb", border: `1px solid ${OUTCOME_COLORS[ev.outcome]}22`, borderRadius: 6, padding: "0.6rem 0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{ev.action}</span>
                <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: OUTCOME_COLORS[ev.outcome], fontWeight: 600 }}>{OUTCOME_LABELS[ev.outcome]}</span>
                {ev.justification && <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>{ev.justification.slice(0, 60)}{ev.justification.length > 60 ? "…" : ""}</div>}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#9ca3af", whiteSpace: "nowrap", marginLeft: "1rem" }}>
                {new Date(ev.occurredAt).toLocaleString("pt-BR")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
