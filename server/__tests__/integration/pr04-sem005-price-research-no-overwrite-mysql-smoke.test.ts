/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR-04 (SEM-005) — a Pesquisa de Preços NUNCA substitui cotações em silêncio (MySQL REAL, flag REAL, worker REAL).
 * Órgãos sintéticos 992041 (A, `FF_CANONICAL_INGESTION` LIGADA por override do tenant) e 992042 (B, sem override ⇒
 * desligada). Nunca a org 1.
 *
 *  [A1] órgão A: duas importações CANÔNICAS sucessivas do mesmo item (3 + 3 fornecedores) ⇒ 6 cotações no domínio,
 *       em duas pesquisas distintas (uma por sessão); o Item Inteligente consolida as 6.
 *  [A2] órgão A: `procurementProcess.importPriceResearch` (gravação direta legada) ⇒ PRECONDITION_FAILED explicativo,
 *       nada gravado (pesquisa, cotações, itens e timeline intactos), mesmo com `confirmReplace`.
 *  [B1] órgão B (flag desligada): 2ª colagem com o mesmo item nas mesmas linhas e OUTROS fornecedores ⇒ CONFLICT
 *       `QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED`, rollback: as 3 cotações originais e a média permanecem.
 *  [B2] órgão B: pesquisa completa (anteriores + novas abaixo) ⇒ 6 cotações, nenhuma substituída; replay idêntico no-op.
 *  [B3] órgão B: correção explícita (`confirmReplace`) ⇒ substitui e registra na timeline.
 *  [T]  isolamento: a flag do órgão A não afeta o B; o processo de A é NOT_FOUND para B.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 992041;
const ORG_B = 992042;

const mem = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", () => ({
  storageGetBytes: async (key: string) => { const b = mem.get(key); if (!b) throw new Error(`storage vazio: ${key}`); return b; },
  storagePut: async (key: string, data: string | Buffer) => { mem.set(key, Buffer.from(data)); return { key, url: "" }; },
}));

import { runMigrations } from "../../bootstrap";
import { getDb } from "../../db/connection";
import { importSessions } from "../../../drizzle/schema";
import { enqueueImport } from "../../services/importQueueService";
import { getImportSession } from "../../services/fileIngestionService";
import { invalidateFlagCache } from "../../services/featureFlagService";
import { CANONICAL_INGESTION_FLAG } from "../../services/ingestionUploadService";
import { insertProcess, listIntelligentItems, listProcessTimeline } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";

let conn: mysql.Connection;
let seq = 0;
const stamp = Date.now();
const U: Record<string, number> = {};

const FIRST = ["Descrição;Quantidade;Unidade;Valor unitário;Fornecedor",
  "Notebook;10;UN;4.000,00;Fornecedor A", "Notebook;10;UN;4.100,00;Fornecedor B", "Notebook;10;UN;3.900,00;Fornecedor C"];
const SECOND = ["Descrição;Quantidade;Unidade;Valor unitário;Fornecedor",
  "Notebook;10;UN;4.200,00;Fornecedor D", "Notebook;10;UN;4.050,00;Fornecedor E", "Notebook;10;UN;3.950,00;Fornecedor F"];

const rows = async (q: string, p: unknown[] = []) => (await conn.execute<mysql.RowDataPacket[]>(q, p))[0];
const quotesOf = async (org: number, pid: string) =>
  (await rows("SELECT research_id, supplier, value FROM price_research_items WHERE organization_id=? AND process_id=? ORDER BY supplier", [org, pid]))
    .map((r) => ({ research: r.research_id as string, supplier: r.supplier as string, value: String(r.value) }));

async function asUser(id: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({ user: { id, role: "user" }, req: { headers: {} }, res: {}, correlationId: `pr04-${id}-${++seq}`, requestId: `req-${seq}` } as any);
}
async function newProcess(org: number, operator: number): Promise<string> {
  const p = createProcurementWorkspace({
    organizationId: org, processNumber: `PR04-${stamp}-${++seq}`, object: "Notebooks (PR-04 sintético)",
    startOption: "importar_tr", responsibleUser: operator, correlationId: "pr04",
  });
  await insertProcess(p);
  return p.id;
}
/** Sessão REAL: CSV pelo worker (parser real) ⇒ staging pendente. */
async function csvSession(org: number, processId: string, csv: string): Promise<number> {
  const db = (await getDb())!;
  const buf = Buffer.from(`${csv}${"\n".repeat(++seq)}`, "utf8");
  const key = `imports/${org}/${stamp}-${seq}-pesquisa.csv`;
  mem.set(key, buf);
  const checksum = createHash("sha256").update(buf).digest("hex");
  const [s] = await db.insert(importSessions).values({
    organizationId: org, uploadedBy: U.operatorA, sourceFileId: key, sourceFileName: "pesquisa.csv", sourceMimeType: "text/csv",
    sourceSize: buf.length, checksum, procurementProcessId: processId, importType: "price_research", parserType: "auto",
    status: "uploaded", stage: "file_stored", correlationId: `pr04-${seq}`,
  }).$returningId();
  expect(enqueueImport(s.id, org, key, { correlationId: `pr04-${s.id}` })).not.toBeNull();
  for (let i = 0; i < 600; i++) {
    const cur = await getImportSession(s.id, org);
    if (cur && cur.status === "awaiting_review" && cur.stage === "awaiting_review") return s.id;
    if (cur?.status === "failed") throw new Error("worker falhou");
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("worker não concluiu");
}
async function approveAndPromote(sid: number, pid: string) {
  const op = await asUser(U.operatorA);
  const rev = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
  await op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "approved", groups: rev.groups.map((g: any) => ({ groupKey: g.groupKey, expectedRevision: g.revision })) });
  await op.ingestion.approveSession({ sessionId: sid, procurementProcessId: pid });
  return (await asUser(U.managerA)).ingestion.promoteSession({ sessionId: sid, procurementProcessId: pid, idempotencyKey: `pr04-promo-${sid}` });
}
async function errOf(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try { await p; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
  throw new Error("esperava erro");
}
async function cleanup() {
  const tables: Array<[string, string]> = [
    ["import_promotions", "organizationId"], ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"],
    ["import_sessions", "organizationId"], ["price_research_items", "organization_id"], ["price_research", "organization_id"],
    ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"],
    ["intelligent_item_identity_aliases", "organization_id"], ["intelligent_items", "organization_id"], ["process_timeline", "organization_id"],
    ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"], ["activity_logs", "organizationId"],
    ["tenant_feature_flags", "organizationId"], ["organization_members", "organizationId"],
  ];
  for (const org of [ORG_A, ORG_B]) for (const [t, col] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(() => {});
}

describe.skipIf(!DB)("PR-04 / SEM-005 — cotações nunca substituídas em silêncio (MySQL real, flag real, worker real)", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const [id, slug] of [[ORG_A, `pr04-a-${stamp}`], [ORG_B, `pr04-b-${stamp}`]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `Prefeitura Sintética ${id}`, slug]);
    }
    for (const [tag, org, role] of [["operatorA", ORG_A, "operator"], ["managerA", ORG_A, "manager"], ["operatorB", ORG_B, "operator"]] as const) {
      const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'PR04', ?)", [`pr04-${tag}-${stamp}`, `pr04-${tag}-${stamp}@teste.local`]);
      U[tag] = u.insertId;
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u.insertId, role]);
    }
    // Override do TENANT (não global): só o órgão A tem a ingestão canônica ligada.
    await conn.execute("INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage) VALUES (?, ?, 1, 100)", [ORG_A, CANONICAL_INGESTION_FLAG]);
    invalidateFlagCache();
  }, 180_000);
  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    const ids = Object.values(U).filter(Boolean);
    if (ids.length) await conn.execute(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    invalidateFlagCache();
    await conn.end();
  });

  let pidA = "";

  it("[A1] duas importações CANÔNICAS sucessivas do mesmo item ⇒ 6 cotações em 2 pesquisas; o item consolida as 6", async () => {
    expect((await (await asUser(U.operatorA)).ingestion.getCapabilities()).enabled).toBe(true);
    pidA = await newProcess(ORG_A, U.operatorA);
    await approveAndPromote(await csvSession(ORG_A, pidA, FIRST.join("\n")), pidA);
    expect(await quotesOf(ORG_A, pidA)).toHaveLength(3);
    await approveAndPromote(await csvSession(ORG_A, pidA, SECOND.join("\n")), pidA);

    const q = await quotesOf(ORG_A, pidA);
    expect(q.map((x) => x.supplier)).toEqual(["Fornecedor A", "Fornecedor B", "Fornecedor C", "Fornecedor D", "Fornecedor E", "Fornecedor F"]);
    expect(q.map((x) => x.value)).toEqual(["4000.00", "4100.00", "3900.00", "4200.00", "4050.00", "3950.00"]);
    expect(new Set(q.map((x) => x.research)).size).toBe(2); // uma pesquisa por sessão
    const items = await listIntelligentItems(pidA, ORG_A);
    expect(items).toHaveLength(1);
    expect(items[0].quoteCount).toBe(6);
    expect(items[0].suppliers.map((s) => s.name).sort()).toEqual(["Fornecedor A", "Fornecedor B", "Fornecedor C", "Fornecedor D", "Fornecedor E", "Fornecedor F"]);
  });

  it("[A2] flag ligada: gravação direta legada recusada pelo servidor, sem efeito (inclusive com confirmReplace)", async () => {
    const before = { q: await quotesOf(ORG_A, pidA), research: await rows("SELECT id, item_count FROM price_research WHERE organization_id=? ORDER BY id", [ORG_A]), tl: (await listProcessTimeline(pidA, ORG_A)).length };
    const op = await asUser(U.operatorA);
    for (const confirmReplace of [undefined, true]) {
      const e = await errOf(op.procurementProcess.importPriceResearch({ processId: pidA, source: "colar", text: SECOND.slice(1).join("\n"), confirmReplace }));
      expect(e.code).toBe("PRECONDITION_FAILED");
      expect(e.message).toMatch(/^LEGACY_PRICE_IMPORT_DISABLED:/);
    }
    expect(await quotesOf(ORG_A, pidA)).toEqual(before.q);
    expect(await rows("SELECT id, item_count FROM price_research WHERE organization_id=? ORDER BY id", [ORG_A])).toEqual(before.research);
    expect((await listProcessTimeline(pidA, ORG_A)).length).toBe(before.tl);
  });

  let pidB = "";
  const FIRST_PASTE = FIRST.slice(1).join("\n");
  const SECOND_PASTE = SECOND.slice(1).join("\n");

  it("[B1] flag desligada: 2ª colagem com outros fornecedores nas mesmas linhas ⇒ CONFLICT, rollback (3 originais intactas)", async () => {
    const op = await asUser(U.operatorB);
    expect((await op.ingestion.getCapabilities()).enabled).toBe(false); // flag do órgão A não vaza para o B
    pidB = await newProcess(ORG_B, U.operatorB);
    await op.procurementProcess.importPriceResearch({ processId: pidB, source: "colar", text: FIRST_PASTE });
    const original = await quotesOf(ORG_B, pidB);
    expect(original.map((x) => x.supplier)).toEqual(["Fornecedor A", "Fornecedor B", "Fornecedor C"]);
    const [item0] = await listIntelligentItems(pidB, ORG_B);
    const tl0 = (await listProcessTimeline(pidB, ORG_B)).length;

    const e = await errOf(op.procurementProcess.importPriceResearch({ processId: pidB, source: "colar", text: SECOND_PASTE }));
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toMatch(/^QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED: esta importação substituiria 3 cotação/);
    expect(await quotesOf(ORG_B, pidB)).toEqual(original);
    const [item1] = await listIntelligentItems(pidB, ORG_B);
    expect([item1.quoteCount, item1.averagePriceCents]).toEqual([item0.quoteCount, item0.averagePriceCents]);
    expect((await listProcessTimeline(pidB, ORG_B)).length).toBe(tl0);
  });

  it("[B2] pesquisa completa (anteriores + novas abaixo) ⇒ 6 cotações, nenhuma substituída; replay idêntico é no-op", async () => {
    const op = await asUser(U.operatorB);
    const full = `${FIRST_PASTE}\n${SECOND_PASTE}`;
    await op.procurementProcess.importPriceResearch({ processId: pidB, source: "colar", text: full });
    const q = await quotesOf(ORG_B, pidB);
    expect(q.map((x) => [x.supplier, x.value])).toEqual([
      ["Fornecedor A", "4000.00"], ["Fornecedor B", "4100.00"], ["Fornecedor C", "3900.00"],
      ["Fornecedor D", "4200.00"], ["Fornecedor E", "4050.00"], ["Fornecedor F", "3950.00"],
    ]);
    const [item] = await listIntelligentItems(pidB, ORG_B);
    expect(item.quoteCount).toBe(6);
    const again = await op.procurementProcess.importPriceResearch({ processId: pidB, source: "colar", text: full });
    expect(again.materialization.updated).toBe(0);
    expect(await quotesOf(ORG_B, pidB)).toEqual(q);
  });

  it("[B3] correção explícita (confirmReplace) substitui e fica registrada na timeline", async () => {
    const op = await asUser(U.operatorB);
    const corrected = FIRST_PASTE.replace("4.000,00;Fornecedor A", "4.010,00;Fornecedor A");
    const fullCorrected = `${corrected}\n${SECOND_PASTE}`;
    expect((await errOf(op.procurementProcess.importPriceResearch({ processId: pidB, source: "colar", text: fullCorrected }))).code).toBe("CONFLICT");
    await op.procurementProcess.importPriceResearch({ processId: pidB, source: "colar", text: fullCorrected, confirmReplace: true });
    const q = await quotesOf(ORG_B, pidB);
    expect(q).toHaveLength(6);
    expect(q.find((x) => x.supplier === "Fornecedor A")!.value).toBe("4010.00");
    expect((await listProcessTimeline(pidB, ORG_B)).some((e) => e.summary.includes("1 cotação(ões) anterior(es) substituída(s) por confirmação do usuário"))).toBe(true);
  });

  it("[T] isolamento: processo do órgão A é NOT_FOUND para o órgão B; cotações de A intactas", async () => {
    const before = await quotesOf(ORG_A, pidA);
    const e = await errOf((await asUser(U.operatorB)).procurementProcess.importPriceResearch({ processId: pidA, source: "colar", text: FIRST_PASTE, confirmReplace: true }));
    expect(e.code).toBe("NOT_FOUND");
    expect(await quotesOf(ORG_A, pidA)).toEqual(before);
  });
});
