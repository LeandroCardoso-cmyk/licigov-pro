/**
 * RC-4.5.1 — Institutional Corpus Framework · Observabilidade (Part 11).
 *
 * Registra eventos do ciclo de vida dos corpora: corpusCreated, corpusLoaded, corpusActivated,
 * corpusDeprecated, collectionAdded, collectionRemoved, knowledgeAttached, projectionGenerated.
 * Recuperável por correlationId. Multi-tenant. Determinístico. Retenção simples em memória.
 */

export type CorpusEventType =
  | "corpusCreated" | "corpusLoaded" | "corpusActivated" | "corpusDeprecated"
  | "collectionAdded" | "collectionRemoved" | "knowledgeAttached" | "projectionGenerated";

export interface CorpusEvent {
  readonly correlationId: string;
  readonly tenantId: number;
  readonly type: CorpusEventType;
  /** Identificador estrutural relacionado (corpusId/collectionId/unitId) — nunca conteúdo. */
  readonly subjectId: string;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, CorpusEvent[]>();
const RETENTION = 200;
let _total = 0;

export function recordCorpusEvent(ev: CorpusEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[corpus-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, subjectId: ev.subjectId, count: ev.count }));
  } catch { /* noop */ }
}

/** Eventos registrados para um correlationId. */
export function getCorpusEvents(correlationId: string): readonly CorpusEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearCorpusEvents(): void { _byCorrelation.clear(); _total = 0; }
