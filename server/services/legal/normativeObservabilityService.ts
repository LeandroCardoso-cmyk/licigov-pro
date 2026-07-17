/**
 * RC-4.6.1 — Federal Procurement Corpus · Observabilidade (Part 9).
 *
 * Registra eventos da fundação normativa: hierarchyCreated, nodeRegistered, referenceRegistered,
 * graphProjected, queryExecuted. Recuperável por correlationId. Multi-tenant. Determinístico.
 * Retenção simples em memória.
 */

export type NormativeEventType =
  | "hierarchyCreated" | "nodeRegistered" | "referenceRegistered" | "graphProjected" | "queryExecuted";

export interface NormativeEvent {
  readonly correlationId: string;
  readonly tenantId: number;
  readonly type: NormativeEventType;
  /** Identificador estrutural relacionado (nodeId/refId/normId) — nunca conteúdo. */
  readonly subjectId: string;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, NormativeEvent[]>();
const RETENTION = 200;
let _total = 0;

export function recordNormativeEvent(ev: NormativeEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[normative-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, subjectId: ev.subjectId, count: ev.count }));
  } catch { /* noop */ }
}

/** Eventos registrados para um correlationId. */
export function getNormativeEvents(correlationId: string): readonly NormativeEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearNormativeEvents(): void { _byCorrelation.clear(); _total = 0; }
