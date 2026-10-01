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

/**
 * Cor com significado (v1.1): neutro azul-acinzentado = agenda de dia inteiro; azul = compromisso
 * com horário; violeta = certame/sessão (destaque superior, com filete à esquerda). Sem verde,
 * amarelo ou vermelho — reservados a sucesso/alerta/erro no restante do sistema.
 */
export const ITEM_KIND_CLASSES: Record<CalendarItemKind, string> = {
  allDay: "border border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
  timed: "border border-blue-300 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100",
  certame: "border border-l-[3px] border-violet-400 bg-violet-100 font-semibold text-violet-950 dark:border-violet-500 dark:bg-violet-900 dark:text-violet-50",
};

/** Hover discreto no item: só realça fundo/borda (o clique continua selecionando o dia). */
export const ITEM_KIND_HOVER_CLASSES: Record<CalendarItemKind, string> = {
  allDay: "hover:border-slate-400 hover:bg-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700",
  timed: "hover:border-blue-400 hover:bg-blue-200 dark:hover:border-blue-600 dark:hover:bg-blue-900",
  certame: "hover:border-violet-500 hover:bg-violet-200 dark:hover:border-violet-400 dark:hover:bg-violet-800",
};

/** Texto do tooltip nativo: título completo primeiro (é o que a célula trunca), depois o horário. */
export function itemTooltip(item: OperationalCalendarItem, kind: CalendarItemKind, timeLabel: string): string {
  const type = kind === "certame" ? ` · ${EVENT_TYPE_LABELS[item.eventType] ?? item.eventType}` : "";
  return `${item.title} — ${timeLabel}${type}`;
}

export const ITEM_KIND_LABELS: Record<CalendarItemKind, string> = {
  allDay: "Dia inteiro", timed: "Com horário", certame: "Certame / sessão",
};

function cellClasses(cell: { inMonth: boolean; isSelected: boolean }): string {
  const base = "flex min-h-[3.25rem] min-w-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-b border-r border-border p-1 text-left align-top transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:min-h-[6.5rem]";
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
                        title={itemTooltip(item, kind, timeLabel)}
                        className={`block truncate rounded px-1 py-0.5 text-[11px] leading-tight transition-colors ${ITEM_KIND_CLASSES[kind]} ${ITEM_KIND_HOVER_CLASSES[kind]}`}
                      >
                        {kind !== "allDay" && <span className="mr-1 font-semibold tabular-nums">{timeLabel}</span>}
                        {item.title}
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
      <ul aria-label="Legenda do calendário" className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-foreground/80">
        {(["allDay", "timed", "certame"] as const).map((kind) => (
          <li key={kind} className="flex items-center gap-1.5"><span aria-hidden="true" data-legend={kind} className={`inline-block h-3 w-4 rounded-sm ${ITEM_KIND_CLASSES[kind]}`} />{ITEM_KIND_LABELS[kind]}</li>
        ))}
      </ul>
    </div>
  );
}
