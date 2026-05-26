import { eq, and, lte, isNull, or } from "drizzle-orm";
import { getDb } from "../db/connection";
import { outboxEvents, outboxDeadLetters } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("OutboxService");
const MAX_ATTEMPTS = 5;

export type TenantContext = {
  orgName?: string;
  orgSlug?: string;
};

export type OutboxEventPayload = {
  organizationId?: number;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  correlationId?: string;
  requestId?: string;
  // Sprint 1.5 — Envelope v2: actor + tenant propagados até o dispatcher
  actorId?: number;
  actorName?: string;
  tenantContext?: TenantContext;
  payload: Record<string, unknown>;
  scheduledAfter?: Date;
};

/**
 * Adiciona evento ao outbox transacional.
 * Deve ser chamado dentro da mesma transação que modifica o agregado.
 */
export async function appendOutboxEvent(
  event: OutboxEventPayload,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txDb?: any,
): Promise<void> {
  const db = txDb ?? await getDb();
  if (!db) {
    log.error("db_unavailable", { eventType: event.eventType });
    return;
  }

  await db.insert(outboxEvents).values({
    id: crypto.randomUUID(),
    organizationId: event.organizationId ?? null,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    correlationId: event.correlationId ?? null,
    requestId: event.requestId ?? null,
    actorId: event.actorId ?? null,
    actorName: event.actorName ?? null,
    tenantContext: event.tenantContext ?? null,
    payload: event.payload,
    status: "pending",
    attempts: 0,
    scheduledAfter: event.scheduledAfter ?? null,
  });

  log.debug("event_appended", {
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    organizationId: event.organizationId,
    correlationId: event.correlationId,
  });
}

/**
 * Busca próximos eventos pendentes para o dispatcher processar.
 * Pessimistic lock via lockedBy + lockedUntil para evitar duplo processamento.
 */
export async function claimPendingEvents(
  workerId: string,
  batchSize = 10,
): Promise<typeof outboxEvents.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();
  const lockUntil = new Date(now.getTime() + 60_000);

  const rows = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "pending"),
        or(isNull(outboxEvents.scheduledAfter), lte(outboxEvents.scheduledAfter, now)),
        or(isNull(outboxEvents.lockedUntil), lte(outboxEvents.lockedUntil, now)),
      ),
    )
    .limit(batchSize);

  if (rows.length === 0) return [];

  for (const row of rows) {
    await db
      .update(outboxEvents)
      .set({ status: "processing", lockedBy: workerId, lockedUntil: lockUntil })
      .where(and(eq(outboxEvents.id, row.id), eq(outboxEvents.status, "pending")));
  }

  log.debug("events_claimed", { workerId, count: rows.length });
  return rows;
}

/**
 * Marca evento como entregue com sucesso.
 */
export async function markDelivered(eventId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(outboxEvents)
    .set({ status: "delivered", processedAt: new Date(), lockedBy: null, lockedUntil: null })
    .where(eq(outboxEvents.id, eventId));
}

/**
 * Registra falha de entrega.
 * Aplica backoff exponencial. Após MAX_ATTEMPTS, move para DLQ.
 */
export async function markFailed(eventId: string, error: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const rows = await db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.id, eventId))
    .limit(1);

  if (rows.length === 0) return;

  const event = rows[0];
  const newAttempts = event.attempts + 1;

  if (newAttempts >= MAX_ATTEMPTS) {
    await db.insert(outboxDeadLetters).values({
      id: crypto.randomUUID(),
      organizationId: event.organizationId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      correlationId: event.correlationId,
      payload: event.payload as Record<string, unknown>,
      attempts: newAttempts,
      lastError: error,
    });

    await db
      .update(outboxEvents)
      .set({ status: "failed", attempts: newAttempts, lastError: error, lockedBy: null })
      .where(eq(outboxEvents.id, eventId));

    log.warn("event_moved_to_dlq", { eventId, eventType: event.eventType, attempts: newAttempts });
  } else {
    const backoffSec = Math.pow(2, newAttempts);
    const scheduledAfter = new Date(Date.now() + backoffSec * 1000);

    await db
      .update(outboxEvents)
      .set({
        status: "pending",
        attempts: newAttempts,
        lastError: error,
        lockedBy: null,
        lockedUntil: null,
        scheduledAfter,
      })
      .where(eq(outboxEvents.id, eventId));

    log.info("event_retry_scheduled", { eventId, attempt: newAttempts, backoffSec });
  }
}
