/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * U2A / U2A-OCR — Pesquisa de Preços com PDF DIGITALIZADO contra MySQL REAL (CI: MySQL 8.4).
 *
 * Caminho real: sessão → WORKER da fila existente (storage em memória; o binário nunca vai ao banco) →
 * parser de PDF real → OCR (Tesseract local REAL no cenário ponta a ponta; porta determinística nos
 * cenários de falha) → MESMO parser tabular → staging → revisão → aprovação → promoção governada.
 *
 * Cenários: (1) OCR ponta a ponta com linhagem persistida + texto bruto por item; (2) zero itens ⇒ não
 * aprovável e não promovível (inclusive sessão "aprovada" vazia legada: promoção revertida, ledger limpo);
 * (3) OCR desligado ⇒ OCR_REQUIRED, depois retry na MESMA sessão/checksum ⇒ revisão (checksum nunca
 * bloqueado); (4) reextração substitui staging intocado e NUNCA sobrescreve item revisado; (5) promoção sem
 * duplicidade (replay idempotente; mesmo arquivo em outra sessão ⇒ CONFLICT); (6) isolamento multi-tenant.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createHash } from "crypto";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG = 990801;
const ORG2 = 990802;
const U = 81;

const mem = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", () => ({
  storageGetBytes: async (key: string) => { const b = mem.get(key); if (!b) throw new Error(`storage vazio: ${key}`); return b; },
  storagePut: async (key: string, data: string | Buffer) => { mem.set(key, Buffer.from(data)); return { key, url: "" }; },
}));

import { runMigrations } from "../../bootstrap";
import { getDb } from "../../db/connection";
import { importSessions } from "../../../drizzle/schema";
import { enqueueImport } from "../../services/importQueueService";
import { getImportSession, updateSessionStatus, findActiveSessionByChecksum } from "../../services/fileIngestionService";
import {
  getStagingItems, getStagingSummary, bulkReviewStagingItems, replaceUnreviewedStagingItems, StagingAlreadyReviewedError,
} from "../../services/importStagingService";
import { promoteApprovedSessionToDomain } from "../../services/importPromotionService";
import { insertProcess, listIntelligentItems } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { assertSessionApprovable } from "../../domain/importOutcome";
import { setOcrAdapterForTesting, TesseractOcrAdapter } from "../../providers/ocr";
import { OcrError } from "../../domain/ocr";
import { scannedPdf, PRICE_TABLE } from "../fixtures/ocrPdfFixtures";

let conn: mysql.Connection;
let seq = 0;
const tesseract = new TesseractOcrAdapter({ maxConcurrency: 1 });

async function newProcess(org: number): Promise<string> {
  const p = createProcurementWorkspace({
    organizationId: org, processNumber: `OCR-${Date.now()}-${++seq}`, object: "Aquisição de mobiliário",
    startOption: "importar_tr", responsibleUser: U, correlationId: "ocr-smoke",
  });
  await insertProcess(p);
  return p.id;
}

async function waitFinal(id: number, org: number) {
  for (let i = 0; i < 600; i++) {
    const cur = await getImportSession(id, org);
    if (cur && ["awaiting_review", "failed"].includes(cur.status) && !["retry", "queued", "parsing", "ocr_processing", "extracted"].includes(cur.stage ?? "")) return cur;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("worker não concluiu");
}

async function newSession(org: number, processId: string, bytes: Buffer) {
  const db = (await getDb())!;
  const key = `imports/${org}/${Date.now()}-${++seq}-cotacao.pdf`;
  mem.set(key, bytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const [s] = await db.insert(importSessions).values({
    organizationId: org, uploadedBy: U, sourceFileId: key, sourceFileName: "cotacao.pdf", sourceMimeType: "application/pdf",
    sourceSize: bytes.length, checksum, procurementProcessId: processId, importType: "price_research", parserType: "auto",
    status: "uploaded", stage: "file_stored", correlationId: `ocr-${seq}`,
  }).$returningId();
  return { id: s.id, key, checksum };
}

async function runWorker(org: number, s: { id: number; key: string }) {
  expect(enqueueImport(s.id, org, s.key, { correlationId: `ocr-${s.id}` })).not.toBeNull();
  return waitFinal(s.id, org);
}

async function approveAndPromote(org: number, pid: string, id: number, key = `promo-${id}`) {
  const items = await getStagingItems(id, org);
  await bulkReviewStagingItems(items.map((i) => i.id), org, U, "approved");
  assertSessionApprovable(await getStagingSummary(id, org));
  await updateSessionStatus(id, org, "approved", { progress: 100, stage: "approved" });
  return promoteApprovedSessionToDomain({ sessionId: id, organizationId: org, procurementProcessId: pid, actorUserId: U, idempotencyKey: key, correlationId: key });
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params as any[]);
  return Number((rows[0] as any).n);
}

async function cleanup() {
  const tables: Array<[string, string]> = [
    ["import_promotions", "organizationId"], ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"],
    ["import_sessions", "organizationId"], ["price_research_items", "organization_id"], ["price_research", "organization_id"],
    ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"],
    ["intelligent_items", "organization_id"], ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"],
  ];
  for (const org of [ORG, ORG2]) for (const [t, col] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(() => {});
}

let SCANNED: Buffer;

describe.skipIf(!DB)("U2A-OCR — Pesquisa de Preços com PDF digitalizado (MySQL real)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    for (const [id, slug] of [[ORG, "ocr-org"], [ORG2, "ocr-org-2"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, slug, slug]).catch(() => {});
    }
    await cleanup();
    SCANNED = await scannedPdf([PRICE_TABLE]);
  }, 180_000);
  afterEach(() => setOcrAdapterForTesting(undefined));
  afterAll(async () => { await cleanup().catch(() => {}); await conn?.end(); });

  it("1) OCR REAL ponta a ponta: staging com texto bruto + linhagem persistida; revisão → promoção", async () => {
    setOcrAdapterForTesting(tesseract);
    const pid = await newProcess(ORG);
    const s = await newSession(ORG, pid, SCANNED);
    const done = await runWorker(ORG, s);
    expect(done).toMatchObject({ status: "awaiting_review", stage: "review_required" });
    const lineage = (done.extractionSummary as any).extraction;
    expect(lineage).toMatchObject({ extractionMode: "ocr", sourceChecksum: s.checksum, parserVersion: "2.3.0", ocr: { engine: "tesseract.js", language: "por", nondeterministic: true } });
    expect(mem.has(lineage.ocr.artifactKey)).toBe(true);
    const items = await getStagingItems(s.id, ORG);
    expect(items.map((i) => [i.rawDescription, i.rawUnitPrice])).toEqual([["Cadeira giratoria", "1.234,56"], ["Mesa de reuniao", "850,00"], ["Papel A4 resma", "R$ 23,90"]]);
    expect((items[0].parserMetadata as any).extractionMode).toBe("ocr");
    expect((items[0].rawMetadata as any).ocr.lineText).toMatch(/Cadeira giratoria/);
    expect((items[0].extractionWarnings as any[]).map((w) => w.code)).toContain("OCR_EXTRACTED");

    const r = await approveAndPromote(ORG, pid, s.id);
    expect(r.idempotent).toBe(false);
    const intel = await listIntelligentItems(pid, ORG);
    expect(intel.length).toBe(3);
  });

  it("2) zero itens ⇒ NÃO aprovável e NÃO promovível (inclusive sessão 'aprovada' vazia legada)", async () => {
    setOcrAdapterForTesting({ identity: () => tesseract.identity(), recognize: async () => ({ text: "", pages: [], warnings: [], confidence: 0, engine: "fake", engineVersion: "0", language: "por", durationMs: 0, metadata: {} }) });
    const pid = await newProcess(ORG);
    const s = await newSession(ORG, pid, SCANNED);
    const done = await runWorker(ORG, s);
    expect(done).toMatchObject({ status: "failed", stage: "no_items" });
    expect((done.errors as any[])[0].code).toBe("NO_VALID_ITEMS");
    const empty = await getStagingSummary(s.id, ORG);
    expect(() => assertSessionApprovable(empty)).toThrow(/NO_VALID_ITEMS_TO_APPROVE/);
    await expect(promoteApprovedSessionToDomain({ sessionId: s.id, organizationId: ORG, procurementProcessId: pid, actorUserId: U, idempotencyKey: `z-${s.id}`, correlationId: "z" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // Legado: sessão forçada a "approved" sem itens ⇒ promoção PROIBIDA e transação revertida (ledger vazio).
    await updateSessionStatus(s.id, ORG, "approved", { stage: "approved" });
    await expect(promoteApprovedSessionToDomain({ sessionId: s.id, organizationId: ORG, procurementProcessId: pid, actorUserId: U, idempotencyKey: `z2-${s.id}`, correlationId: "z" }))
      .rejects.toThrow(/NO_VALID_ITEMS_TO_PROMOTE/);
    expect(await count("SELECT COUNT(*) n FROM import_promotions WHERE organizationId = ? AND importSessionId = ?", [ORG, s.id])).toBe(0);
    expect(await listIntelligentItems(pid, ORG)).toHaveLength(0);
  });

  it("3) OCR desligado ⇒ OCR_REQUIRED; retry na MESMA sessão/checksum ⇒ revisão (checksum nunca bloqueado)", async () => {
    setOcrAdapterForTesting(null);
    const pid = await newProcess(ORG);
    const s = await newSession(ORG, pid, SCANNED);
    const first = await runWorker(ORG, s);
    expect(first).toMatchObject({ status: "failed", stage: "ocr_required" });
    expect(await getStagingItems(s.id, ORG)).toHaveLength(0);
    // O mesmo arquivo reenviado reutiliza a MESMA sessão (dedup por checksum) — não é beco sem saída.
    expect((await findActiveSessionByChecksum(ORG, s.checksum, pid, "price_research"))?.id).toBe(s.id);

    // Motor falha ⇒ OCR_FAILED (terminal, recuperável) …
    setOcrAdapterForTesting({ identity: () => tesseract.identity(), recognize: async () => { throw new OcrError("OCR_ENGINE_FAILURE", "x"); } });
    await updateSessionStatus(s.id, ORG, "queued", { stage: "queued" });
    expect(await runWorker(ORG, s)).toMatchObject({ status: "failed", stage: "ocr_failed" });

    // … e a nova tentativa (OCR disponível) conclui na MESMA sessão.
    setOcrAdapterForTesting(tesseract);
    await updateSessionStatus(s.id, ORG, "queued", { stage: "queued" });
    const ok = await runWorker(ORG, s);
    expect(ok).toMatchObject({ status: "awaiting_review", stage: "review_required" });
    expect(ok.errors).toEqual([]);
    expect(await getStagingItems(s.id, ORG)).toHaveLength(3);
  });

  it("4) reextração substitui staging intocado sem duplicar; item revisado NUNCA é sobrescrito", async () => {
    setOcrAdapterForTesting(tesseract);
    const pid = await newProcess(ORG);
    const s = await newSession(ORG, pid, SCANNED);
    await runWorker(ORG, s);
    const items = await getStagingItems(s.id, ORG);
    const raw = items.map((i) => ({ ...i, importSessionId: s.id })) as any[];
    const again = await replaceUnreviewedStagingItems(s.id, ORG, raw);
    expect(again.replaced).toBe(3);
    expect(await getStagingItems(s.id, ORG)).toHaveLength(3);
    await bulkReviewStagingItems([(await getStagingItems(s.id, ORG))[0].id], ORG, U, "approved");
    await expect(replaceUnreviewedStagingItems(s.id, ORG, raw)).rejects.toBeInstanceOf(StagingAlreadyReviewedError);
    expect((await getStagingSummary(s.id, ORG)).approved).toBe(1);
  });

  it("5) promoção sem duplicidade: replay idempotente; mesmo arquivo em outra sessão ⇒ CONFLICT", async () => {
    setOcrAdapterForTesting(tesseract);
    const pid = await newProcess(ORG);
    const a = await newSession(ORG, pid, SCANNED);
    await runWorker(ORG, a);
    await approveAndPromote(ORG, pid, a.id);
    const replay = await promoteApprovedSessionToDomain({ sessionId: a.id, organizationId: ORG, procurementProcessId: pid, actorUserId: U, idempotencyKey: `promo-${a.id}`, correlationId: "r" });
    expect(replay.idempotent).toBe(true);
    const b = await newSession(ORG, pid, SCANNED);
    await runWorker(ORG, b);
    await expect(approveAndPromote(ORG, pid, b.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await listIntelligentItems(pid, ORG)).toHaveLength(3);
  });

  it("6) isolamento multi-tenant: tenant B não enxerga nem promove a sessão OCR do tenant A", async () => {
    setOcrAdapterForTesting(tesseract);
    const pid = await newProcess(ORG);
    const s = await newSession(ORG, pid, SCANNED);
    await runWorker(ORG, s);
    expect(await getImportSession(s.id, ORG2)).toBeNull();
    expect(await getStagingItems(s.id, ORG2)).toHaveLength(0);
    expect((await getStagingSummary(s.id, ORG2)).total).toBe(0);
    expect(await findActiveSessionByChecksum(ORG2, s.checksum, pid, "price_research")).toBeNull();
    await expect(promoteApprovedSessionToDomain({ sessionId: s.id, organizationId: ORG2, procurementProcessId: pid, actorUserId: U, idempotencyKey: `x-${s.id}`, correlationId: "x" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    // Nada foi materializado em nenhum tenant por essa tentativa.
    expect(await count("SELECT COUNT(*) n FROM import_promotions WHERE organizationId = ?", [ORG2])).toBe(0);
  });
});

