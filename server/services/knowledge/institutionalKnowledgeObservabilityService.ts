/**
 * RC-4.7 — Institutional Knowledge Framework · Observabilidade (Part 9).
 *
 * Registra eventos do ciclo de vida do conhecimento: knowledgeCreated, knowledgeReviewed,
 * knowledgeApproved, knowledgePublished, knowledgeUpdated, knowledgeDeprecated, knowledgeQueried,
 * knowledgeRendered. Recuperável por correlationId. Multi-tenant. Determinístico. Retenção em memória.
 */

export type InstitutionalKnowledgeEventType =
  | "knowledgeCreated" | "knowledgeReviewed" | "knowledgeApproved" | "knowledgePublished"
  | "knowledgeUpdated" | "knowledgeDeprecated" | "knowledgeQueried" | "knowledgeRendered";

export interface InstitutionalKnowledgeEvent {
  readonly correlationId: string;
  readonly tenantId: number;
  readonly type: InstitutionalKnowledgeEventType;
  /** Identificador estrutural relacionado (docId/docKey) — nunca conteúdo. */
  readonly subjectId: string;
  readonly detail: string;
  readonly count: number;
}

const _byCorrelation = new Map<string, InstitutionalKnowledgeEvent[]>();
const RETENTION = 200;
let _total = 0;

export function recordInstitutionalKnowledgeEvent(ev: InstitutionalKnowledgeEvent): void {
  const arr = _byCorrelation.get(ev.correlationId) ?? [];
  arr.push(ev);
  _byCorrelation.set(ev.correlationId, arr);
  _total += 1;
  if (_total > RETENTION) {
    const firstKey = _byCorrelation.keys().next().value;
    if (firstKey !== undefined) { _total -= (_byCorrelation.get(firstKey)?.length ?? 0); _byCorrelation.delete(firstKey); }
  }
  try {
    console.info("[institutional-knowledge-observability]", JSON.stringify({ correlationId: ev.correlationId, tenant: ev.tenantId, type: ev.type, subjectId: ev.subjectId, count: ev.count }));
  } catch { /* noop */ }
}

export function getInstitutionalKnowledgeEvents(correlationId: string): readonly InstitutionalKnowledgeEvent[] {
  return _byCorrelation.get(correlationId) ?? [];
}

export function clearInstitutionalKnowledgeEvents(): void { _byCorrelation.clear(); _total = 0; }
