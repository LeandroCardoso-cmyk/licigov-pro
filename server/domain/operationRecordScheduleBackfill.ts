/**
 * Backfill GENÉRICO e seguro da agenda de registros operacionais JÁ EXISTENTES (puro, determinístico).
 *
 * O dataset (item → data) vem de fonte EXTERNA ao repositório (arquivo local/stdin); nenhum dado real vive
 * no código. Cada entrada é resolvida por uma referência determinística gravada na etapa do registro
 * (ex.: "<PREFIXO> item 12" ou "<PREFIXO> itens 7/8"), casada por TOKEN exato — nunca por posição, ordem
 * ou objeto textual sozinho. Classificação:
 *   MATCH            → registro único, sem agenda: pode ser atualizado;
 *   ALREADY_CORRECT  → agenda já igual à desejada: nenhuma escrita;
 *   CONFLICT         → agenda diferente já existente, objeto divergente, entrada inválida/duplicada;
 *   NOT_FOUND        → nenhum registro com a referência (nunca cria registro);
 *   AMBIGUOUS        → mais de um registro com a referência (nunca escolhe).
 * Somente MATCH é gravado; os demais bloqueiam a entrada e aparecem no relatório.
 */
import { validLocalDate, validLocalTime } from "./operationRecordSchedule";

export type BackfillStatus = "MATCH" | "ALREADY_CORRECT" | "CONFLICT" | "NOT_FOUND" | "AMBIGUOUS";

export interface BackfillRecord {
  id: string;
  number: string;
  object: string;
  currentStage: string;
  eventDate: string;
  eventEndDate: string;
  eventTime: string;
  lifecycleStatus?: string;
}

export interface ScheduleBackfillEntry {
  item: string | number;
  eventDate: string;
  /** Opcional: conferência adicional do objeto (normalizado). Divergência ⇒ CONFLICT. */
  expectedObject?: string;
}

export interface EventBackfillEntry {
  item: string | number;
  eventType: "certame" | "sessao_publica";
  number: string;
  eventDate: string;
  eventTime: string;
}

export interface ScheduleBackfillDataset {
  /** Prefixo da referência gravada na etapa (ex.: um código de cronograma). */
  referencePrefix: string;
  /** Contagem esperada de entradas (conferência cruzada com a fonte). */
  expected?: number;
  schedules: ScheduleBackfillEntry[];
  events?: EventBackfillEntry[];
}

export interface ScheduleBackfillRow {
  item: string;
  status: BackfillStatus;
  reason: string;
  recordId: string | null;
  reference: string | null;
  object: string | null;
  currentSchedule: string;
  desiredSchedule: string;
  action: "update" | "skip" | "blocked";
}

export interface EventBackfillRow {
  item: string;
  number: string;
  status: BackfillStatus;
  reason: string;
  recordId: string | null;
  title: string | null;
  eventType: string;
  eventDate: string;
  eventTime: string;
  action: "create" | "skip" | "blocked";
}

export interface BackfillSummary {
  expected: number;
  MATCH: number;
  ALREADY_CORRECT: number;
  CONFLICT: number;
  NOT_FOUND: number;
  AMBIGUOUS: number;
}

export interface ScheduleBackfillPlan {
  schedules: ScheduleBackfillRow[];
  events: EventBackfillRow[];
  scheduleSummary: BackfillSummary;
  eventSummary: BackfillSummary;
  /** Gate de gravação: nenhuma entrada bloqueada e contagem esperada atendida. */
  canApply: boolean;
  blockers: string[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Número de item canônico ("007" → "7"); inválido ⇒ null. */
export function canonicalItem(value: string | number): string | null {
  const s = String(value).trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  return String(Number(s));
}

/**
 * Referências de item presentes em um texto: "<prefixo> item 12", "<prefixo> itens 7/8" (também "7, 8"
 * ou "7 e 8"). Casamento por token exato (item 4 ≠ item 45). Prefixo comparado sem diferenciar caixa.
 */
export function parseItemReferences(text: string, prefix: string): { items: Set<string>; tokens: string[] } {
  const items = new Set<string>();
  const tokens: string[] = [];
  if (!prefix.trim()) return { items, tokens };
  const re = new RegExp(`${escapeRegex(prefix.trim())}\\s+ite(?:m|ns)\\s+(\\d+(?:\\s*(?:\\/|,|\\be\\b)\\s*\\d+)*)(?!\\d)`, "gi");
  for (const m of text.matchAll(re)) {
    tokens.push(m[0]);
    for (const n of m[1].split(/\s*(?:\/|,|\be\b)\s*/)) {
      const c = canonicalItem(n);
      if (c) items.add(c);
    }
  }
  return { items, tokens };
}

export function normalizeObject(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const scheduleText = (d: string, e: string, t: string) => (d ? `${d}${e ? ` a ${e}` : ""} · ${t || "dia inteiro"}` : "sem data");

function summarize(rows: Array<{ status: BackfillStatus }>, expected: number): BackfillSummary {
  const s: BackfillSummary = { expected, MATCH: 0, ALREADY_CORRECT: 0, CONFLICT: 0, NOT_FOUND: 0, AMBIGUOUS: 0 };
  for (const r of rows) s[r.status] += 1;
  return s;
}

/** Título do evento vinculado — o número (ex.: do certame) fica explícito no título. */
export function eventTitleFor(entry: Pick<EventBackfillEntry, "eventType" | "number">, record: Pick<BackfillRecord, "object" | "number">): string {
  const label = entry.eventType === "certame" ? "Certame" : "Sessão pública";
  return `${label} ${entry.number} — ${record.object || record.number || "registro operacional"}`.slice(0, 500);
}

export interface LinkedEventSnapshot {
  id: string;
  eventType: string;
  title: string;
  eventDate: string;
  eventTime: string;
  referenceId: string;
}

/** Plano completo (agenda base + eventos vinculados). Nunca produz inserção de registro. */
export function planScheduleBackfill(
  dataset: ScheduleBackfillDataset,
  records: readonly BackfillRecord[],
  linkedEvents: readonly LinkedEventSnapshot[] = [],
): ScheduleBackfillPlan {
  const prefix = dataset.referencePrefix ?? "";
  const byItem = new Map<string, Array<{ record: BackfillRecord; token: string }>>();
  for (const record of records) {
    const { items, tokens } = parseItemReferences(record.currentStage ?? "", prefix);
    for (const item of items) {
      if (!byItem.has(item)) byItem.set(item, []);
      byItem.get(item)!.push({ record, token: tokens.join(" ") });
    }
  }

  const resolve = (item: string) => byItem.get(item) ?? [];

  // Entradas repetidas (mesmo item) ou dois itens apontando para o mesmo registro ⇒ CONFLICT (fail closed).
  const itemCount = new Map<string, number>();
  for (const e of dataset.schedules) { const c = canonicalItem(e.item); if (c) itemCount.set(c, (itemCount.get(c) ?? 0) + 1); }
  const recordTargets = new Map<string, number>();
  for (const e of dataset.schedules) {
    const c = canonicalItem(e.item);
    const cands = c ? resolve(c) : [];
    if (cands.length === 1) recordTargets.set(cands[0].record.id, (recordTargets.get(cands[0].record.id) ?? 0) + 1);
  }

  const schedules: ScheduleBackfillRow[] = dataset.schedules.map((entry) => {
    const item = canonicalItem(entry.item) ?? String(entry.item);
    const desired = scheduleText(entry.eventDate, "", "");
    const blocked = (status: BackfillStatus, reason: string, rec?: { record: BackfillRecord; token: string }): ScheduleBackfillRow => ({
      item, status, reason, recordId: rec?.record.id ?? null, reference: rec?.token ?? null, object: rec?.record.object ?? null,
      currentSchedule: rec ? scheduleText(rec.record.eventDate, rec.record.eventEndDate, rec.record.eventTime) : "—",
      desiredSchedule: desired, action: status === "ALREADY_CORRECT" ? "skip" : status === "MATCH" ? "update" : "blocked",
    });
    if (!canonicalItem(entry.item)) return blocked("CONFLICT", "INVALID_ITEM");
    if (!validLocalDate(entry.eventDate)) return blocked("CONFLICT", "INVALID_DATE");
    if ((itemCount.get(item) ?? 0) > 1) return blocked("CONFLICT", "DUPLICATE_ENTRY");
    const cands = resolve(item);
    if (cands.length === 0) return blocked("NOT_FOUND", "NO_RECORD_WITH_REFERENCE");
    if (cands.length > 1) return { ...blocked("AMBIGUOUS", `MULTIPLE_RECORDS:${cands.map((c) => c.record.id).join(",")}`), recordId: null };
    const [c] = cands;
    if ((recordTargets.get(c.record.id) ?? 0) > 1) return blocked("CONFLICT", "RECORD_TARGETED_BY_MULTIPLE_ENTRIES", c);
    if (entry.expectedObject && normalizeObject(entry.expectedObject) !== normalizeObject(c.record.object)) {
      return blocked("CONFLICT", "OBJECT_MISMATCH", c);
    }
    const r = c.record;
    if (r.eventDate === entry.eventDate && !r.eventEndDate && !r.eventTime) return blocked("ALREADY_CORRECT", "SCHEDULE_ALREADY_SET", c);
    if (!r.eventDate && !r.eventEndDate && !r.eventTime) return blocked("MATCH", "EMPTY_SCHEDULE", c);
    return blocked("CONFLICT", "EXISTING_SCHEDULE_DIFFERS", c);
  });

  const events: EventBackfillRow[] = (dataset.events ?? []).map((entry) => {
    const item = canonicalItem(entry.item) ?? String(entry.item);
    const base = { item, number: entry.number, eventType: entry.eventType, eventDate: entry.eventDate, eventTime: entry.eventTime };
    const row = (status: BackfillStatus, reason: string, recordId: string | null, title: string | null): EventBackfillRow => ({
      ...base, status, reason, recordId, title, action: status === "MATCH" ? "create" : status === "ALREADY_CORRECT" ? "skip" : "blocked",
    });
    if (!canonicalItem(entry.item) || !entry.number.trim()) return row("CONFLICT", "INVALID_ENTRY", null, null);
    if (!validLocalDate(entry.eventDate) || (entry.eventTime && !validLocalTime(entry.eventTime))) return row("CONFLICT", "INVALID_DATE_OR_TIME", null, null);
    const cands = resolve(item);
    if (cands.length === 0) return row("NOT_FOUND", "NO_RECORD_WITH_REFERENCE", null, null);
    if (cands.length > 1) return row("AMBIGUOUS", `MULTIPLE_RECORDS:${cands.map((c) => c.record.id).join(",")}`, null, null);
    const record = cands[0].record;
    const title = eventTitleFor(entry, record);
    const mine = linkedEvents.filter((e) => e.referenceId === record.id && e.eventType === entry.eventType);
    const sameDay = mine.filter((e) => e.eventDate === entry.eventDate);
    const hasNumber = (e: LinkedEventSnapshot) => e.title.includes(entry.number);
    if (sameDay.some((e) => e.eventTime === entry.eventTime && hasNumber(e))) return row("ALREADY_CORRECT", "EQUIVALENT_EVENT_EXISTS", record.id, title);
    if (sameDay.length > 0) return row("CONFLICT", "DIFFERENT_EVENT_SAME_TYPE_AND_DATE", record.id, title);
    if (mine.some(hasNumber)) return row("CONFLICT", "SAME_NUMBER_ON_OTHER_DATE", record.id, title);
    return row("MATCH", "NO_EQUIVALENT_EVENT", record.id, title);
  });

  const scheduleSummary = summarize(schedules, dataset.expected ?? dataset.schedules.length);
  const eventSummary = summarize(events, events.length);
  const blockers: string[] = [];
  for (const [name, s] of [["agenda", scheduleSummary], ["eventos", eventSummary]] as const) {
    const blockedCount = s.CONFLICT + s.NOT_FOUND + s.AMBIGUOUS;
    if (blockedCount > 0) blockers.push(`${name}: ${blockedCount} entrada(s) bloqueada(s)`);
  }
  if (scheduleSummary.MATCH + scheduleSummary.ALREADY_CORRECT !== scheduleSummary.expected) {
    blockers.push(`agenda: MATCH + ALREADY_CORRECT (${scheduleSummary.MATCH + scheduleSummary.ALREADY_CORRECT}) ≠ esperado (${scheduleSummary.expected})`);
  }
  if (dataset.schedules.length !== scheduleSummary.expected) {
    blockers.push(`agenda: ${dataset.schedules.length} entrada(s) no arquivo ≠ esperado (${scheduleSummary.expected})`);
  }
  return { schedules, events, scheduleSummary, eventSummary, canApply: blockers.length === 0, blockers };
}

/** Validação estrutural do dataset externo (sem confiar no arquivo). */
export function parseScheduleBackfillDataset(raw: unknown): ScheduleBackfillDataset {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Dataset inválido: objeto esperado.");
  const d = raw as Record<string, unknown>;
  if (typeof d.referencePrefix !== "string" || !d.referencePrefix.trim()) throw new Error("Dataset inválido: referencePrefix obrigatório.");
  if (!Array.isArray(d.schedules)) throw new Error("Dataset inválido: schedules deve ser uma lista.");
  const schedules = d.schedules.map((s, i) => {
    const e = s as Record<string, unknown>;
    if ((typeof e.item !== "string" && typeof e.item !== "number") || typeof e.eventDate !== "string") throw new Error(`Dataset inválido: schedules[${i}].`);
    return { item: e.item, eventDate: e.eventDate, ...(typeof e.expectedObject === "string" ? { expectedObject: e.expectedObject } : {}) };
  });
  const events = Array.isArray(d.events) ? d.events.map((s, i) => {
    const e = s as Record<string, unknown>;
    if ((typeof e.item !== "string" && typeof e.item !== "number") || (e.eventType !== "certame" && e.eventType !== "sessao_publica")
      || typeof e.number !== "string" || typeof e.eventDate !== "string" || typeof (e.eventTime ?? "") !== "string") {
      throw new Error(`Dataset inválido: events[${i}].`);
    }
    return { item: e.item, eventType: e.eventType as EventBackfillEntry["eventType"], number: e.number, eventDate: e.eventDate, eventTime: (e.eventTime as string) ?? "" };
  }) : [];
  const expected = typeof d.expected === "number" && Number.isInteger(d.expected) ? d.expected : undefined;
  return { referencePrefix: d.referencePrefix, expected, schedules, events };
}
