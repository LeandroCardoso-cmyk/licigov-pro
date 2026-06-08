import React from "react";

interface ApprovalItem { id: string; approvalType: string; status: string; priority: string; createdAt: string; }
interface Props { approvals?: ApprovalItem[]; onApprove?: (id: string) => void; onReject?: (id: string) => void; }

export function ApprovalQueuePanel({ approvals = [], onApprove, onReject }: Props) {
  return (
    <div>
      <h4>Fila de Aprovações ({approvals.length})</h4>
      {approvals.length === 0 && <p style={{ color: "#888" }}>Nenhuma aprovação pendente.</p>}
      {approvals.map(a => (
        <div key={a.id} style={{ border: "1px solid #444", padding: 8, marginBottom: 8, borderRadius: 4 }}>
          <strong>{a.approvalType}</strong> <span style={{ color: a.priority === "urgent" ? "red" : "orange" }}>[{a.priority}]</span>
          <br /><small>{new Date(a.createdAt).toLocaleString("pt-BR")}</small>
          <div>
            <button onClick={() => onApprove?.(a.id)} style={{ marginRight: 8 }}>Aprovar</button>
            <button onClick={() => onReject?.(a.id)}>Rejeitar</button>
          </div>
        </div>
      ))}
    </div>
  );
}
