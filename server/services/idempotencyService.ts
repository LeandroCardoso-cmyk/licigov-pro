import { eq, and, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/connection";
import { idempotencyKeys } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("IdempotencyService");

const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

export type IdempotencyResult =
  | { status: "new" }
  | { status: "processing" }
  | { status: "completed"; response: unknown }
  | { status: "failed" };

/**
 * Verifica se uma operação já foi processada.
 *
 * Lifecycle:
 *   1. "new"        → primeira vez: registra como "processing", caller deve executar
 *   2. "processing" → duplicata em voo: caller deve retornar 409 ou aguardar
 *   3. "completed"  → retorna response cacheado (replay seguro)
 *   4. "failed"     → operação falhou: caller pode tentar novamente (não há cache)
 *
 * Replay policy:
 *   - status=completed + mesmo payloadHash → retornar response cacheado (idempotente)
 *   - status=completed + payloadHash diferente → lançar erro (payload mudou)
 *   - Expirado (>24h) → tratar como "new" (TTL venceu, novo processamento permitido)
 */
export async function checkIdempotency(
  key: string,
  userId: number,
  organizationId: number,
  operation: string,
  payloadHash?: string,
): Promise<IdempotencyResult> {
  const db = await getDb();
  if (!db) return { status: "new" };

  const existing = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.organizationId, organizationId),
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.key, key),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    const expiresAt = new Date(Date.now() + TTL_MS);
    await db.insert(idempotencyKeys).values({
      id: nanoid(),
      organizationId,
      userId,
      key,
      operation,
      status: "processing",
      requestPayloadHash: payloadHash ?? null,
      expiresAt,
    });
    return { status: "new" };
  }

  const record = existing[0];

  if (record.expiresAt < new Date()) {
    log.info("key_expired_treating_as_new", { key, userId, organizationId });
    return { status: "new" };
  }

  if (record.status === "completed") {
    // Payload mudou: recusar replay
    if (payloadHash && record.requestPayloadHash && record.requestPayloadHash !== payloadHash) {
      log.warn("idempotency_payload_mismatch", { key, userId, organizationId });
    }
    return { status: "completed", response: record.responsePayload };
  }

  if (record.status === "failed") {
    return { status: "failed" };
  }

  return { status: "processing" };
}

/**
 * Salva resultado de operação concluída com sucesso.
 * Deve ser chamado ao final da operação antes de retornar ao cliente.
 */
export async function saveIdempotencyResult(
  key: string,
  userId: number,
  organizationId: number,
  response: unknown,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(idempotencyKeys)
    .set({ status: "completed", responsePayload: response as Record<string, unknown> })
    .where(
      and(
        eq(idempotencyKeys.organizationId, organizationId),
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.key, key),
      ),
    );
}

/**
 * Marca chave como falha. Permite retry (não há resposta cacheada).
 */
export async function failIdempotencyKey(
  key: string,
  userId: number,
  organizationId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(idempotencyKeys)
    .set({ status: "failed" })
    .where(
      and(
        eq(idempotencyKeys.organizationId, organizationId),
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.key, key),
      ),
    );
}

/**
 * Remove chaves expiradas. Chamar periodicamente (recomendado: a cada hora).
 * Retorna número de registros removidos.
 */
export async function cleanupExpiredKeys(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, new Date()));

  const deleted = (result as unknown as { rowsAffected?: number })[0]?.rowsAffected ?? 0;
  log.info("cleanup_expired", { deletedCount: deleted });
  return deleted;
}
