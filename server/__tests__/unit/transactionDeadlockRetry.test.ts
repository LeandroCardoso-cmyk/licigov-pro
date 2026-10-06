/**
 * SEM084-A — retry LIMITADO de transação inteira por deadlock (unidade, sem DB).
 *  A  1213 injetado ⇒ a transação inteira é repetida e o resultado é o da tentativa bem-sucedida;
 *  B  qualquer outro erro ⇒ SEM retry, o erro ORIGINAL propaga;
 *  C  3 deadlocks consecutivos ⇒ falha limitada e observável (`DeadlockRetryExhaustedError`, 3 tentativas);
 *  esperas FIXAS e determinísticas; logs estruturados sem conteúdo jurídico/pessoal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const logs: Array<{ level: string; event: string; data: Record<string, unknown> }> = [];
vi.mock("../../services/observabilityService", () => ({
  serviceLogger: () => ({
    info: (event: string, data: Record<string, unknown>) => logs.push({ level: "info", event, data }),
    warn: (event: string, data: Record<string, unknown>) => logs.push({ level: "warn", event, data }),
    error: (event: string, data: Record<string, unknown>) => logs.push({ level: "error", event, data }),
  }),
}));

import {
  runTransactionWithDeadlockRetry, isDeadlockError, DeadlockRetryExhaustedError, DEADLOCK_MAX_ATTEMPTS, DEADLOCK_RETRY_DELAYS_MS,
} from "../../services/transactionDeadlockRetry";

/** Forma do erro do mysql2 para ER_LOCK_DEADLOCK. */
const deadlock = () => Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), { code: "ER_LOCK_DEADLOCK", errno: 1213, sqlState: "40001" });
const CTX = { label: "official_document.create", organizationId: 42, correlationId: "corr-1" };

beforeEach(() => { logs.length = 0; });

describe("SEM084-A — isDeadlockError", () => {
  it("reconhece só ER_LOCK_DEADLOCK / errno 1213 (inclusive embrulhado em `cause`)", () => {
    expect(isDeadlockError(deadlock())).toBe(true);
    expect(isDeadlockError({ errno: 1213 })).toBe(true);
    expect(isDeadlockError(new Error("wrap", { cause: deadlock() }))).toBe(true);
    expect(isDeadlockError(Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }))).toBe(false);
    expect(isDeadlockError(Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 }))).toBe(false);
    expect(isDeadlockError(new Error("Deadlock found when trying to get lock"))).toBe(false); // nunca por texto
    expect(isDeadlockError(null)).toBe(false);
    expect(isDeadlockError("ER_LOCK_DEADLOCK")).toBe(false);
  });
});

describe("SEM084-A — runTransactionWithDeadlockRetry", () => {
  it("A — 1213 na 1ª tentativa ⇒ a transação INTEIRA roda de novo; resultado da 2ª; espera fixa de 10 ms; log estruturado", async () => {
    const sleep = vi.fn(async () => {});
    const attempts: number[] = [];
    const out = await runTransactionWithDeadlockRetry(CTX, async (attempt) => {
      attempts.push(attempt);
      if (attempt === 1) throw deadlock();
      return `ok-${attempt}`;
    }, sleep);
    expect(out).toBe("ok-2");
    expect(attempts).toEqual([1, 2]);
    expect(sleep.mock.calls).toEqual([[10]]);
    expect(logs.map((l) => `${l.level}:${l.event}`)).toEqual(["warn:deadlock_retry", "info:deadlock_retry_succeeded"]);
    expect(logs[0].data).toEqual({ label: CTX.label, attempt: 1, nextAttempt: 2, delayMs: 10, organizationId: 42, correlationId: "corr-1" });
  });

  it("A — sucesso na 1ª tentativa ⇒ nenhuma espera, nenhum log", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => 7);
    expect(await runTransactionWithDeadlockRetry(CTX, fn, sleep)).toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it("B — erro que NÃO é deadlock ⇒ sem retry; o MESMO erro propaga", async () => {
    for (const original of [
      Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }),
      Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 }),
      new Error("OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE"),
    ]) {
      const sleep = vi.fn(async () => {});
      const fn = vi.fn(async () => { throw original; });
      const caught = await runTransactionWithDeadlockRetry(CTX, fn, sleep).then(() => null, (e: unknown) => e);
      expect(caught).toBe(original);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
    expect(logs).toEqual([]);
  });

  it("C — 3 deadlocks consecutivos ⇒ LIMITADO: exatamente 3 tentativas, esperas 10/25 ms, DeadlockRetryExhaustedError com a causa", async () => {
    const sleep = vi.fn(async () => {});
    const last = deadlock();
    let n = 0;
    const fn = vi.fn(async () => { n += 1; throw n === DEADLOCK_MAX_ATTEMPTS ? last : deadlock(); });
    const caught = await runTransactionWithDeadlockRetry(CTX, fn, sleep).then(() => null, (e: unknown) => e);
    expect(caught).toBeInstanceOf(DeadlockRetryExhaustedError);
    const err = caught as DeadlockRetryExhaustedError;
    expect(err.attempts).toBe(3);
    expect(err.cause).toBe(last);
    expect(err.message).toMatch(/^DEADLOCK_RETRY_EXHAUSTED: official_document\.create/);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [25]]);
    expect(logs.map((l) => `${l.level}:${l.event}`)).toEqual(["warn:deadlock_retry", "warn:deadlock_retry", "warn:deadlock_retry_exhausted"]);
    expect(logs[2].data).toEqual({ label: CTX.label, attempts: 3, organizationId: 42, correlationId: "corr-1", outcome: "FAILED" });
  });

  it("C — deadlock seguido de outro erro ⇒ o outro erro propaga sem nova tentativa", async () => {
    const sleep = vi.fn(async () => {});
    const other = new Error("CONFLICT");
    let n = 0;
    const fn = vi.fn(async () => { n += 1; throw n === 1 ? deadlock() : other; });
    expect(await runTransactionWithDeadlockRetry(CTX, fn, sleep).then(() => null, (e: unknown) => e)).toBe(other);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("parâmetros fixos e determinísticos: 3 tentativas; esperas [10, 25] congeladas", () => {
    expect(DEADLOCK_MAX_ATTEMPTS).toBe(3);
    expect(DEADLOCK_RETRY_DELAYS_MS).toEqual([10, 25]);
    expect(Object.isFrozen(DEADLOCK_RETRY_DELAYS_MS)).toBe(true);
  });

  it("logs não carregam conteúdo de documento nem dados pessoais (só rótulo, tentativa, tenant, correlationId)", async () => {
    await runTransactionWithDeadlockRetry(CTX, async (a) => { if (a < 3) throw deadlock(); return 1; }, async () => {});
    const allowed = new Set(["label", "attempt", "attempts", "nextAttempt", "delayMs", "organizationId", "correlationId", "outcome"]);
    for (const l of logs) for (const k of Object.keys(l.data)) expect(allowed.has(k)).toBe(true);
  });
});
