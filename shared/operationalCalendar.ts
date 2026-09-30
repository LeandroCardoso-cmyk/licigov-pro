/**
 * Calendário Operacional Visual v1 — domínio PURO (sem React, sem I/O, determinístico).
 *
 * Transforma os itens que `departmentOperation.calendar` JÁ devolve (eventos operacionais +
 * agenda base dos registros ativos) em:
 *  - uma grade mensal real (semanas completas, domingo → sábado);
 *  - a lista operacional agrupada por dia (mês inteiro ou dia selecionado).
 *
 * Nenhuma regra de negócio nova: quem decide o que entra no calendário (tenant, registros
 * concluídos fora, eventos vinculados) continua sendo o serviço. Aqui só há apresentação.
 * Datas são strings locais `AAAA-MM-DD` (fuso da organização já aplicado na origem); toda a
 * aritmética é feita em UTC sobre essas strings — sem depender do fuso do navegador.
 */

export interface OperationalCalendarItem {
  readonly id: string;
  readonly eventType: string;
  readonly title: string;
  readonly eventDate: string;
  readonly eventEndDate: string;
  readonly eventTime: string;
  readonly referenceType: string;
  readonly referenceId: string | null;
}

/** Diferenciação visual mínima exigida pela v1. */
export type CalendarItemKind = "certame" | "timed" | "allDay";

/** Sessão de disputa (certame / sessão pública) tem destaque próprio, com ou sem horário. */
const CERTAME_TYPES = new Set(["certame", "sessao_publica"]);

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
export const DEFAULT_MAX_VISIBLE_PER_DAY = 3;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `AAAA-MM` do mês de uma data. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Desloca um mês `AAAA-MM` em N meses. */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function monthBounds(month: string): { first: string; last: string } {
  if (!ISO_MONTH.test(month)) throw new Error(`Mês inválido: ${month}`);
  const [year, m] = month.split("-").map(Number);
  return {
    first: `${month}-01`,
    last: new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10),
  };
}

/** Janela visível da grade: do domingo da 1ª semana ao sábado da última (5 ou 6 semanas). */
export function monthGridRange(month: string): { from: string; to: string; weekCount: number } {
  const { first, last } = monthBounds(month);
  const from = addDays(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
  const to = addDays(last, 6 - new Date(`${last}T00:00:00Z`).getUTCDay());
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from, to, weekCount: days / 7 };
}

/** "outubro de 2026" (pt-BR), independente do fuso do navegador. */
export function monthLabel(month: string): string {
  const { first } = monthBounds(month);
  return new Date(`${first}T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function classifyCalendarItem(item: Pick<OperationalCalendarItem, "eventType" | "eventTime">): CalendarItemKind {
  if (CERTAME_TYPES.has(item.eventType)) return "certame";
  return item.eventTime ? "timed" : "allDay";
}

/** Último dia ocupado pelo item (agenda de registro pode ter data final). */
export function itemLastDate(item: Pick<OperationalCalendarItem, "eventDate" | "eventEndDate">): string {
  return item.eventEndDate && item.eventEndDate > item.eventDate ? item.eventEndDate : item.eventDate;
}

/**
 * Interseção do período do item com a janela `[from, to]` (datas `AAAA-MM-DD`), ou `null` quando
 * não há dia em comum. A projeção percorre só essa interseção: o custo fica limitado à janela
 * recebida (a grade mensal tem no máximo 42 dias), qualquer que seja a duração do item.
 */
export function visibleSpan(
  item: Pick<OperationalCalendarItem, "eventDate" | "eventEndDate">, from: string, to: string,
): { first: string; last: string } | null {
  if (!isIsoDate(item.eventDate)) return null;
  const lastOfItem = itemLastDate(item);
  const first = item.eventDate < from ? from : item.eventDate;
  const last = lastOfItem > to ? to : lastOfItem;
  return first <= last ? { first, last } : null;
}

export function occursOn(item: Pick<OperationalCalendarItem, "eventDate" | "eventEndDate">, day: string): boolean {
  return isIsoDate(item.eventDate) && item.eventDate <= day && itemLastDate(item) >= day;
}

/**
 * Rótulo de horário por dia — mesma regra da lista existente:
 * sem horário ⇒ "Dia inteiro"; com horário ⇒ o horário no 1º dia e "Em andamento" nos seguintes.
 */
export function timeLabelFor(item: Pick<OperationalCalendarItem, "eventDate" | "eventTime">, day: string): string {
  if (!item.eventTime) return "Dia inteiro";
  return day === item.eventDate ? item.eventTime : "Em andamento";
}

/** Ordem estável dentro do dia: dia inteiro primeiro, depois por horário, título e id. */
function compareWithinDay(a: OperationalCalendarItem, b: OperationalCalendarItem): number {
  const ta = a.eventTime || "";
  const tb = b.eventTime || "";
  if (!ta !== !tb) return ta ? 1 : -1;
  return ta.localeCompare(tb) || a.title.localeCompare(b.title, "pt-BR") || a.id.localeCompare(b.id);
}

/** Remove repetições pelo id (a fonte já é única; isto só impede duplicação visual). */
function uniqueById<T extends OperationalCalendarItem>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/**
 * Agrupa os itens por dia dentro de [from, to] (itens com período aparecem em cada dia visível).
 * Cada item percorre apenas `visibleSpan` — nunca além da janela recebida.
 */
export function groupItemsByDay<T extends OperationalCalendarItem>(items: readonly T[], from: string, to: string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const item of uniqueById(items)) {
    const span = visibleSpan(item, from, to);
    if (!span) continue;
    for (let day = span.first; day <= span.last; day = addDays(day, 1)) {
      const bucket = map.get(day);
      if (bucket) bucket.push(item); else map.set(day, [item]);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, dayItems]) => [day, [...dayItems].sort(compareWithinDay)]);
}

export interface CalendarDayItem<T extends OperationalCalendarItem = OperationalCalendarItem> {
  readonly item: T;
  readonly kind: CalendarItemKind;
  readonly timeLabel: string;
}

export interface MonthGridCell<T extends OperationalCalendarItem = OperationalCalendarItem> {
  readonly date: string;
  readonly dayOfMonth: number;
  readonly inMonth: boolean;
  readonly isToday: boolean;
  readonly isSelected: boolean;
  readonly items: ReadonlyArray<CalendarDayItem<T>>;
  readonly visible: ReadonlyArray<CalendarDayItem<T>>;
  readonly overflow: number;
}

export interface MonthGrid<T extends OperationalCalendarItem = OperationalCalendarItem> {
  readonly month: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly weeks: ReadonlyArray<ReadonlyArray<MonthGridCell<T>>>;
}

export function buildMonthGrid<T extends OperationalCalendarItem>(params: {
  month: string;
  items: readonly T[];
  today: string;
  selectedDate?: string | null;
  maxVisiblePerDay?: number;
}): MonthGrid<T> {
  const { from, to, weekCount } = monthGridRange(params.month);
  const maxVisible = Math.max(1, params.maxVisiblePerDay ?? DEFAULT_MAX_VISIBLE_PER_DAY);
  const byDay = new Map(groupItemsByDay(params.items, from, to));
  const weeks: MonthGridCell<T>[][] = [];
  for (let w = 0; w < weekCount; w++) {
    const week: MonthGridCell<T>[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(from, w * 7 + d);
      const items = (byDay.get(date) ?? []).map((item) => ({ item, kind: classifyCalendarItem(item), timeLabel: timeLabelFor(item, date) }));
      // Com excedente, o próprio indicador "+N" ocupa uma linha — nunca passa do limite visual.
      const visible = items.length > maxVisible ? items.slice(0, maxVisible - 1) : items;
      week.push({
        date,
        dayOfMonth: Number(date.slice(8, 10)),
        inMonth: monthOf(date) === params.month,
        isToday: date === params.today,
        isSelected: Boolean(params.selectedDate) && date === params.selectedDate,
        items,
        visible,
        overflow: items.length - visible.length,
      });
    }
    weeks.push(week);
  }
  return { month: params.month, label: monthLabel(params.month), from, to, weeks };
}

/**
 * Lista inferior: com um dia selecionado, só aquele dia; sem seleção, o mês inteiro
 * (dias de meses vizinhos visíveis na grade não entram na lista).
 */
export function listForMonthSelection<T extends OperationalCalendarItem>(items: readonly T[], month: string, selectedDate: string | null): Array<[string, T[]]> {
  if (selectedDate) return groupItemsByDay(items, selectedDate, selectedDate);
  const { first, last } = monthBounds(month);
  return groupItemsByDay(items, first, last);
}

// ── Navegação (redutor puro, compartilhado pela UI e pelos testes) ──────────────────────────

export interface MonthNavigationState {
  readonly month: string;
  readonly selectedDate: string | null;
}

export type MonthNavigationAction =
  | { type: "previous" }
  | { type: "next" }
  | { type: "today"; today: string }
  | { type: "select"; date: string }
  | { type: "clearSelection" }
  | { type: "goTo"; date: string };

export function monthNavigationReducer(state: MonthNavigationState, action: MonthNavigationAction): MonthNavigationState {
  switch (action.type) {
    case "previous": return { month: shiftMonth(state.month, -1), selectedDate: null };
    case "next": return { month: shiftMonth(state.month, 1), selectedDate: null };
    case "today": return { month: monthOf(action.today), selectedDate: action.today };
    case "clearSelection": return { ...state, selectedDate: null };
    case "select":
      if (!isIsoDate(action.date)) return state;
      // Clicar de novo no dia selecionado volta para o mês inteiro; dia de mês vizinho navega até ele.
      if (action.date === state.selectedDate) return { ...state, selectedDate: null };
      return { month: monthOf(action.date), selectedDate: action.date };
    case "goTo":
      return isIsoDate(action.date) ? { month: monthOf(action.date), selectedDate: action.date } : state;
    default: return state;
  }
}
