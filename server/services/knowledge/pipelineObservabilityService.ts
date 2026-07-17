/**
 * RC-4.8 — Institutional Knowledge Pipeline · Observabilidade (Fase 9).
 *
 * Registra eventos do pipeline: pipelineStarted, stageStarted, stageFinished, validationFailed,
 * publicationStarted, publicationFinished, rollback, upgrade. Recuperável por correlationId.
 * Multi-tenant. Determinístico. Retenção simples em memória.
 */

export type PipelineEventType =
  | "pipelineStarted" | "stageStarted" | "stageFinished" | "validationFailed"
  | "publicationStarted" | "publicationFinished" | "rollback" | "upgrade";

export interface PipelineEvent {
  readonly correlationId: string;
  readonly tenantId: number;
  readonly type: PipelineEventType;
  /** Identificador estrutural relacionado (executionId/stageId/snapshotId) — nunca conteúdo. */
  readonly subjectId: string;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, PipelineEvent[]>();
const RETENTION = 200;
let _total = 0;

export function recordPipelineEvent(ev: PipelineEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[pipeline-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, subjectId: ev.subjectId, count: ev.count }));
  } catch { /* noop */ }
}

export function getPipelineEvents(correlationId: string): readonly PipelineEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearPipelineEvents(): void { _byCorrelation.clear(); _total = 0; }
