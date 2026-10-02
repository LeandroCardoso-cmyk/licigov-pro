import { eq, and, lt, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { idempotencyKeys } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("IdempotencyService");

const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

export type IdempotencyResult =
  | { status: "new" }
  | { status: "processing" }
  | { status: "completed"; response: unknown; payloadMismatch: boolean }
  | { status: "failed" };

/**
 * Detecta violação de UNIQUE (org, user, key) — o índice `idempotency_org_user_key`.
 * Usada para tornar o caminho "new" atômico sob concorrência: o perdedor de uma
 * corrida de INSERT relê a linha vencedora em vez de propagar um 500 cru.
 */
function isDuplicateEntryError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: string }).code;
  const causeCode = (err as { cause?: { code?: string } }).cause?.code;
  return code === "ER_DUP_ENTRY" || causeCode === "ER_DUP_ENTRY";
}

type IdempotencyRow = typeof idempotencyKeys.$inferSelect;

// C.4A — executor aceita a conexão (db) ou uma transação (tx), permitindo marcar a chave como
// COMPLETED atomicamente junto do commit documental (ver procurementProcessService). Quando ausente,
// usa getDb() (comportamento anterior, sem quebra de assinatura para callers existentes).
type IdemDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type IdempotencyExecutor = IdemDb | Parameters<Parameters<IdemDb["transaction"]>[0]>[0];

/**
 * R9 / SEM-075 — a chave é VINCULADA à operação que a reservou primeiro. Reusar a mesma (org, user, key) para OUTRA
 * operação nunca devolve a resposta (nem o estado "em voo") da primeira: é um conflito explícito. Sem migration — a
 * unicidade física continua (org, user, key); a identidade lógica passa a ser (org, user, key, operation).
 */
export const IDEMPOTENCY_OPERATION_MISMATCH = "IDEMPOTENCY_KEY_OPERATION_MISMATCH";

function assertSameOperation(record: IdempotencyRow, operation: string, ctx: { key: string; userId: number; organizationId: number }): void {
  if (record.operation === operation) return;
  log.warn("idempotency_operation_mismatch", { ...ctx, storedOperation: record.operation, operation });
  throw new TRPCError({
    code: "CONFLICT",
    message: `${IDEMPOTENCY_OPERATION_MISMATCH}: Idempotency-Key já usada por outra operação — gere uma nova chave.`,
  });
}

/** Linha re-reservável: falhou (retry permitido) ou venceu o TTL (inclusive "processing" órfão de um crash). */
function isReReservable(record: IdempotencyRow): boolean {
  return record.status === "failed" || record.expiresAt < new Date();
}

/**
 * Avalia uma linha já existente (ou recém-vencedora de corrida) e a converte no lifecycle público.
 * Só é chamada para linhas NÃO re-reserváveis (vigentes e não-falhas) — ver `checkIdempotency`.
 */
function evaluateExistingRow(
  record: IdempotencyRow,
  payloadHash: string | undefined,
  ctx: { key: string; userId: number; organizationId: number },
): IdempotencyResult {
  if (record.status === "completed") {
    // Payload mudou: o CALLER deve rejeitar como conflito (nunca sobrescrever/repetir
    // o efeito com dados diferentes sob a mesma chave) — não é replay seguro.
    const payloadMismatch = !!(
      payloadHash &&
      record.requestPayloadHash &&
      record.requestPayloadHash !== payloadHash
    );
    if (payloadMismatch) {
      log.warn("idempotency_payload_mismatch", ctx);
    }
    return { status: "completed", response: record.responsePayload, payloadMismatch };
  }

  if (record.status === "failed") {
    return { status: "failed" };
  }

  return { status: "processing" };
}

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
 *
 * R9 / SEM-075 — "failed" e expirada são RE-RESERVADAS atomicamente (UPDATE condicional): só UM retry concorrente
 * recebe "new" (os demais recebem "processing"), a reserva grava o payloadHash do NOVO pedido (o cache futuro fica
 * sob o hash certo), renova o TTL e limpa a resposta antiga. Mesma chave para OUTRA operação ⇒ CONFLICT.
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

  const ctx = { key, userId, organizationId };

  const whereKey = and(
    eq(idempotencyKeys.organizationId, organizationId),
    eq(idempotencyKeys.userId, userId),
    eq(idempotencyKeys.key, key),
  );

  const existing = await db.select().from(idempotencyKeys).where(whereKey).limit(1);

  if (existing.length === 0) {
    // Caminho "new" ATÔMICO: tenta reservar a chave; se outra requisição concorrente
    // venceu a corrida (violação do UNIQUE idempotency_org_user_key), relê a linha
    // vencedora e devolve o estado real (processing/completed/failed) — nunca propaga
    // um 500 cru nem cria linha duplicada.
    const expiresAt = new Date(Date.now() + TTL_MS);
    try {
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
    } catch (err) {
      if (!isDuplicateEntryError(err)) throw err;
      log.info("idempotency_insert_race_reread", ctx);
      const raced = await db.select().from(idempotencyKeys).where(whereKey).limit(1);
      if (raced.length === 0) throw err;
      assertSameOperation(raced[0], operation, ctx);
      return evaluateExistingRow(raced[0], payloadHash, ctx);
    }
  }

  const record = existing[0];
  assertSameOperation(record, operation, ctx);
  if (!isReReservable(record)) return evaluateExistingRow(record, payloadHash, ctx);

  // Re-reserva ATÔMICA: a condição repete o predicado de re-reservabilidade; o perdedor de uma corrida afeta 0
  // linhas e relê o estado real (o vencedor já marcou "processing").
  const now = new Date();
  const res = await db
    .update(idempotencyKeys)
    .set({
      status: "processing",
      requestPayloadHash: payloadHash ?? null,
      responsePayload: null,
      expiresAt: new Date(now.getTime() + TTL_MS),
    })
    .where(and(whereKey, eq(idempotencyKeys.operation, operation), or(eq(idempotencyKeys.status, "failed"), lt(idempotencyKeys.expiresAt, now))));
  const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined;
  if ((header?.affectedRows ?? 0) === 1) {
    log.info(record.status === "failed" ? "idempotency_failed_rereserved" : "idempotency_expired_rereserved", ctx);
    return { status: "new" };
  }
  log.info("idempotency_rereserve_race_reread", ctx);
  const raced = await db.select().from(idempotencyKeys).where(whereKey).limit(1);
  if (raced.length === 0) return { status: "processing" }; // removida pelo cleanup no meio da corrida: não executa às cegas
  assertSameOperation(raced[0], operation, ctx);
  return isReReservable(raced[0]) ? { status: "processing" } : evaluateExistingRow(raced[0], payloadHash, ctx);
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
  executor?: IdempotencyExecutor,
): Promise<void> {
  const db = executor ?? await getDb();
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

  const deleted = (result as unknown as Array<{ rowsAffected?: number }>)[0]?.rowsAffected ?? 0;
  log.info("cleanup_expired", { deletedCount: deleted });
  return deleted;
}

/**
 * PR C — Wrapper canônico de idempotência (reutiliza check/save/fail — NÃO é um segundo
 * mecanismo). Garante, para uma mesma (org,user,key):
 *   - replay seguro: mesma chave + mesmo payload → devolve o resultado anterior (`replayed:true`);
 *   - conflito explícito: mesma chave + payload diferente → CONFLICT;
 *   - operação em andamento (duplicata em voo / corrida) → CONFLICT (o caller reexecuta depois);
 *   - falha não é cacheada como sucesso (marca `failed`, permite novo retry);
 *   - nenhuma conclusão parcial é tratada como sucesso (save só após `fn` resolver).
 * Degrada com segurança sem DB (executa `fn` normalmente).
 */
export async function runWithIdempotency<T>(
  params: { key: string; userId: number; organizationId: number; operation: string; payloadHash?: string },
  fn: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const { key, userId, organizationId, operation, payloadHash } = params;
  const check = await checkIdempotency(key, userId, organizationId, operation, payloadHash);

  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Idempotency-Key reutilizada com payload diferente — operação recusada.",
      });
    }
    return { result: check.response as T, replayed: true };
  }

  if (check.status === "processing") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Operação idêntica já está em processamento para esta chave — aguarde a conclusão.",
    });
  }

  // status "new" ou "failed": executa (retry permitido após falha, sem cache de sucesso parcial).
  try {
    const result = await fn();
    await saveIdempotencyResult(key, userId, organizationId, result);
    return { result, replayed: false };
  } catch (err) {
    await failIdempotencyKey(key, userId, organizationId);
    throw err;
  }
}
