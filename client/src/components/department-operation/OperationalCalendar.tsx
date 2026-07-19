import React from "react";
import { trpc } from "../../lib/trpc";
import { EVENT_TYPE_LABELS, EVENT_TYPE_CLASSES, formatDate, todayIso, addDaysIso } from "./labels";

/**
 * OperationalCalendar — REAL (tRPC).
 *
 * ÁREA 3 — Calendário Operacional: acompanha EVENTOS (não workflow). Visualizações
 * diária/semanal/mensal. Ao clicar num evento, abre o processo de referência.
 */

export interface OperationalCalendarProps { onOpenReference?: (type: string, id: string) => void }

type ViewMode = "diaria" | "semanal" | "mensal";
const SPAN: Record<ViewMode, number> = { diaria: 0, semanal: 6, mensal: 29 };

export default function OperationalCalendar({ onOpenReference }: OperationalCalendarProps) {
  const [view, setView] = React.useState<ViewMode>("semanal");
  const from = todayIso();
  const to = addDaysIso(from, SPAN[view]);
  const { data, isLoading } = trpc.departmentOperation.calendar.useQuery({ from, to });
  const events = data?.events ?? [];

  const byDate = React.useMemo(() => {
    const map: Record<string, typeof events> = {};
    for (const e of events) (map[e.eventDate] ??= []).push(e);
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Calendário Operacional</h3>
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
          {(["diaria", "semanal", "mensal"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded-md px-3 py-1 capitalize transition ${view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{v}</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : byDate.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">Nenhum evento no período.</p>
      ) : (
        <div className="space-y-4">
          {byDate.map(([date, evs]) => (
            <div key={date}>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">{formatDate(date)}</p>
              <ul className="space-y-1">
                {evs.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => e.referenceId && onOpenReference?.(e.referenceType, e.referenceId)} className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left hover:border-indigo-200">
                      <span className="line-clamp-1 text-sm text-foreground">{e.title}{e.eventTime ? ` · ${e.eventTime}` : ""}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${EVENT_TYPE_CLASSES[e.eventType] ?? "bg-muted text-foreground"}`}>{EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">O calendário mostra eventos (sessões, vencimentos, reuniões…), nunca publicações/checklist/documentos (pertencem ao workflow).</p>
    </section>
  );
}
