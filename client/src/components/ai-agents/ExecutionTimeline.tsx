import React from "react";

interface TimelineEvent { id: string; label: string; occurredAt: string; type: string; }
interface Props { events?: TimelineEvent[]; }

export function ExecutionTimeline({ events = [] }: Props) {
  return (
    <div>
      <h4>Timeline de Execução</h4>
      {events.length === 0 && <p style={{ color: "#888" }}>Sem eventos registrados.</p>}
      <ol>
        {events.map(e => (
          <li key={e.id}><strong>[{e.type}]</strong> {e.label} — {new Date(e.occurredAt).toLocaleTimeString("pt-BR")}</li>
        ))}
      </ol>
    </div>
  );
}
