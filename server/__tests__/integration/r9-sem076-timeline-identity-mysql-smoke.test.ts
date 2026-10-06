/**
 * R9 / SEM-076 — identidade do evento da timeline e ator humano, MySQL 8 real (órgão sintético 960761).
 *
 *   T1. eventos CONCORRENTES do mesmo tipo no mesmo processo ⇒ N linhas, cada resumo preservado (antes: mesmo id
 *       `sha256(org:process:ordem:tipo)` + upsert do summary ⇒ o último sobrescrevia os demais);
 *   T2. evento singleton com idempotencyKey ⇒ uma linha; o retry NÃO reescreve o resumo original;
 *   T3. o ator registrado é o humano solicitante (`user:<id>`) — nunca "multi_copilot".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { recordProcessEvent, listProcessTimeline } from "../../db/procurement";
import { timelineActor } from "../../domain/timelineActor";

const DB = process.env.DATABASE_URL;
const ORG = 960761;

describe.skipIf(!DB)("R9 / SEM-076 — timeline: id por evento, sem reescrita, ator humano (MySQL 8)", () => {
  let conn: mysql.Connection;
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query("DELETE FROM process_timeline WHERE organization_id = ?", [ORG]);
  }, 300_000);
  afterAll(async () => {
    if (!conn) return;
    await conn.query("DELETE FROM process_timeline WHERE organization_id = ?", [ORG]).catch(() => {});
    await conn.end();
  });

  it("T1) eventos concorrentes do mesmo tipo não se sobrescrevem", async () => {
    const pid = `t1-${Date.now()}`.slice(0, 20);
    await Promise.all(Array.from({ length: 8 }, (_, i) => recordProcessEvent({
      organizationId: ORG, processId: pid, eventType: "change", actor: timelineActor(5), summary: `evento ${i}`, correlationId: `c${i}`,
    })));
    const tl = await listProcessTimeline(pid, ORG);
    expect(tl).toHaveLength(8);
    expect(new Set(tl.map((e) => e.id)).size).toBe(8);
    expect(tl.map((e) => e.summary).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `evento ${i}`).sort());
  }, 60_000);

  it("T2) singleton com chave: uma linha; retry não reescreve o resumo", async () => {
    const pid = `t2-${Date.now()}`.slice(0, 20);
    const base = { organizationId: ORG, processId: pid, eventType: "workspace_created", actor: timelineActor(5), correlationId: "c", idempotencyKey: "create" };
    await recordProcessEvent({ ...base, summary: "original" });
    await Promise.all([recordProcessEvent({ ...base, summary: "retry A" }), recordProcessEvent({ ...base, summary: "retry B" })]);
    const tl = await listProcessTimeline(pid, ORG);
    expect(tl).toHaveLength(1);
    expect(tl[0].summary).toBe("original");
  }, 60_000);

  it("T3) ator = humano solicitante; sem solicitante = sistema", async () => {
    expect(timelineActor(42)).toBe("user:42");
    expect(timelineActor(undefined)).toBe("sistema");
    const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM process_timeline WHERE organization_id = ? AND actor = 'multi_copilot'", [ORG]);
    expect(Number(rows[0].n)).toBe(0);
  });
});
