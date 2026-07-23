/**
 * RC-5.0 — Institutional Knowledge Integration Layer · Observabilidade.
 *
 * Persiste (em memória) eventos da integração: contextResolution, knowledgeRetrieval,
 * documentsLoaded, documentsIgnored, retrievalTime, correlationId, replayId, tenant, businessDomain,
 * taskType. Recuperável por correlationId. Multi-tenant. Determinístico.
 */

export type IntegrationEventType =
  | "contextResolution" | "knowledgeRetrieval" | "documentsLoaded" | "documentsIgnored" | "contextPackageBuilt"
  // SOURCE-SCOPE-ROUTER-001 — decisão de escopo documental e eventual ampliação (auditável por correlationId).
  | "sourceScope" | "sourceScopeExpansion";

export interface IntegrationEvent {
  readonly correlationId: string;
  readonly replayId: string;
  readonly tenantId: number | null;
  readonly businessDomain: string | null;
  readonly taskType: string;
  readonly type: IntegrationEventType;
  readonly detail: string;
  readonly count: number;
  /** Latência declarativa (ms) — fora do replayHash. */
  readonly retrievalTimeMs: number;
}

const _byCorrelation = new Map<string, IntegrationEvent[]>();
const RETENTION = 300;
let _total = 0;

export function recordIntegrationEvent(ev: IntegrationEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[institutional-integration-observability]", JSON.stringify({ correlationId: ev.correlationId, replayId: ev.replayId, tenant: ev.tenantId, domain: ev.businessDomain, task: ev.taskType, type: ev.type, count: ev.count }));
  } catch { /* noop */ }
}

export function getIntegrationEvents(correlationId: string): readonly IntegrationEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearIntegrationEvents(): void { _byCorrelation.clear(); _total = 0; }
