/**
 * Kernel — Request Timeline (append-only)
 *
 * Registra cada evento do ciclo de vida de uma solicitação institucional:
 * criação, encaminhamento, recebimento, aceite, devolução, resposta, assinatura.
 * Auditável e determinístico (replay via snapshot).
 */

import { createHash } from "crypto";

export type RequestEventType =
  | "created"
  | "forwarded"
  | "received"
  | "accepted"
  | "in_progress"
  | "waiting_information"
  | "returned"
  | "responded"
  | "signed"
  | "archived";

export interface RequestTimelineEntry {
  readonly id: string;
  readonly requestId: string;
  readonly organizationId: number;
  readonly order: number;
  readonly eventType: RequestEventType;
  readonly actor: string;
  readonly summary: string;
  readonly refId: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createRequestTimelineEntry(params: {
  requestId: string;
  organizationId: number;
  order: number;
  eventType: RequestEventType;
  actor: string;
  summary: string;
  refId?: string;
  correlationId: string;
  createdAt?: string;
  /** F1 — chave determinística opcional (eventos de ciclo de vida do recebimento): o id deixa de depender da ordem ⇒ a
   *  inserção é idempotente (PK + ON DUPLICATE KEY) mesmo com execuções concorrentes. Ausente ⇒ id inalterado (por ordem). */
  idKey?: string;
}): RequestTimelineEntry {
  const id = createHash("sha256")
    .update(`rtl:${params.organizationId}:${params.requestId}:${params.idKey ?? params.order}:${params.eventType}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    requestId: params.requestId,
    organizationId: params.organizationId,
    order: params.order,
    eventType: params.eventType,
    actor: params.actor,
    summary: params.summary,
    refId: params.refId ?? "",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

export function appendRequestTimeline(
  entries: readonly RequestTimelineEntry[],
  params: {
    requestId: string;
    organizationId: number;
    eventType: RequestEventType;
    actor: string;
    summary: string;
    refId?: string;
    correlationId: string;
    createdAt?: string;
  },
): RequestTimelineEntry[] {
  const entry = createRequestTimelineEntry({ ...params, order: entries.length });
  return [...entries, entry];
}

/** Snapshot determinístico para replay/auditoria. */
export function requestTimelineSnapshot(entries: readonly RequestTimelineEntry[]): string {
  const canonical = entries.map(e => `${e.order}:${e.eventType}:${e.actor}:${e.refId}`);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}
