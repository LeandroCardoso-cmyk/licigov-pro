/**
 * R10 / SEM-061 — prévia do IMPACTO ORG-WIDE da troca do limiar CATMAT (MySQL real, appRouter real, órgãos 961061/961062):
 *   T1. a prévia conta a decisão VIGENTE de cada item (a superada conta uma vez), separa as tomadas sob outro limiar, e NÃO grava
 *       nada (versão do limiar e ledger idênticos antes/depois);
 *   T2. tenant: o outro órgão enxerga 0 — nunca o ledger alheio; operator é FORBIDDEN (manager+ como a própria troca);
 *   T3. a troca em si continua exigindo manager e versionando (versão anterior preservada, decisões antigas intactas).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, validateSchema } from "../../bootstrap";
import { createIntelligentItem } from "../../domain/intelligentItem";
import { insertIntelligentItem } from "../../db/procurement";
import { setCatmatThresholdConfig } from "../../db/catmatGovernance";

const DB = process.env.DATABASE_URL;
const ORG = 961061;
const ORG_B = 961062;

describe.skipIf(!DB)("R10 / SEM-061 — impacto org-wide do limiar CATMAT (MySQL)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let manager = 0, operator = 0, managerB = 0;

  async function caller(userId: number, org: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {}, correlationId: `sem061-${userId}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function err(p: Promise<unknown>): Promise<{ code: string } | null> {
    try { await p; return null; } catch (e) { return { code: (e as { code?: string }).code ?? "ERR" }; }
  }
  const count = async (sql: string, params: unknown[]) => Number(((await conn.execute<mysql.RowDataPacket[]>(sql, params as never[]))[0][0] as { n: number }).n);
  async function cleanup() {
    for (const t of ["intelligent_items", "process_timeline", "catmat_matches"]) await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
    for (const t of ["catmat_decisions", "catmat_threshold_config", "organization_members", "idempotency_keys"]) await conn.query(`DELETE FROM \`${t}\` WHERE organizationId IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
  }
  async function seed(tag: string) {
    const it = createIntelligentItem({
      organizationId: ORG, processId: `sem061-${tag}`, sourceResearchId: `res-${tag}`.slice(0, 20),
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
    for (const id of [ORG, ORG_B]) await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `SEM061 ${id}`, `sem061-${id}`]);
    const mk = async (tag: string) => (await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`sem061-${tag}-${stamp}`, tag, `sem061-${tag}-${stamp}@teste.local`]))[0].insertId;
    manager = await mk("manager"); operator = await mk("operator"); managerB = await mk("managerb");
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'manager', 1)", [ORG, manager]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG, operator]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'manager', 1)", [ORG_B, managerB]);
    await setCatmatThresholdConfig({ organizationId: ORG, minScore: 0.5, reason: "Limiar do smoke SEM-061", actorUserId: manager, correlationId: "sem061" });
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE id IN (?, ?, ?)", [manager, operator, managerB]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("T1) conta a decisão VIGENTE por item, separa as tomadas sob outro limiar e não grava nada", async () => {
    const a = await seed("a"); const b = await seed("b");
    const c = await caller(manager, ORG);
    const { suggestions } = await c.itemIntelligence.getCATMATSuggestions({ itemId: a.id });
    await c.itemIntelligence.acceptCATMAT({ itemId: a.id, matchId: suggestions[0].id, catmatCode: suggestions[0].catmatCode });
    await c.itemIntelligence.manualCATMAT({ itemId: a.id, catmatCode: "123456", justification: "Supera a confirmação anterior." }); // a: vigente = substituido
    await c.itemIntelligence.manualCATMAT({ itemId: b.id, catmatCode: "654321", justification: "Código conferido no catálogo." });
    const ledgerBefore = await count("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ?", [ORG]);
    const versionsBefore = await count("SELECT COUNT(*) n FROM catmat_threshold_config WHERE organizationId = ?", [ORG]);

    const same = await c.itemIntelligence.previewCATMATThresholdChange({ minScore: 0.5 });
    expect(same.current).toMatchObject({ minScore: 0.5, version: 1 });
    expect(same.impact).toMatchObject({ itemsWithCurrentDecision: 2, totalLedgerEntries: 3, currentDecisionsUnderOtherThreshold: 0 });
    expect(same.impact.byDecision).toMatchObject({ substituido: 2, confirmado: 0 }); // a superada não conta como vigente
    const other = await c.itemIntelligence.previewCATMATThresholdChange({ minScore: 0.8 });
    expect(other.proposedMinScore).toBe(0.8);
    expect(other.impact.currentDecisionsUnderOtherThreshold).toBe(2);

    expect(await count("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ?", [ORG])).toBe(ledgerBefore);
    expect(await count("SELECT COUNT(*) n FROM catmat_threshold_config WHERE organizationId = ?", [ORG])).toBe(versionsBefore);
  }, 120_000);

  it("T2) tenant e papel: outro órgão vê 0; operator é FORBIDDEN; entrada inválida recusada", async () => {
    const other = await (await caller(managerB, ORG_B)).itemIntelligence.previewCATMATThresholdChange({ minScore: 0.8 });
    expect(other.current).toBeNull();
    expect(other.impact).toMatchObject({ itemsWithCurrentDecision: 0, totalLedgerEntries: 0 });
    expect((await err((await caller(operator, ORG)).itemIntelligence.previewCATMATThresholdChange({ minScore: 0.8 })))?.code).toBe("FORBIDDEN");
    expect((await err((await caller(manager, ORG)).itemIntelligence.previewCATMATThresholdChange({ minScore: 1.5 })))?.code).toBe("BAD_REQUEST");
  }, 60_000);

  it("T3) a troca segue exigindo manager e versiona; decisões antigas permanecem intactas", async () => {
    expect((await err((await caller(operator, ORG)).itemIntelligence.setCATMATThreshold({ minScore: 0.8, reason: "Tentativa de operator" })))?.code).toBe("FORBIDDEN");
    const ledgerBefore = await count("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ?", [ORG]);
    await (await caller(manager, ORG)).itemIntelligence.setCATMATThreshold({ minScore: 0.8, reason: "Nova política institucional" });
    expect(await count("SELECT COUNT(*) n FROM catmat_threshold_config WHERE organizationId = ?", [ORG])).toBe(2);
    expect(await count("SELECT COUNT(*) n FROM catmat_threshold_config WHERE organizationId = ? AND active = 1", [ORG])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ?", [ORG])).toBe(ledgerBefore);
  }, 60_000);
});
