/**
 * R9 / SEM-035 — `acceptCATMAT` e `manualCATMAT` passam pelo LEDGER governado (`catmat_decisions`), MySQL 8 real,
 * appRouter real, dados sintéticos (órgãos 960871/960872).
 *
 *   K1. aceitar com código que NÃO é o da sugestão ⇒ BAD_REQUEST CATMAT_CODE_MISMATCH, zero escrita;
 *   K2. aceitar a sugestão real ⇒ 1 decisão `confirmado` no ledger (ator, correlationId), código no item; repetir = replay;
 *   K3. código manual sem justificativa ⇒ BAD_REQUEST, zero escrita; com justificativa ⇒ decisão `substituido` no ledger;
 *   K4. outro órgão ⇒ NOT_FOUND, sem efeito.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, validateSchema } from "../../bootstrap";
import { createIntelligentItem } from "../../domain/intelligentItem";
import { insertIntelligentItem, getIntelligentItem } from "../../db/procurement";
import { setCatmatThresholdConfig } from "../../db/catmatGovernance";

const DB = process.env.DATABASE_URL;
const ORG = 960871;
const ORG_B = 960872;

describe.skipIf(!DB)("R9 / SEM-035 — CATMAT só pelo ledger governado (MySQL 8)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let operator = 0, ownerB = 0;

  async function caller(userId: number, org: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {}, correlationId: `sem035-${userId}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
    try { await p; return null; } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code ?? "ERR", message: String(x.message ?? "") }; }
  }
  const decisions = async (itemId: string) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>("SELECT decision, catmatCode, actorUserId, correlationId FROM catmat_decisions WHERE organizationId = ? AND itemId = ? ORDER BY id", [ORG, itemId]);
    return rows as Array<{ decision: string; catmatCode: string | null; actorUserId: number; correlationId: string }>;
  };
  async function cleanup() {
    for (const t of ["intelligent_items", "process_timeline", "catmat_matches"]) await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
    for (const t of ["catmat_decisions", "catmat_threshold_config", "organization_members", "idempotency_keys"]) await conn.query(`DELETE FROM \`${t}\` WHERE organizationId IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
  }
  async function seed(tag: string) {
    const it = createIntelligentItem({
      organizationId: ORG, processId: `sem035-${tag}`, sourceResearchId: `res-${tag}`.slice(0, 20),
      description: "Caneta esferográfica azul", quantity: 10, unit: "un", correlationId: `corr-${tag}`,
    });
    await insertIntelligentItem(it);
    return it;
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await cleanup();
    for (const id of [ORG, ORG_B]) await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `SEM035 ${id}`, `sem035-${id}`]);
    const mk = async (tag: string) => (await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`sem035-${tag}-${stamp}`, tag, `sem035-${tag}-${stamp}@teste.local`]))[0].insertId;
    operator = await mk("operator");
    ownerB = await mk("ownerb");
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG, operator]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)", [ORG_B, ownerB]);
    await setCatmatThresholdConfig({ organizationId: ORG, minScore: 0, reason: "Limiar do smoke SEM-035", actorUserId: operator, correlationId: "sem035" });
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE id IN (?, ?)", [operator, ownerB]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("K1/K2) aceitar só a sugestão REAL, pelo ledger; código divergente ⇒ CATMAT_CODE_MISMATCH sem escrita; repetir = replay", async () => {
    const it0 = await seed("k1");
    const c = await caller(operator, ORG);
    const { suggestions } = await c.itemIntelligence.getCATMATSuggestions({ itemId: it0.id });
    expect(suggestions.length).toBeGreaterThan(0);
    const s = suggestions[0];
    const bad = await err(c.itemIntelligence.acceptCATMAT({ itemId: it0.id, matchId: s.id, catmatCode: "999999999" }));
    expect(bad?.code).toBe("BAD_REQUEST");
    expect(bad?.message).toContain("CATMAT_CODE_MISMATCH");
    expect(await decisions(it0.id)).toEqual([]);

    await c.itemIntelligence.acceptCATMAT({ itemId: it0.id, matchId: s.id, catmatCode: s.catmatCode });
    await c.itemIntelligence.acceptCATMAT({ itemId: it0.id, matchId: s.id, catmatCode: s.catmatCode });
    const d = await decisions(it0.id);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ decision: "confirmado", catmatCode: s.catmatCode, actorUserId: operator });
    expect(d[0].correlationId).toBeTruthy();
    expect((await getIntelligentItem(it0.id, ORG))?.suggestedCATMAT).toBe(s.catmatCode);
  }, 60_000);

  it("K3) código manual exige justificativa e vira decisão `substituido` no ledger", async () => {
    const it0 = await seed("k3");
    const c = await caller(operator, ORG);
    const e = await err(c.itemIntelligence.manualCATMAT({ itemId: it0.id, catmatCode: "123456" }));
    expect(e?.code).toBe("BAD_REQUEST");
    expect(await decisions(it0.id)).toEqual([]);
    await c.itemIntelligence.manualCATMAT({ itemId: it0.id, catmatCode: "123456", justification: "Código conferido no catálogo oficial." });
    expect(await decisions(it0.id)).toEqual([expect.objectContaining({ decision: "substituido", catmatCode: "123456", actorUserId: operator })]);
  }, 60_000);

  it("K4) outro órgão ⇒ NOT_FOUND, sem efeito", async () => {
    const it0 = await seed("k4");
    const e = await err((await caller(ownerB, ORG_B)).itemIntelligence.manualCATMAT({ itemId: it0.id, catmatCode: "123456", justification: "Tentativa cross-tenant." }));
    expect(e?.code).toBe("NOT_FOUND");
    expect(await decisions(it0.id)).toEqual([]);
  }, 60_000);
});
