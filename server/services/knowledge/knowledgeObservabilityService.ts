/**
 * RC-4.5 — Legal Knowledge Foundation · Observabilidade (Part 9).
 *
 * Registra eventos do ciclo de vida do conhecimento jurídico: knowledgeLoaded,
 * knowledgeValidated, projectionGenerated, conflictsDetected, versionResolved, queryExecuted.
 * Recuperável por correlationId. Multi-tenant. Determinístico. Retenção simples em memória.
 */

export type KnowledgeEventType =
  | "knowledgeLoaded" | "knowledgeValidated" | "projectionGenerated"
  | "conflictsDetected" | "versionResolved" | "queryExecuted";

export interface KnowledgeEvent {
  readonly correlationId: string;
  readonly tenantId: number;
  readonly type: KnowledgeEventType;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, KnowledgeEvent[]>();
const RETENTION = 200;
let _total = 0;

export function recordKnowledgeEvent(ev: KnowledgeEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    // retenção simples: descarta a correlação mais antiga.
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[legal-knowledge-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, count: ev.count }));
  } catch { /* noop */ }
}

/** Eventos registrados para um correlationId. */
export function getKnowledgeEvents(correlationId: string): readonly KnowledgeEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearKnowledgeEvents(): void { _byCorrelation.clear(); _total = 0; }
