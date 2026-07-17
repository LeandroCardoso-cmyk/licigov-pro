/**
 * RC-4.6.2 — Knowledge Binding Framework · Observabilidade (Part 9).
 *
 * Registra eventos dos bindings: bindingCreated, bindingUpdated, bindingVersioned, bindingResolved,
 * bindingQueried. Recuperável por correlationId. Multi-tenant. Determinístico. Retenção em memória.
 */

export type BindingEventType =
  | "bindingCreated" | "bindingUpdated" | "bindingVersioned" | "bindingResolved" | "bindingQueried";

export interface BindingEvent {
  readonly correlationId: string;
  readonly tenantId: number;
  readonly type: BindingEventType;
  /** Identificador estrutural relacionado (bindingId/nodeId/unitId) — nunca conteúdo. */
  readonly subjectId: string;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, BindingEvent[]>();
const RETENTION = 200;
let _total = 0;

export function recordBindingEvent(ev: BindingEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[binding-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, subjectId: ev.subjectId, count: ev.count }));
  } catch { /* noop */ }
}

/** Eventos registrados para um correlationId. */
export function getBindingEvents(correlationId: string): readonly BindingEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearBindingEvents(): void { _byCorrelation.clear(); _total = 0; }
