/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR C — Idempotência canônica contra MySQL REAL (CI). Executável (não source inspection).
 *
 * Cobre o serviço único (checkIdempotency/save/fail + runWithIdempotency), reforçado nesta PR
 * para ser concorrência-safe (reutiliza o UNIQUE tenant-aware idempotency_org_user_key):
 *   - replay seguro: mesma chave + mesmo payload → resultado anterior;
 *   - conflito explícito: mesma chave + payload diferente → CONFLICT;
 *   - operação em andamento (processing) → CONFLICT;
 *   - falha não é cacheada como sucesso (permite retry);
 *   - concorrência: N execuções simultâneas com a mesma chave → `fn` roda UMA vez, sem linha duplicada.
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { idempotencyKeys } from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import {
  checkIdempotency,
  runWithIdempotency,
} from "../../services/idempotencyService";

const DB = process.env.DATABASE_URL;
const ORG = 993301;
const USER = 7;

async function cleanup(conn: mysql.Connection) {
  await conn.query("DELETE FROM `idempotency_keys` WHERE organizationId = ?", [ORG]).catch(() => {});
}

async function countRows(key: string): Promise<number> {
  const db = await getDb();
  const rows = await db!
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.organizationId, ORG), eq(idempotencyKeys.userId, USER), eq(idempotencyKeys.key, key)));
  return rows.length;
}

describe.skipIf(!DB)("PR C — Idempotência canônica (MySQL real)", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup(conn);
  }, 300_000);

  afterAll(async () => {
    await cleanup(conn).catch(() => {});
    await conn?.end();
  });

  it("replay seguro: mesma chave + mesmo payload devolve o resultado anterior", async () => {
    const key = "k-replay";
    let calls = 0;
    const fn = async () => { calls++; return { ok: true, n: calls }; };

    const first = await runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "gen", payloadHash: "h1" }, fn);
    expect(first.replayed).toBe(false);

    const second = await runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "gen", payloadHash: "h1" }, fn);
    expect(second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(calls).toBe(1); // fn executou apenas uma vez
    expect(await countRows(key)).toBe(1);
  }, 60_000);

  it("conflito explícito: mesma chave + payload diferente → CONFLICT", async () => {
    const key = "k-conflict";
    await runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "gen", payloadHash: "hA" }, async () => ({ v: 1 }));
    await expect(
      runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "gen", payloadHash: "hB" }, async () => ({ v: 2 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }, 60_000);

  it("operação em andamento (processing) → CONFLICT", async () => {
    const key = "k-inflight";
    // Reserva a chave como "processing" (primeira passagem), sem concluir.
    const r = await checkIdempotency(key, USER, ORG, "gen", "h1");
    expect(r.status).toBe("new");
    await expect(
      runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "gen", payloadHash: "h1" }, async () => ({ v: 1 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }, 60_000);

  it("falha não é cacheada como sucesso: permite novo retry", async () => {
    const key = "k-fail";
    await expect(
      runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "gen", payloadHash: "h1" }, async () => { throw new Error("boom"); }),
    ).rejects.toThrow(/boom/);

    // Segundo retry com a mesma chave deve REEXECUTAR (falha não vira sucesso cacheado).
    let calls = 0;
    const ok = await runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "gen", payloadHash: "h1" }, async () => { calls++; return { ok: true }; });
    expect(ok.replayed).toBe(false);
    expect(calls).toBe(1);
  }, 60_000);

  it("concorrência: N execuções simultâneas com a mesma chave → fn roda UMA vez, sem linha duplicada", async () => {
    const key = "k-concurrent";
    let calls = 0;
    const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 30)); return { ok: true }; };

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "gen", payloadHash: "h1" }, fn),
      ),
    );
    const fulfilledExecuted = settled.filter((s) => s.status === "fulfilled" && (s.value as any).replayed === false).length;

    expect(calls).toBe(1); // efeito colateral rodou exatamente uma vez
    expect(fulfilledExecuted).toBe(1); // apenas um executor; os demais → conflito ou replay
    expect(await countRows(key)).toBe(1); // UNIQUE tenant-aware: sem duplicação
  }, 60_000);
});
