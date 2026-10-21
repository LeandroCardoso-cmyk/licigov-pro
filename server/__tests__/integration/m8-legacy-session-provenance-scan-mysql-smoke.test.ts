/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * M8 — EMENDA P1-C (PR #312) contra MySQL REAL: sessão de Pesquisa de Preços extraída ANTES da análise de declaração do
 * documento (sem a evidência versionada `extractionSummary.provenanceScan`) não é promovida como se tivesse sido examinada.
 * Worker real (CSV), órgãos sintéticos 991941/991942 — nunca a org 1.
 *
 * "Sessão legada" = o estado exato que a extração anterior deixava: avisos sem DOCUMENT_DECLARES_FICTITIOUS e sumário sem
 * `provenanceScan` (o código antigo não gerava nenhum dos dois).
 *
 *  [1] legada com título fictício ⇒ promoção RECUSADA (PROVENANCE_SCAN_REQUIRED) e nada persistido (cotação, pesquisa,
 *      Item Inteligente, ledger, evento, projeção); a mesma chave de idempotência não vira sucesso.
 *  [2] legada legítima ⇒ também recusada, com orientação (ausência de aviso ≠ análise feita).
 *  [3] atual legítima ⇒ evidência gravada (declaração nenhuma); promoção permitida; `declarada`.
 *  [4] atual fictícia ⇒ aviso + evidência `global`; `ficticia`; referência suspensa; emissão bloqueada (contagem com trava).
 *  [5] revalidação de legada COM revisões/correção/aprovação ⇒ nova evidência; staging/correções/decisões intactos;
 *      histórico append-only + auditoria; promoção depois classifica `ficticia`. Reextração governada também gera evidência.
 *  [6] replay/concorrência: retry com a mesma chave após a recusa; replay idempotente; promoção ESPERA o lock da sessão e
 *      enxerga o commit; revalidação cujo estado muda entre a pré-checagem e o commit não aplica nada; arquivo divergente.
 *  [7] outro órgão não revalida, não promove e não usa a evidência de outra sessão; papel abaixo de operador não revalida.
 *  [8] legado JÁ promovido: replay intacto; revalidação recusada; nada é reclassificado.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG = 991941;
const ORG_B = 991942;

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
import { enqueueImport, isSessionInFlight } from "../../services/importQueueService";
import { getImportSession } from "../../services/fileIngestionService";
import { commitProvenanceRevalidation } from "../../services/importReprocessService";
import { insertProcess, listIntelligentItems, lockedFictitiousPriceItemCount } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { getItemPanel } from "../../services/itemIntelligenceService";
import { nativeTextPdf } from "../fixtures/pageLimitPdfFixture";
import {
  DOCUMENT_DECLARES_FICTITIOUS, PROVENANCE_SCAN_REQUIRED, PROVENANCE_SCAN_VERSION, type ProvenanceScanEvidence,
} from "../../domain/quoteProvenance";

let conn: mysql.Connection;
let seq = 0;
const stamp = Date.now();
const U: Record<string, number> = {};
const FICT_CSV = [
  "PESQUISA DE PREÇOS — DADOS FICTÍCIOS PARA HOMOLOGAÇÃO", "",
  "Descrição;Quantidade;Unidade;Valor unitário;Fornecedor",
  "Caneta azul;10;UN;1,50;Empresa Alfa", "Caneta azul;10;UN;1,70;Empresa Beta",
].join("\n");
const REAL_CSV = [
  "Pesquisa de preços — material de expediente 2026",
  "Descrição;Quantidade;Unidade;Valor unitário;Fornecedor",
  "Lápis HB;20;UN;0,90;Papelaria Central", "Lápis HB;20;UN;1,10;Comercial Beta",
].join("\n");

const rows = async (q: string, p: unknown[] = []) => (await conn.execute<mysql.RowDataPacket[]>(q, p))[0];
const codeOf = (e: any) => ({ code: e?.code, message: String(e?.message ?? "") });
async function asUser(id: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({ user: { id, role: "user" }, req: { headers: {} }, res: {}, correlationId: `p1c-${id}-${++seq}`, requestId: `req-${seq}` } as any);
}
async function newProcess(org: number): Promise<string> {
  const p = createProcurementWorkspace({
    organizationId: org, processNumber: `P1C-${stamp}-${++seq}`, object: "Material de expediente (P1-C)",
    startOption: "importar_tr", responsibleUser: U.operator, correlationId: "p1c",
  });
  await insertProcess(p);
  return p.id;
}
/** Sessão REAL: CSV pelo worker (parser real) ⇒ staging pendente. */
async function csvSession(org: number, processId: string, csv: string | Buffer, uploader: number, file = { name: "pesquisa.csv", mime: "text/csv" }): Promise<{ sid: number; checksum: string }> {
  const db = (await getDb())!;
  const buf = typeof csv === "string" ? Buffer.from(csv, "utf8") : csv;
  const key = `imports/${org}/${stamp}-${++seq}-${file.name}`;
  mem.set(key, buf);
  const checksum = createHash("sha256").update(buf).digest("hex");
  const [s] = await db.insert(importSessions).values({
    organizationId: org, uploadedBy: uploader, sourceFileId: key, sourceFileName: file.name, sourceMimeType: file.mime,
    sourceSize: buf.length, checksum, procurementProcessId: processId, importType: "price_research", parserType: "auto",
    status: "uploaded", stage: "file_stored", correlationId: `p1c-${seq}`,
  }).$returningId();
  expect(enqueueImport(s.id, org, key, { correlationId: `p1c-${s.id}` })).not.toBeNull();
  for (let i = 0; i < 600; i++) {
    const cur = await getImportSession(s.id, org);
    if (cur && cur.status === "awaiting_review" && cur.stage === "awaiting_review" && !isSessionInFlight(s.id)) return { sid: s.id, checksum };
    if (cur?.status === "failed") throw new Error("worker falhou");
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("worker não concluiu");
}
/** Estado de uma extração ANTERIOR à análise: sem aviso de declaração e sem evidência. */
async function makeLegacy(sid: number) {
  await conn.execute("UPDATE import_sessions SET warnings = JSON_ARRAY(), extractionSummary = JSON_REMOVE(extractionSummary, '$.provenanceScan') WHERE id = ?", [sid]);
}
async function waitIdle(sid: number) {
  for (let i = 0; i < 600 && isSessionInFlight(sid); i++) await new Promise((r) => setTimeout(r, 50));
  expect(isSessionInFlight(sid)).toBe(false);
}
async function approveAll(sid: number, pid: string) {
  const op = await asUser(U.operator);
  const rev = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
  await op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "approved", groups: rev.groups.map((g: any) => ({ groupKey: g.groupKey, expectedRevision: g.revision })) });
  await op.ingestion.approveSession({ sessionId: sid, procurementProcessId: pid });
}
const promote = async (sid: number, pid: string, key: string, user = U.manager) =>
  (await asUser(user)).ingestion.promoteSession({ sessionId: sid, procurementProcessId: pid, idempotencyKey: key });
async function summaryOf(sid: number): Promise<any> {
  const [r] = await rows("SELECT CAST(extractionSummary AS CHAR) s, CAST(warnings AS CHAR) w, promotionStatus p, status FROM import_sessions WHERE id = ?", [sid]);
  return { summary: JSON.parse(String(r.s ?? "null")), warnings: String(r.w ?? ""), promotionStatus: r.p, status: r.status };
}
async function domainFootprint(org: number, pid: string, sid: number) {
  const n = async (q: string, p: unknown[]) => Number((await rows(q, p))[0].n);
  return {
    quotes: await n("SELECT COUNT(*) n FROM price_research_items WHERE organization_id = ? AND process_id = ?", [org, pid]),
    research: await n("SELECT COUNT(*) n FROM price_research WHERE organization_id = ? AND process_id = ?", [org, pid]),
    items: await n("SELECT COUNT(*) n FROM intelligent_items WHERE organization_id = ? AND process_id = ?", [org, pid]),
    ledger: await n("SELECT COUNT(*) n FROM import_promotions WHERE organizationId = ? AND importSessionId = ?", [org, sid]),
    events: await n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ? AND summary LIKE 'Pesquisa de preços promovida%'", [org, pid]),
    promotedLogs: await n("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND entityId = ? AND action = 'import_session_promoted'", [org, sid]),
  };
}
const NOTHING = { quotes: 0, research: 0, items: 0, ledger: 0, events: 0, promotedLogs: 0 };
async function stagingSnapshot(sid: number) {
  return rows("SELECT id, reviewStatus, correctionRevision, CAST(correctedPayload AS CHAR) cp FROM import_staging_items WHERE importSessionId = ? ORDER BY id", [sid]);
}
async function cleanup() {
  const tables: Array<[string, string]> = [
    ["import_promotions", "organizationId"], ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"],
    ["import_sessions", "organizationId"], ["price_research_items", "organization_id"], ["price_research", "organization_id"],
    ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"],
    ["intelligent_item_identity_aliases", "organization_id"], ["intelligent_items", "organization_id"], ["process_timeline", "organization_id"],
    ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"], ["activity_logs", "organizationId"],
    ["organization_members", "organizationId"],
  ];
  for (const org of [ORG, ORG_B]) for (const [t, col] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(() => {});
}
/** Barreira determinística: outra conexão segura o lock da linha da sessão até `release`. */
async function holdSessionLock(sid: number) {
  const holder = await mysql.createConnection(DB!);
  await holder.query("START TRANSACTION");
  await holder.execute("SELECT id FROM import_sessions WHERE id = ? FOR UPDATE", [sid]);
  return {
    holder,
    async waitForWaiter() {
      // Espera de lock NA TABELA import_sessions deste banco (não qualquer espera do servidor).
      let waits = 0;
      for (const deadline = Date.now() + 20_000; waits === 0 && Date.now() < deadline;) {
        waits = Number((await rows(
          `SELECT COUNT(*) n FROM performance_schema.data_lock_waits w
             JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
            WHERE l.OBJECT_SCHEMA = DATABASE() AND l.OBJECT_NAME = 'import_sessions'`))[0].n);
        if (waits === 0) await new Promise((r) => setTimeout(r, 25));
      }
      expect(waits).toBeGreaterThan(0);
    },
    async commit() { await holder.query("COMMIT"); await holder.end(); },
  };
}

describe.skipIf(!DB)("M8 emenda P1-C — sessão legada sem análise de proveniência (MySQL real, worker real)", { timeout: 240_000 }, () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const [id, slug] of [[ORG, `p1c-a-${stamp}`], [ORG_B, `p1c-b-${stamp}`]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `Prefeitura Sintética ${id}`, slug]);
    }
    for (const [tag, org, role] of [["operator", ORG, "operator"], ["manager", ORG, "manager"], ["viewer", ORG, "viewer"], ["operatorB", ORG_B, "operator"], ["managerB", ORG_B, "manager"]] as const) {
      const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'P1C', ?)", [`p1c-${tag}-${stamp}`, `p1c-${tag}-${stamp}@teste.local`]);
      U[tag] = u.insertId;
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u.insertId, role]);
    }
  }, 180_000);
  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    const ids = Object.values(U).filter(Boolean);
    if (ids.length) await conn.execute(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  let pidL = "";
  let sidL = 0;
  it("[1] legada com título fictício ⇒ promoção e prévia recusadas; nada persistido; a chave não vira sucesso", async () => {
    pidL = await newProcess(ORG);
    ({ sid: sidL } = await csvSession(ORG, pidL, FICT_CSV, U.operator));
    await makeLegacy(sidL);
    await approveAll(sidL, pidL);
    const mgr = await asUser(U.manager);
    const prev = await mgr.ingestion.previewPromotion({ sessionId: sidL, procurementProcessId: pidL }).then(() => null, codeOf);
    expect(prev).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(prev!.message).toContain(PROVENANCE_SCAN_REQUIRED);
    for (let i = 0; i < 2; i++) { // mesma chave: a recusa não é armazenada como sucesso idempotente
      const err = await promote(sidL, pidL, `p1c-promo-${sidL}`).then(() => null, codeOf);
      expect(err).toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(err!.message).toContain(PROVENANCE_SCAN_REQUIRED);
      expect(err!.message).toMatch(/Revalide o arquivo original/);
    }
    expect(await domainFootprint(ORG, pidL, sidL)).toEqual(NOTHING);
    expect((await summaryOf(sidL)).promotionStatus).toBe("none");
    const st = await (await asUser(U.operator)).ingestion.getSessionStatus({ sessionId: sidL, procurementProcessId: pidL });
    expect(st.session.provenanceScan.status).toBe("required");
  });

  it("[2] legada legítima ⇒ também recusada com orientação (ausência de aviso não prova a análise)", async () => {
    const pid = await newProcess(ORG);
    const { sid } = await csvSession(ORG, pid, REAL_CSV, U.operator);
    await makeLegacy(sid);
    await approveAll(sid, pid);
    const err = await promote(sid, pid, `p1c-promo-${sid}`).then(() => null, codeOf);
    expect(err).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(err!.message).toContain(PROVENANCE_SCAN_REQUIRED);
    expect(await domainFootprint(ORG, pid, sid)).toEqual(NOTHING);
    // Revalidada sem declaração ⇒ aprovação preservada (nada novo para o revisor) e promoção legítima `declarada`.
    await (await asUser(U.operator)).ingestion.revalidateProvenance({ sessionId: sid, procurementProcessId: pid });
    await waitIdle(sid);
    const s = await summaryOf(sid);
    expect(s.status).toBe("approved");
    expect(s.summary.provenanceRevalidations[0]).toMatchObject({ declaration: null, approvalReopened: false });
    expect((await promote(sid, pid, `p1c-promo-${sid}`)).idempotent).toBe(false);
    expect((await rows("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).map((x) => x.k)).toEqual(["declarada"]);
  });

  it("[3] atual legítima ⇒ evidência gravada sem declaração; promoção permitida; `declarada` (sem falso positivo)", async () => {
    const pid = await newProcess(ORG);
    const { sid, checksum } = await csvSession(ORG, pid, REAL_CSV, U.operator);
    const s = await summaryOf(sid);
    expect(s.summary.provenanceScan).toMatchObject({ version: PROVENANCE_SCAN_VERSION, sourceChecksum: checksum, declaration: null, origin: "extraction", parserType: "csv" });
    expect(s.warnings).not.toContain(DOCUMENT_DECLARES_FICTITIOUS);
    await approveAll(sid, pid);
    expect((await promote(sid, pid, `p1c-promo-${sid}`)).idempotent).toBe(false);
    const kinds = (await rows("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).map((r) => r.k);
    expect(kinds).toEqual(["declarada"]);
    const [item] = await listIntelligentItems(pid, ORG);
    expect((await getItemPanel(item.id, ORG)).governance!.referenceBlockedReason).toBeNull();
  });

  it("[4] atual fictícia ⇒ aviso + evidência `global`; `ficticia`; referência suspensa; emissão bloqueada", async () => {
    const pid = await newProcess(ORG);
    const { sid } = await csvSession(ORG, pid, FICT_CSV, U.operator);
    const s = await summaryOf(sid);
    expect(s.warnings).toContain(DOCUMENT_DECLARES_FICTITIOUS);
    expect(s.summary.provenanceScan.declaration).toBe("global");
    await approveAll(sid, pid);
    await promote(sid, pid, `p1c-promo-${sid}`);
    const kinds = (await rows("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).map((r) => r.k);
    expect(kinds).toEqual(["ficticia"]);
    const [item] = await listIntelligentItems(pid, ORG);
    await (await asUser(U.operator)).procurementProcess.approveItem({ itemId: item.id });
    expect((await getItemPanel(item.id, ORG)).governance!.referenceBlockedReason).toBe("FICTITIOUS_SOURCE");
    const db = (await getDb())!;
    const locked = await db.transaction((tx) => lockedFictitiousPriceItemCount(tx, ORG, pid, false));
    expect(locked).toBeGreaterThan(0); // EMISSION_FICTITIOUS_PRICES (P1-A) recontado com trava dentro da transação
  });

  it("[5] revalidação de legada revisada/corrigida/aprovada ⇒ nova evidência, revisões intactas; depois `ficticia`", async () => {
    const pid = await newProcess(ORG);
    const { sid, checksum } = await csvSession(ORG, pid, FICT_CSV, U.operator);
    await makeLegacy(sid);
    const op = await asUser(U.operator);
    const [first] = await rows("SELECT id, correctionRevision r FROM import_staging_items WHERE importSessionId = ? ORDER BY id LIMIT 1", [sid]);
    await op.ingestion.correctItem({
      sessionId: sid, procurementProcessId: pid, itemId: Number(first.id), expectedRevision: Number(first.r ?? 0),
      corrections: { supplier: "Empresa Gama Ltda" }, justification: "razão social conferida", idempotencyKey: `p1c-corr-${sid}`,
    });
    await approveAll(sid, pid);
    const before = await stagingSnapshot(sid);
    const beforeSummary = (await summaryOf(sid)).summary;
    const corrections = Number((await rows("SELECT COUNT(*) n FROM import_item_corrections WHERE importSessionId = ?", [sid]))[0].n);
    expect(corrections).toBe(1);

    const r = await op.ingestion.revalidateProvenance({ sessionId: sid, procurementProcessId: pid });
    expect(r).toMatchObject({ status: "revalidating", enqueued: true });
    await waitIdle(sid);

    const after = await summaryOf(sid);
    // Declaração NOVA para o revisor ⇒ a aprovação da SESSÃO volta à revisão (itens/correções/decisões por item intactos).
    expect(after.status).toBe("awaiting_review");
    expect(after.summary.provenanceScan).toMatchObject({ version: PROVENANCE_SCAN_VERSION, sourceChecksum: checksum, declaration: "global", origin: "revalidation" });
    expect(after.summary.provenanceRevalidations).toHaveLength(1);
    expect(after.summary.provenanceRevalidations[0]).toMatchObject({ actorUserId: U.operator, previousScanVersion: null, declaration: "global", approvalReopened: true });
    expect(after.summary.extraction?.fingerprint ?? null).toBe(beforeSummary.extraction?.fingerprint ?? null); // linhagem da extração vigente intacta
    expect(after.warnings).toContain(DOCUMENT_DECLARES_FICTITIOUS);
    expect(await stagingSnapshot(sid)).toEqual(before);           // itens, decisões e correções intocados
    expect(Number((await rows("SELECT COUNT(*) n FROM import_item_corrections WHERE importSessionId = ?", [sid]))[0].n)).toBe(1);
    expect(Number((await rows("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND entityId = ? AND action = 'import_provenance_revalidated'", [ORG, sid]))[0].n)).toBe(1);
    // Já vigente ⇒ nova revalidação recusada (nada a refazer).
    const again = await op.ingestion.revalidateProvenance({ sessionId: sid, procurementProcessId: pid }).then(() => null, codeOf);
    expect(again).toMatchObject({ code: "PRECONDITION_FAILED" });
    // Sem nova aprovação humana não há promoção; o revisor confirma (um clique) e então promove.
    expect((await promote(sid, pid, `p1c-promo-${sid}`).then(() => null, codeOf))?.code).toBe("PRECONDITION_FAILED");
    await op.ingestion.approveSession({ sessionId: sid, procurementProcessId: pid });
    await promote(sid, pid, `p1c-promo-${sid}`);
    const q = await rows("SELECT supplier, provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ? ORDER BY supplier", [ORG, pid]);
    expect(q.map((x) => [x.supplier, x.k])).toEqual([["Empresa Beta", "ficticia"], ["Empresa Gama Ltda", "ficticia"]]);
  });

  it("[5b] reextração governada de legada intocada também grava evidência (histórico de reextração preservado)", async () => {
    const pid = await newProcess(ORG);
    const { sid } = await csvSession(ORG, pid, FICT_CSV, U.operator);
    await makeLegacy(sid);
    const op = await asUser(U.operator);
    await op.ingestion.reprocessExtraction({ sessionId: sid, procurementProcessId: pid, reason: "reextrair após a emenda P1-C" });
    await waitIdle(sid);
    const s = await summaryOf(sid);
    expect(s.summary.provenanceScan).toMatchObject({ origin: "reextraction", declaration: "global" });
    expect(s.summary.reextractions).toHaveLength(1);
    await approveAll(sid, pid);
    await promote(sid, pid, `p1c-promo-${sid}`);
    expect((await rows("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).map((x) => x.k)).toEqual(["ficticia"]);
  });

  it("[5c] revalidação NUNCA remove uma declaração já registrada (veredito mais restritivo)", async () => {
    const pid = await newProcess(ORG);
    const { sid } = await csvSession(ORG, pid, FICT_CSV, U.operator);
    const scan = (await summaryOf(sid)).summary.provenanceScan as ProvenanceScanEvidence;
    // Sessão com o aviso P1-B já gravado, mas sem evidência (extraída entre P1-B e P1-C).
    await conn.execute("UPDATE import_sessions SET extractionSummary = JSON_REMOVE(extractionSummary, '$.provenanceScan') WHERE id = ?", [sid]);
    expect((await summaryOf(sid)).warnings).toContain(DOCUMENT_DECLARES_FICTITIOUS);
    // Nova análise que NÃO vê a declaração (ex.: OCR com leitura diferente).
    await commitProvenanceRevalidation({ sessionId: sid, organizationId: ORG, actorUserId: U.operator, correlationId: "p1c-5c", scan: { ...scan, declaration: null, origin: "revalidation" }, warnings: [] });
    const s = await summaryOf(sid);
    expect(s.warnings).toContain(DOCUMENT_DECLARES_FICTITIOUS);
    expect(s.summary.provenanceScan.declaration).toBe("global");
    expect(s.status).toBe("awaiting_review"); // ainda não aprovada: nada a reabrir
    await approveAll(sid, pid);
    await promote(sid, pid, `p1c-promo-${sid}`);
    expect((await rows("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).map((x) => x.k)).toEqual(["ficticia"]);
  });

  it("[6c] revalidação que não conclui a análise (arquivo lido ≠ sessão) ⇒ nada aplicado; motivo visível e auditado", async () => {
    const pid = await newProcess(ORG);
    const { sid } = await csvSession(ORG, pid, FICT_CSV, U.operator);
    await makeLegacy(sid);
    await approveAll(sid, pid);
    const [{ k }] = await rows("SELECT sourceFileId k FROM import_sessions WHERE id = ?", [sid]);
    mem.set(String(k), Buffer.from(REAL_CSV, "utf8")); // objeto do storage diverge do checksum da sessão
    const op = await asUser(U.operator);
    await op.ingestion.revalidateProvenance({ sessionId: sid, procurementProcessId: pid });
    await waitIdle(sid);
    const s = await summaryOf(sid);
    expect(s.summary.provenanceScan).toBeUndefined();
    expect(s.status).toBe("approved");
    const st = await op.ingestion.getSessionStatus({ sessionId: sid, procurementProcessId: pid });
    expect(st.session.provenanceScan.status).toBe("required");
    expect(st.session.provenanceScan.message).toMatch(/Última tentativa não concluída/);
    expect(Number((await rows("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND entityId = ? AND action = 'import_provenance_revalidation_not_applied'", [ORG, sid]))[0].n)).toBe(1);
    expect((await promote(sid, pid, `p1c-promo-${sid}`).then(() => null, codeOf))?.message).toContain(PROVENANCE_SCAN_REQUIRED);
    expect(await domainFootprint(ORG, pid, sid)).toEqual(NOTHING);
  });

  it("[6] retry após a recusa com a MESMA chave; replay idempotente; payload divergente; promoção espera o lock e enxerga o commit", async () => {
    // Retry: a sessão [1] foi recusada com `p1c-promo-${sidL}` — revalidada, a MESMA chave promove (nada foi gravado antes).
    const op = await asUser(U.operator);
    await op.ingestion.revalidateProvenance({ sessionId: sidL, procurementProcessId: pidL });
    await waitIdle(sidL);
    expect((await summaryOf(sidL)).status).toBe("awaiting_review"); // declaração nova ⇒ nova confirmação humana
    await op.ingestion.approveSession({ sessionId: sidL, procurementProcessId: pidL });
    const ok = await promote(sidL, pidL, `p1c-promo-${sidL}`);
    expect(ok.idempotent).toBe(false);
    expect((await promote(sidL, pidL, `p1c-promo-${sidL}`)).idempotent).toBe(true);   // replay
    expect((await promote(sidL, pidL, `p1c-outra-chave-${sidL}`)).idempotent).toBe(true); // chave divergente: ledger por sessão
    expect(await domainFootprint(ORG, pidL, sidL)).toMatchObject({ quotes: 2, research: 1, items: 1, ledger: 1, events: 1 });
    expect((await rows("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG, pidL])).map((x) => x.k)).toEqual(["ficticia"]);

    // Concorrência: a promoção ESPERA o lock da sessão (prova em data_lock_waits) e lê a evidência confirmada pelo detentor.
    const pid = await newProcess(ORG);
    const { sid, checksum } = await csvSession(ORG, pid, FICT_CSV, U.operator);
    const scan = (await summaryOf(sid)).summary.provenanceScan as ProvenanceScanEvidence;
    await makeLegacy(sid);
    await approveAll(sid, pid);
    const lock = await holdSessionLock(sid);
    let settled = false;
    const pending = promote(sid, pid, `p1c-promo-${sid}`).then((v) => { settled = true; return v; }, (e) => { settled = true; throw e; });
    await lock.waitForWaiter();
    expect(settled).toBe(false);
    // O detentor grava a evidência (equivalente ao commit de uma revalidação) e confirma.
    await lock.holder.execute("UPDATE import_sessions SET extractionSummary = JSON_SET(extractionSummary, '$.provenanceScan', CAST(? AS JSON)) WHERE id = ?", [JSON.stringify({ ...scan, sourceChecksum: checksum }), sid]);
    await lock.commit();
    expect((await pending).idempotent).toBe(false);
    expect((await rows("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).map((x) => x.k)).toEqual(["ficticia"]);
    // Ordem inversa: a promoção venceu ⇒ uma revalidação que chega depois aborta sob o lock (PROMOTED), nada muda.
    const late = await commitProvenanceRevalidation({ sessionId: sid, organizationId: ORG, actorUserId: U.operator, correlationId: "p1c-late", scan: { ...scan, sourceChecksum: checksum, origin: "revalidation" }, warnings: [] }).then(() => null, (e) => e.code);
    expect(late).toBe("PROMOTED");
  });

  it("[6b] estado muda entre a pré-checagem e o commit da revalidação ⇒ nada aplicado; arquivo divergente ⇒ nada aplicado", async () => {
    const pid = await newProcess(ORG);
    const { sid, checksum } = await csvSession(ORG, pid, FICT_CSV, U.operator);
    const scan = (await summaryOf(sid)).summary.provenanceScan as ProvenanceScanEvidence;
    await makeLegacy(sid);
    const before = await summaryOf(sid);
    // Barreira: o commit da revalidação espera o lock; o detentor reserva uma REEXTRAÇÃO no meio e confirma.
    const lock = await holdSessionLock(sid);
    const pending = commitProvenanceRevalidation({
      sessionId: sid, organizationId: ORG, actorUserId: U.operator, correlationId: "p1c-race", scan: { ...scan, origin: "revalidation" }, warnings: [],
    }).then(() => null, (e) => e.code);
    await lock.waitForWaiter();
    await lock.holder.execute("UPDATE import_sessions SET stage = 'reprocessing' WHERE id = ?", [sid]);
    await lock.commit();
    expect(await pending).toBe("REPROCESS_IN_PROGRESS");
    const mid = await summaryOf(sid);
    expect(mid.summary.provenanceScan).toBeUndefined();
    expect(mid.warnings).toBe(before.warnings);
    await conn.execute("UPDATE import_sessions SET stage = 'awaiting_review' WHERE id = ?", [sid]);
    // Evidência de OUTRO arquivo (checksum divergente) ⇒ recusada no commit.
    const wrong = await commitProvenanceRevalidation({
      sessionId: sid, organizationId: ORG, actorUserId: U.operator, correlationId: "p1c-wrong",
      scan: { ...scan, sourceChecksum: "f".repeat(64) }, warnings: [],
    }).then(() => null, (e) => e.code);
    expect(wrong).toBe("SESSION_STATE_CHANGED");
    expect((await summaryOf(sid)).summary.provenanceScan).toBeUndefined();
    expect(checksum).not.toBe("f".repeat(64));
  });

  it("[7] outro órgão não revalida/promove/consulta; evidência copiada para outra sessão não vale; viewer não revalida", async () => {
    const opB = await asUser(U.operatorB);
    const mgrB = await asUser(U.managerB);
    const pid = await newProcess(ORG);
    const { sid } = await csvSession(ORG, pid, REAL_CSV, U.operator);
    const fromA = (await summaryOf(sid)).summary;
    await makeLegacy(sid);
    await approveAll(sid, pid);
    for (const call of [
      () => opB.ingestion.revalidateProvenance({ sessionId: sid, procurementProcessId: pid }),
      () => mgrB.ingestion.promoteSession({ sessionId: sid, procurementProcessId: pid, idempotencyKey: `p1c-b-${sid}` }),
      () => opB.ingestion.getSessionStatus({ sessionId: sid, procurementProcessId: pid }),
    ]) {
      const e = await call().then(() => null, codeOf);
      expect(["NOT_FOUND", "FORBIDDEN"]).toContain(e?.code);
    }
    const viewer = await asUser(U.viewer);
    expect((await viewer.ingestion.revalidateProvenance({ sessionId: sid, procurementProcessId: pid }).then(() => null, codeOf))?.code).toBe("FORBIDDEN");
    // Órgão B: sessão própria (outro arquivo) com a evidência de A copiada ⇒ CHECKSUM não confere ⇒ recusa.
    const pidB = await newProcess(ORG_B);
    const { sid: sidB } = await csvSession(ORG_B, pidB, FICT_CSV, U.operatorB);
    await conn.execute("UPDATE import_sessions SET warnings = JSON_ARRAY(), extractionSummary = CAST(? AS JSON) WHERE id = ?", [JSON.stringify(fromA), sidB]);
    const rev = await opB.ingestion.getPriceResearchReview({ sessionId: sidB, procurementProcessId: pidB });
    await opB.ingestion.reviewPriceResearchGroups({ sessionId: sidB, procurementProcessId: pidB, action: "approved", groups: rev.groups.map((g: any) => ({ groupKey: g.groupKey, expectedRevision: g.revision })) });
    await opB.ingestion.approveSession({ sessionId: sidB, procurementProcessId: pidB });
    const e = await mgrB.ingestion.promoteSession({ sessionId: sidB, procurementProcessId: pidB, idempotencyKey: `p1c-b-${sidB}` }).then(() => null, codeOf);
    expect(e?.message).toContain(PROVENANCE_SCAN_REQUIRED);
    expect(await domainFootprint(ORG_B, pidB, sidB)).toEqual(NOTHING);
    expect(await domainFootprint(ORG, pid, sid)).toEqual(NOTHING);
  });

  it("[9] PDF de 501 páginas (declaração fictícia SÓ na 501ª) pelo worker ⇒ extração parcial revisável, sem evidência; promoção/prévia recusadas sem efeito; revalidação recusada; outro órgão não alcança", async () => {
    const pid = await newProcess(ORG);
    const { sid } = await csvSession(ORG, pid, await nativeTextPdf(501, 501), U.operator, { name: "mapa-501.pdf", mime: "application/pdf" });
    const s = await summaryOf(sid);
    expect(s.warnings).toContain("PAGE_LIMIT");
    expect(s.warnings).not.toContain(DOCUMENT_DECLARES_FICTITIOUS);   // a página 501 nunca foi lida
    expect(s.summary.provenanceScan).toBeUndefined();                  // sem evidência de análise completa
    expect(Number((await rows("SELECT COUNT(*) n FROM import_staging_items WHERE importSessionId = ?", [sid]))[0].n)).toBe(2); // revisão possível
    await approveAll(sid, pid);
    const op = await asUser(U.operator);
    const st = await op.ingestion.getSessionStatus({ sessionId: sid, procurementProcessId: pid });
    expect(st.session.provenanceScan).toMatchObject({ status: "required", revalidable: false });
    expect(st.session.provenanceScan.message).toMatch(/não cobriu todo o arquivo/);
    const mgr = await asUser(U.manager);
    const prev = await mgr.ingestion.previewPromotion({ sessionId: sid, procurementProcessId: pid }).then(() => null, codeOf);
    expect(prev?.message).toContain(PROVENANCE_SCAN_REQUIRED);
    for (let i = 0; i < 2; i++) { // retry com a mesma chave: continua recusado (nenhum sucesso idempotente gravado)
      const err = await promote(sid, pid, `p1c-promo-${sid}`).then(() => null, codeOf);
      expect(err).toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(err!.message).toContain(PROVENANCE_SCAN_REQUIRED);
      expect(err!.message).toMatch(/não cobriu todo o arquivo/);
    }
    const reval = await op.ingestion.revalidateProvenance({ sessionId: sid, procurementProcessId: pid }).then(() => null, codeOf);
    expect(reval).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(reval!.message).toMatch(/limite de páginas/);
    expect(isSessionInFlight(sid)).toBe(false);                          // nada enfileirado
    expect((await summaryOf(sid)).status).toBe("approved");             // decisões humanas intactas
    expect(await domainFootprint(ORG, pid, sid)).toEqual(NOTHING);
    const b = await (await asUser(U.managerB)).ingestion.promoteSession({ sessionId: sid, procurementProcessId: pid, idempotencyKey: `p1c-b9-${sid}` }).then(() => null, codeOf);
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(b?.code);
    // Evidência v1 gravada ANTES desta correção (versão P1-C anterior) numa sessão com PAGE_LIMIT ⇒ continua sem valor.
    const [{ checksum }] = await rows("SELECT checksum FROM import_sessions WHERE id = ?", [sid]);
    const stale = { version: PROVENANCE_SCAN_VERSION, sourceChecksum: String(checksum), parserType: "pdf", parserVersion: "2.3.0", declaration: null, origin: "extraction", scannedAt: new Date(0).toISOString() };
    await conn.execute("UPDATE import_sessions SET extractionSummary = JSON_SET(extractionSummary, '$.provenanceScan', CAST(? AS JSON)) WHERE id = ?", [JSON.stringify(stale), sid]);
    expect((await op.ingestion.getSessionStatus({ sessionId: sid, procurementProcessId: pid })).session.provenanceScan).toMatchObject({ status: "required", revalidable: false });
    const err2 = await promote(sid, pid, `p1c-promo-${sid}`).then(() => null, codeOf);
    expect(err2?.message).toContain(PROVENANCE_SCAN_REQUIRED);
    expect(await domainFootprint(ORG, pid, sid)).toEqual(NOTHING);
  });

  it("[8] legado JÁ promovido: replay intacto, revalidação recusada, nada reclassificado", async () => {
    const pid = await newProcess(ORG);
    const { sid } = await csvSession(ORG, pid, REAL_CSV, U.operator);
    await approveAll(sid, pid);
    await promote(sid, pid, `p1c-promo-${sid}`);
    await makeLegacy(sid); // estado de uma promoção concluída ANTES da emenda (sem evidência)
    const quotesBefore = await rows("SELECT id, provenance_kind k, value FROM price_research_items WHERE organization_id = ? AND process_id = ? ORDER BY id", [ORG, pid]);
    const itemsBefore = await rows("SELECT id, status, CAST(suppliers AS CHAR) s FROM intelligent_items WHERE organization_id = ? AND process_id = ? ORDER BY id", [ORG, pid]);
    expect((await promote(sid, pid, `p1c-promo-${sid}`)).idempotent).toBe(true);
    const e = await (await asUser(U.operator)).ingestion.revalidateProvenance({ sessionId: sid, procurementProcessId: pid }).then(() => null, codeOf);
    expect(e).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(e!.message).toMatch(/promovida/);
    const st = await (await asUser(U.operator)).ingestion.getSessionStatus({ sessionId: sid, procurementProcessId: pid });
    expect(st.session.provenanceScan.status).toBe("not_applicable");
    expect(await rows("SELECT id, provenance_kind k, value FROM price_research_items WHERE organization_id = ? AND process_id = ? ORDER BY id", [ORG, pid])).toEqual(quotesBefore);
    expect(await rows("SELECT id, status, CAST(suppliers AS CHAR) s FROM intelligent_items WHERE organization_id = ? AND process_id = ? ORDER BY id", [ORG, pid])).toEqual(itemsBefore);
  });
});
