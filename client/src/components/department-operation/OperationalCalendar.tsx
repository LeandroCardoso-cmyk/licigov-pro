import React from "react";
import { trpc } from "../../lib/trpc";
import { EVENT_TYPE_LABELS, EVENT_TYPE_CLASSES, formatDate, todayIso, addDaysIso } from "./labels";
import {
  buildMonthGrid, groupItemsByDay, listForMonthSelection, monthGridRange, monthLabel, monthNavigationReducer,
  timeLabelFor, type OperationalCalendarItem,
} from "@shared/operationalCalendar";
import OperationalMonthGrid from "./OperationalMonthGrid";

/**
 * OperationalCalendar — REAL (tRPC).
 *
 * ÁREA 3 — Calendário Operacional: acompanha EVENTOS (não workflow). Visualizações
 * diária/semanal/mensal. Ao clicar num evento, abre o processo de referência.
 *
 * Calendário Operacional Visual v1: na visão mensal, uma GRADE MENSAL REAL fica acima da
 * lista. Grade e lista usam a MESMA consulta (`departmentOperation.calendar`) — a janela
 * consultada cobre as semanas visíveis da grade; nada é buscado em outra fonte.
 */

export interface OperationalCalendarProps {
  onOpenReference?: (type: string, id: string) => void;
  /** Data de referência "hoje" (AAAA-MM-DD). Padrão: hoje em America/Sao_Paulo. */
  today?: string;
}

type ViewMode = "diaria" | "semanal" | "mensal";

/** Navegação das visões em lista (diária/semanal); a mensal usa `monthNavigationReducer`. */
function shiftDate(date: string, view: ViewMode, direction: -1 | 1): string {
  return addDaysIso(date, view === "diaria" ? direction : direction * 7);
}

type CalendarEvent = OperationalCalendarItem;

function EventList({ groups, onOpenReference }: { groups: Array<[string, CalendarEvent[]]>; onOpenReference?: OperationalCalendarProps["onOpenReference"] }) {
  return (
    <div className="space-y-4">
      {groups.map(([date, evs]) => (
        <div key={date}>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{formatDate(date)}</p>
          <ul className="space-y-1">
            {evs.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => e.referenceId && onOpenReference?.(e.referenceType, e.referenceId)} className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left hover:border-indigo-200 dark:hover:border-indigo-800">
                  <span className="line-clamp-1 text-sm text-foreground">{e.title} · {timeLabelFor(e, date)}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${EVENT_TYPE_CLASSES[e.eventType] ?? "bg-muted text-foreground"}`}>{EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** "outubro de 2026" → "Outubro de 2026" (só a 1ª letra; o "de" continua minúsculo). */
export function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1) : text;
}

const NAV_BUTTON = "rounded border border-border px-2 py-1 text-foreground hover:bg-muted";

export default function OperationalCalendar({ onOpenReference, today: todayProp }: OperationalCalendarProps) {
  const today = todayProp ?? todayIso();
  const [view, setView] = React.useState<ViewMode>("mensal");
  const [anchorDate, setAnchorDate] = React.useState(today);
  const [monthState, dispatch] = React.useReducer(monthNavigationReducer, { month: today.slice(0, 7), selectedDate: null });

  const isMonth = view === "mensal";
  const grid = isMonth ? monthGridRange(monthState.month) : null;
  const from = grid ? grid.from : anchorDate;
  const to = grid ? grid.to : addDaysIso(from, view === "diaria" ? 0 : 6);
  const { data, isLoading, isError } = trpc.departmentOperation.calendar.useQuery({ from, to });
  const events: CalendarEvent[] = React.useMemo(() => data?.events ?? [], [data]);

  const monthGrid = React.useMemo(
    () => (isMonth ? buildMonthGrid({ month: monthState.month, items: events, today, selectedDate: monthState.selectedDate }) : null),
    [isMonth, monthState, events, today],
  );
  const groups = React.useMemo(
    () => (isMonth ? listForMonthSelection(events, monthState.month, monthState.selectedDate) : groupItemsByDay(events, from, to)),
    [isMonth, events, monthState, from, to],
  );

  const goTo = (value: string) => {
    if (!value) return;
    if (isMonth) dispatch({ type: "goTo", date: value }); else setAnchorDate(value);
  };
  const periodLabel = isMonth
    ? monthState.selectedDate ? `Eventos de ${formatDate(monthState.selectedDate)}` : `Eventos de ${monthLabel(monthState.month)}`
    : `${formatDate(from)}${from !== to ? ` a ${formatDate(to)}` : ""}`;
  const emptyMessage = isMonth && monthState.selectedDate ? `Nenhum evento em ${formatDate(monthState.selectedDate)}.` : "Nenhum evento no período.";

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Calendário Operacional</h3>
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
          {(["diaria", "semanal", "mensal"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 capitalize transition ${view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{v}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <button type="button" onClick={() => (isMonth ? dispatch({ type: "previous" }) : setAnchorDate(shiftDate(anchorDate, view, -1)))} className={NAV_BUTTON}>Anterior</button>
        <button type="button" onClick={() => (isMonth ? dispatch({ type: "today", today }) : setAnchorDate(today))} className={NAV_BUTTON}>Hoje</button>
        <button type="button" onClick={() => (isMonth ? dispatch({ type: "next" }) : setAnchorDate(shiftDate(anchorDate, view, 1)))} className={NAV_BUTTON}>Próximo</button>
        <label className="flex items-center gap-2">Ir para <input aria-label="Ir para data" type="date" value={isMonth ? monthState.selectedDate ?? "" : anchorDate} onChange={(e) => goTo(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-foreground" /></label>
        {isMonth && monthGrid && <span className="text-sm font-semibold text-foreground">{capitalizeFirst(monthGrid.label)}</span>}
      </div>

      {isError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-center text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">Não foi possível carregar o calendário. Tente novamente.</p>
      ) : (
        <>
          {monthGrid && (isLoading ? <div className="h-72 animate-pulse rounded-md bg-muted" /> : <OperationalMonthGrid grid={monthGrid} onSelectDate={(date) => dispatch({ type: "select", date })} />)}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">{periodLabel}</p>
              {isMonth && monthState.selectedDate && (
                <button type="button" onClick={() => dispatch({ type: "clearSelection" })} className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted">Ver mês inteiro</button>
              )}
            </div>
            {isLoading ? (
              <div className="h-24 animate-pulse rounded-md bg-muted" />
            ) : groups.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">{emptyMessage}</p>
            ) : (
              <EventList groups={groups} onOpenReference={onOpenReference} />
            )}
          </div>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">O calendário mostra eventos (sessões, vencimentos, reuniões…), nunca publicações/checklist/documentos (pertencem ao workflow).</p>
    </section>
  );
}
