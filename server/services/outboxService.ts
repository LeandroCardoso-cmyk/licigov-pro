import { getDb } from "../db/connection";
import { outboxEvents, outboxDeadLetters } from "../../drizzle/schema";
import { eq, and, lte, isNull, or } from "drizzle-orm";

const MAX_ATTEMPTS = 5;

export type OutboxEventPayload = {
  organizationId?: number;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  correlationId?: string;
  requestId?: string;
  payload: Record<string, unknown>;
  scheduledAfter?: Date;
};

/**
 * Adiciona um evento ao outbox transacional.
 * Deve ser chamado dentro da mesma transação que modifica o agregado.
 *
 * Se uma instância de db transacional for fornecida, usa ela.
 * Caso contrário, usa conexão avulsa (aceitável para eventos não-críticos).
 */
export async function appendOutboxEvent(
  event: OutboxEventPayload,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txDb?: any,
): Promise<void> {
  const db = txDb ?? await getDb();
  if (!db) {
    console.error("[Outbox] DB indisponível — evento não registrado:", event.eventType);
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
    payload: event.payload,
    status: "pending",
    attempts: 0,
    scheduledAfter: event.scheduledAfter ?? null,
  });
}

/**
 * Busca próximos eventos pendentes para o dispatcher processar.
 * Utiliza pessimistic lock (lockedBy + lockedUntil) para evitar duplo processamento.
 */
export async function claimPendingEvents(
  workerId: string,
  batchSize = 10,
): Promise<typeof outboxEvents.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();
  const lockUntil = new Date(now.getTime() + 60_000); // lock por 60s

  const rows = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "pending"),
        or(
          isNull(outboxEvents.scheduledAfter),
          lte(outboxEvents.scheduledAfter, now),
        ),
        or(
          isNull(outboxEvents.lockedUntil),
          lte(outboxEvents.lockedUntil, now),
        ),
      ),
    )
    .limit(batchSize);

  if (rows.length === 0) return [];

  const ids = rows.map(r => r.id);

  // Lock atômico (sem FOR UPDATE aqui — Railway MySQL pode não suportar bem em drizzle)
  for (const id of ids) {
    await db
      .update(outboxEvents)
      .set({ status: "processing", lockedBy: workerId, lockedUntil: lockUntil })
      .where(and(eq(outboxEvents.id, id), eq(outboxEvents.status, "pending")));
  }

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
 * Registra falha de entrega e incrementa tentativas.
 * Se atingir MAX_ATTEMPTS, move para dead letter queue.
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
    // Mover para DLQ
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
  } else {
    // Backoff exponencial: 2^n segundos
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
  }
}
