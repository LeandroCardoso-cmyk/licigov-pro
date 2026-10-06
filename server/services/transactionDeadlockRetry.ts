/**
 * SEM084-A — retry LIMITADO de transação INTEIRA quando o InnoDB a desfaz por deadlock.
 *
 * Contexto (SEM-084 K1): a alocação de versão do documento oficial (`SELECT MAX(version) … FOR UPDATE` seguido de
 * `INSERT`) trava a faixa do índice; para linhagens novas a faixa é vazia, então duas transações concorrentes do
 * mesmo órgão seguram o gap lock e esperam o *insert intention* uma da outra. O InnoDB desfaz UMA delas por inteiro
 * (ER_LOCK_DEADLOCK, errno 1213, SQLSTATE 40001) — nada dela fica gravado — e repetir a transação inteira é seguro.
 *
 * Regras:
 *  - só deadlock é repetido (errno 1213 / ER_LOCK_DEADLOCK); qualquer outro erro propaga na 1ª ocorrência;
 *  - a função repetida é a TRANSAÇÃO INTEIRA (quem chama é a fronteira dona da transação; nunca uma parte dela);
 *  - no máximo 3 tentativas, com esperas FIXAS e determinísticas (sem aleatoriedade) entre elas;
 *  - cada retry e o esgotamento são registrados estruturadamente (rótulo, tentativa, tenant, correlationId) — sem
 *    conteúdo de documento, nome de pessoa ou outro dado jurídico/pessoal.
 */
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("TransactionDeadlockRetry");

export const DEADLOCK_MAX_ATTEMPTS = 3;
/** Espera antes da 2ª e da 3ª tentativa (ms). Fixa: o comportamento é reprodutível. */
export const DEADLOCK_RETRY_DELAYS_MS: readonly number[] = Object.freeze([10, 25]);

/** ER_LOCK_DEADLOCK (errno 1213, SQLSTATE 40001), inclusive embrulhado pelo driver/ORM em `cause`. */
export function isDeadlockError(err: unknown): boolean {
  let x: unknown = err;
  for (let i = 0; i < 5 && x && typeof x === "object"; i++) {
    const e = x as { code?: unknown; errno?: unknown; cause?: unknown };
    if (e.code === "ER_LOCK_DEADLOCK" || e.errno === 1213) return true;
    x = e.cause;
  }
  return false;
}

export class DeadlockRetryExhaustedError extends Error {
  readonly attempts: number;
  constructor(label: string, attempts: number, cause: unknown) {
    super(`DEADLOCK_RETRY_EXHAUSTED: ${label} — transação desfeita por deadlock em ${attempts} tentativas; nada foi gravado.`, { cause });
    this.name = "DeadlockRetryExhaustedError";
    this.attempts = attempts;
  }
}

export interface DeadlockRetryContext {
  readonly label: string;
  readonly organizationId?: number;
  readonly correlationId?: string;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executa `runTransaction` (que deve abrir e concluir UMA transação completa) e a repete, inteira, se o InnoDB a
 * desfizer por deadlock. `sleep` é injetável para testes.
 */
export async function runTransactionWithDeadlockRetry<T>(
  ctx: DeadlockRetryContext,
  runTransaction: (attempt: number) => Promise<T>,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const out = await runTransaction(attempt);
      if (attempt > 1) log.info("deadlock_retry_succeeded", { label: ctx.label, attempt, organizationId: ctx.organizationId, correlationId: ctx.correlationId });
      return out;
    } catch (err) {
      if (!isDeadlockError(err)) throw err;
      if (attempt >= DEADLOCK_MAX_ATTEMPTS) {
        log.warn("deadlock_retry_exhausted", { label: ctx.label, attempts: attempt, organizationId: ctx.organizationId, correlationId: ctx.correlationId, outcome: "FAILED" });
        throw new DeadlockRetryExhaustedError(ctx.label, attempt, err);
      }
      const delayMs = DEADLOCK_RETRY_DELAYS_MS[attempt - 1] ?? DEADLOCK_RETRY_DELAYS_MS[DEADLOCK_RETRY_DELAYS_MS.length - 1];
      log.warn("deadlock_retry", { label: ctx.label, attempt, nextAttempt: attempt + 1, delayMs, organizationId: ctx.organizationId, correlationId: ctx.correlationId });
      await sleep(delayMs);
    }
  }
}
