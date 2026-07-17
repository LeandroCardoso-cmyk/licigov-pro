/**
 * RC-X.1 — Institutional Experience Framework · Observabilidade (Part 11).
 *
 * Registra eventos da experiência: contextLoaded, workspaceRegistered, workspaceActivated,
 * navigationGenerated, homeGenerated, capabilityResolved, copilotOpened. Recuperável por
 * correlationId. Multi-tenant. Determinístico. Retenção simples em memória.
 */

export type ExperienceEventType =
  | "contextLoaded" | "workspaceRegistered" | "workspaceActivated" | "navigationGenerated"
  | "homeGenerated" | "capabilityResolved" | "copilotOpened";

export interface ExperienceEvent {
  readonly correlationId: string;
  readonly tenantId: number;
  readonly type: ExperienceEventType;
  /** Identificador estrutural relacionado (workspaceId/capabilityId/...) — nunca conteúdo. */
  readonly subjectId: string;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, ExperienceEvent[]>();
const RETENTION = 200;
let _total = 0;

export function recordExperienceEvent(ev: ExperienceEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[experience-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, subjectId: ev.subjectId, count: ev.count }));
  } catch { /* noop */ }
}

/** Eventos registrados para um correlationId. */
export function getExperienceEvents(correlationId: string): readonly ExperienceEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearExperienceEvents(): void { _byCorrelation.clear(); _total = 0; }
