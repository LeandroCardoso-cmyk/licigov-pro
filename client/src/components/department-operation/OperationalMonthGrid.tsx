import React from "react";
import { WEEKDAY_LABELS, type CalendarItemKind, type MonthGrid, type OperationalCalendarItem } from "@shared/operationalCalendar";
import { EVENT_TYPE_LABELS, formatDate } from "./labels";

/**
 * Calendário Operacional Visual v1 — grade mensal (apresentação pura).
 *
 * Recebe a grade já montada pelo domínio (`buildMonthGrid`) e só desenha: semanas 7×N,
 * dia atual, dia selecionado, dias fora do mês atenuados, itens por dia e excedente "+N".
 * Selecionar um dia é a única interação; abrir o processo continua na lista abaixo.
 */

export interface OperationalMonthGridProps<T extends OperationalCalendarItem> {
  grid: MonthGrid<T>;
  onSelectDate: (date: string) => void;
}

export const ITEM_KIND_CLASSES: Record<CalendarItemKind, string> = {
  certame: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 font-semibold",
  timed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  allDay: "border border-border bg-muted text-foreground",
};

export const ITEM_KIND_LABELS: Record<CalendarItemKind, string> = {
  allDay: "Dia inteiro", timed: "Com horário", certame: "Certame / sessão",
};

function cellClasses(cell: { inMonth: boolean; isSelected: boolean }): string {
  const base = "flex min-h-[3.25rem] min-w-0 flex-col gap-0.5 overflow-hidden border-b border-r border-border p-1 text-left align-top transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:min-h-[6.5rem]";
  const tone = cell.isSelected ? "bg-indigo-50 dark:bg-indigo-950 ring-2 ring-inset ring-indigo-500" : cell.inMonth ? "bg-card hover:bg-muted" : "bg-muted/40 text-muted-foreground hover:bg-muted";
  return `${base} ${tone}`;
}

export default function OperationalMonthGrid<T extends OperationalCalendarItem>({ grid, onSelectDate }: OperationalMonthGridProps<T>) {
  return (
    <div className="space-y-2">
      <div role="group" aria-label={`Calendário de ${grid.label}`} className="overflow-hidden rounded-md border-l border-t border-border">
        <div aria-hidden="true" className="grid grid-cols-7">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="border-b border-r border-border bg-muted px-1 py-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
          ))}
        </div>
        {grid.weeks.map((week) => (
          <div key={week[0].date} className="grid grid-cols-7">
            {week.map((cell) => {
              const summary = cell.items.length === 0 ? "sem eventos" : `${cell.items.length} evento(s)`;
              return (
                <button
                  key={cell.date}
                  type="button"
                  aria-pressed={cell.isSelected}
                  aria-current={cell.isToday ? "date" : undefined}
                  aria-label={`${formatDate(cell.date)}${cell.isToday ? " (hoje)" : ""}: ${summary}`}
                  data-date={cell.date}
                  onClick={() => onSelectDate(cell.date)}
                  className={cellClasses(cell)}
                >
                  <span className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${cell.isToday ? "bg-indigo-600 font-semibold text-white" : cell.inMonth ? "text-foreground" : "text-muted-foreground"}`}>{cell.dayOfMonth}</span>
                    {cell.items.length > 0 && (
                      <span aria-hidden="true" className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 sm:hidden">{cell.items.length}</span>
                    )}
                  </span>
                  <span className="hidden w-full flex-col gap-0.5 sm:flex">
                    {cell.visible.map(({ item, kind, timeLabel }) => (
                      <span
                        key={item.id}
                        data-kind={kind}
                        title={`${timeLabel} · ${item.title}${kind === "certame" ? ` (${EVENT_TYPE_LABELS[item.eventType] ?? item.eventType})` : ""}`}
                        className={`block truncate rounded px-1 py-0.5 text-[11px] leading-tight ${ITEM_KIND_CLASSES[kind]}`}
                      >
                        {kind === "allDay" ? item.title : `${timeLabel} ${item.title}`}
                      </span>
                    ))}
                    {cell.overflow > 0 && <span className="px-1 text-[11px] font-medium text-muted-foreground">+{cell.overflow}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <ul aria-label="Legenda do calendário" className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {(["allDay", "timed", "certame"] as const).map((kind) => (
          <li key={kind} className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded ${ITEM_KIND_CLASSES[kind]}`} />{ITEM_KIND_LABELS[kind]}</li>
        ))}
      </ul>
    </div>
  );
}
