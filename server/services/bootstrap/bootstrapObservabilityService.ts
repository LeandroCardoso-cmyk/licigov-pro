/**
 * RC-X.2 — Institutional Bootstrap Framework · Observabilidade (Part 9).
 *
 * Registra eventos do bootstrap: bootstrapStarted, bootstrapFinished, bootstrapFailed,
 * stageStarted, stageFinished, dependencyResolved, subsystemLoaded. Recuperável por correlationId.
 * Multi-tenant. Determinístico. Retenção simples em memória.
 */

export type BootstrapEventType =
  | "bootstrapStarted" | "bootstrapFinished" | "bootstrapFailed"
  | "stageStarted" | "stageFinished" | "dependencyResolved" | "subsystemLoaded";

export interface BootstrapEvent {
  readonly correlationId: string;
  readonly tenantId: number;
  readonly type: BootstrapEventType;
  /** Identificador estrutural relacionado (stageId/subsystemId) — nunca conteúdo. */
  readonly subjectId: string;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, BootstrapEvent[]>();
const RETENTION = 200;
let _total = 0;

export function recordBootstrapEvent(ev: BootstrapEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[bootstrap-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, subjectId: ev.subjectId, count: ev.count }));
  } catch { /* noop */ }
}

/** Eventos registrados para um correlationId. */
export function getBootstrapEvents(correlationId: string): readonly BootstrapEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearBootstrapEvents(): void { _byCorrelation.clear(); _total = 0; }
