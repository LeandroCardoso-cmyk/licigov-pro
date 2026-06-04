import React from "react";

type StageStatus = "pending" | "in_progress" | "completed" | "overdue" | "blocked";

interface WorkflowCard {
  id:        string;
  title:     string;
  stage:     string;
  status:    StageStatus;
  assignees: string[];
  deadline?: string;
  isOverdue: boolean;
}

interface Props {
  cards:    WorkflowCard[];
  onSelect?: (card: WorkflowCard) => void;
}

const STATUS_COLORS: Record<StageStatus, string> = {
  pending:     "#e5e7eb",
  in_progress: "#bfdbfe",
  completed:   "#bbf7d0",
  overdue:     "#fecaca",
  blocked:     "#fde68a",
};

const STATUS_LABELS: Record<StageStatus, string> = {
  pending:     "Aguardando",
  in_progress: "Em Andamento",
  completed:   "Concluído",
  overdue:     "Atrasado",
  blocked:     "Bloqueado",
};

export function WorkflowStatusBoard({ cards, onSelect }: Props) {
  const grouped: Record<string, WorkflowCard[]> = {};
  for (const card of cards) {
    if (!grouped[card.stage]) grouped[card.stage] = [];
    grouped[card.stage].push(card);
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h3 style={{ marginBottom: "1rem" }}>Painel de Workflows</h3>
      {Object.keys(grouped).length === 0 && (
        <p style={{ color: "#9ca3af" }}>Nenhum processo ativo.</p>
      )}
      <div style={{ display: "flex", gap: "1rem", overflowX: "auto" }}>
        {Object.entries(grouped).map(([stage, stageCards]) => (
          <div key={stage} style={{ minWidth: 200, background: "#f9fafb", borderRadius: 8, padding: "0.75rem" }}>
            <div style={{ fontWeight: 600, marginBottom: "0.75rem", textTransform: "capitalize" }}>
              {stage.replace(/_/g, " ")} ({stageCards.length})
            </div>
            {stageCards.map(card => (
              <div
                key={card.id}
                onClick={() => onSelect?.(card)}
                style={{
                  background: STATUS_COLORS[card.status],
                  borderRadius: 6, padding: "0.75rem", marginBottom: "0.5rem",
                  cursor: "pointer", border: card.isOverdue ? "2px solid #dc2626" : "1px solid transparent",
                }}
              >
                <div style={{ fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>{card.title}</div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{STATUS_LABELS[card.status]}</div>
                {card.assignees.length > 0 && (
                  <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                    {card.assignees.join(", ")}
                  </div>
                )}
                {card.deadline && (
                  <div style={{ fontSize: "0.7rem", color: card.isOverdue ? "#dc2626" : "#6b7280" }}>
                    Prazo: {new Date(card.deadline).toLocaleDateString("pt-BR")}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
