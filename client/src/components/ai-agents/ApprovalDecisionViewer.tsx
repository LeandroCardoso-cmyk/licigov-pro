import React from "react";

interface Decision { id: string; approver: string; decision: string; justification: string; decidedAt: string; }
interface Props { decisions?: Decision[]; }

export function ApprovalDecisionViewer({ decisions = [] }: Props) {
  return (
    <div>
      <h4>Histórico de Decisões</h4>
      {decisions.length === 0 && <p style={{ color: "#888" }}>Sem decisões registradas.</p>}
      {decisions.map(d => (
        <div key={d.id} style={{ borderLeft: `4px solid ${d.decision === "approve" ? "green" : "red"}`, paddingLeft: 8, marginBottom: 8 }}>
          <strong>{d.approver}</strong>: {d.decision} — {d.justification}
          <br /><small>{new Date(d.decidedAt).toLocaleString("pt-BR")}</small>
        </div>
      ))}
    </div>
  );
}
