import React, { useState } from "react";

interface AIExecutionStatus {
  id: string;
  provider: string;
  model: string;
  status: "queued" | "dispatched" | "executing" | "awaiting_tool" | "awaiting_human" | "retrying" | "completed" | "failed" | "cancelled" | "expired";
  attempt: number;
  maxAttempts: number;
  durationMs?: number;
  error?: string;
  startedAt: string;
}

interface AIExecutionPanelProps {
  executions?: AIExecutionStatus[];
  onRetry?: (id: string) => void;
  onCancel?: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  queued:          "#6b7280",
  dispatched:      "#3b82f6",
  executing:       "#f59e0b",
  awaiting_tool:   "#8b5cf6",
  awaiting_human:  "#ec4899",
  retrying:        "#f97316",
  completed:       "#10b981",
  failed:          "#ef4444",
  cancelled:       "#9ca3af",
  expired:         "#d1d5db",
};

const STATUS_LABELS: Record<string, string> = {
  queued:          "Na fila",
  dispatched:      "Despachado",
  executing:       "Executando",
  awaiting_tool:   "Aguardando ferramenta",
  awaiting_human:  "Aguardando revisão",
  retrying:        "Tentando novamente",
  completed:       "Concluído",
  failed:          "Falhou",
  cancelled:       "Cancelado",
  expired:         "Expirado",
};

export function AIExecutionPanel({ executions = [], onRetry, onCancel }: AIExecutionPanelProps) {
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? executions : executions.filter(e => e.status === filter);

  const counts = executions.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
        Painel de Execução IA
      </h2>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <button
          onClick={() => setFilter("all")}
          style={{ padding: "0.25rem 0.75rem", borderRadius: "9999px", border: "1px solid #d1d5db", background: filter === "all" ? "#3b82f6" : "white", color: filter === "all" ? "white" : "#374151", cursor: "pointer" }}
        >
          Todos ({executions.length})
        </button>
        {Object.entries(counts).map(([status, count]) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            style={{
              padding: "0.25rem 0.75rem", borderRadius: "9999px", border: "1px solid #d1d5db",
              background: filter === status ? STATUS_COLORS[status] : "white",
              color: filter === status ? "white" : "#374151", cursor: "pointer"
            }}
          >
            {STATUS_LABELS[status] ?? status} ({count})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: "2rem" }}>
          Nenhuma execução encontrada.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {filtered.map(exec => (
            <div
              key={exec.id}
              style={{
                border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem",
                borderLeft: `4px solid ${STATUS_COLORS[exec.status] ?? "#9ca3af"}`
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{exec.provider}/{exec.model}</span>
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#6b7280" }}>#{exec.id.slice(0, 8)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{
                    padding: "0.125rem 0.5rem", borderRadius: "9999px", fontSize: "0.75rem",
                    background: STATUS_COLORS[exec.status] ?? "#9ca3af", color: "white"
                  }}>
                    {STATUS_LABELS[exec.status] ?? exec.status}
                  </span>
                  {exec.attempt > 1 && (
                    <span style={{ fontSize: "0.75rem", color: "#f97316" }}>
                      Tentativa {exec.attempt}/{exec.maxAttempts}
                    </span>
                  )}
                </div>
              </div>
              {exec.error && (
                <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#ef4444" }}>
                  Erro: {exec.error}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                  {new Date(exec.startedAt).toLocaleString("pt-BR")}
                  {exec.durationMs != null && ` • ${exec.durationMs}ms`}
                </span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {exec.status === "failed" && onRetry && (
                    <button
                      onClick={() => onRetry(exec.id)}
                      style={{ fontSize: "0.75rem", color: "#3b82f6", border: "none", background: "none", cursor: "pointer" }}
                    >
                      Tentar novamente
                    </button>
                  )}
                  {["queued", "dispatched", "executing"].includes(exec.status) && onCancel && (
                    <button
                      onClick={() => onCancel(exec.id)}
                      style={{ fontSize: "0.75rem", color: "#ef4444", border: "none", background: "none", cursor: "pointer" }}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
