/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pesquisa de Preços — revisão por ITEM LÓGICO contra MySQL REAL (CI: MySQL 8).
 *
 * Golden E (fixture sanitizada, gerada em tempo de teste) pelo WORKER real ⇒ 30 cotações em staging. Pelo ROUTER
 * real: a revisão apresenta 5 itens × 30 cotações (7/7/5/5/6); decisão por item é ATÔMICA (todas as cotações
 * pendentes do item ou nada), auditada com cada cotação afetada, protegida por revisão otimista e por locks;
 * concorrência ⇒ uma decisão vence; IDs de outro item/sessão/tenant nunca são aceitos; RBAC (viewer não decide;
 * promoção segue manager+); promoção após revisão por item ⇒ 5 Itens Inteligentes (não 30), lineage preservada.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG = 990911;
const ORG2 = 990912;

const mem = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", () => ({
  storageGetBytes: async (key: string) => { const b = mem.get(key); if (!b) throw new Error(`storage vazio: ${key}`); return b; },
  storagePut: async (key: string, data: string | Buffer) => { mem.set(key, Buffer.from(data)); return { key, url: "" }; },
}));
vi.mock("../../services/featureFlagService", async (orig) => {
  const actual = await orig<typeof import("../../services/featureFlagService")>();
  return { ...actual, isFeatureEnabled: vi.fn(async () => true) };
});

import { runMigrations } from "../../bootstrap";
import { getDb } from "../../db/connection";
import { importSessions } from "../../../drizzle/schema";
import { enqueueImport } from "../../services/importQueueService";
import { getImportSession } from "../../services/fileIngestionService";
import { getStagingItems } from "../../services/importStagingService";
import { reviewPriceResearchGroups } from "../../services/priceResearchReviewService";
import { insertProcess, listIntelligentItems } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { goldenEPdf } from "../fixtures/layoutPdfFixtures";

let conn: mysql.Connection;
let seq = 0;
let GOLDEN: Buffer;
const users: Record<string, number> = {};

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params as any[]);
  return Number((rows[0] as any).n);
}

async function newProcess(org: number): Promise<string> {
  const p = createProcurementWorkspace({
    organizationId: org, processNumber: `GRP-${Date.now()}-${++seq}`, object: "Aquisição de materiais (fictício)",
    startOption: "importar_tr", responsibleUser: users.operator ?? 1, correlationId: "group-smoke",
  });
  await insertProcess(p);
  return p.id;
}

/** Sessão real: Golden E pelo worker (parser layout-aware) ⇒ 30 cotações pendentes em staging. */
async function goldenSession(org: number, processId: string) {
  const db = (await getDb())!;
  const key = `imports/${org}/${Date.now()}-${++seq}-mapa.pdf`;
  mem.set(key, GOLDEN);
  const checksum = createHash("sha256").update(`${GOLDEN.length}-${seq}-${org}`).update(GOLDEN).digest("hex");
  const [s] = await db.insert(importSessions).values({
    organizationId: org, uploadedBy: users.operator ?? 1, sourceFileId: key, sourceFileName: "mapa.pdf", sourceMimeType: "application/pdf",
    sourceSize: GOLDEN.length, checksum, procurementProcessId: processId, importType: "price_research", parserType: "auto",
    status: "uploaded", stage: "file_stored", correlationId: `grp-${seq}`,
  }).$returningId();
  expect(enqueueImport(s.id, org, key, { correlationId: `grp-${s.id}` })).not.toBeNull();
  for (let i = 0; i < 600; i++) {
    const cur = await getImportSession(s.id, org);
    if (cur && cur.status === "awaiting_review" && cur.stage === "awaiting_review") return s.id;
    if (cur?.status === "failed") throw new Error("worker falhou");
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("worker não concluiu");
}

async function asUser(id: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({ user: { id, role: "user" }, req: { headers: {} }, res: {}, correlationId: `grp-corr-${id}-${++seq}`, requestId: `req-${seq}` } as any);
}

async function mkUser(org: number, role: string): Promise<number> {
  const tag = `${role}-${org}-${Date.now()}-${++seq}`;
  const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'Grupo', ?)", [`grp-${tag}`, `grp-${tag}@teste.local`]);
  await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u.insertId, role]);
  return u.insertId;
}

async function cleanup() {
  const tables: Array<[string, string]> = [
    ["import_promotions", "organizationId"], ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"],
    ["import_sessions", "organizationId"], ["price_research_items", "organization_id"], ["price_research", "organization_id"],
    ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"],
    ["intelligent_items", "organization_id"], ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"],
    ["activity_logs", "organizationId"], ["organization_members", "organizationId"],
  ];
  for (const org of [ORG, ORG2]) for (const [t, col] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(() => {});
  await conn.query("DELETE FROM users WHERE openId LIKE 'grp-%'").catch(() => {});
}

describe.skipIf(!DB)("Pesquisa de Preços — revisão por item lógico (MySQL real)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    for (const [id, slug] of [[ORG, "group-org"], [ORG2, "group-org-2"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, slug, slug]).catch(() => {});
    }
    await cleanup();
    users.operator = await mkUser(ORG, "operator");
    users.operator2 = await mkUser(ORG, "operator");
    users.viewer = await mkUser(ORG, "viewer");
    users.manager = await mkUser(ORG, "manager");
    users.operatorB = await mkUser(ORG2, "operator");
    GOLDEN = await goldenEPdf();
  }, 180_000);
  afterAll(async () => { await cleanup().catch(() => {}); await conn?.end(); });

  it("1) parser real ⇒ revisão com 5 ITENS e 30 COTAÇÕES (7/7/5/5/6), médias reconciliadas, contadores separados", async () => {
    const pid = await newProcess(ORG);
    const sid = await goldenSession(ORG, pid);
    const op = await asUser(users.operator);
    const r = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
    expect(r.counts.logicalItems).toBe(5);
    expect(r.counts.quotes).toBe(30);
    expect(r.counts.items.pending).toBe(5);
    expect(r.counts.quoteStatus.pending).toBe(30);
    expect(r.groups.map((g) => g.quoteCount)).toEqual([7, 7, 5, 5, 6]);
    expect(r.groups.map((g) => g.extractedAverageCents)).toEqual([95031, 6723, 113428, 14529, 105282]);
    expect(r.groups.every((g) => g.averageMatches === true && g.identity.status === "consistent")).toBe(true);
    expect(r.groups.reduce((a, g) => a + (g.extractedAverageCents ?? 0), 0)).toBe(334993);
    expect(new Set(r.groups.flatMap((g) => g.quotes.map((q) => q.stagingRowId))).size).toBe(30);
    // o staging continua uma linha por cotação (nada foi persistido pela projeção)
    expect(await getStagingItems(sid, ORG)).toHaveLength(30);
  });

  it("2) decisão por item: ATÔMICA, só pendentes, auditada com cada cotação (antes/depois, ator, correlação, motivo)", async () => {
    const pid = await newProcess(ORG);
    const sid = await goldenSession(ORG, pid);
    const op = await asUser(users.operator);
    let rev = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
    // Uma cotação do item 1 é rejeitada individualmente antes (decisão humana a preservar).
    const rejectedId = rev.groups[0].quotes[6].stagingRowId;
    await op.ingestion.reviewItem({ sessionId: sid, procurementProcessId: pid, itemId: rejectedId, action: "rejected", note: "valor fora do padrão" });
    rev = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
    const g = rev.groups[0];
    expect(g.status).toBe("partially_reviewed");
    expect(g.documentAverageCents).toBe(95031);        // evidência histórica preservada
    expect(g.extractedAverageCents).toBe(95031);
    expect(g.consideredQuoteCount).toBe(6);
    expect(g.consideredAverageCents).not.toBe(95031);  // média após revisão exibida SEPARADAMENTE

    const res = await op.ingestion.reviewPriceResearchGroups({
      sessionId: sid, procurementProcessId: pid, action: "approved", groups: [{ groupKey: g.groupKey, expectedRevision: g.revision }], note: "item conferido",
    });
    expect(res.affectedQuoteCount).toBe(6);
    const after = res.review.groups[0];
    expect(after.status).toBe("reviewed");
    expect(after.statusCounts).toEqual({ pending: 0, approved: 6, rejected: 1, skipped: 0 });
    expect(res.review.counts.items).toEqual({ pending: 4, partially_reviewed: 0, reviewed: 1, rejected: 0 });
    const staged = await getStagingItems(sid, ORG);
    expect(staged.find((i) => i.id === rejectedId)!.reviewStatus).toBe("rejected");
    expect(staged.filter((i) => g.quotes.some((q) => q.stagingRowId === i.id) && i.id !== rejectedId).every((i) => i.reviewStatus === "approved" && i.reviewedBy === users.operator)).toBe(true);
    expect(staged.filter((i) => !g.quotes.some((q) => q.stagingRowId === i.id)).every((i) => i.reviewStatus === "pending")).toBe(true);

    const [logs] = await conn.execute<mysql.RowDataPacket[]>("SELECT * FROM activity_logs WHERE organizationId = ? AND action = 'import_item_group_reviewed' AND entityId = ?", [ORG, sid]);
    expect(logs).toHaveLength(1);
    const d = JSON.parse(logs[0].details);
    expect(logs[0].userId).toBe(users.operator);
    expect(logs[0].correlationId).toMatch(/^grp-corr-/);
    expect(d).toMatchObject({ procurementProcessId: pid, sessionId: sid, action: "approved", note: "item conferido", affectedQuoteCount: 6 });
    expect(d.groups[0].groupKey).toBe(g.groupKey);
    expect(d.groups[0].affectedQuotes).toHaveLength(6);
    expect(d.groups[0].affectedQuotes[0]).toMatchObject({ from: "pending", to: "approved" });
    expect(d.groups[0].preservedDecisions).toEqual([{ stagingRowId: rejectedId, status: "rejected" }]);
    expect(d.groups[0].sourceRowKeys).toHaveLength(1); // identidade estrutural da linha do documento
    expect(Array.isArray(d.groups[0].identifiers)).toBe(true);
    expect(typeof d.timestamp).toBe("string");
  });

  it("3) revisão velha ⇒ CONFLICT e nada muda; item ambíguo/inexistente ⇒ recusado; outro tenant ⇒ NOT_FOUND", async () => {
    const pid = await newProcess(ORG);
    const sid = await goldenSession(ORG, pid);
    const op = await asUser(users.operator);
    const rev = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
    const g = rev.groups[1];
    // Outra decisão muda o item depois da leitura ⇒ a decisão baseada na leitura velha é rejeitada.
    await op.ingestion.reviewItem({ sessionId: sid, procurementProcessId: pid, itemId: g.quotes[0].stagingRowId, action: "skipped" });
    await expect(op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "approved", groups: [{ groupKey: g.groupKey, expectedRevision: g.revision }] }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getStagingItems(sid, ORG)).filter((i) => i.reviewStatus === "approved")).toHaveLength(0);

    // groupKey que não pertence a esta sessão (inventada/de outro item) ⇒ NOT_FOUND.
    await expect(op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "approved", groups: [{ groupKey: "a".repeat(32), expectedRevision: "b".repeat(16) }] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    // Lote com um item válido + um inválido ⇒ nada é aplicado (atomicidade entre itens).
    const g3 = rev.groups[2];
    await expect(op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "approved", groups: [
      { groupKey: g3.groupKey, expectedRevision: g3.revision }, { groupKey: g.groupKey, expectedRevision: g.revision },
    ] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getStagingItems(sid, ORG)).filter((i) => i.reviewStatus === "approved")).toHaveLength(0);

    // Tenant B (operador de outra organização) não lê nem decide a sessão de A.
    const opB = await asUser(users.operatorB);
    await expect(opB.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(opB.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "rejected", groups: [{ groupKey: g3.groupKey, expectedRevision: g3.revision }] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reviewPriceResearchGroups({ organizationId: ORG2, sessionId: sid, procurementProcessId: pid, actorUserId: users.operatorB, action: "rejected", groups: [{ groupKey: g3.groupKey, expectedRevision: g3.revision }] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getStagingItems(sid, ORG)).filter((i) => i.reviewStatus === "rejected")).toHaveLength(0);

    // Processo errado ⇒ NOT_FOUND; viewer ⇒ FORBIDDEN.
    await expect(op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: "OUTRO-PROC", action: "approved", groups: [{ groupKey: g3.groupKey, expectedRevision: g3.revision }] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const viewer = await asUser(users.viewer);
    await expect(viewer.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "approved", groups: [{ groupKey: g3.groupKey, expectedRevision: g3.revision }] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await count("SELECT COUNT(*) n FROM activity_logs WHERE organizationId IN (?, ?) AND action = 'import_item_group_reviewed' AND entityId = ?", [ORG, ORG2, sid])).toBe(0);
  });

  it("4) concorrência: dois revisores decidem o MESMO item ao mesmo tempo ⇒ exatamente um vence, sem estado parcial", async () => {
    const pid = await newProcess(ORG);
    const sid = await goldenSession(ORG, pid);
    const [a, b] = [await asUser(users.operator), await asUser(users.operator2)];
    const rev = await a.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
    const g = rev.groups[0];
    const req = (action: "approved" | "rejected") => ({ sessionId: sid, procurementProcessId: pid, action, groups: [{ groupKey: g.groupKey, expectedRevision: g.revision }] });
    const results = await Promise.allSettled([a.ingestion.reviewPriceResearchGroups(req("approved")), b.ingestion.reviewPriceResearchGroups(req("rejected"))]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ code: "CONFLICT" });
    const statuses = new Set((await getStagingItems(sid, ORG)).filter((i) => g.quotes.some((q) => q.stagingRowId === i.id)).map((i) => i.reviewStatus));
    expect(statuses.size).toBe(1); // todas as 7 com a MESMA decisão (nunca metade/metade)
    expect(await count("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND action = 'import_item_group_reviewed' AND entityId = ?", [ORG, sid])).toBe(1);
  });

  it("5) revisão por item → aprovação → promoção (manager) ⇒ 5 Itens Inteligentes (não 30), 30 cotações, lineage intacta", async () => {
    const pid = await newProcess(ORG);
    const sid = await goldenSession(ORG, pid);
    const op = await asUser(users.operator);
    const rev = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
    const res = await op.ingestion.reviewPriceResearchGroups({
      sessionId: sid, procurementProcessId: pid, action: "approved", groups: rev.groups.map((g) => ({ groupKey: g.groupKey, expectedRevision: g.revision })),
    });
    expect(res.affectedQuoteCount).toBe(30);
    expect(res.review.counts.items).toEqual({ pending: 0, partially_reviewed: 0, reviewed: 5, rejected: 0 });
    // Replay idempotente da mesma decisão (revisões novas; nada pendente) ⇒ 0 cotações afetadas.
    const again = await op.ingestion.reviewPriceResearchGroups({
      sessionId: sid, procurementProcessId: pid, action: "approved", groups: res.review.groups.map((g) => ({ groupKey: g.groupKey, expectedRevision: g.revision })),
    });
    expect(again.affectedQuoteCount).toBe(0);

    await op.ingestion.approveSession({ sessionId: sid, procurementProcessId: pid });
    await expect(op.ingestion.promoteSession({ sessionId: sid, procurementProcessId: pid, idempotencyKey: `grp-promo-op-${sid}` })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Sessão aprovada: decisões por item encerradas.
    await expect(op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "rejected", groups: [{ groupKey: res.review.groups[0].groupKey, expectedRevision: res.review.groups[0].revision }] }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const mgr = await asUser(users.manager);
    const promo = await mgr.ingestion.promoteSession({ sessionId: sid, procurementProcessId: pid, idempotencyKey: `grp-promo-mgr-${sid}` });
    expect(promo).toMatchObject({ idempotent: false, itemsPromoted: 30 });
    const items = await listIntelligentItems(pid, ORG);
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.quoteCount).sort((x, y) => x - y)).toEqual([5, 5, 6, 7, 7]);
    expect(items.map((i) => i.averagePriceCents).sort((x, y) => x - y)).toEqual([6723, 14529, 95031, 105282, 113428]);
    // Lineage das cotações promovidas continua apontando para a sessão/linha de staging de origem.
    expect(await count("SELECT COUNT(*) n FROM price_research_items WHERE organization_id = ? AND process_id = ? AND observations LIKE ?", [ORG, pid, `%sessão ${sid}, item %`])).toBe(30);
  });
});
