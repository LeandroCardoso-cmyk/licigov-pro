/**
 * Sprint 2.5 — Document Concurrency Service.
 *
 * Concorrência colaborativa: soft locks (advisory), hard locks (bloqueantes),
 * escalation detection, autosave collision handling, cleanup de locks expirados.
 *
 * Soft lock  = 15 min — indica edição em andamento, não bloqueia leitura
 * Hard lock  = 60 min — bloqueia escrita de outros usuários (e.g. aprovação)
 */
import { eq, and, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { documents } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { addTimelineEvent } from "./documentTimelineService";
import type { TrpcAuditCtx } from "./activityLogService";

const log = serviceLogger("DocumentConcurrencyService");

export type LockType = "soft" | "hard";

const SOFT_LOCK_MINUTES = 15;
const HARD_LOCK_MINUTES = 60;

// ─── Status shape ─────────────────────────────────────────────────────────────

export interface LockStatus {
  isLocked:      boolean;
  lockedBy:      number | null;
  lockType:      LockType | null;
  lockReason:    string | null;
  lockExpiresAt: Date | null;
  isExpired:     boolean;
  isOwnLock:     boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseLockType(lockReason: string | null): LockType | null {
  if (!lockReason) return null;
  if (lockReason.startsWith("soft:")) return "soft";
  if (lockReason.startsWith("hard:")) return "hard";
  return null;
}

// ─── Acquire ──────────────────────────────────────────────────────────────────

export async function acquireLock(
  documentId: number,
  lockType:   LockType,
  reason:     string,
  ctx:        TrpcAuditCtx,
): Promise<LockStatus> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const rows = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, orgId)))
    .limit(1);

  if (rows.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });

  const doc = rows[0];
  const now = new Date();
  const existingExpired = doc.lockExpiresAt && new Date(doc.lockExpiresAt) < now;

  // Bloqueio ativo por outro usuário
  if (doc.isLocked && !existingExpired && doc.lockedBy !== ctx.user.id) {
    const existingType = parseLockType(doc.lockReason);
    // Soft lock não bloqueia aquisição de soft lock por outros (advisory)
    if (!(lockType === "soft" && existingType === "soft")) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Documento com bloqueio ${existingType ?? "ativo"} por outro usuário.`,
      });
    }
  }

  const durationMinutes = lockType === "soft" ? SOFT_LOCK_MINUTES : HARD_LOCK_MINUTES;
  const lockExpiresAt   = new Date(now.getTime() + durationMinutes * 60 * 1000);
  const fullReason      = `${lockType}:${reason}`;

  await db.update(documents).set({
    isLocked:      1,
    lockedBy:      ctx.user.id,
    lockReason:    fullReason,
    lockExpiresAt,
  }).where(eq(documents.id, documentId));

  try {
    await addTimelineEvent({
      organizationId: orgId,
      documentId,
      eventType:      "lock_adquirido",
      ctx,
      details:        { lockType, reason, expiresAt: lockExpiresAt.toISOString() },
    });
  } catch { /* silent */ }

  log.info("lock_acquired", { documentId, lockType, orgId, actorId: ctx.user.id });

  return {
    isLocked:      true,
    lockedBy:      ctx.user.id,
    lockType,
    lockReason:    fullReason,
    lockExpiresAt,
    isExpired:     false,
    isOwnLock:     true,
  };
}

// ─── Release ──────────────────────────────────────────────────────────────────

export async function releaseLock(
  documentId: number,
  ctx:        TrpcAuditCtx,
  force?:     boolean,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const rows = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, orgId)))
    .limit(1);

  if (rows.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });

  const doc = rows[0];

  if (!force && doc.lockedBy !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Não é possível liberar bloqueio de outro usuário sem force=true." });
  }

  await db.update(documents).set({
    isLocked:      0,
    lockedBy:      null,
    lockReason:    null,
    lockExpiresAt: null,
  }).where(eq(documents.id, documentId));

  try {
    await addTimelineEvent({
      organizationId: orgId,
      documentId,
      eventType:      "lock_liberado",
      ctx,
      details:        { force: !!force },
    });
  } catch { /* silent */ }

  log.info("lock_released", { documentId, orgId, actorId: ctx.user.id, force: !!force });
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getLockStatus(
  documentId:     number,
  organizationId: number,
  actorId:        number,
): Promise<LockStatus> {
  const db = await getDb();
  if (!db) return { isLocked: false, lockedBy: null, lockType: null, lockReason: null, lockExpiresAt: null, isExpired: false, isOwnLock: false };

  const rows = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
    .limit(1);

  if (rows.length === 0)
    return { isLocked: false, lockedBy: null, lockType: null, lockReason: null, lockExpiresAt: null, isExpired: false, isOwnLock: false };

  const doc           = rows[0];
  const lockExpiresAt = doc.lockExpiresAt ? new Date(doc.lockExpiresAt) : null;
  const isExpired     = lockExpiresAt ? new Date() > lockExpiresAt : false;
  const isOwnLock     = doc.lockedBy === actorId;
  const lockType      = parseLockType(doc.lockReason ?? null);

  return {
    isLocked:      !!doc.isLocked && !isExpired,
    lockedBy:      doc.lockedBy   ?? null,
    lockType,
    lockReason:    doc.lockReason ?? null,
    lockExpiresAt,
    isExpired,
    isOwnLock,
  };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export async function cleanupExpiredLocks(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.update(documents).set({
    isLocked:      0,
    lockedBy:      null,
    lockReason:    null,
    lockExpiresAt: null,
  }).where(and(
    eq(documents.isLocked, 1),
    lt(documents.lockExpiresAt, new Date()),
  ));

  const count = (result[0] as { affectedRows?: number })?.affectedRows ?? 0;
  if (count > 0) log.info("expired_locks_cleaned", { count });
  return count;
}

// ─── Autosave collision detection ─────────────────────────────────────────────

export function detectAutosaveCollision(
  lockStatus: LockStatus,
  actorId:    number,
): { hasCollision: boolean; reason?: string; canOverride: boolean } {
  if (!lockStatus.isLocked || lockStatus.isExpired)
    return { hasCollision: false, canOverride: false };

  if (lockStatus.lockedBy === actorId)
    return { hasCollision: false, canOverride: false }; // own lock

  const isSoftLock = lockStatus.lockType === "soft";
  return {
    hasCollision: true,
    canOverride:  isSoftLock, // soft = override possível (advisory); hard = bloqueante
    reason:       `Documento com bloqueio ${lockStatus.lockType} por outro usuário. ${isSoftLock ? "Pode sobrescrever." : "Operação bloqueada."}`,
  };
}
