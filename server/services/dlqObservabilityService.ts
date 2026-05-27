/**
 * Sprint 1.8 — DLQ Observability Service.
 *
 * Métricas, detecção de poison events e stuck events no outbox.
 * Permite: auditoria de falhas, replay seguro, alertas operacionais.
 */
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import { outboxEvents, outboxDeadLetters } from "../../drizzle/schema";
import { appendOutboxEvent } from "./outboxService";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("DlqObservabilityService");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DlqMetrics {
  totalDeadLetters:  number;
  byEventType:       Record<string, number>;
  byOrganization:    Record<number, number>;
  oldestDeadLetter:  Date | null;
  recentFailures24h: number;
}

export interface StuckEvent {
  id:             string;
  eventType:      string;
  attempts:       number;
  lockedUntil:    Date | null;
  lockedBy:       string | null;
  organizationId: number | null;
  stuckSinceMs:   number;
}

export interface PoisonEventPattern {
  eventType:    string;
  errorPattern: string;
  occurrences:  number;
}

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Agrega métricas da Dead Letter Queue.
 */
export async function getDlqMetrics(): Promise<DlqMetrics> {
  const db = await getDb();
  if (!db) {
    return {
      totalDeadLetters:  0,
      byEventType:       {},
      byOrganization:    {},
      oldestDeadLetter:  null,
      recentFailures24h: 0,
    };
  }

  const rows    = await db.select().from(outboxDeadLetters);
  const since24h = new Date(Date.now() - 86_400_000);

  const byEventType:    Record<string, number> = {};
  const byOrganization: Record<number, number> = {};
  let oldestDeadLetter: Date | null = null;
  let recentFailures24h = 0;

  for (const row of rows) {
    byEventType[row.eventType] = (byEventType[row.eventType] ?? 0) + 1;

    if (row.organizationId != null) {
      byOrganization[row.organizationId] =
        (byOrganization[row.organizationId] ?? 0) + 1;
    }

    if (!oldestDeadLetter || row.movedAt < oldestDeadLetter) {
      oldestDeadLetter = row.movedAt;
    }

    if (row.movedAt >= since24h) {
      recentFailures24h++;
    }
  }

  log.debug("dlq_metrics_fetched", {
    totalDeadLetters: rows.length,
    recentFailures24h,
  });

  return {
    totalDeadLetters: rows.length,
    byEventType,
    byOrganization,
    oldestDeadLetter,
    recentFailures24h,
  };
}

/**
 * Detecta eventos presos em status "processing" além do threshold.
 * Default: 5 minutos (300_000 ms).
 */
export async function detectStuckEvents(
  stuckThresholdMs = 300_000,
): Promise<StuckEvent[]> {
  const db = await getDb();
  if (!db) return [];

  const threshold = new Date(Date.now() - stuckThresholdMs);

  const rows = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "processing"),
        isNotNull(outboxEvents.lockedUntil),
        lte(outboxEvents.lockedUntil, threshold),
      ),
    );

  const stuckEvents = rows.map(row => ({
    id:             row.id,
    eventType:      row.eventType,
    attempts:       row.attempts,
    lockedUntil:    row.lockedUntil,
    lockedBy:       row.lockedBy,
    organizationId: row.organizationId,
    stuckSinceMs:   row.lockedUntil
      ? Date.now() - row.lockedUntil.getTime()
      : 0,
  }));

  if (stuckEvents.length > 0) {
    log.warn("stuck_events_detected", { count: stuckEvents.length, thresholdMs: stuckThresholdMs });
  }

  return stuckEvents;
}

/**
 * Identifica padrões de erros repetitivos (poison events).
 * Agrupa por (eventType, errorPattern), retorna os com >= minOccurrences.
 */
export async function detectPoisonEvents(
  minOccurrences = 3,
): Promise<PoisonEventPattern[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(outboxDeadLetters)
    .where(eq(outboxDeadLetters.resolution, "pending"));

  const patterns = new Map<string, { count: number; errorPattern: string; eventType: string }>();

  for (const row of rows) {
    const errorPattern = (row.lastError ?? "unknown_error").slice(0, 120);
    const key          = `${row.eventType}::${errorPattern}`;
    const entry        = patterns.get(key) ?? { count: 0, errorPattern, eventType: row.eventType };
    entry.count++;
    patterns.set(key, entry);
  }

  return Array.from(patterns.values())
    .filter(v => v.count >= minOccurrences)
    .map(v => ({ eventType: v.eventType, errorPattern: v.errorPattern, occurrences: v.count }));
}

/**
 * Libera um stuck event de volta para "pending" (remove lock).
 */
export async function releaseStuckEvent(eventId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(outboxEvents)
    .set({ status: "pending", lockedBy: null, lockedUntil: null })
    .where(
      and(
        eq(outboxEvents.id, eventId),
        eq(outboxEvents.status, "processing"),
      ),
    );

  log.info("stuck_event_released", { eventId });
}

/**
 * Recoloca um dead letter na fila de pending events para re-processamento.
 * Marca o dead letter como "resolved".
 */
export async function replayDeadLetter(
  deadLetterId: string,
  requeuedBy: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const rows = await db
    .select()
    .from(outboxDeadLetters)
    .where(eq(outboxDeadLetters.id, deadLetterId))
    .limit(1);

  if (rows.length === 0) {
    log.warn("dead_letter_not_found", { deadLetterId });
    return;
  }

  const dl = rows[0];

  await appendOutboxEvent({
    organizationId: dl.organizationId ?? undefined,
    eventType:      dl.eventType,
    aggregateType:  dl.aggregateType,
    aggregateId:    dl.aggregateId,
    correlationId:  dl.correlationId ?? undefined,
    payload:        dl.payload as Record<string, unknown>,
  });

  await db
    .update(outboxDeadLetters)
    .set({
      resolution:   "resolved",
      resolvedAt:   new Date(),
      resolvedNote: `replayed by ${requeuedBy}`,
    })
    .where(eq(outboxDeadLetters.id, deadLetterId));

  log.info("dead_letter_replayed", {
    deadLetterId,
    requeuedBy,
    eventType: dl.eventType,
    aggregateId: dl.aggregateId,
  });
}
