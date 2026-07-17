/**
 * RC-4.9 — Official Knowledge Corpus · Observabilidade (Fase 9).
 *
 * Registra eventos da incorporação de conhecimento oficial: corpusCreated, documentPublished,
 * newVersion, updated, rollback. Recuperável por correlationId. Multi-tenant. Determinístico.
 */

export type OfficialCorpusEventType =
  | "corpusCreated" | "documentPublished" | "newVersion" | "updated" | "rollback";

export interface OfficialCorpusEvent {
  readonly correlationId: string;
  readonly tenantId: number | null;
  readonly type: OfficialCorpusEventType;
  /** Identificador estrutural (corpusId/documentId/normId) — nunca conteúdo jurídico. */
  readonly subjectId: string;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, OfficialCorpusEvent[]>();
const RETENTION = 300;
let _total = 0;

export function recordOfficialCorpusEvent(ev: OfficialCorpusEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[official-corpus-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, subjectId: ev.subjectId, count: ev.count }));
  } catch { /* noop */ }
}

export function getOfficialCorpusEvents(correlationId: string): readonly OfficialCorpusEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearOfficialCorpusEvents(): void { _byCorrelation.clear(); _total = 0; }
