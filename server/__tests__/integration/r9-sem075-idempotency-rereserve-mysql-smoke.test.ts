/**
 * R9 / SEM-075 — serviço de idempotência contra MySQL 8 real (órgão sintético 960751).
 *
 *   I1. "failed" é RE-RESERVADA atomicamente: N retries concorrentes ⇒ `fn` roda UMA vez (não há IA duplicada);
 *   I2. a re-reserva grava o payloadHash do NOVO pedido ⇒ o replay posterior com esse payload é seguro e o payload
 *       antigo vira conflito (antes: resposta do payload B cacheada sob o hash de A);
 *   I3. chave expirada (completed ou "processing" órfão) é reativada: nova execução, TTL renovado, resposta antiga limpa;
 *   I4. mesma chave para OUTRA operação ⇒ CONFLICT IDEMPOTENCY_KEY_OPERATION_MISMATCH (nunca devolve o cache alheio).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { checkIdempotency, failIdempotencyKey, runWithIdempotency, IDEMPOTENCY_OPERATION_MISMATCH } from "../../services/idempotencyService";

const DB = process.env.DATABASE_URL;
const ORG = 960751;
const USER = 11;

describe.skipIf(!DB)("R9 / SEM-075 — idempotência: re-reserva atômica, hash, expiração e operação (MySQL 8)", () => {
  let conn: mysql.Connection;
  const row = async (key: string) => {
    const [r] = await conn.execute<mysql.RowDataPacket[]>("SELECT status, operation, requestPayloadHash, responsePayload, expiresAt FROM idempotency_keys WHERE organizationId = ? AND userId = ? AND `key` = ?", [ORG, USER, key]);
    return r as Array<{ status: string; operation: string; requestPayloadHash: string | null; responsePayload: unknown; expiresAt: Date }>;
  };
  async function err(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
    try { await p; return null; } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: String(x.message ?? "") }; }
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query("DELETE FROM idempotency_keys WHERE organizationId = ?", [ORG]);
  }, 300_000);
  afterAll(async () => {
    if (!conn) return;
    await conn.query("DELETE FROM idempotency_keys WHERE organizationId = ?", [ORG]).catch(() => {});
    await conn.end();
  });

  it("I1) retries concorrentes de uma chave 'failed' ⇒ só um executa", async () => {
    const key = `i1-${Date.now()}`;
    await expect(runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "sem075.op", payloadHash: "h1" }, async () => { throw new Error("falha do provedor"); })).rejects.toThrow("falha do provedor");
    expect((await row(key))[0].status).toBe("failed");

    let runs = 0;
    const settled = await Promise.allSettled(Array.from({ length: 6 }, () => runWithIdempotency(
      { key, userId: USER, organizationId: ORG, operation: "sem075.op", payloadHash: "h1" },
      async () => { runs++; await new Promise((r) => setTimeout(r, 150)); return { ok: true }; },
    )));
    expect(runs).toBe(1);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    for (const s of settled.filter((x) => x.status === "rejected")) expect((s as PromiseRejectedResult).reason.code).toBe("CONFLICT");
    expect(await row(key)).toEqual([expect.objectContaining({ status: "completed", requestPayloadHash: "h1" })]);
  }, 60_000);

  it("I2) retry de 'failed' com payload novo grava o hash novo; o antigo vira conflito", async () => {
    const key = `i2-${Date.now()}`;
    expect(await checkIdempotency(key, USER, ORG, "sem075.op", "hashA")).toEqual({ status: "new" });
    await failIdempotencyKey(key, USER, ORG);
    const r = await runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "sem075.op", payloadHash: "hashB" }, async () => ({ v: "B" }));
    expect(r).toEqual({ result: { v: "B" }, replayed: false });
    expect((await row(key))[0].requestPayloadHash).toBe("hashB");
    expect(await runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "sem075.op", payloadHash: "hashB" }, async () => ({ v: "X" }))).toEqual({ result: { v: "B" }, replayed: true });
    expect((await err(runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "sem075.op", payloadHash: "hashA" }, async () => ({ v: "A" }))))?.code).toBe("CONFLICT");
  }, 60_000);

  it("I3) chave expirada (completed e 'processing' órfão) é reativada com TTL novo e sem a resposta antiga", async () => {
    for (const status of ["completed", "processing"] as const) {
      const key = `i3-${status}-${Date.now()}`;
      await runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "sem075.op", payloadHash: "old" }, async () => ({ v: "old" }));
      await conn.execute("UPDATE idempotency_keys SET status = ?, expiresAt = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE organizationId = ? AND `key` = ?", [status, ORG, key]);
      let runs = 0;
      const r = await runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "sem075.op", payloadHash: "new" }, async () => { runs++; return { v: "new" }; });
      expect(runs).toBe(1);
      expect(r).toEqual({ result: { v: "new" }, replayed: false });
      const [x] = await row(key);
      expect(x).toMatchObject({ status: "completed", requestPayloadHash: "new" });
      expect(new Date(x.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
  }, 60_000);

  it("I4) mesma chave para outra operação ⇒ CONFLICT, sem devolver o cache da primeira", async () => {
    const key = `i4-${Date.now()}`;
    await runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "sem075.op", payloadHash: "p" }, async () => ({ secret: "da operação A" }));
    let ran = false;
    const e = await err(runWithIdempotency({ key, userId: USER, organizationId: ORG, operation: "sem075.other", payloadHash: "p" }, async () => { ran = true; return {}; }));
    expect(e?.code).toBe("CONFLICT");
    expect(e?.message).toContain(IDEMPOTENCY_OPERATION_MISMATCH);
    expect(ran).toBe(false);
    expect(await row(key)).toEqual([expect.objectContaining({ operation: "sem075.op", status: "completed" })]);
  }, 60_000);
});
