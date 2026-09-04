import React from "react";

/**
 * TimelinePanel — PRESENTATIONAL.
 * Linha do tempo do contrato (Timeline Engine reutilizado). Append-only, imutável.
 */

export interface TimelineEvent {
  id: string; order: number; eventType: string; actor: string; summary: string; createdAt: string;
}

export interface TimelinePanelProps { timeline?: TimelineEvent[] }

function fmt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TimelinePanel({ timeline = [] }: TimelinePanelProps) {
  const ordered = [...timeline].sort((a, b) => a.order - b.order);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-semibold text-foreground">Linha do tempo</h3>
      <p className="mb-4 text-xs text-muted-foreground">Registro append-only — cada evento é imutável.</p>
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem eventos registrados.</p>
      ) : (
        <ol className="relative space-y-5 border-l border-border pl-5">
          {ordered.map((ev) => (
            <li key={ev.id} className="relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-500" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-indigo-700">{ev.eventType}</span>
                <span className="text-[11px] text-muted-foreground">{fmt(ev.createdAt)}</span>
              </div>
              <p className="text-sm text-foreground">{ev.summary}</p>
              <p className="text-xs text-muted-foreground">por {ev.actor}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
