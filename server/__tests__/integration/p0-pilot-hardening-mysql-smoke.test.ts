/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0 PILOTO — HARDENING contra MySQL REAL (CI: MySQL 8.4). Executável; caminhos de produção.
 *
 *  1–2  contrato monetário: XLSX real com célula NUMÉRICA (1.234 → R$ 1,23; 1.005 → 1,01; 1.0049 → 1,00)
 *  3–4  convergência Pesquisa × Item: cotação manual alterada atualiza item pendente; item aprovado
 *       preserva a decisão e fica `source_changed` (nunca Pesquisa=300 × Item=200 sem sinal)
 *  5–7  reconciliação legado→v2: aprovado/rejeitado reconciliam sem duplicar; ambíguo/incompatível
 *       FAIL-CLOSED + resolução humana; itens distintos não se juntam  (GOLDEN C)
 *  8    duas sessões do MESMO arquivo em paralelo (duas conexões) ⇒ UMA promoção  (GOLDEN D)
 *  9–10 ledger append-only da revisão documental reconstrói todas as versões; edição após aprovação
 *       invalida a aprovação (registrado)
 *  11–15 digest = snapshot consumido (fornecedor, preço, quantidade, nº do processo mudam; ordem não)
 *  16–18 createSession pelo ROUTER real: mesma chave + mesmo payload ⇒ replay; outro processo/tipo ⇒ conflito
 *  18b  issueProcess não emite: manager + Edital OFICIAL prévio (senão PRECONDITION_FAILED); operator ⇒ FORBIDDEN
 *  19   "Baseado em N" conta só cotações válidas
 *  20   recuperação durável do enriquecimento (processing travado / pending) é replay-safe
 *  GOLDEN A (XLSX 3 fornecedores → Itens → TR → Edital: valores, contagem, digest, lineage, timeline, histórico)
 *  GOLDEN B (TR importado → revisado → promovido → Edital, histórico documental completo)
 *  MIGRATION 0304: upgrade com dados legados, replay no-op e FAIL-CLOSED em duplicata não-nula
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "node:fs";
import pathMod from "node:path";
import mysql from "mysql2/promise";
import * as XLSX from "xlsx";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

const DB = process.env.DATABASE_URL;
const ORG = 990701;
const ORG2 = 990702;
const U1 = 71;
const U2 = 72;

const mem = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", () => ({
  storageGetBytes: async (key: string) => { const b = mem.get(key); if (!b) throw new Error(`storage vazio: ${key}`); return b; },
}));
// Somente a superfície do router exige a flag (fail-closed em produção); aqui é ligada no teste.
vi.mock("../../services/featureFlagService", async (orig) => {
  const actual = await orig<typeof import("../../services/featureFlagService")>();
  return { ...actual, isFeatureEnabled: vi.fn(async () => true) };
});

import { runMigrations } from "../../bootstrap";
import { getDb } from "../../db/connection";
import { importSessions, importStagingItems, catmatDecisionsTable } from "../../../drizzle/schema";
import { enqueueImport } from "../../services/importQueueService";
import { getImportSession, updateSessionStatus } from "../../services/fileIngestionService";
import { getStagingItems, bulkReviewStagingItems } from "../../services/importStagingService";
import { promoteApprovedSessionToDomain } from "../../services/importPromotionService";
import {
  importManualPriceResearch, applyItemSourceUpdate, resolveItemIdentity, recoverStaleEnrichment,
} from "../../services/itemMaterializationService";
import {
  getDocumentIntake, saveDocumentReview, approveDocumentStaging, promoteDocumentToDraft, rejectDocumentStaging, getDocumentReviewHistory,
} from "../../services/documentIntakeService";
import { generateDocument, generateNotice, getAuthoringSourceState } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import {
  insertProcess, listIntelligentItems, transitionItemStatusCAS, getGeneratedDocumentByKind, listProcessTimeline,
} from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";

let conn: mysql.Connection;
let seq = 0;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function newProcess(org: number, object = "Aquisição de material"): Promise<string> {
  const p = createProcurementWorkspace({ organizationId: org, processNumber: `H-${Date.now()}-${++seq}`, object, startOption: "iniciar_pesquisa", responsibleUser: U1, correlationId: "hard" });
  await insertProcess(p);
  return p.id;
}

function xlsxOf(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Cotações");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function docxOf(title: string, body: string): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun(body)] }),
  ] }] }));
}

async function ingest(org: number, processId: string, importType: string, fileName: string, mime: string, bytes: Buffer): Promise<number> {
  const db = (await getDb())!;
  const key = `imports/${org}/${Date.now()}-${++seq}-${fileName}`;
  mem.set(key, bytes);
  const [s] = await db.insert(importSessions).values({
    organizationId: org, uploadedBy: U1, sourceFileId: key, sourceFileName: fileName, sourceMimeType: mime, sourceSize: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"), procurementProcessId: processId, importType, parserType: "auto",
    status: "uploaded", stage: "file_stored", correlationId: `h-${seq}`,
  }).$returningId();
  enqueueImport(s.id, org, key, { correlationId: `h-${seq}` });
  for (let i = 0; i < 200; i++) {
    const cur = await getImportSession(s.id, org);
    if (cur && ["awaiting_review", "failed"].includes(cur.status) && cur.stage !== "retry") return s.id;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("worker não concluiu");
}

async function approveAndPromote(org: number, processId: string, sessionId: number) {
  const items = await getStagingItems(sessionId, org);
  await bulkReviewStagingItems(items.map((i) => i.id), org, U1, "approved");
  await updateSessionStatus(sessionId, org, "approved", { progress: 100, stage: "approved" });
  return promoteApprovedSessionToDomain({ sessionId, organizationId: org, procurementProcessId: processId, actorUserId: U2, idempotencyKey: `hp-${sessionId}`, correlationId: `hp-${sessionId}` });
}

async function approveAllItems(org: number, processId: string) {
  for (const it of await listIntelligentItems(processId, org)) {
    await transitionItemStatusCAS({ id: it.id, orgId: org, fromStatuses: ["pendente", "em_analise"], toStatus: "aprovado", approvedBy: U2, updatedAt: new Date().toISOString() });
  }
}

const manual = (org: number, processId: string, text: string) =>
  importManualPriceResearch({ organizationId: org, processId, source: "colar", text, actorUserId: U1, correlationId: `m-${++seq}` });

const legacyId = (org: number, pid: string, desc: string) => createHash("sha256").update(`iitem:${org}:${pid}:${desc.toLowerCase().trim()}`).digest("hex").slice(0, 20);

async function insertLegacyItem(org: number, pid: string, p: { description: string; unit: string; quantity: number; status: string; value: number; approvedBy?: number | null }) {
  const id = legacyId(org, pid, p.description);
  await conn.execute(
    `INSERT INTO intelligent_items (id, organization_id, process_id, source_research_id, description, quantity, unit, average_price, suppliers,
       suggested_catmat, alternative_catmat, specifications, risks, recommendations, status, approved_by, enrichment_status, correlation_id)
     VALUES (?, ?, ?, 'legacy-r', ?, ?, ?, ?, ?, NULL, '[]', '[]', '[]', '[]', ?, ?, 'done', 'legacy')`,
    [id, org, pid, p.description, p.quantity, p.unit, p.value.toFixed(2), JSON.stringify([{ name: "Fornecedor legado", value: p.value }]), p.status, p.approvedBy ?? null],
  );
  return id;
}

async function count(sqlText: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sqlText, params as any[]);
  return Number((rows[0] as any).n);
}

async function cleanup() {
  const tables: Array<[string, string]> = [
    ["import_document_review_ledger", "organizationId"], ["import_document_staging", "organizationId"], ["import_promotions", "organizationId"],
    ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"], ["import_sessions", "organizationId"],
    ["price_research_items", "organization_id"], ["price_research", "organization_id"], ["intelligent_item_identity_aliases", "organization_id"],
    ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"],
    ["intelligent_items", "organization_id"], ["catmat_decisions", "organizationId"], ["generated_document_edits", "organization_id"],
    ["generated_documents", "organization_id"], ["official_document_timeline", "tenant_id"], ["official_document_promotions", "organization_id"], ["official_documents", "tenant_id"],
    ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"],
    ["organization_members", "organizationId"],
  ];
  for (const org of [ORG, ORG2]) for (const [t, c] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${c}\` = ?`, [org]).catch(() => {});
}

describe.skipIf(!DB)("P0 PILOTO — hardening (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    for (const o of [ORG, ORG2]) await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [o, `Hard ${o}`, `hard-${o}`]).catch(() => {});
    await cleanup();
  }, 300_000);
  afterAll(async () => { await cleanup().catch(() => {}); await conn?.end(); });

  it("1–2) XLSX real: célula NUMÉRICA preservada e arredondada UMA vez (1.234→1,23 · 1.005→1,01 · 1.0049→1,00 · 100→100,00)", async () => {
    const pid = await newProcess(ORG);
    const sid = await ingest(ORG, pid, "price_research", "num.xlsx", XLSX_MIME, xlsxOf([
      ["Descrição", "Qtd", "Unid", "Valor unitário", "Fornecedor"],
      ["Clipes", 10, "cx", 1.234, "A"], ["Grampos", 10, "cx", 1.005, "A"], ["Elástico", 10, "cx", 1.0049, "A"],
      ["Caneta", 100, "un", 100, "A"], ["Papel A4", 2, "resma", "1.234,56", "A"],
    ]));
    const st = await getStagingItems(sid, ORG);
    expect((st.find((i) => i.rawDescription === "Clipes")!.rawTypedValues as any).rawUnitPrice).toEqual({ type: "number", value: "1.234" });
    await approveAndPromote(ORG, pid, sid);
    const [rows] = await conn.execute<mysql.RowDataPacket[]>("SELECT description, value FROM price_research_items WHERE organization_id=? AND process_id=? ORDER BY description", [ORG, pid]);
    const val = Object.fromEntries((rows as any[]).map((r) => [r.description, String(r.value)]));
    expect(val).toEqual({ Caneta: "100.00", Clipes: "1.23", "Elástico": "1.00", Grampos: "1.01", "Papel A4": "1234.56" });
    const items = await listIntelligentItems(pid, ORG);
    expect(Object.fromEntries(items.map((i) => [i.description, i.averagePriceCents]))).toEqual({ Caneta: 10000, Clipes: 123, "Elástico": 100, Grampos: 101, "Papel A4": 123456 });
  }, 60_000);

  it("3–4) manual: valor alterado atualiza item PENDENTE; item APROVADO preserva decisão + source_changed; aplicação explícita", async () => {
    const pid = await newProcess(ORG);
    await manual(ORG, pid, "Papel A4;10;resma;R$ 100,00;Papelaria X");
    let [it] = await listIntelligentItems(pid, ORG);
    expect(it.averagePriceCents).toBe(10000);
    const r2 = await manual(ORG, pid, "Papel A4;10;resma;R$ 200,00;Papelaria X"); // mesmo quoteId, conteúdo novo
    expect(r2.result.updated).toEqual([it.id]);
    [it] = await listIntelligentItems(pid, ORG);
    expect(it.averagePriceCents).toBe(20000);
    expect(await count("SELECT COUNT(*) n FROM price_research_items WHERE organization_id=? AND process_id=? AND value='200.00'", [ORG, pid])).toBe(1);

    await approveAllItems(ORG, pid);
    const r3 = await manual(ORG, pid, "Papel A4;10;resma;R$ 300,00;Papelaria X");
    expect(r3.result.sourceChanged).toEqual([it.id]);
    [it] = await listIntelligentItems(pid, ORG);
    expect(it.status).toBe("aprovado");            // decisão preservada
    expect(it.averagePriceCents).toBe(20000);      // números do item decidido NÃO sobrescritos
    expect(it.sourceState).toBe("source_changed"); // …mas a divergência é EXPLÍCITA
    expect(it.pendingQuoteCount).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM price_research_items WHERE organization_id=? AND process_id=? AND value='300.00'", [ORG, pid])).toBe(1);
    expect((await listProcessTimeline(pid, ORG)).some((e) => e.summary.includes("Fonte alterada"))).toBe(true);
    // Replay idêntico não re-sinaliza nem escreve.
    const r4 = await manual(ORG, pid, "Papel A4;10;resma;R$ 300,00;Papelaria X");
    expect(r4.result.updated).toEqual([]);
    await expect(applyItemSourceUpdate({ organizationId: ORG2, itemId: it.id, actorUserId: U1, correlationId: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const applied = await applyItemSourceUpdate({ organizationId: ORG, itemId: it.id, actorUserId: U1, correlationId: "ap" });
    expect(applied).toMatchObject({ status: "em_analise", averageCents: 30000, quoteCount: 1 });
    [it] = await listIntelligentItems(pid, ORG);
    expect([it.status, it.sourceState, it.averagePriceCents]).toEqual(["em_analise", "current", 30000]);
  }, 60_000);

  it("5–6 · GOLDEN C) legado APROVADO e REJEITADO reconciliam com v2: sem duplicar, decisão/CATMAT/lineage preservados, fonte nova sinalizada", async () => {
    const pid = await newProcess(ORG);
    const approvedLegacy = await insertLegacyItem(ORG, pid, { description: "Papel A4", unit: "resma", quantity: 10, status: "aprovado", value: 100, approvedBy: 7 });
    const rejectedLegacy = await insertLegacyItem(ORG, pid, { description: "Grampeador", unit: "", quantity: 0, status: "rejeitado", value: 50 });
    const db = (await getDb())!;
    await db.insert(catmatDecisionsTable).values({ organizationId: ORG, processId: pid, itemId: approvedLegacy, decision: "confirmado", catmatCode: "461234", source: "manual", actorUserId: 7, idempotencyKey: `leg-cm-${seq}` });

    const r = await manual(ORG, pid, "Papel A4;10;resma;R$ 120,00;Fornecedor novo\nGrampeador;3;un;R$ 55,00;Fornecedor novo");
    expect(r.result.created).toEqual([]);
    expect(r.result.reconciled.sort()).toEqual([approvedLegacy, rejectedLegacy].sort());
    expect(r.result.sourceChanged.sort()).toEqual([approvedLegacy, rejectedLegacy].sort());
    const items = await listIntelligentItems(pid, ORG);
    expect(items).toHaveLength(2); // NENHUMA duplicação
    const a = items.find((i) => i.id === approvedLegacy)!;
    expect([a.status, a.averagePriceCents, a.sourceState]).toEqual(["aprovado", 10000, "source_changed"]);
    const [row] = await conn.execute<mysql.RowDataPacket[]>("SELECT approved_by, source_research_id FROM intelligent_items WHERE id=?", [approvedLegacy]);
    expect((row[0] as any).approved_by).toBe(7);
    expect((row[0] as any).source_research_id).toBe("legacy-r"); // lineage original preservado
    expect(items.find((i) => i.id === rejectedLegacy)!.status).toBe("rejeitado");
    expect(await count("SELECT COUNT(*) n FROM intelligent_item_identity_aliases WHERE organization_id=? AND process_id=? AND resolution='auto_legacy'", [ORG, pid])).toBe(2);
    // Quadro autoritativo: o item conta UMA vez e a classificação decidida no legado continua valendo.
    const s = await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Material" });
    expect(s.summary).toMatchObject({ approvedItems: 1, confirmedClassifications: 1, estimatedGlobalTotalCents: 100000 });
    // Replay idêntico: nada novo.
    const again = await manual(ORG, pid, "Papel A4;10;resma;R$ 120,00;Fornecedor novo\nGrampeador;3;un;R$ 55,00;Fornecedor novo");
    expect([again.result.created.length, again.result.reconciled.length]).toEqual([0, 0]);
    expect(await listIntelligentItems(pid, ORG)).toHaveLength(2);
  }, 60_000);

  it("7) legado AMBÍGUO/incompatível → FAIL-CLOSED (nada fundido, nada criado); resolução humana; itens distintos NÃO se juntam", async () => {
    const pid = await newProcess(ORG);
    const t1 = await insertLegacyItem(ORG, pid, { description: "Toner  HP", unit: "un", quantity: 2, status: "pendente", value: 40 });
    const t2 = await insertLegacyItem(ORG, pid, { description: "Toner HP.", unit: "un", quantity: 2, status: "aprovado", value: 45, approvedBy: 7 });
    const cx = await insertLegacyItem(ORG, pid, { description: "Cartucho", unit: "cx", quantity: 5, status: "aprovado", value: 30, approvedBy: 7 });
    await insertLegacyItem(ORG, pid, { description: "Caneta azul", unit: "un", quantity: 10, status: "aprovado", value: 2, approvedBy: 7 });
    const r = await manual(ORG, pid, "Toner HP;2;un;R$ 50,00;X\nCartucho;5;un;R$ 33,00;X\nCaneta preta;10;un;R$ 2,50;X");
    expect(r.result.reviewRequired).toHaveLength(2);   // Toner (2 candidatos) + Cartucho (unidade incompatível)
    expect(r.result.created).toHaveLength(1);          // só "Caneta preta" (distinta) é criada
    let items = await listIntelligentItems(pid, ORG);
    expect(items).toHaveLength(5);
    for (const id of [t1, t2, cx]) {
      const it = items.find((i) => i.id === id)!;
      expect(it.sourceState).toBe("review_required");
    }
    expect(items.find((i) => i.id === t2)!.averagePriceCents).toBe(4500); // números intactos
    const tonerHash = r.result.reviewRequired.find((h) => items.find((i) => i.id === t1)!.sourceStateReason === `identidade_ambigua:${h}`)!;
    await expect(resolveItemIdentity({ organizationId: ORG2, processId: pid, logicalKeyHash: tonerHash, targetItemId: t1, actorUserId: U1, reason: "mesmo toner", correlationId: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const res = await resolveItemIdentity({ organizationId: ORG, processId: pid, logicalKeyHash: tonerHash, targetItemId: t1, actorUserId: U1, reason: "É o mesmo toner do legado pendente", correlationId: "res" });
    expect(res.updated).toEqual([t1]);
    items = await listIntelligentItems(pid, ORG);
    expect(items).toHaveLength(5);
    expect(items.find((i) => i.id === t1)!.sourceState).toBe("current");
    expect(items.find((i) => i.id === t2)!.sourceState).toBe("current");
    expect(items.find((i) => i.id === cx)!.sourceState).toBe("review_required"); // outra chave: continua aguardando
    expect(await count("SELECT COUNT(*) n FROM intelligent_item_identity_aliases WHERE organization_id=? AND process_id=? AND resolution='manual'", [ORG, pid])).toBe(1);
  }, 60_000);

  it("8 · GOLDEN D) duas sessões do MESMO arquivo promovidas em PARALELO ⇒ exatamente UMA promoção; zero duplicação", async () => {
    const pid = await newProcess(ORG);
    const checksum = createHash("sha256").update(`same-file-${Date.now()}`).digest("hex");
    const db = (await getDb())!;
    const sessions: number[] = [];
    for (let k = 0; k < 2; k++) {
      const [s] = await db.insert(importSessions).values({
        organizationId: ORG, uploadedBy: U1, sourceFileId: `imports/x/${k}`, sourceFileName: "mapa.csv", sourceMimeType: "text/csv",
        checksum, procurementProcessId: pid, importType: "price_research", parserType: "csv", status: "approved",
      }).$returningId();
      for (const [sup, v] of [["A", "100,00"], ["B", "110,00"], ["C", "90,00"]]) {
        await db.insert(importStagingItems).values({ importSessionId: s.id, organizationId: ORG, rawDescription: "Cadeira", rawQuantity: "10", rawUnit: "un", rawUnitPrice: v, rawSupplier: sup, reviewStatus: "approved" });
      }
      sessions.push(s.id);
    }
    const out = await Promise.allSettled(sessions.map((sid) => promoteApprovedSessionToDomain({ sessionId: sid, organizationId: ORG, procurementProcessId: pid, actorUserId: U2, idempotencyKey: `race-${sid}`, correlationId: `race-${sid}` })));
    const ok = out.filter((o) => o.status === "fulfilled");
    const ko = out.filter((o) => o.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toMatchObject({ code: "CONFLICT" });
    expect(await count("SELECT COUNT(*) n FROM price_research WHERE organization_id=? AND process_id=?", [ORG, pid])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM price_research_items WHERE organization_id=? AND process_id=?", [ORG, pid])).toBe(3);
    expect(await count("SELECT COUNT(*) n FROM intelligent_items WHERE organization_id=? AND process_id=?", [ORG, pid])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM import_promotions WHERE organizationId=? AND procurementProcessId=?", [ORG, pid])).toBe(1);
    expect((await listProcessTimeline(pid, ORG)).filter((e) => e.summary.startsWith("Pesquisa de preços promovida")).length).toBe(1);
    const [it] = await listIntelligentItems(pid, ORG);
    expect([it.quoteCount, it.averagePriceCents]).toEqual([3, 10000]);
    // Mesmo arquivo / mesmo processId em OUTRO tenant não colide (UNIQUE é tenant-aware).
    const [s2] = await db.insert(importSessions).values({ organizationId: ORG2, uploadedBy: U1, sourceFileId: "imports/y", sourceFileName: "mapa.csv", sourceMimeType: "text/csv", checksum, procurementProcessId: pid, importType: "price_research", parserType: "csv", status: "approved" }).$returningId();
    await db.insert(importStagingItems).values({ importSessionId: s2.id, organizationId: ORG2, rawDescription: "Cadeira", rawQuantity: "10", rawUnit: "un", rawUnitPrice: "100,00", reviewStatus: "approved" });
    await expect(promoteApprovedSessionToDomain({ sessionId: s2.id, organizationId: ORG2, procurementProcessId: pid, actorUserId: U2, idempotencyKey: `race-other-${s2.id}`, correlationId: "o" })).resolves.toMatchObject({ idempotent: false });
  }, 60_000);

  it("8b) exclusividade no BANCO com duas conexões explícitas: a segunda bloqueia e recebe ER_DUP_ENTRY após o commit da primeira", async () => {
    const c1 = await mysql.createConnection(DB!);
    const c2 = await mysql.createConnection(DB!);
    const chk = createHash("sha256").update(`raw-${Date.now()}`).digest("hex");
    try {
      await c1.beginTransaction(); await c2.beginTransaction();
      const ins = (c: mysql.Connection, sid: number) => c.execute("INSERT INTO import_promotions (organizationId, procurementProcessId, importSessionId, importType, targetKind, itemsPromoted, sourceChecksum) VALUES (?, 'RAWP', ?, 'price_research', 'price_research', 0, ?)", [ORG, sid, chk]);
      await ins(c1, 880001);
      const second = ins(c2, 880002).then(() => "inserted", (e) => e.code as string);
      await new Promise((r) => setTimeout(r, 300));
      await c1.commit();
      expect(await second).toBe("ER_DUP_ENTRY");
      await c2.rollback();
    } finally { await c1.end(); await c2.end(); }
  }, 30_000);

  it("9–10) ledger APPEND-ONLY: extraído → revisões → aprovação → edição invalida → reaprovação → promoção; tudo reconstruível", async () => {
    const pid = await newProcess(ORG);
    await ingest(ORG, pid, "document_dfd", "dfd.docx", DOCX, await docxOf("DFD", "Precisamos de 10 cadeiras."));
    let st = (await getDocumentIntake({ organizationId: ORG, processId: pid, kind: "dfd" })).staging!;
    const v1 = `${st.content}\nRevisão 1.`; const v2 = `${st.content}\nRevisão 2.`; const v3 = `${st.content}\nRevisão 3.`;
    const r1 = await saveDocumentReview({ organizationId: ORG, processId: pid, stagingId: st.id, expectedRevision: 0, content: v1, actorUserId: U1, correlationId: "r1" });
    const r2 = await saveDocumentReview({ organizationId: ORG, processId: pid, stagingId: st.id, expectedRevision: 1, content: v2, actorUserId: U1, correlationId: "r2" });
    await approveDocumentStaging({ organizationId: ORG, processId: pid, stagingId: st.id, expectedContentHash: r2.contentHash, actorUserId: U2, correlationId: "a1" });
    const r3 = await saveDocumentReview({ organizationId: ORG, processId: pid, stagingId: st.id, expectedRevision: 2, content: v3, actorUserId: U1, correlationId: "r3" });
    st = (await getDocumentIntake({ organizationId: ORG, processId: pid, kind: "dfd" })).staging!;
    expect(st.status).toBe("pending_review"); // aprovação invalidada
    await approveDocumentStaging({ organizationId: ORG, processId: pid, stagingId: st.id, expectedContentHash: r3.contentHash, actorUserId: U2, correlationId: "a2" });
    await promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U1, idempotencyKey: `led-${st.id}`, correlationId: "p" });

    const h = await getDocumentReviewHistory({ organizationId: ORG, processId: pid, stagingId: st.id, includeContent: true });
    expect(h.map((e) => e.eventType)).toEqual(["extracted", "reviewed", "reviewed", "approved", "approval_invalidated", "reviewed", "approved", "promoted"]);
    expect(h.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(h[0].content).toBe(st.rawContent);
    expect([h[1].content, h[2].content, h[5].content]).toEqual([v1, v2, v3]);
    expect(h[2].previousContentHash).toBe(r1.contentHash);
    expect(h[3].contentHash).toBe(r2.contentHash);
    expect(h[7]).toMatchObject({ contentHash: r3.contentHash, revision: 3 });
    const draft = await getGeneratedDocumentByKind(pid, ORG, "dfd");
    expect(draft!.content).toBe(v3);
    expect(draft!.sources).toContain(`aprovado:rev3@${r3.contentHash.slice(0, 12)}`);
    expect(h[7].targetDocumentId).toBeTruthy();
    // Descarte também é registrado; outro tenant não lê o histórico.
    await ingest(ORG, pid, "document_etp", "etp.docx", DOCX, await docxOf("ETP", "Estudo."));
    const etp = (await getDocumentIntake({ organizationId: ORG, processId: pid, kind: "etp" })).staging!;
    await rejectDocumentStaging({ organizationId: ORG, processId: pid, stagingId: etp.id, actorUserId: U1, correlationId: "rj", reason: "arquivo errado" });
    const he = await getDocumentReviewHistory({ organizationId: ORG, processId: pid, stagingId: etp.id });
    expect(he.map((e) => e.eventType)).toEqual(["extracted", "rejected"]);
    expect(he[1].reason).toBe("arquivo errado");
    expect(await getDocumentReviewHistory({ organizationId: ORG2, processId: pid, stagingId: st.id })).toEqual([]);
  }, 60_000);

  it("11–15) digest das fontes do TR: fornecedor, preço, quantidade e nº do processo mudam; ordem física não; retry idêntico estável", async () => {
    const pid = await newProcess(ORG);
    await manual(ORG, pid, "Mesa;5;un;R$ 300,00;Móveis A\nMesa;5;un;R$ 320,00;Móveis B");
    await approveAllItems(ORG, pid);
    const dig = async () => (await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Mesas" })).currentDigest;
    const d0 = await dig();
    expect(await dig()).toBe(d0); // retry idêntico
    // 15) ordem física das cotações no JSON não muda o digest.
    const [row] = await conn.execute<mysql.RowDataPacket[]>("SELECT id, suppliers FROM intelligent_items WHERE organization_id=? AND process_id=?", [ORG, pid]);
    const r0 = row[0] as any;
    await conn.execute("UPDATE intelligent_items SET suppliers=? WHERE id=?", [JSON.stringify([...JSON.parse(r0.suppliers)].reverse()), r0.id]);
    expect(await dig()).toBe(d0);
    // 11) fornecedor alterado (fluxo real: nova cotação → aplicar → reaprovar).
    await manual(ORG, pid, "Mesa;5;un;R$ 300,00;Móveis Z\nMesa;5;un;R$ 320,00;Móveis B");
    await applyItemSourceUpdate({ organizationId: ORG, itemId: r0.id, actorUserId: U1, correlationId: "s" });
    await approveAllItems(ORG, pid);
    const d1 = await dig(); expect(d1).not.toBe(d0);
    // 12) preço alterado.
    await manual(ORG, pid, "Mesa;5;un;R$ 310,00;Móveis Z\nMesa;5;un;R$ 320,00;Móveis B");
    await applyItemSourceUpdate({ organizationId: ORG, itemId: r0.id, actorUserId: U1, correlationId: "s2" });
    await approveAllItems(ORG, pid);
    const d2 = await dig(); expect(d2).not.toBe(d1);
    // 14) nº do processo (renderizado no prompt) altera o digest.
    await conn.execute("UPDATE procurement_processes SET process_number = CONCAT(process_number, '-R') WHERE id=?", [pid]);
    const d3 = await dig(); expect(d3).not.toBe(d2);
    // 13) quantidade (nova chave lógica → novo item aprovado) altera o digest.
    await manual(ORG, pid, "Mesa;6;un;R$ 310,00;Móveis Z");
    await approveAllItems(ORG, pid);
    expect(await dig()).not.toBe(d3);
  }, 60_000);

  it("16–18) createSession pelo ROUTER real: mesma chave+payload ⇒ replay; outro processo ou outro tipo ⇒ IDEMPOTENCY_CONFLICT", async () => {
    const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'Hard', ?)", [`hard-${Date.now()}`, `hard-${Date.now()}@teste.local`]);
    const userId = u.insertId;
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG, userId]);
    const { appRouter } = await import("../../routers");
    const caller = appRouter.createCaller({ user: { id: userId, role: "user" }, req: { headers: {} }, res: {}, correlationId: "hard-router" } as any);
    const p1 = await newProcess(ORG); const p2 = await newProcess(ORG);
    const base = { importType: "price_research" as const, sourceFileName: "c.csv", sourceMimeType: "text/csv", sourceSize: 10, checksum: "c".repeat(64), idempotencyKey: `idem-${Date.now()}`, procurementProcessId: p1 };
    const a = await caller.ingestion.createSession(base);
    const b = await caller.ingestion.createSession(base);
    expect(b.sessionId).toBe(a.sessionId);
    await expect(caller.ingestion.createSession({ ...base, procurementProcessId: p2 })).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
    await expect(caller.ingestion.createSession({ ...base, importType: "document_tr", sourceMimeType: "application/pdf" })).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
    expect(await count("SELECT COUNT(*) n FROM import_sessions WHERE organizationId=? AND checksum=?", [ORG, "c".repeat(64)])).toBe(1);
    await conn.execute("DELETE FROM users WHERE id=?", [userId]).catch(() => {});
  }, 60_000);

  it("18b) issueProcess (risco D) NÃO emite: operator ⇒ FORBIDDEN; manager sem Edital OFICIAL ⇒ PRECONDITION_FAILED; com emissão oficial ⇒ só projeta a etapa", async () => {
    const mk = async (role: string) => {
      const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'Hard', ?)", [`hard-${role}-${Date.now()}`, `hard-${role}-${Date.now()}@teste.local`]);
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [ORG, u.insertId, role]);
      return u.insertId;
    };
    const opId = await mk("operator"); const mgrId = await mk("manager");
    const { appRouter } = await import("../../routers");
    const as = (id: number) => appRouter.createCaller({ user: { id, role: "user" }, req: { headers: {} }, res: {}, correlationId: "hard-issue" } as any);
    const pid = await newProcess(ORG);
    const stage = async () => { const [r] = await conn.execute<mysql.RowDataPacket[]>("SELECT current_stage s, status FROM procurement_processes WHERE id=?", [pid]); return [(r[0] as any).s, (r[0] as any).status]; };
    const before = await stage();
    await expect(as(opId).procurementProcess.issueProcess({ processId: pid })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as(mgrId).procurementProcess.issueProcess({ processId: pid })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await stage()).toEqual(before);
    // Emissão OFICIAL do Edital (fluxo governado coberto pelo smoke C.4B.1) representada pelo seu ledger.
    await conn.execute(
      "INSERT INTO official_document_promotions (organization_id, process_id, official_document_id, lineage_id, document_kind, version, content_hash, actor_user_id, idempotency_key) VALUES (?, ?, 'off-ed-1', 'lin-ed-1', 'edital', 1, ?, ?, ?)",
      [ORG, pid, "e".repeat(64), mgrId, `issue-${pid}`],
    );
    const r = await as(mgrId).procurementProcess.issueProcess({ processId: pid });
    expect(r).toMatchObject({ status: "emitido", officialEditalVersion: 1 });
    expect(await stage()).toEqual(["ISSUED", "emitido"]);
    await conn.execute("DELETE FROM users WHERE id IN (?, ?)", [opId, mgrId]).catch(() => {});
  }, 60_000);

  it("19) 'Baseado em N' conta só cotações válidas (fornecedor sem preço não entra)", async () => {
    const pid = await newProcess(ORG);
    await manual(ORG, pid, "Cadeira;10;un;R$ 100,00;A\nCadeira;10;un;R$ 110,00;B\nCadeira;10;un;;C");
    const [it] = await listIntelligentItems(pid, ORG);
    expect([it.suppliers.length, it.quoteCount, it.averagePriceCents]).toEqual([3, 2, 10500]);
    await approveAllItems(ORG, pid);
    const { document } = await generateDocument({ organizationId: ORG, processId: pid, kind: "tr", object: "Cadeiras", correlationId: "q", idempotencyKey: `q-${pid}`, actorUserId: U2, invoke: async () => buildMockProviderAuthoring("tr") });
    expect(document.content).toContain("Baseado em 2 cotação(ões) válida(s)");
  }, 60_000);

  it("20) recuperação DURÁVEL do enriquecimento: processing travado/pending antigo → done; segunda execução é no-op", async () => {
    const pid = await newProcess(ORG);
    await manual(ORG, pid, "Grampeador;2;un;R$ 30,00;A");
    const [it] = await listIntelligentItems(pid, ORG);
    await conn.execute("UPDATE intelligent_items SET enrichment_status='processing', enrichment_attempts=1, enrichment_last_attempt_at=NOW(3) - INTERVAL 1 HOUR WHERE id=?", [it.id]);
    const r1 = await recoverStaleEnrichment({ organizationId: ORG, processId: pid });
    expect(r1).toMatchObject({ scanned: 1, enriched: 1 });
    const [row] = await conn.execute<mysql.RowDataPacket[]>("SELECT enrichment_status, enrichment_attempts FROM intelligent_items WHERE id=?", [it.id]);
    expect([(row[0] as any).enrichment_status, (row[0] as any).enrichment_attempts]).toEqual(["done", 2]);
    expect((await recoverStaleEnrichment({ organizationId: ORG, processId: pid })).scanned).toBe(0);
    // Limite de tentativas: não fica em loop.
    await conn.execute("UPDATE intelligent_items SET enrichment_status='pending', enrichment_attempts=3 WHERE id=?", [it.id]);
    expect((await recoverStaleEnrichment({ organizationId: ORG, processId: pid, staleMs: 0 })).scanned).toBe(0);
  }, 60_000);

  it("GOLDEN A) DFD+ETP importados + XLSX com 3 fornecedores → Itens → TR → Edital: valores, contagem, digest, lineage, timeline e histórico", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    for (const kind of ["dfd", "etp"] as const) {
      await ingest(ORG, pid, `document_${kind}`, `${kind}.docx`, DOCX, await docxOf(kind.toUpperCase(), kind === "dfd" ? "A Secretaria precisa de 10 cadeiras." : "Aquisição direta com garantia de 12 meses."));
      const st = (await getDocumentIntake({ organizationId: ORG, processId: pid, kind })).staging!;
      await approveDocumentStaging({ organizationId: ORG, processId: pid, stagingId: st.id, expectedContentHash: st.contentHash, actorUserId: U2, correlationId: "ga" });
      await promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U1, idempotencyKey: `ga-${kind}-${st.id}`, correlationId: "ga" });
      expect((await getDocumentReviewHistory({ organizationId: ORG, processId: pid, stagingId: st.id })).map((e) => e.eventType)).toEqual(["extracted", "approved", "promoted"]);
    }
    const sid = await ingest(ORG, pid, "price_research", "mapa.xlsx", XLSX_MIME, xlsxOf([
      ["Item", "Descrição", "Qtd", "Unid", "Móveis A (R$)", "Móveis B (R$)", "Móveis C (R$)"],
      [1, "Cadeira giratória", 10, "un", 100, 110, 90],
    ]));
    const promo = await approveAndPromote(ORG, pid, sid);
    expect(promo.intelligentItems).toMatchObject({ created: 1, total: 1, validQuotes: 3 });
    await approveAllItems(ORG, pid);
    const src = await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras" });
    expect(src.summary).toMatchObject({ quoteCount: 3, estimatedGlobalTotalCents: 100000, dfd: { present: true, origin: "import" } });
    const tr = await generateDocument({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras", correlationId: "ga", idempotencyKey: `ga-tr-${pid}`, actorUserId: U2, invoke: async () => buildMockProviderAuthoring("tr") });
    expect(tr.document.content).toContain("| 1 | Cadeira giratória | 10 | un | 100,00 | 1.000,00 |");
    expect(tr.document.content).toContain("Baseado em 3 cotação(ões) válida(s)");
    expect(tr.document.sources).toContain(`srcdigest:${src.currentDigest.slice(0, 16)}`);
    expect(tr.document.sources.some((x) => x.startsWith("coverage:dfd="))).toBe(true);
    expect((await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras" })).state).toBe("current");
    const ed = await generateNotice({ organizationId: ORG, processId: pid, object: "Aquisição de cadeiras", modality: "pregao", form: "eletronico", platform: "compras_gov", correlationId: "ga", idempotencyKey: `ga-ed-${pid}`, actorUserId: U2, invoke: async () => buildMockProviderAuthoring("edital") });
    expect(ed.document.content).toContain("**Valor estimado global:** R$ 1.000,00");
    const tl = (await listProcessTimeline(pid, ORG)).map((e) => e.summary);
    expect(tl.filter((s) => s.includes("importado promovido a rascunho"))).toHaveLength(2);
    expect(tl.filter((s) => s.startsWith("Pesquisa de preços promovida"))).toHaveLength(1);
    expect(tl.some((s) => s.startsWith("TR gerado"))).toBe(true);
    expect(tl.some((s) => s.startsWith("Edital gerado"))).toBe(true);
  }, 120_000);

  it("GOLDEN B) TR importado → revisado → promovido → Edital; histórico documental completo", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    await ingest(ORG, pid, "document_tr", "tr.docx", DOCX, await docxOf("TERMO DE REFERÊNCIA", "Prazo de entrega de 20 dias corridos."));
    const st = (await getDocumentIntake({ organizationId: ORG, processId: pid, kind: "tr" })).staging!;
    const rev = await saveDocumentReview({ organizationId: ORG, processId: pid, stagingId: st.id, expectedRevision: 0, content: `${st.content}\nGarantia de 12 meses.`, actorUserId: U1, correlationId: "gb" });
    await approveDocumentStaging({ organizationId: ORG, processId: pid, stagingId: st.id, expectedContentHash: rev.contentHash, actorUserId: U2, correlationId: "gb" });
    await promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U1, idempotencyKey: `gb-${st.id}`, correlationId: "gb" });
    const h = await getDocumentReviewHistory({ organizationId: ORG, processId: pid, stagingId: st.id, includeContent: true });
    expect(h.map((e) => e.eventType)).toEqual(["extracted", "reviewed", "approved", "promoted"]);
    expect(h[1].content).toContain("Garantia de 12 meses.");
    let prompt = "";
    await generateNotice({ organizationId: ORG, processId: pid, object: "Aquisição de cadeiras", modality: "pregao", form: "eletronico", platform: "compras_gov", correlationId: "gb", idempotencyKey: `gb-ed-${pid}`, actorUserId: U2, invoke: async (p) => { prompt = p; return buildMockProviderAuthoring("edital"); } });
    expect(prompt).toContain("20 dias corridos");
    expect(prompt).toContain("Garantia de 12 meses.");
  }, 120_000);
});

/**
 * MIGRATION 0304 — segurança de migração (banco DEDICADO, hermético):
 *   UPGRADE     — cadeia até a 0303 + dados legados (promoções/itens pré-hardening) → aplicar a 0304 preserva
 *                 as linhas, sourceChecksum legado = NULL (não colide), source_state = 'current'.
 *   REPLAY      — reaplicar TODOS os statements da 0304 num banco convergido é no-op (sem erro, sem mudança).
 *   FAIL-CLOSED — duplicata NÃO-NULL (só por escrita manual) impede o UNIQUE: a 0304 falha em vez de
 *                 deduplicar arbitrariamente.
 */
describe.skipIf(!DB)("P0 PILOTO — migration 0304 (upgrade / replay / fail-closed)", () => {
  const TAG = "0304_p0_hardening";
  const DRZ = pathMod.join(process.cwd(), "drizzle");
  const dbName = `licigov_mig0304_${Date.now()}`;
  let admin: mysql.Connection;
  let m: mysql.Connection;
  const urlFor = (name: string) => { const u = new URL(DB!); u.pathname = `/${name}`; return u.toString(); };
  const statements = (tag: string) => readFileSync(pathMod.join(DRZ, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint").map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter((s) => s.length > 0);
  const apply = async (tag: string) => { for (const s of statements(tag)) await m.query(s); };
  const columns = async (t: string) => {
    const [r] = await m.query<mysql.RowDataPacket[]>("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY c", [t]);
    return r.map((x) => String(x.c));
  };
  const indexes = async (t: string) => {
    const [r] = await m.query<mysql.RowDataPacket[]>("SELECT DISTINCT INDEX_NAME i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY i", [t]);
    return r.map((x) => String(x.i));
  };

  beforeAll(async () => {
    const u = new URL(DB!); u.pathname = "/";
    admin = await mysql.createConnection(u.toString());
    await admin.query(`CREATE DATABASE \`${dbName}\``);
    m = await mysql.createConnection({ uri: urlFor(dbName), multipleStatements: false });
    const journal = JSON.parse(readFileSync(pathMod.join(DRZ, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const idx = journal.entries.findIndex((e) => e.tag === TAG);
    expect(idx).toBeGreaterThan(0);
    for (const e of journal.entries.slice(0, idx)) await apply(e.tag);
  }, 600_000);
  afterAll(async () => { await m?.end(); await admin?.query(`DROP DATABASE IF EXISTS \`${dbName}\``).catch(() => {}); await admin?.end(); });

  it("UPGRADE preserva dados legados; REPLAY é no-op; duplicata não-nula ⇒ FAIL-CLOSED (sem dedupe)", async () => {
    // Estado pré-0304: sem as colunas/tabelas novas.
    expect(await columns("import_promotions")).not.toContain("sourceChecksum");
    expect(await columns("intelligent_items")).not.toContain("source_state");
    // Dados legados: duas promoções do MESMO processo/tipo (antes não havia checksum) + um item aprovado.
    await m.query("INSERT INTO import_promotions (organizationId, importSessionId, importType, targetKind, procurementProcessId, idempotencyKey) VALUES (1, 11, 'pesquisa_precos', 'price_research', 'P-LEG', 'k1'), (1, 12, 'pesquisa_precos', 'price_research', 'P-LEG', 'k2')");
    await m.query("INSERT INTO intelligent_items (id, organization_id, process_id, description, status) VALUES ('legacy-item-1', 1, 'P-LEG', 'Cadeira', 'aprovado')");

    await apply(TAG);
    const [promos] = await m.query<mysql.RowDataPacket[]>("SELECT importSessionId, sourceChecksum FROM import_promotions ORDER BY importSessionId");
    expect(promos.map((r) => [r.importSessionId, r.sourceChecksum])).toEqual([[11, null], [12, null]]);
    const [items] = await m.query<mysql.RowDataPacket[]>("SELECT status, source_state, enrichment_attempts FROM intelligent_items WHERE id = 'legacy-item-1'");
    expect(items[0]).toMatchObject({ status: "aprovado", source_state: "current", enrichment_attempts: 0 });
    expect(await indexes("import_promotions")).toContain("uq_import_promotions_source");

    // REPLAY: mesmo schema antes/depois, sem erro.
    const snap = async () => JSON.stringify(await Promise.all(
      ["import_promotions", "intelligent_items", "import_staging_items", "import_document_review_ledger", "intelligent_item_identity_aliases"]
        .map(async (t) => [t, await columns(t), await indexes(t)]),
    ));
    const before = await snap();
    await apply(TAG);
    expect(await snap()).toBe(before);

    // FAIL-CLOSED: sem o UNIQUE, uma escrita manual cria duplicata NÃO-NULL; a 0304 recusa recriá-lo.
    await m.query("DROP INDEX `uq_import_promotions_source` ON import_promotions");
    await m.query("UPDATE import_promotions SET sourceChecksum = 'dup' WHERE procurementProcessId = 'P-LEG'");
    await expect(apply(TAG)).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    const [still] = await m.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM import_promotions WHERE procurementProcessId = 'P-LEG'");
    expect(Number(still[0].n)).toBe(2); // nada foi deduplicado/apagado
  }, 300_000);
});
