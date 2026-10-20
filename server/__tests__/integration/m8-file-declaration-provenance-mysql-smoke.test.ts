/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * M8 — EMENDA DE INTEGRIDADE (PR #312, P1-B) contra MySQL REAL: a declaração explícita de dados fictícios no TÍTULO de um
 * ARQUIVO (CSV pelo WORKER real) não desaparece na cadeia Arquivo → Extração → Sessão → Correção supervisionada →
 * Aprovação → Promoção → Cotação persistida → Item Inteligente → Referência. Órgãos sintéticos 991931/991932 — nunca a org 1.
 *
 *  [1][2][15][16][17] título "DADOS FICTÍCIOS" + fornecedores de aparência real ⇒ aviso estruturado na sessão; cotações
 *        persistidas `ficticia`; Item Inteligente com fictícias; referência suspensa (FICTITIOUS_SOURCE) e célula do quadro
 *        documental suspensa.
 *  [11]  correção supervisionada do NOME do fornecedor não apaga a declaração do arquivo.
 *  [14]  aprovação do item não promove o preço fictício a referência institucional.
 *  [19]  replay da promoção é idempotente (nada duplicado, proveniência intacta).
 *  [20]  arquivo legado sem declaração ⇒ `declarada`, referência normal.
 *  [18]  outro órgão não vê sessão, cotações nem itens.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG = 991931;
const ORG_B = 991932;

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
import { insertProcess, listIntelligentItems } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { getItemPanel } from "../../services/itemIntelligenceService";
import { resolveDocumentAuthoringContext } from "../../services/authoring/authoringContext";
import { FICTITIOUS_PRICE_CELL_TEXT } from "../../domain/authoritativeItems";
import { DOCUMENT_DECLARES_FICTITIOUS } from "../../domain/quoteProvenance";

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
  "Pesquisa de preços — homologação de fornecedor 2026",
  "Descrição;Quantidade;Unidade;Valor unitário;Fornecedor",
  "Lápis HB;20;UN;0,90;Papelaria Teste & Cia", "Lápis HB;20;UN;1,10;Comercial Beta",
].join("\n");

const rows = async (q: string, p: unknown[] = []) => (await conn.execute<mysql.RowDataPacket[]>(q, p))[0];
async function asUser(id: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({ user: { id, role: "user" }, req: { headers: {} }, res: {}, correlationId: `m8fd-${id}-${++seq}`, requestId: `req-${seq}` } as any);
}
async function newProcess(org: number): Promise<string> {
  const p = createProcurementWorkspace({
    organizationId: org, processNumber: `M8FD-${stamp}-${++seq}`, object: "Material de expediente (M8 arquivo)",
    startOption: "importar_tr", responsibleUser: U.operator, correlationId: "m8fd",
  });
  await insertProcess(p);
  return p.id;
}
/** Sessão REAL: CSV pelo worker (parser real) ⇒ staging pendente. */
async function csvSession(org: number, processId: string, csv: string, uploader: number): Promise<number> {
  const db = (await getDb())!;
  const buf = Buffer.from(csv, "utf8");
  const key = `imports/${org}/${stamp}-${++seq}-pesquisa.csv`;
  mem.set(key, buf);
  const checksum = createHash("sha256").update(`${seq}-${org}`).update(buf).digest("hex");
  const [s] = await db.insert(importSessions).values({
    organizationId: org, uploadedBy: uploader, sourceFileId: key, sourceFileName: "pesquisa.csv", sourceMimeType: "text/csv",
    sourceSize: buf.length, checksum, procurementProcessId: processId, importType: "price_research", parserType: "auto",
    status: "uploaded", stage: "file_stored", correlationId: `m8fd-${seq}`,
  }).$returningId();
  expect(enqueueImport(s.id, org, key, { correlationId: `m8fd-${s.id}` })).not.toBeNull();
  for (let i = 0; i < 600; i++) {
    const cur = await getImportSession(s.id, org);
    if (cur && cur.status === "awaiting_review" && cur.stage === "awaiting_review") return s.id;
    if (cur?.status === "failed") throw new Error("worker falhou");
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("worker não concluiu");
}
async function approveAndPromote(sid: number, pid: string) {
  const op = await asUser(U.operator);
  const rev = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
  await op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "approved", groups: rev.groups.map((g: any) => ({ groupKey: g.groupKey, expectedRevision: g.revision })) });
  await op.ingestion.approveSession({ sessionId: sid, procurementProcessId: pid });
  const mgr = await asUser(U.manager);
  return mgr.ingestion.promoteSession({ sessionId: sid, procurementProcessId: pid, idempotencyKey: `m8fd-promo-${sid}` });
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

describe.skipIf(!DB)("M8 emenda — declaração fictícia do ARQUIVO até a referência (MySQL real, worker real)", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const [id, slug] of [[ORG, `m8fd-a-${stamp}`], [ORG_B, `m8fd-b-${stamp}`]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `Prefeitura Sintética ${id}`, slug]);
    }
    for (const [tag, org, role] of [["operator", ORG, "operator"], ["manager", ORG, "manager"], ["operatorB", ORG_B, "operator"]] as const) {
      const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'M8FD', ?)", [`m8fd-${tag}-${stamp}`, `m8fd-${tag}-${stamp}@teste.local`]);
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

  let pidF = "";
  let sidF = 0;
  it("[1][2][11][14][15][16][17][19] título fictício ⇒ cotações `ficticia` mesmo após correção do fornecedor; referência suspensa", async () => {
    pidF = await newProcess(ORG);
    sidF = await csvSession(ORG, pidF, FICT_CSV, U.operator);
    const [s] = await rows("SELECT CAST(warnings AS CHAR) w FROM import_sessions WHERE id = ?", [sidF]);
    expect(String(s.w)).toContain(DOCUMENT_DECLARES_FICTITIOUS);
    // [11] correção supervisionada do nome de um fornecedor (a linha normalizada não carrega a declaração).
    const op = await asUser(U.operator);
    const staged = await rows("SELECT id, correctionRevision revision FROM import_staging_items WHERE importSessionId = ? AND organizationId = ? ORDER BY id LIMIT 1", [sidF, ORG]);
    await op.ingestion.correctItem({
      sessionId: sidF, procurementProcessId: pidF, itemId: Number(staged[0].id), expectedRevision: Number(staged[0].revision ?? 0),
      corrections: { supplier: "Empresa Gama Ltda" }, justification: "razão social conferida", idempotencyKey: `m8fd-corr-${sidF}`,
    });
    const promo = await approveAndPromote(sidF, pidF);
    expect(promo).toMatchObject({ idempotent: false, itemsPromoted: 2 });
    const q = await rows("SELECT supplier, provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ? ORDER BY supplier", [ORG, pidF]);
    expect(q.map((r) => [r.supplier, r.k])).toEqual([["Empresa Beta", "ficticia"], ["Empresa Gama Ltda", "ficticia"]]);
    const items = await listIntelligentItems(pidF, ORG);
    expect(items).toHaveLength(1);
    expect(items[0].fictitiousQuoteCount).toBe(2);
    // [14] aprovar o item não promove o preço fictício.
    const c = await asUser(U.operator);
    await c.procurementProcess.approveItem({ itemId: items[0].id });
    expect((await getItemPanel(items[0].id, ORG)).governance!.referenceBlockedReason).toBe("FICTITIOUS_SOURCE");
    const ctx = await resolveDocumentAuthoringContext({ organizationId: ORG, processId: pidF, kind: "tr", object: "Material de expediente" });
    expect(ctx.authoritativeBlock).toContain(FICTITIOUS_PRICE_CELL_TEXT);
    // [19] replay da promoção: idempotente, nada duplicado, proveniência intacta.
    const mgr = await asUser(U.manager);
    const again = await mgr.ingestion.promoteSession({ sessionId: sidF, procurementProcessId: pidF, idempotencyKey: `m8fd-promo-${sidF}` });
    expect(again.idempotent).toBe(true);
    expect((await rows("SELECT COUNT(*) n FROM price_research_items WHERE organization_id = ? AND process_id = ? AND provenance_kind = 'ficticia'", [ORG, pidF]))[0].n).toBe(2);
  });

  it("[5][6][20] arquivo legítimo com 'homologação'/'Teste' no texto ⇒ `declarada`, referência normal", async () => {
    const pid = await newProcess(ORG);
    const sid = await csvSession(ORG, pid, REAL_CSV, U.operator);
    const [s] = await rows("SELECT CAST(warnings AS CHAR) w FROM import_sessions WHERE id = ?", [sid]);
    expect(String(s.w ?? "")).not.toContain(DOCUMENT_DECLARES_FICTITIOUS);
    await approveAndPromote(sid, pid);
    const kinds = (await rows("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).map((r) => r.k);
    expect(kinds).toEqual(["declarada"]);
    const [item] = await listIntelligentItems(pid, ORG);
    expect(item.fictitiousQuoteCount).toBe(0);
    expect((await getItemPanel(item.id, ORG)).governance!.referenceBlockedReason).toBeNull();
  });

  it("[18] outro órgão não vê a sessão, as cotações nem o item do órgão A", async () => {
    const b = await asUser(U.operatorB);
    const err = await b.ingestion.getPriceResearchReview({ sessionId: sidF, procurementProcessId: pidF }).then(() => "RESOLVED", (e: any) => e.code);
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(err);
    const [item] = await listIntelligentItems(pidF, ORG);
    expect((await getItemPanel(item.id, ORG_B)).item).toBeNull();
    expect(await listIntelligentItems(pidF, ORG_B)).toEqual([]);
  });
});
