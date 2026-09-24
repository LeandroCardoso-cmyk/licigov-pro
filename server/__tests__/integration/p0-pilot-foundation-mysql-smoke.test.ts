/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0 PILOTO — FUNDAÇÃO COMPLETA contra MySQL REAL (CI: MySQL 8.4). Executável, não source inspection.
 *
 * Caminho REAL de ponta a ponta: sessão de ingestão → WORKER da fila (storage em memória no teste; o
 * binário nunca vai ao banco) → parser REAL (DOCX/PDF/CSV gerados em tempo de teste) → staging →
 * revisão/aprovação humana → promoção governada → rascunho canônico / Itens Inteligentes → autoria
 * ETP/TR/Edital com CONTEXTO REAL (seam `invoke` determinístico, sem rede) → lineage/replay/SOURCE_CHANGED.
 *
 * Cenários: import DFD (DOCX) + revisão/lock otimista/aprovação/promoção/replay; conflito de rascunho +
 * substituição governada (ledger preserva o anterior; oficial intocado); PDF escaneado → OCR_REQUIRED;
 * isolamento multi-tenant e entre processos; Pesquisa em MAPA COMPARATIVO (CSV largo) → cotações →
 * Itens Inteligentes (média 100,00; replay sem duplicar; mesmo arquivo → CONFLICT; item aprovado
 * preservado); TR com contexto real e números autoritativos; GOLDEN A (Secretaria mandou os documentos)
 * e GOLDEN B (TR já veio pronto → Edital).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import mysql from "mysql2/promise";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } from "docx";

const DB = process.env.DATABASE_URL;
const ORG = 990601;
const ORG2 = 990602;
const U_OPERATOR = 61;
const U_OTHER = 62;

// Storage em MEMÓRIA (o Storage Service real é S3). O worker lê os bytes daqui — mesmo contrato.
const mem = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", () => ({
  storageGetBytes: async (key: string) => {
    const b = mem.get(key);
    if (!b) throw new Error(`storage vazio: ${key}`);
    return b;
  },
}));

import { runMigrations } from "../../bootstrap";
import { getDb } from "../../db/connection";
import { importSessions, catmatDecisionsTable } from "../../../drizzle/schema";
import { enqueueImport } from "../../services/importQueueService";
import { getImportSession, updateSessionStatus } from "../../services/fileIngestionService";
import { getStagingItems, bulkReviewStagingItems } from "../../services/importStagingService";
import { promoteApprovedSessionToDomain } from "../../services/importPromotionService";
import {
  getDocumentIntake, saveDocumentReview, approveDocumentStaging, promoteDocumentToDraft, rejectDocumentStaging,
} from "../../services/documentIntakeService";
import {
  generateDocument, generateNotice, getAuthoringSourceState, getEditalSourceState, saveDFDDraft,
} from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { insertProcess, getGeneratedDocumentByKind, listIntelligentItems, transitionItemStatusCAS } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { draftContentHash } from "../../domain/generatedDocument";

let conn: mysql.Connection;
let seq = 0;

// ─── Fixtures reais (geradas em tempo de teste) ───────────────────────────────────

async function docxOf(title: string, sections: Array<{ h: string; p: string }>, table?: string[][]): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 })];
  for (const s of sections) {
    children.push(new Paragraph({ text: s.h, heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ children: [new TextRun(s.p)] }));
  }
  if (table) children.push(new Table({ rows: table.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph(c)] })) })) }));
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

function pdfOf(lines: string[] | null): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    if (lines) { doc.fontSize(11); lines.forEach((l) => doc.text(l)); }
    else { doc.rect(60, 60, 300, 200).fill("#cccccc"); doc.circle(200, 400, 60).fill("#999999"); } // só imagem
    doc.end();
  });
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function newProcess(org: number, object: string): Promise<string> {
  const p = createProcurementWorkspace({
    organizationId: org, processNumber: `P0-${Date.now()}-${++seq}`, object, startOption: "importar_tr",
    responsibleUser: U_OPERATOR, correlationId: "p0-smoke",
  });
  await insertProcess(p);
  return p.id;
}

/** Sessão + upload (storage em memória) + WORKER real da fila; aguarda estado final. */
async function ingest(org: number, processId: string, importType: string, fileName: string, mime: string, bytes: Buffer): Promise<number> {
  const db = (await getDb())!;
  const key = `imports/${org}/${Date.now()}-${++seq}-${fileName}`;
  mem.set(key, bytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const [s] = await db.insert(importSessions).values({
    organizationId: org, uploadedBy: U_OPERATOR, sourceFileId: key, sourceFileName: fileName, sourceMimeType: mime,
    sourceSize: bytes.length, checksum, procurementProcessId: processId, importType, parserType: "auto",
    status: "uploaded", stage: "file_stored", correlationId: `p0-${seq}`,
  }).$returningId();
  expect(enqueueImport(s.id, org, key, { correlationId: `p0-${seq}` })).not.toBeNull();
  for (let i = 0; i < 200; i++) {
    const cur = await getImportSession(s.id, org);
    if (cur && ["awaiting_review", "failed"].includes(cur.status) && cur.stage !== "retry") return s.id;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("worker não concluiu");
}

async function importAndApproveDocument(org: number, processId: string, kind: "dfd" | "etp" | "tr", bytes: Buffer, fileName: string, mime = DOCX) {
  await ingest(org, processId, `document_${kind}`, fileName, mime, bytes);
  const view = await getDocumentIntake({ organizationId: org, processId, kind });
  expect(view.staging?.status).toBe("pending_review");
  await approveDocumentStaging({ organizationId: org, processId, stagingId: view.staging!.id, expectedContentHash: view.staging!.contentHash, actorUserId: U_OPERATOR, correlationId: "p0" });
  return view.staging!;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params as any[]);
  return Number((rows[0] as any).n);
}

/** Pesquisa em mapa comparativo (CSV LARGO) → worker → aprova tudo → promove (materializa Itens). */
async function importPriceMap(org: number, processId: string, csv: string, actor = U_OPERATOR) {
  const sessionId = await ingest(org, processId, "price_research", `mapa-${seq}.csv`, "text/csv", Buffer.from(csv, "utf8"));
  const items = await getStagingItems(sessionId, org);
  await bulkReviewStagingItems(items.map((i) => i.id), org, actor, "approved");
  await updateSessionStatus(sessionId, org, "approved", { progress: 100, stage: "approved" });
  const result = await promoteApprovedSessionToDomain({
    sessionId, organizationId: org, procurementProcessId: processId, actorUserId: actor,
    idempotencyKey: `promo-${sessionId}`, correlationId: `promo-${sessionId}`,
  });
  return { sessionId, result, stagingCount: items.length };
}

const MAPA = [
  "Item;Descrição;Qtd;Unid;Móveis A (R$);Móveis B (R$);Móveis C (R$);Média",
  "1;Cadeira giratória;10;un;100,00;110,00;90,00;100,00",
].join("\n");

async function approveAll(org: number, processId: string) {
  for (const it of await listIntelligentItems(processId, org)) {
    await transitionItemStatusCAS({ id: it.id, orgId: org, fromStatuses: ["pendente", "em_analise"], toStatus: "aprovado", approvedBy: U_OTHER, updatedAt: new Date().toISOString() });
  }
}

async function confirmCatmat(org: number, processId: string, itemId: string, code: string) {
  const db = (await getDb())!;
  await db.insert(catmatDecisionsTable).values({
    organizationId: org, processId, itemId, decision: "confirmado", catmatCode: code, catmatDescription: "Cadeira giratória",
    source: "manual", actorUserId: U_OTHER, correlationId: "p0", idempotencyKey: `cm-${itemId}-${++seq}`,
  });
}

async function cleanup() {
  const tables: Array<[string, string]> = [
    ["import_document_staging", "organizationId"], ["import_promotions", "organizationId"],
    ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"], ["import_sessions", "organizationId"],
    ["price_research_items", "organization_id"], ["price_research", "organization_id"],
    ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"],
    ["intelligent_items", "organization_id"], ["catmat_decisions", "organizationId"],
    ["generated_document_edits", "organization_id"], ["generated_documents", "organization_id"],
    ["official_document_timeline", "tenant_id"], ["official_documents", "tenant_id"],
    ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"],
    ["idempotency_keys", "organizationId"], ["cognitive_provenance", "organization_id"],
  ];
  for (const org of [ORG, ORG2]) {
    for (const [t, col] of tables) {
      await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(async () => {
        const alt = col === "organizationId" ? "organization_id" : "organizationId";
        await conn.query(`DELETE FROM \`${t}\` WHERE \`${alt}\` = ?`, [org]).catch(() => {});
      });
    }
  }
}

const DFD_DOCX = () => docxOf("DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA", [
  { h: "1. Necessidade", p: "A Secretaria de Educação necessita de 10 cadeiras giratórias para a sala dos professores." },
  { h: "2. Justificativa", p: "As cadeiras atuais estão danificadas e comprometem a ergonomia." },
]);
const ETP_DOCX = () => docxOf("ESTUDO TÉCNICO PRELIMINAR", [
  { h: "1. Descrição da necessidade", p: "Reposição de mobiliário ergonômico." },
  { h: "2. Solução escolhida", p: "Aquisição direta de cadeiras com garantia mínima de 12 meses." },
]);
const TR_DOCX = () => docxOf("TERMO DE REFERÊNCIA", [
  { h: "1. Objeto", p: "Aquisição de cadeiras giratórias ergonômicas." },
  { h: "2. Prazo de entrega", p: "O prazo de entrega é de 20 dias corridos a contar da ordem de fornecimento." },
], [["Descrição", "Quantidade", "Unidade", "Valor unitário"], ["Cadeira giratória", "10", "un", "100,00"]]);

describe.skipIf(!DB)("P0 PILOTO — fundação Document Intake + Pesquisa → Itens → TR → Edital (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "P0 Org", "p0-org"]).catch(() => {});
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG2, "P0 Org 2", "p0-org-2"]).catch(() => {});
    await cleanup();
  }, 300_000);
  afterAll(async () => { await cleanup().catch(() => {}); await conn?.end(); });

  it("1) DFD importado (DOCX real): projeção imutável, revisão com lock otimista, aprovação por hash, promoção + ledger + replay", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    await ingest(ORG, pid, "document_dfd", "dfd.docx", DOCX, await DFD_DOCX());
    const v0 = await getDocumentIntake({ organizationId: ORG, processId: pid, kind: "dfd" });
    const st = v0.staging!;
    expect(st.status).toBe("pending_review");
    expect(st.rawContent).toContain("10 cadeiras giratórias");
    expect(st.stats.headings).toBeGreaterThanOrEqual(2);
    expect(st.parser).toMatch(/^docx@2\.1\.0$/);
    expect(JSON.stringify(v0)).not.toContain("imports/"); // chave de storage nunca exposta

    // Revisão humana (raw imutável) + lock otimista.
    const edited = `${st.content}\n\nObservação do revisor: prioridade alta.`;
    const r1 = await saveDocumentReview({ organizationId: ORG, processId: pid, stagingId: st.id, expectedRevision: 0, content: edited, actorUserId: U_OPERATOR, correlationId: "p0" });
    expect(r1).toMatchObject({ revision: 1, changed: true });
    await expect(saveDocumentReview({ organizationId: ORG, processId: pid, stagingId: st.id, expectedRevision: 0, content: "outro", actorUserId: U_OPERATOR, correlationId: "p0" })).rejects.toMatchObject({ code: "CONFLICT" });
    // Aprovação exige o hash do que foi revisado.
    await expect(approveDocumentStaging({ organizationId: ORG, processId: pid, stagingId: st.id, expectedContentHash: st.contentHash, actorUserId: U_OPERATOR, correlationId: "p0" })).rejects.toMatchObject({ code: "CONFLICT" });
    // Promover antes de aprovar → recusado.
    await expect(promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U_OPERATOR, idempotencyKey: "p0-dfd-early", correlationId: "p0" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await approveDocumentStaging({ organizationId: ORG, processId: pid, stagingId: st.id, expectedContentHash: r1.contentHash, actorUserId: U_OPERATOR, correlationId: "p0" });

    const prom = await promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U_OPERATOR, idempotencyKey: "p0-dfd-1", correlationId: "p0" });
    expect(prom).toMatchObject({ kind: "dfd", created: true, replayed: false });
    const draft = await getGeneratedDocumentByKind(pid, ORG, "dfd");
    expect(draft!.status).toBe("rascunho");
    expect(draft!.content).toBe(edited.replace(/\r\n/g, "\n"));
    expect(draft!.sources).toEqual(expect.arrayContaining(["origem:import", "kind:dfd", "parser:docx@2.1.0"]));
    expect(draft!.authorUserId).toBe(U_OPERATOR);
    expect(await count("SELECT COUNT(*) n FROM generated_document_edits WHERE organization_id=? AND process_id=? AND operation='import_promote'", [ORG, pid])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM import_promotions WHERE organizationId=? AND procurementProcessId=? AND targetKind='dfd'", [ORG, pid])).toBe(1);
    // Raw permanece imutável.
    const [raw] = await conn.execute<mysql.RowDataPacket[]>("SELECT rawContent, rawContentHash, status FROM import_document_staging WHERE id=?", [st.id]);
    expect((raw[0] as any).rawContent).toBe(st.rawContent);
    expect((raw[0] as any).status).toBe("promoted");
    // Replay (mesma chave) → sem duplicar; nova tentativa com outra chave → CONFLICT.
    const replay = await promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U_OPERATOR, idempotencyKey: "p0-dfd-1", correlationId: "p0" });
    expect(replay.replayed).toBe(true);
    await expect(promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U_OPERATOR, idempotencyKey: "p0-dfd-2", correlationId: "p0" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id=? AND process_id=? AND kind='dfd'", [ORG, pid])).toBe(1);
  }, 60_000);

  it("2) conflito de rascunho: create FAIL-CLOSED; substituição exige motivo + hash; anterior preservado; oficial intocado", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    // Rascunho de ETP GERADO antes (com documento 'gerado' no Document Engine).
    await generateDocument({ organizationId: ORG, processId: pid, kind: "etp", object: "Aquisição de cadeiras", correlationId: "p0-gen", idempotencyKey: "p0-etp-gen", actorUserId: U_OTHER, invoke: async () => buildMockProviderAuthoring("etp") });
    const before = await getGeneratedDocumentByKind(pid, ORG, "etp");
    const officialBefore = await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id=?", [ORG]);

    const st = await importAndApproveDocument(ORG, pid, "etp", await ETP_DOCX(), "etp.docx");
    await expect(promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U_OPERATOR, idempotencyKey: "p0-etp-c", correlationId: "p0" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "replace", expectedDraftContentHash: draftContentHash(before!.content), actorUserId: U_OPERATOR, idempotencyKey: "p0-etp-r0", correlationId: "p0" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "replace", expectedDraftContentHash: "f".repeat(64), reason: "ETP oficial da Secretaria", actorUserId: U_OPERATOR, idempotencyKey: "p0-etp-r1", correlationId: "p0" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getGeneratedDocumentByKind(pid, ORG, "etp"))!.content).toBe(before!.content); // nada alterado

    const ok = await promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "replace", expectedDraftContentHash: draftContentHash(before!.content), reason: "ETP oficial da Secretaria", actorUserId: U_OPERATOR, idempotencyKey: "p0-etp-r2", correlationId: "p0" });
    expect(ok).toMatchObject({ mode: "replace", replaced: true });
    const after = await getGeneratedDocumentByKind(pid, ORG, "etp");
    expect(after!.content).toContain("garantia mínima de 12 meses");
    expect(after!.authorUserId).toBe(U_OTHER); // originador preservado
    const [ledger] = await conn.execute<mysql.RowDataPacket[]>("SELECT previous_content, reason FROM generated_document_edits WHERE organization_id=? AND process_id=? AND operation='import_replace'", [ORG, pid]);
    expect((ledger[0] as any).previous_content).toBe(before!.content);
    expect((ledger[0] as any).reason).toBe("ETP oficial da Secretaria");
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id=?", [ORG])).toBe(officialBefore); // oficial intocado
  }, 60_000);

  it("3) PDF escaneado (só imagem) → OCR_REQUIRED terminal, sem staging e sem conteúdo fingido", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    const sid = await ingest(ORG, pid, "document_tr", "tr-escaneado.pdf", "application/pdf", await pdfOf(null));
    const s = await getImportSession(sid, ORG);
    expect(s!.status).toBe("failed");
    expect((s!.errors as any[])[0].code).toBe("OCR_REQUIRED");
    expect((await getDocumentIntake({ organizationId: ORG, processId: pid, kind: "tr" })).staging).toBeNull();
  }, 60_000);

  it("4) PDF com texto → projeção documental real (TR)", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    await ingest(ORG, pid, "document_tr", "tr.pdf", "application/pdf", await pdfOf(["TERMO DE REFERÊNCIA", "1. OBJETO", "Aquisição de cadeiras giratórias.", "2. PRAZO", "Entrega em 20 dias."]));
    const v = await getDocumentIntake({ organizationId: ORG, processId: pid, kind: "tr" });
    expect(v.staging!.parser).toBe("pdf@2.2.0");
    expect(v.staging!.content).toContain("Entrega em 20 dias.");
    expect(v.staging!.stats.pages).toBe(1);
  }, 60_000);

  it("5) isolamento: outro tenant e outro processo NÃO leem/operam o staging documental", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    const other = await newProcess(ORG, "Outro objeto");
    await ingest(ORG, pid, "document_dfd", "dfd.docx", DOCX, await DFD_DOCX());
    const st = (await getDocumentIntake({ organizationId: ORG, processId: pid, kind: "dfd" })).staging!;
    expect((await getDocumentIntake({ organizationId: ORG2, processId: pid, kind: "dfd" })).staging).toBeNull();
    expect((await getDocumentIntake({ organizationId: ORG, processId: other, kind: "dfd" })).staging).toBeNull();
    await expect(saveDocumentReview({ organizationId: ORG2, processId: pid, stagingId: st.id, expectedRevision: 0, content: "x", actorUserId: U_OTHER, correlationId: "p0" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(approveDocumentStaging({ organizationId: ORG, processId: other, stagingId: st.id, expectedContentHash: st.contentHash, actorUserId: U_OTHER, correlationId: "p0" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(promoteDocumentToDraft({ organizationId: ORG2, processId: pid, stagingId: st.id, mode: "create", actorUserId: U_OTHER, idempotencyKey: "p0-iso", correlationId: "p0" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(rejectDocumentStaging({ organizationId: ORG2, processId: pid, stagingId: st.id, actorUserId: U_OTHER, correlationId: "p0" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 60_000);

  it("6) Pesquisa em MAPA COMPARATIVO (CSV largo) → 3 cotações → 1 Item Inteligente (média 100,00); replay/duplicidade/aprovado preservado", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    const { sessionId, result, stagingCount } = await importPriceMap(ORG, pid, MAPA);
    expect(stagingCount).toBe(3);
    expect(result.itemsPromoted).toBe(3);
    expect(result.intelligentItems).toMatchObject({ created: 1, total: 1 });
    const [item] = await listIntelligentItems(pid, ORG);
    expect(item.averagePrice).toBe(100);
    expect(item.averagePriceCents).toBe(10000);
    // Ordem das cotações é determinística por quoteId (não por posição na planilha).
    expect(item.suppliers.map((s) => [s.name, s.value]).sort()).toEqual([["Móveis A", 100], ["Móveis B", 110], ["Móveis C", 90]]);
    expect(await count("SELECT COUNT(*) n FROM price_research_items WHERE organization_id=? AND process_id=? AND supplier <> ''", [ORG, pid])).toBe(3);
    // Enriquecimento pós-commit concluído (degradável) — sugestão ≠ decisão.
    const [row] = await conn.execute<mysql.RowDataPacket[]>("SELECT enrichment_status, status FROM intelligent_items WHERE id=?", [item.id]);
    expect(["done", "failed"]).toContain((row[0] as any).enrichment_status);
    expect((row[0] as any).status).toBe("pendente");
    // Replay da mesma sessão → idempotente, sem duplicar.
    const replay = await promoteApprovedSessionToDomain({ sessionId, organizationId: ORG, procurementProcessId: pid, actorUserId: U_OPERATOR, idempotencyKey: `promo-${sessionId}`, correlationId: "r" });
    expect(replay.idempotent).toBe(true);
    expect(await listIntelligentItems(pid, ORG)).toHaveLength(1);
    // Mesmo arquivo em nova sessão → CONFLICT (não duplica cotações).
    await expect(importPriceMap(ORG, pid, MAPA)).rejects.toMatchObject({ code: "CONFLICT" });
    // Item APROVADO não muda com nova pesquisa do mesmo item lógico (decisão humana preservada).
    // Contrato superado pelo hardening (blocker 2): antes a nova pesquisa era descartada em silêncio
    // ("preserved"); agora a decisão continua intocada, mas o item é SINALIZADO como SOURCE_CHANGED
    // (cotações novas ficam pendentes até o operador aplicá-las) — nunca sobrescrito, nunca ignorado.
    await approveAll(ORG, pid);
    const mapa2 = MAPA.replace("100,00;110,00;90,00;100,00", "200,00;210,00;190,00;200,00");
    const second = await importPriceMap(ORG, pid, mapa2);
    expect(second.result.intelligentItems).toMatchObject({ sourceChanged: 1, preserved: 0, created: 0 });
    const [again] = await listIntelligentItems(pid, ORG);
    expect(again.status).toBe("aprovado");
    expect(again.averagePriceCents).toBe(10000);
    expect(again.sourceState).toBe("source_changed");
  }, 90_000);

  it("7) TR com CONTEXTO REAL: prompt recebe DFD/ETP/itens; números do quadro autoritativo; replay + SOURCE_CHANGED", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    const dfd = await importAndApproveDocument(ORG, pid, "dfd", await DFD_DOCX(), "dfd.docx");
    await promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: dfd.id, mode: "create", actorUserId: U_OPERATOR, idempotencyKey: "p0-7-dfd", correlationId: "p0" });
    await generateDocument({ organizationId: ORG, processId: pid, kind: "etp", object: "Aquisição de cadeiras", correlationId: "p0-7", idempotencyKey: "p0-7-etp", actorUserId: U_OTHER, invoke: async () => buildMockProviderAuthoring("etp") });
    await importPriceMap(ORG, pid, MAPA);
    await approveAll(ORG, pid);
    const [item] = await listIntelligentItems(pid, ORG);
    await confirmCatmat(ORG, pid, item.id, "461234");

    const pre = await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras" });
    expect(pre.state).toBe("never_generated");
    expect(pre.summary).toMatchObject({ approvedItems: 1, quoteCount: 3, confirmedClassifications: 1, estimatedGlobalTotalCents: 100000, dfd: { present: true, origin: "import" }, etp: { present: true } });

    let prompt = "";
    const invoke = async (p: string) => { prompt = p; return buildMockProviderAuthoring("tr"); };
    const { document } = await generateDocument({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras", correlationId: "p0-7", idempotencyKey: "p0-7-tr", actorUserId: U_OTHER, invoke });
    expect(prompt).toContain("10 cadeiras giratórias");      // DFD importado
    expect(prompt).toContain("Cadeira giratória");           // item aprovado
    expect(document.content).toContain("| 1 | Cadeira giratória | 10 | un | 100,00 | 1.000,00 | 461234 | 3 |");
    expect(document.content).toContain("**Valor estimado global:** R$ 1.000,00");
    expect(document.content).toContain("Baseado em 3 cotação(ões) válida(s)"); // risco A: só cotações com preço
    expect(document.sources.some((s) => s.startsWith("srcdigest:"))).toBe(true);
    expect((await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras" })).state).toBe("current");

    // Replay com as MESMAS fontes → mesmo documento, sem nova cognição.
    prompt = "";
    const rep = await generateDocument({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras", correlationId: "p0-7", idempotencyKey: "p0-7-tr", actorUserId: U_OTHER, invoke });
    expect(rep.replayed).toBe(true);
    expect(prompt).toBe("");
    // Fonte alterada (DFD editado) → SOURCE_CHANGED; mesma chave com fonte nova → CONFLICT.
    const cur = await getGeneratedDocumentByKind(pid, ORG, "dfd");
    await saveDFDDraft({ organizationId: ORG, processId: pid, object: "Aquisição de cadeiras", content: `${cur!.content}\nAtualizado.`, actorUserId: U_OPERATOR, expectedContentHash: draftContentHash(cur!.content), idempotencyKey: "p0-7-dfd-save", correlationId: "p0" });
    expect((await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras" })).state).toBe("source_changed");
    await expect(generateDocument({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras", correlationId: "p0-7", idempotencyKey: "p0-7-tr", actorUserId: U_OTHER, invoke })).rejects.toMatchObject({ code: "CONFLICT" });
  }, 120_000);

  it("GOLDEN A — Secretaria mandou os documentos: DFD+ETP importados + mapa comparativo → TR → Edital (mesmos números, sem /100)", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    for (const [kind, bytes] of [["dfd", await DFD_DOCX()], ["etp", await ETP_DOCX()]] as const) {
      const st = await importAndApproveDocument(ORG, pid, kind, bytes, `${kind}.docx`);
      await promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U_OPERATOR, idempotencyKey: `ga-${kind}`, correlationId: "ga" });
    }
    const { result } = await importPriceMap(ORG, pid, MAPA);
    expect(result.intelligentItems?.total).toBe(1);
    await approveAll(ORG, pid);

    let trPrompt = "";
    const tr = await generateDocument({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras", correlationId: "ga", idempotencyKey: "ga-tr", actorUserId: U_OTHER, invoke: async (p) => { trPrompt = p; return buildMockProviderAuthoring("tr"); } });
    expect(trPrompt).toContain("garantia mínima de 12 meses"); // ETP importado chegou à autoria do TR
    expect(tr.document.content).toContain("**Valor estimado global:** R$ 1.000,00");

    let edPrompt = "";
    const ed = await generateNotice({ organizationId: ORG, processId: pid, object: "Aquisição de cadeiras", modality: "pregao", form: "eletronico", platform: "compras_gov", correlationId: "ga", idempotencyKey: "ga-ed", actorUserId: U_OTHER, invoke: async (p) => { edPrompt = p; return buildMockProviderAuthoring("edital"); } });
    expect(edPrompt).toContain("R$ 100,00");       // antes: R$ 1,00 (bug /100)
    expect(edPrompt).not.toContain("R$ 1,00 ");
    // Sem decisão humana de CATMAT: a sugestão do enriquecimento NUNCA aparece como código oficial.
    expect(ed.document.content).toMatch(/\| 1 \| Cadeira giratória \| 10 \| un \| 100,00 \| 1\.000,00 \| a revisar[^|]*\| 3 \|/);
    expect(ed.document.content).toContain("**Valor estimado global:** R$ 1.000,00");
  }, 120_000);

  it("GOLDEN B — TR já veio pronto: importar TR → Edital reaproveita o TR (indistinguível de TR gerado)", async () => {
    const pid = await newProcess(ORG, "Aquisição de cadeiras");
    const st = await importAndApproveDocument(ORG, pid, "tr", await TR_DOCX(), "tr.docx");
    const view = await getDocumentIntake({ organizationId: ORG, processId: pid, kind: "tr" });
    expect(view.staging!.itemSuggestions[0]).toMatchObject({ description: "Cadeira giratória", quantity: "10" }); // sugestão, não materializada
    expect(await listIntelligentItems(pid, ORG)).toHaveLength(0);
    await promoteDocumentToDraft({ organizationId: ORG, processId: pid, stagingId: st.id, mode: "create", actorUserId: U_OPERATOR, idempotencyKey: "gb-tr", correlationId: "gb" });
    expect((await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Aquisição de cadeiras" })).state).toBe("imported");

    let edPrompt = "";
    await generateNotice({ organizationId: ORG, processId: pid, object: "Aquisição de cadeiras", modality: "pregao", form: "eletronico", platform: "compras_gov", correlationId: "gb", idempotencyKey: "gb-ed", actorUserId: U_OTHER, invoke: async (p) => { edPrompt = p; return buildMockProviderAuthoring("edital"); } });
    expect(edPrompt).toContain("20 dias corridos");          // prazo do TR importado reaproveitado
    expect(edPrompt).toContain("[REVISAR: Documento de Formalização da Demanda (DFD) não localizado"); // ausente → sinalizado
    const state = await getEditalSourceState({ organizationId: ORG, processId: pid, object: "Aquisição de cadeiras", modality: "pregao", form: "eletronico", platform: "compras_gov" });
    expect(state.state).toBe("current");
    expect(state.usedSources).toContain("tr");
  }, 120_000);
});
