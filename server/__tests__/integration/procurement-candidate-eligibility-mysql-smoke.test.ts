/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Hotfix — ELEGIBILIDADE dos candidatos da Pesquisa de Preços (incidente do piloto) contra MySQL REAL, pelos
 * caminhos REAIS (worker + revisão por item lógico + aprovação + promoção; importação manual legada):
 *
 *   Processo com Item Inteligente LEGADO (importação manual de texto, sem revisão: qtd 0, R$ 0, 0 cotações) +
 *   Pesquisa atual em REVISÃO (5 itens lógicos / 30 cotações, pendentes) ⇒ "Preparar a partir da pesquisa" = 0
 *   candidatos (o legado continua no banco) → revisão + aprovação + promoção ⇒ EXATAMENTE 5 candidatos (nunca 30,
 *   nunca 6), sourceQuantity preservada e plannedQuantity vazia → nova sessão em revisão não mistura → rejeição
 *   parcial ⇒ só os aprovados → importação manual APROVADA por humano ⇒ elegível → tenant.
 *
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG = 991313;
const ORG2 = 991314;

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
import { goldenEPdf } from "../fixtures/layoutPdfFixtures";

let conn: mysql.Connection;
let seq = 0;
let GOLDEN: Buffer;
const users: Record<string, number> = {};

async function newProcess(org: number): Promise<string> {
  const p = createProcurementWorkspace({
    organizationId: org, processNumber: `ELG-${Date.now()}-${++seq}`, object: "Material de limpeza (fictício)",
    startOption: "importar_tr", responsibleUser: users.operator ?? 1, correlationId: "elig-smoke",
  });
  await insertProcess(p);
  return p.id;
}

/** Sessão real: Golden E pelo worker (parser layout-aware) ⇒ 30 cotações pendentes em staging. */
async function goldenSession(org: number, processId: string, salt = "") {
  const db = (await getDb())!;
  const key = `imports/${org}/${Date.now()}-${++seq}-mapa.pdf`;
  mem.set(key, GOLDEN);
  const checksum = createHash("sha256").update(`${GOLDEN.length}-${seq}-${org}-${salt}`).update(GOLDEN).digest("hex");
  const [s] = await db.insert(importSessions).values({
    organizationId: org, uploadedBy: users.operator ?? 1, sourceFileId: key, sourceFileName: "mapa.pdf", sourceMimeType: "application/pdf",
    sourceSize: GOLDEN.length, checksum, procurementProcessId: processId, importType: "price_research", parserType: "auto",
    status: "uploaded", stage: "file_stored", correlationId: `elg-${seq}`,
  }).$returningId();
  expect(enqueueImport(s.id, org, key, { correlationId: `elg-${s.id}` })).not.toBeNull();
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
  return appRouter.createCaller({ user: { id, role: "user" }, req: { headers: {} }, res: {}, correlationId: `elg-corr-${id}-${++seq}`, requestId: `req-${seq}` } as any);
}

async function mkUser(org: number, role: string): Promise<number> {
  const tag = `${role}-${org}-${Date.now()}-${++seq}`;
  const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'Eleg', ?)", [`elg-${tag}`, `elg-${tag}@teste.local`]);
  await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u.insertId, role]);
  return u.insertId;
}

/** Revisão por item lógico (decisões atômicas) → aprovação da sessão → promoção (manager). */
async function reviewAndPromote(pid: string, sid: number, reject: number[] = []) {
  const op = await asUser(users.operator);
  const rev = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
  const toGroups = (idx: number[]) => rev.groups.filter((_, i) => idx.includes(i)).map((g) => ({ groupKey: g.groupKey, expectedRevision: g.revision }));
  const approveIdx = rev.groups.map((_, i) => i).filter((i) => !reject.includes(i));
  if (reject.length) await op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "rejected", groups: toGroups(reject) });
  await op.ingestion.reviewPriceResearchGroups({ sessionId: sid, procurementProcessId: pid, action: "approved", groups: toGroups(approveIdx) });
  await op.ingestion.approveSession({ sessionId: sid, procurementProcessId: pid });
  return (await asUser(users.manager)).ingestion.promoteSession({ sessionId: sid, procurementProcessId: pid, idempotencyKey: `elg-promo-${sid}` });
}

async function cleanup() {
  const tables: Array<[string, string]> = [
    ["import_promotions", "organizationId"], ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"],
    ["import_sessions", "organizationId"], ["price_research_items", "organization_id"], ["price_research", "organization_id"],
    ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"],
    ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
    ["procurement_lots", "organization_id"], ["procurement_context_facts", "organization_id"],
    ["intelligent_items", "organization_id"], ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"],
    ["activity_logs", "organizationId"], ["idempotency_keys", "organizationId"], ["organization_members", "organizationId"],
  ];
  for (const org of [ORG, ORG2]) for (const [t, col] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(() => {});
  await conn.query("DELETE FROM users WHERE openId LIKE 'elg-%'").catch(() => {});
}

const candidatesOf = async (pid: string, u = users.operator) => (await asUser(u)).procurementItems.candidates({ processId: pid, source: "price_research" });

describe.skipIf(!DB)("Hotfix — candidatos da Pesquisa exigem lineage governado (MySQL real)", { timeout: 180_000 }, () => {
  let pid = "";
  let legacyId = "";

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    for (const [id, slug] of [[ORG, "elig-org"], [ORG2, "elig-org-2"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, slug, slug]).catch(() => {});
    }
    await cleanup();
    users.operator = await mkUser(ORG, "operator");
    users.manager = await mkUser(ORG, "manager");
    users.operatorB = await mkUser(ORG2, "operator");
    GOLDEN = await goldenEPdf();
  }, 180_000);
  afterAll(async () => { await cleanup().catch(() => {}); await conn?.end(); });

  it("1) INCIDENTE: legado sem revisão (qtd 0, R$ 0) + Pesquisa em revisão (5/30 pendentes) ⇒ 0 candidatos; legado preservado", async () => {
    pid = await newProcess(ORG);
    // Caminho LEGADO real (importação de texto): uma linha vira Item Inteligente sem revisão prévia.
    const op = await asUser(users.operator);
    await op.procurementProcess.importPriceResearch({ processId: pid, source: "pdf", text: "Fornecedor Exemplo Ltda" });
    const before = await listIntelligentItems(pid, ORG);
    expect(before).toHaveLength(1);
    legacyId = before[0].id;
    expect(before[0]).toMatchObject({ quantity: 0, averagePriceCents: 0, quoteCount: 0, status: "pendente" });

    const sid = await goldenSession(ORG, pid);
    const review = await op.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid });
    expect(review.counts).toMatchObject({ logicalItems: 5, quotes: 30 });
    expect(review.counts.items.pending).toBe(5);

    const c = await candidatesOf(pid);
    expect(c.candidates).toHaveLength(0);
    expect(c.eligibility).toMatchObject({ intelligentItemCount: 1, eligibleCount: 0, manualUnreviewedCount: 1, sessionsPending: 1 });
    const ws = await op.procurementItems.workspace({ processId: pid });
    expect(ws.sources).toMatchObject({ priceResearchItems: 0, priceResearchSessionsPending: 1 });
    // Histórico intacto: o legado continua registrado e visível nos Itens Inteligentes.
    expect((await listIntelligentItems(pid, ORG)).map((i) => i.id)).toEqual([legacyId]);
  });

  it("2) APÓS revisão + aprovação + promoção ⇒ EXATAMENTE 5 candidatos (não 30, não 6); legado excluído; prevista vazia", async () => {
    const sid = (await conn.execute<mysql.RowDataPacket[]>("SELECT id FROM import_sessions WHERE organizationId = ? AND procurementProcessId = ?", [ORG, pid]))[0][0].id as number;
    const promo = await reviewAndPromote(pid, sid);
    expect(promo).toMatchObject({ itemsPromoted: 30 });
    expect(await listIntelligentItems(pid, ORG)).toHaveLength(6); // 5 promovidos + 1 legado (nada apagado)

    const a = await candidatesOf(pid);
    const b = await candidatesOf(pid);
    expect(a.candidates).toHaveLength(5);
    expect(a.sourceDigest).toBe(b.sourceDigest); // determinístico
    expect(a.candidates.some((x: any) => x.sourceId === legacyId)).toBe(false);
    expect(a.eligibility).toMatchObject({ intelligentItemCount: 6, eligibleCount: 5, manualUnreviewedCount: 1, promotedSessionCount: 1, sessionsPending: 0 });
    const ws = await (await asUser(users.operator)).procurementItems.workspace({ processId: pid });
    expect(ws.sources.priceResearchItems).toBe(5);
    expect(ws.items).toHaveLength(0); // nada criado sozinho; plannedQuantity nunca preenchida automaticamente
    expect(a.candidates.every((x: any) => x.sourceType === "price_research")).toBe(true);
  });

  it("3) nova sessão em revisão no MESMO processo não mistura: continuam 5 candidatos da sessão promovida", async () => {
    await goldenSession(ORG, pid, "second");
    const c = await candidatesOf(pid);
    expect(c.candidates).toHaveLength(5);
    expect(c.eligibility).toMatchObject({ eligibleCount: 5, sessionsPending: 1 });
  });

  it("4) rejeição PARCIAL (4 aprovados, 1 rejeitado) ⇒ 4 candidatos (a promoção leva só os aprovados)", async () => {
    const p2 = await newProcess(ORG);
    const sid = await goldenSession(ORG, p2, "partial");
    await reviewAndPromote(p2, sid, [0]);
    expect(await listIntelligentItems(p2, ORG)).toHaveLength(4);
    expect((await candidatesOf(p2)).candidates).toHaveLength(4);
  });

  it("5) importação manual APROVADA por humano (decisão do Item Inteligente) ⇒ elegível; não aprovada ⇒ não", async () => {
    const p3 = await newProcess(ORG);
    const op = await asUser(users.operator);
    await op.procurementProcess.importPriceResearch({ processId: p3, source: "colar", text: "Detergente neutro;10;UN;12,50;Fornecedor A" });
    expect((await candidatesOf(p3)).candidates).toHaveLength(0);
    const [it] = await listIntelligentItems(p3, ORG);
    await op.procurementProcess.approveItem({ itemId: it.id });
    const c = await candidatesOf(p3);
    expect(c.candidates.map((x: any) => [x.sourceId, x.sourceQuantity])).toEqual([[it.id, 10]]);
  });

  it("6) tenant: outro órgão não vê candidatos, workspace nem a sessão/pesquisa do processo", async () => {
    const b = await asUser(users.operatorB);
    await expect(b.procurementItems.candidates({ processId: pid, source: "price_research" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.procurementItems.workspace({ processId: pid })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const sid = (await conn.execute<mysql.RowDataPacket[]>("SELECT id FROM import_sessions WHERE organizationId = ? AND procurementProcessId = ? ORDER BY id LIMIT 1", [ORG, pid]))[0][0].id as number;
    await expect(b.ingestion.getPriceResearchReview({ sessionId: sid, procurementProcessId: pid })).rejects.toBeTruthy();
  });
});
