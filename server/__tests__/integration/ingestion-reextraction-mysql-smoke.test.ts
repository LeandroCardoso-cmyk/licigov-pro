/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Layout v2 — PDF DIGITAL layout-aware + REPROCESSAMENTO SEGURO contra MySQL REAL (CI: MySQL 8).
 *
 * Golden E (fixture sanitizada gerada em tempo de teste) pelo WORKER real: 5 itens / 30 cotações, OCR não roda.
 * Cenário que espelha a homologação: sessão em `awaiting_review` com extração ANTIGA (v1: 10 linhas-lixo como
 * "R$", título, cabeçalhos), nenhuma decisão humana → "Reprocessar extração" pelo ROUTER real → a MESMA sessão
 * passa a ter as 30 cotações (troca atômica, versão/linhagem/auditoria), sem criar sessão/pesquisa/promoção.
 * Invariantes: qualquer intervenção humana ⇒ FORBIDDEN; RBAC (viewer não; promoção segue manager+); tenant B não
 * lê/reprocessa; reservas simultâneas ⇒ uma vence; revisão durante o reprocessamento ⇒ nada é substituído;
 * falha no meio da troca ⇒ rollback total; extração sem itens nunca substitui a anterior; promoção sem duplicar.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createHash } from "crypto";
import mysql from "mysql2/promise";
import PDFDocument from "pdfkit";
import { and, eq } from "drizzle-orm";

const DB = process.env.DATABASE_URL;
const ORG = 990901;
const ORG2 = 990902;

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
import { importSessions, importStagingItems } from "../../../drizzle/schema";
import { enqueueImport } from "../../services/importQueueService";
import { getImportSession } from "../../services/fileIngestionService";
import { getStagingItems, getStagingSummary, bulkReviewStagingItems, StagingAlreadyReviewedError } from "../../services/importStagingService";
import { commitReextraction, releaseReextraction, reserveReextraction } from "../../services/importReprocessService";
import { insertProcess, listIntelligentItems } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { setOcrAdapterForTesting } from "../../providers/ocr";
import { averageCents, parseBRL } from "../../domain/money";
import { PdfParser } from "../../parsers/pdfParser";
import { goldenEPdf } from "../fixtures/layoutPdfFixtures";

let conn: mysql.Connection;
let seq = 0;
let GOLDEN: Buffer;
const users: Record<string, number> = {};
const ocrCalls = { n: 0 };

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params as any[]);
  return Number((rows[0] as any).n);
}

async function newProcess(org: number): Promise<string> {
  const p = createProcurementWorkspace({
    organizationId: org, processNumber: `LAY-${Date.now()}-${++seq}`, object: "Aquisição de lubrificantes (fictício)",
    startOption: "importar_tr", responsibleUser: users.operator ?? 1, correlationId: "layout-smoke",
  });
  await insertProcess(p);
  return p.id;
}

async function newSession(org: number, processId: string, bytes: Buffer) {
  const db = (await getDb())!;
  const key = `imports/${org}/${Date.now()}-${++seq}-mapa.pdf`;
  mem.set(key, bytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const [s] = await db.insert(importSessions).values({
    organizationId: org, uploadedBy: users.operator ?? 1, sourceFileId: key, sourceFileName: "mapa.pdf", sourceMimeType: "application/pdf",
    sourceSize: bytes.length, checksum, procurementProcessId: processId, importType: "price_research", parserType: "auto",
    status: "uploaded", stage: "file_stored", correlationId: `lay-${seq}`,
  }).$returningId();
  return { id: s.id, key, checksum };
}

async function waitWorker(id: number, org: number) {
  for (let i = 0; i < 600; i++) {
    const cur = await getImportSession(id, org);
    if (cur && ["awaiting_review", "failed"].includes(cur.status) && !["retry", "queued", "parsing", "ocr_processing", "extracted", "reprocessing"].includes(cur.stage ?? "")) return cur;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("worker não concluiu");
}

/**
 * Sessão "como em produção": extração ANTIGA (parser 2.2.0, sem versão de layout) com 10 linhas-lixo, todas
 * pendentes — nenhuma decisão humana. Conteúdo genérico/fictício (sem dado real).
 */
const LEGACY_JUNK = ["R$", "MAPA DE APURAÇÃO DE", "PREÇOS", "Descrição", "Fornecedor A", "R$ R$ R$", "MÉDIA ARITMÉTICA", "VALOR TOTAL", "Página 1 de 2", "Portal Público 1"];
async function legacySession(org: number, processId: string) {
  const s = await newSession(org, processId, GOLDEN);
  const db = (await getDb())!;
  for (const [k, junk] of LEGACY_JUNK.entries()) {
    await db.insert(importStagingItems).values({
      importSessionId: s.id, organizationId: org, rawDescription: junk, rawUnitPrice: k % 2 ? "950,31" : null,
      parserMetadata: { parserType: "pdf", parserVersion: "2.2.0", processingMs: 0, rawCellValues: {} } as any, reviewStatus: "pending",
    });
  }
  await db.update(importSessions).set({
    status: "awaiting_review", stage: "awaiting_review", parserType: "pdf", parserVersion: "2.2.0",
    extractionSummary: { extraction: { lineageVersion: "1", extractionMode: "native_text", parserVersion: "2.2.0", fingerprint: "f".repeat(64), sourceChecksum: s.checksum } } as any,
  }).where(mysqlScope(s.id, org));
  return s;
}
const mysqlScope = (id: number, org: number) => and(eq(importSessions.id, id), eq(importSessions.organizationId, org));

/** PDF digital SEM tabela de itens (só identificação/assinatura) — fictício. */
function noItemsPdf(): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  doc.fontSize(11).text("ENTE PÚBLICO EXEMPLO — Declaração sem itens.", 40, 60).text("Servidor Responsável pela Pesquisa", 40, 120);
  doc.end();
  return done;
}

async function asUser(id: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({ user: { id, role: "user" }, req: { headers: {} }, res: {}, correlationId: `lay-${id}-${++seq}`, requestId: `req-${seq}` } as any);
}

async function mkUser(org: number, role: string): Promise<number> {
  const tag = `${role}-${org}-${Date.now()}-${++seq}`;
  const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'Layout', ?)", [`lay-${tag}`, `lay-${tag}@teste.local`]);
  await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u.insertId, role]);
  return u.insertId;
}

async function waitReextraction(id: number, org: number) {
  for (let i = 0; i < 600; i++) {
    const cur = await getImportSession(id, org);
    if (cur && cur.stage !== "reprocessing") return cur;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("reextração não concluiu");
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
  await conn.query("DELETE FROM users WHERE openId LIKE 'lay-%'").catch(() => {});
}

describe.skipIf(!DB)("Layout v2 — PDF digital layout-aware + reprocessamento seguro (MySQL real)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    for (const [id, slug] of [[ORG, "layout-org"], [ORG2, "layout-org-2"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, slug, slug]).catch(() => {});
    }
    await cleanup();
    users.operator = await mkUser(ORG, "operator");
    users.viewer = await mkUser(ORG, "viewer");
    users.manager = await mkUser(ORG, "manager");
    users.operatorB = await mkUser(ORG2, "operator");
    GOLDEN = await goldenEPdf();
  }, 180_000);
  afterEach(() => { setOcrAdapterForTesting(undefined); ocrCalls.n = 0; });
  afterAll(async () => { await cleanup().catch(() => {}); await conn?.end(); });

  const spyOcr = () => setOcrAdapterForTesting({
    identity: () => ({ engine: "spy", engineVersion: "0", coreVersion: "0", language: "por", languageDataVersion: "0", config: {} }),
    recognize: async () => { ocrCalls.n++; throw new Error("OCR não deveria rodar em PDF digital"); },
  });

  it("1) GOLDEN E pelo worker real: 5 itens / 30 cotações em staging, OCR não roda, linhagem com versão de layout", async () => {
    spyOcr();
    const pid = await newProcess(ORG);
    const s = await newSession(ORG, pid, GOLDEN);
    expect(enqueueImport(s.id, ORG, s.key, { correlationId: `lay-${s.id}` })).not.toBeNull();
    const done = await waitWorker(s.id, ORG);
    expect(ocrCalls.n).toBe(0);
    expect(done).toMatchObject({ status: "awaiting_review", stage: "awaiting_review", parserVersion: "2.3.0" });
    const lineage = (done.extractionSummary as any).extraction;
    expect(lineage).toMatchObject({ extractionMode: "native_text", layoutVersion: "2", lineageVersion: "2" });
    expect(lineage.layout).toMatchObject({ mode: "positioned", pagesWithoutItemTable: [2], validation: { validQuotes: 30, documentTotalCents: 334993, calculatedTotalCents: 334993, totalMatches: true } });
    const items = await getStagingItems(s.id, ORG);
    expect(items).toHaveLength(30);
    expect(new Set(items.map((i) => i.rawDescription)).size).toBe(5);
    expect(items.every((i) => i.reviewStatus === "pending")).toBe(true);
    expect(items.map((i) => i.rawDescription)).not.toContain("R$");
  });

  it("2) sessão com extração ANTIGA (10 linhas-lixo, nada revisado) → Reprocessar pelo ROUTER → MESMA sessão com 30 cotações, auditoria e sem duplicar", async () => {
    spyOcr();
    const pid = await newProcess(ORG);
    const s = await legacySession(ORG, pid);
    const op = await asUser(users.operator);
    const before = await op.ingestion.getSessionStatus({ sessionId: s.id, procurementProcessId: pid });
    expect(before.staging).toMatchObject({ total: 10, pending: 10 });
    expect(before.reprocess).toMatchObject({ eligible: true, inProgress: false });

    const res = await op.ingestion.reprocessExtraction({ sessionId: s.id, procurementProcessId: pid, reason: "Layout v2: leitura tabular do mapa de apuração" });
    expect(res).toMatchObject({ sessionId: s.id, status: "reprocessing", enqueued: true, previousStagedCount: 10 });
    const after = await waitReextraction(s.id, ORG);

    expect(ocrCalls.n).toBe(0);
    expect(after).toMatchObject({ id: s.id, status: "awaiting_review", stage: "awaiting_review", parserVersion: "2.3.0", checksum: s.checksum, sourceFileId: s.key });
    const items = await getStagingItems(s.id, ORG);
    expect(items).toHaveLength(30);
    expect(items.some((i) => LEGACY_JUNK.includes(i.rawDescription ?? ""))).toBe(false);
    // Contrato do Golden E preservado em staging (médias pelo contrato monetário).
    const byDesc = new Map<string, number[]>();
    for (const i of items) byDesc.set(i.rawDescription!, [...(byDesc.get(i.rawDescription!) ?? []), parseBRL(i.rawUnitPrice)!]);
    expect([...byDesc.values()].map((q) => q.length)).toEqual([7, 7, 5, 5, 6]);
    expect([...byDesc.values()].map((q) => averageCents(q))).toEqual([95031, 6723, 113428, 14529, 105282]);

    const summary = after.extractionSummary as any;
    expect(summary.extraction.layoutVersion).toBe("2");
    expect(summary.reextractions).toHaveLength(1);
    expect(summary.reextractions[0]).toMatchObject({
      actorUserId: users.operator, reason: "Layout v2: leitura tabular do mapa de apuração", sourceChecksum: s.checksum,
      previous: { parserVersion: "2.2.0", layoutVersion: null, fingerprint: "f".repeat(64), stagedCount: 10 },
      next: { parserVersion: "2.3.0", layoutVersion: "2", stagedCount: 30 },
    });
    // Auditoria: pedido + troca aplicada (com versões, contagens, motivo, correlationId, timestamp).
    const [logs] = await conn.execute<mysql.RowDataPacket[]>("SELECT action, userId, details, correlationId FROM activity_logs WHERE organizationId = ? AND entityId = ? AND action LIKE 'import_reextract%' ORDER BY id", [ORG, s.id]);
    expect(logs.map((l: any) => l.action)).toEqual(["import_reextraction_requested", "import_reextracted"]);
    const d = JSON.parse((logs[1] as any).details);
    expect(d).toMatchObject({ sessionId: s.id, procurementProcessId: pid, sourceChecksum: s.checksum, previousParserVersion: "2.2.0", previousLayoutVersion: null, newParserVersion: "2.3.0", newLayoutVersion: "2", previousStagedCount: 10, newStagedCount: 30 });
    expect(d.timestamp).toBeTruthy();
    expect((logs[1] as any).userId).toBe(users.operator);

    // Não duplica: uma sessão para o checksum; nenhuma pesquisa/promoção/Item Inteligente criado pelo reprocessamento.
    expect(await count("SELECT COUNT(*) n FROM import_sessions WHERE organizationId = ? AND checksum = ?", [ORG, s.checksum])).toBeGreaterThanOrEqual(1);
    expect(await count("SELECT COUNT(*) n FROM import_sessions WHERE organizationId = ? AND procurementProcessId = ?", [ORG, pid])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM import_promotions WHERE organizationId = ? AND importSessionId = ?", [ORG, s.id])).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM price_research WHERE organization_id = ? AND process_id = ?", [ORG, pid])).toBe(0);
    expect(await listIntelligentItems(pid, ORG)).toHaveLength(0);

    // Revisão humana + promoção (manager+) ⇒ exatamente 5 Itens Inteligentes, uma promoção.
    await bulkReviewStagingItems(items.map((i) => i.id), ORG, users.operator, "approved");
    await op.ingestion.approveSession({ sessionId: s.id, procurementProcessId: pid });
    await expect(op.ingestion.promoteSession({ sessionId: s.id, procurementProcessId: pid, idempotencyKey: `promo-op-${s.id}-x` })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const mgr = await asUser(users.manager);
    const promo = await mgr.ingestion.promoteSession({ sessionId: s.id, procurementProcessId: pid, idempotencyKey: `promo-mgr-${s.id}-x` });
    expect(promo).toMatchObject({ idempotent: false, itemsPromoted: 30 });
    expect(await listIntelligentItems(pid, ORG)).toHaveLength(5);
    const replay = await mgr.ingestion.promoteSession({ sessionId: s.id, procurementProcessId: pid, idempotencyKey: `promo-mgr-${s.id}-x` });
    expect(replay.idempotent).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM import_promotions WHERE organizationId = ? AND importSessionId = ?", [ORG, s.id])).toBe(1);
    // Depois da promoção, reprocessar é PROIBIDO.
    await expect(op.ingestion.reprocessExtraction({ sessionId: s.id, procurementProcessId: pid, reason: "tentativa após promoção" })).rejects.toThrow(/REPROCESS_FORBIDDEN/);
  });

  it("3) QUALQUER intervenção humana ⇒ REPROCESS = FORBIDDEN (aceito, rejeitado, pulado, corrigido); staging intocado", async () => {
    const op = await asUser(users.operator);
    for (const action of ["approved", "rejected", "skipped", "corrected"] as const) {
      const pid = await newProcess(ORG);
      const s = await legacySession(ORG, pid);
      const [first] = await getStagingItems(s.id, ORG);
      if (action === "corrected") {
        await op.ingestion.correctItem({ sessionId: s.id, procurementProcessId: pid, itemId: first.id, expectedRevision: 0, corrections: { description: "Corrigido pelo revisor" }, justification: "ajuste", idempotencyKey: `corr-${s.id}-x` });
      } else {
        await op.ingestion.reviewItem({ sessionId: s.id, procurementProcessId: pid, itemId: first.id, action });
      }
      const st = await op.ingestion.getSessionStatus({ sessionId: s.id, procurementProcessId: pid });
      expect(st.reprocess.eligible).toBe(false);
      await expect(op.ingestion.reprocessExtraction({ sessionId: s.id, procurementProcessId: pid, reason: `tentativa com item ${action}` }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await getStagingItems(s.id, ORG)).toHaveLength(10);
      expect((await getImportSession(s.id, ORG))?.stage).toBe("awaiting_review");
    }
  });

  it("4) RBAC: viewer não reprocessa; operator reprocessa (sem promover); tenant B não lê nem reprocessa a sessão do tenant A", async () => {
    const pid = await newProcess(ORG);
    const s = await legacySession(ORG, pid);
    const viewer = await asUser(users.viewer);
    await expect(viewer.ingestion.reprocessExtraction({ sessionId: s.id, procurementProcessId: pid, reason: "viewer tentando reprocessar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const b = await asUser(users.operatorB);
    await expect(b.ingestion.getSessionStatus({ sessionId: s.id, procurementProcessId: pid })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.ingestion.reprocessExtraction({ sessionId: s.id, procurementProcessId: pid, reason: "tenant B tentando reprocessar" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reserveReextraction({ sessionId: s.id, organizationId: ORG2, actorUserId: users.operatorB, reason: "serviço com org errada", correlationId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Nada mudou no tenant A.
    expect(await getImportSession(s.id, ORG)).toMatchObject({ stage: "awaiting_review", parserVersion: "2.2.0" });
    expect(await getStagingItems(s.id, ORG)).toHaveLength(10);
    expect(await count("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND action LIKE 'import_reextract%'", [ORG2])).toBe(0);
  });

  it("5) concorrência: dois pedidos simultâneos ⇒ exatamente UMA reserva; o outro recebe CONFLICT", async () => {
    const pid = await newProcess(ORG);
    const s = await legacySession(ORG, pid);
    const req = () => reserveReextraction({ sessionId: s.id, organizationId: ORG, actorUserId: users.operator, reason: "pedido concorrente", correlationId: null });
    const results = await Promise.allSettled([req(), req()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });
    const op = await asUser(users.operator);
    expect((await op.ingestion.getSessionStatus({ sessionId: s.id, procurementProcessId: pid })).reprocess).toMatchObject({ eligible: false, inProgress: true });
    await releaseReextraction({ sessionId: s.id, organizationId: ORG, previousStage: "awaiting_review", actorUserId: users.operator, correlationId: null, code: "TEST", message: "fim do teste" });
    expect((await getImportSession(s.id, ORG))?.stage).toBe("awaiting_review");
  });

  it("6) revisão DURANTE o reprocessamento ⇒ a troca é recusada (decisão humana vence) e nada é substituído", async () => {
    const pid = await newProcess(ORG);
    const s = await legacySession(ORG, pid);
    await reserveReextraction({ sessionId: s.id, organizationId: ORG, actorUserId: users.operator, reason: "reprocessamento em curso", correlationId: null });
    const before = await getStagingItems(s.id, ORG);
    const op = await asUser(users.operator);
    await op.ingestion.reviewItem({ sessionId: s.id, procurementProcessId: pid, itemId: before[0].id, action: "rejected" });
    const parsed = await new PdfParser().parse(GOLDEN, { importSessionId: s.id, organizationId: ORG, sourceFileId: s.key, sourceFileName: "mapa.pdf", sourceMimeType: "application/pdf", sourceChecksum: s.checksum });
    await expect(commitReextraction({
      sessionId: s.id, organizationId: ORG, actorUserId: users.operator, reason: "r", correlationId: null, items: parsed.items,
      parserVersion: "2.3.0", outcomeStage: "awaiting_review", warnings: parsed.warnings, summary: { ...parsed.summary, extraction: parsed.extraction },
    })).rejects.toBeInstanceOf(StagingAlreadyReviewedError);
    const after = await getStagingItems(s.id, ORG);
    expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect((await getStagingSummary(s.id, ORG)).rejected).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND entityId = ? AND action = 'import_reextracted'", [ORG, s.id])).toBe(0);
    await releaseReextraction({ sessionId: s.id, organizationId: ORG, previousStage: "awaiting_review", actorUserId: users.operator, correlationId: null, code: "STAGING_ALREADY_REVIEWED", message: "revisão concorrente" });
  });

  it("7) falha NO MEIO da troca ⇒ rollback total (nunca metade antiga + metade nova); reserva liberável", async () => {
    const pid = await newProcess(ORG);
    const s = await legacySession(ORG, pid);
    await reserveReextraction({ sessionId: s.id, organizationId: ORG, actorUserId: users.operator, reason: "teste de atomicidade", correlationId: null });
    const before = await getStagingItems(s.id, ORG);
    const parsed = await new PdfParser().parse(GOLDEN, { importSessionId: s.id, organizationId: ORG, sourceFileId: s.key, sourceFileName: "mapa.pdf", sourceMimeType: "application/pdf", sourceChecksum: s.checksum });
    const poisoned = [...parsed.items.slice(0, 5), { ...parsed.items[5], rawUnit: "U".repeat(500) }, ...parsed.items.slice(6)]; // rawUnit > varchar(50)
    await expect(commitReextraction({
      sessionId: s.id, organizationId: ORG, actorUserId: users.operator, reason: "r", correlationId: null, items: poisoned as any,
      parserVersion: "2.3.0", outcomeStage: "awaiting_review", warnings: [], summary: { ...parsed.summary, extraction: parsed.extraction },
    })).rejects.toThrow();
    expect((await getStagingItems(s.id, ORG)).map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect(await getImportSession(s.id, ORG)).toMatchObject({ parserVersion: "2.2.0", stage: "reprocessing" });
    await releaseReextraction({ sessionId: s.id, organizationId: ORG, previousStage: "awaiting_review", actorUserId: users.operator, correlationId: null, code: "TEST", message: "rollback" });
    expect((await getImportSession(s.id, ORG))?.stage).toBe("awaiting_review");
  });

  it("8) nova extração sem item revisável NUNCA substitui a anterior (reserva liberada e auditada)", async () => {
    const pid = await newProcess(ORG);
    const s = await legacySession(ORG, pid);
    // O arquivo armazenado passa a ser um documento SEM tabela de itens (só identificação/assinatura).
    mem.set(s.key, await noItemsPdf());
    const op = await asUser(users.operator);
    await op.ingestion.reprocessExtraction({ sessionId: s.id, procurementProcessId: pid, reason: "arquivo sem tabela de itens" });
    const after = await waitReextraction(s.id, ORG);
    expect(after).toMatchObject({ status: "awaiting_review", stage: "awaiting_review", parserVersion: "2.2.0" });
    expect(await getStagingItems(s.id, ORG)).toHaveLength(10);
    const [logs] = await conn.execute<mysql.RowDataPacket[]>("SELECT action, details FROM activity_logs WHERE organizationId = ? AND entityId = ? AND action LIKE 'import_reextract%' ORDER BY id", [ORG, s.id]);
    expect(logs.map((l: any) => l.action)).toEqual(["import_reextraction_requested", "import_reextraction_not_applied"]);
    expect(JSON.parse((logs[1] as any).details).code).toMatch(/^REEXTRACTION_/);
    mem.set(s.key, GOLDEN);
  });

  it("9) replay: reprocessar de novo (mesma versão) é idempotente em conteúdo — mesmo fingerprint, mesma ordem, sem duplicar", async () => {
    const pid = await newProcess(ORG);
    const s = await legacySession(ORG, pid);
    const op = await asUser(users.operator);
    await op.ingestion.reprocessExtraction({ sessionId: s.id, procurementProcessId: pid, reason: "primeira reextração v2" });
    const a = await waitReextraction(s.id, ORG);
    const itemsA = (await getStagingItems(s.id, ORG)).map((i) => [i.rawDescription, i.rawSupplier, i.rawUnitPrice]);
    await op.ingestion.reprocessExtraction({ sessionId: s.id, procurementProcessId: pid, reason: "segunda reextração v2" });
    const b = await waitReextraction(s.id, ORG);
    expect((await getStagingItems(s.id, ORG)).map((i) => [i.rawDescription, i.rawSupplier, i.rawUnitPrice])).toEqual(itemsA);
    expect((b.extractionSummary as any).extraction.fingerprint).toBe((a.extractionSummary as any).extraction.fingerprint);
    expect((b.extractionSummary as any).reextractions).toHaveLength(2);
    expect(await getStagingItems(s.id, ORG)).toHaveLength(30);
  });
});
