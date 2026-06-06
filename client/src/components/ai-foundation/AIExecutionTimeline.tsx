import React from "react";

interface TimelineEvent {
  id: string;
  type: "created" | "dispatched" | "retried" | "completed" | "failed" | "cancelled" | "expired" | "awaiting_human" | "awaiting_tool";
  description: string;
  occurredAt: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

interface AIExecutionTimelineProps {
  events?: TimelineEvent[];
  sessionId?: string;
}

const EVENT_ICONS: Record<string, string> = {
  created:         "📋",
  dispatched:      "🚀",
  retried:         "🔄",
  completed:       "✅",
  failed:          "❌",
  cancelled:       "🚫",
  expired:         "⏰",
  awaiting_human:  "👤",
  awaiting_tool:   "🔧",
};

const EVENT_COLORS: Record<string, string> = {
  created:         "#6b7280",
  dispatched:      "#3b82f6",
  retried:         "#f97316",
  completed:       "#10b981",
  failed:          "#ef4444",
  cancelled:       "#9ca3af",
  expired:         "#d97706",
  awaiting_human:  "#ec4899",
  awaiting_tool:   "#8b5cf6",
};

const EVENT_LABELS: Record<string, string> = {
  created:         "Criado",
  dispatched:      "Despachado",
  retried:         "Retentativa",
  completed:       "Concluído",
  failed:          "Falhou",
  cancelled:       "Cancelado",
  expired:         "Expirado",
  awaiting_human:  "Aguardando humano",
  awaiting_tool:   "Aguardando ferramenta",
};

export function AIExecutionTimeline({ events = [], sessionId }: AIExecutionTimelineProps) {
  if (events.length === 0) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "1rem", textAlign: "center", color: "#9ca3af" }}>
        Nenhum evento de execução.
      </div>
    );
  }

  const sorted = [...events].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const totalDuration = sorted.length >= 2
    ? new Date(sorted[sorted.length - 1].occurredAt).getTime() - new Date(sorted[0].occurredAt).getTime()
    : 0;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
          Linha do Tempo de Execução IA
        </h2>
        {sessionId && (
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Sessão: {sessionId.slice(0, 12)}...</span>
        )}
      </div>

      {totalDuration > 0 && (
        <div style={{ marginBottom: "0.75rem", fontSize: "0.75rem", color: "#6b7280" }}>
          Duração total: {totalDuration >= 1000 ? `${(totalDuration / 1000).toFixed(1)}s` : `${totalDuration}ms`}
        </div>
      )}

      <div style={{ position: "relative", paddingLeft: "2rem" }}>
        <div style={{ position: "absolute", left: "0.75rem", top: 0, bottom: 0, width: "2px", background: "#e5e7eb" }} />

        {sorted.map((event, idx) => {
          const color = EVENT_COLORS[event.type] ?? "#9ca3af";
          const isLast = idx === sorted.length - 1;
          const duration = idx > 0
            ? new Date(event.occurredAt).getTime() - new Date(sorted[idx - 1].occurredAt).getTime()
            : null;

          return (
            <div key={event.id} style={{ position: "relative", marginBottom: isLast ? 0 : "1rem" }}>
              <div style={{
                position: "absolute", left: "-1.625rem", top: "0.125rem",
                width: "1rem", height: "1rem", borderRadius: "50%",
                background: color, border: "2px solid white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.5rem", boxShadow: "0 0 0 2px " + color + "40"
              }}>
              </div>

              <div style={{ paddingLeft: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    <span>{EVENT_ICONS[event.type] ?? "•"}</span>
                    <span style={{ fontWeight: 600, fontSize: "0.875rem", color }}>{EVENT_LABELS[event.type] ?? event.type}</span>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.75rem", color: "#9ca3af" }}>
                    {duration !== null && <span>+{duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`}</span>}
                    <span>{new Date(event.occurredAt).toLocaleTimeString("pt-BR")}</span>
                  </div>
                </div>
                <div style={{ fontSize: "0.8125rem", color: "#374151", marginTop: "0.125rem" }}>{event.description}</div>
                {event.metadata && Object.keys(event.metadata).length > 0 && (
                  <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                    {Object.entries(event.metadata).slice(0, 3).map(([k, v]) => (
                      <span key={k} style={{ fontSize: "0.6875rem", padding: "0.125rem 0.375rem", background: "#f3f4f6", borderRadius: "0.25rem", color: "#6b7280" }}>
                        {k}: {String(v).slice(0, 20)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
