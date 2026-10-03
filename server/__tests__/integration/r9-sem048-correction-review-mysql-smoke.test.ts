/**
 * R9 / SEM-048 — Correção de extração × revisão/aprovação/promoção contra MySQL REAL.
 *
 * Cobre: (a) correção de item aceito em sessão APROVADA reabre a revisão (item → pendente, sessão → aguardando
 * revisão; a promoção passa a ser recusada até nova aprovação humana) + auditoria; (b) sessão PROMOVIDA ⇒
 * SESSION_ALREADY_PROMOTED sem nenhuma escrita; (c) ATOMICIDADE: falha injetada no histórico (revisão já registrada)
 * ⇒ rollback total (item, reabertura, sessão) e chave idempotente não cacheada como sucesso (retry funciona);
 * (d) idempotência: mesma chave + mesmo payload ⇒ replay sem 2ª escrita; mesma chave + payload diferente ⇒
 * CONFLICT; chave do histórico pré-R9 com outro conteúdo ⇒ CONFLICT; (e) concorrência otimista (duas correções
 * simultâneas na mesma revisão ⇒ uma vence, outra CONFLICT); (f) isolamento por tenant. Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { getDb } from "../../db/connection";
import { importSessions, importStagingItems, importItemCorrections } from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import { correctStagingItem, getStagingItem, getItemCorrectionHistory } from "../../services/importStagingService";
import { getImportSession } from "../../services/fileIngestionService";
import { promoteApprovedSessionToDomain } from "../../services/importPromotionService";

const DB = process.env.DATABASE_URL;
const ORG = 960480;
const OTHER_ORG = 960481;
const PROC = "R9-S048";
const U = 4801;
let conn: mysql.Connection;
let seq = 0;

type ReviewStatus = "pending" | "approved" | "rejected" | "skipped";

async function seed(session: { status?: "awaiting_review" | "approved"; promotionStatus?: string }, items: ReviewStatus[]): Promise<{ sessionId: number; itemIds: number[] }> {
  const db = (await getDb())!;
  const [s] = await db.insert(importSessions).values({
    organizationId: ORG, uploadedBy: U, sourceFileId: `imports/${ORG}/${++seq}-cot.xlsx`, sourceFileName: "cot.xlsx",
    sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", checksum: `${seq}`.padStart(64, "a"),
    procurementProcessId: PROC, importType: "price_research", parserType: "xlsx", parserVersion: "1.0.0",
    status: session.status ?? "approved", stage: session.status ?? "approved", promotionStatus: session.promotionStatus ?? "none",
  }).$returningId();
  const itemIds: number[] = [];
  for (const [i, reviewStatus] of items.entries()) {
    const [row] = await db.insert(importStagingItems).values({
      importSessionId: s.id, organizationId: ORG, rawDescription: `Item ${i + 1}`, rawQuantity: "10", rawUnit: "UN",
      rawUnitPrice: "5,00", rawTotalPrice: "50,00", reviewStatus,
      ...(reviewStatus !== "pending" ? { reviewedBy: U, reviewedAt: new Date(), reviewNote: "conferido" } : {}),
    }).$returningId();
    itemIds.push(row.id);
  }
  return { sessionId: s.id, itemIds };
}

const params = (sessionId: number, itemId: number, over: Record<string, unknown> = {}) => ({
  itemId, organizationId: ORG, importSessionId: sessionId, procurementProcessId: PROC, importType: "price_research",
  actorUserId: U, corrections: { unitPrice: "7,50" }, justification: "valor unitário digitado errado",
  expectedRevision: 0, idempotencyKey: `s048-${sessionId}-${itemId}-${++seq}`, correlationId: "r9-s048", ...over,
});

async function count(sqlText: string, args: unknown[]): Promise<number> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(sqlText, args);
  return Number(rows[0].n);
}

async function idemStatus(key: string): Promise<string | null> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT status FROM idempotency_keys WHERE organizationId = ? AND userId = ? AND `key` = ?", [ORG, U, key]);
  return rows[0]?.status ?? null;
}

async function cleanup(): Promise<void> {
  const tables: Array<[string, string]> = [
    ["import_item_corrections", "organizationId"], ["import_promotions", "organizationId"], ["import_staging_items", "organizationId"],
    ["import_sessions", "organizationId"], ["idempotency_keys", "organizationId"], ["activity_logs", "organizationId"],
    ["price_research_items", "organization_id"], ["price_research", "organization_id"], ["intelligent_items", "organization_id"],
    ["process_timeline", "organization_id"],
  ];
  for (const org of [ORG, OTHER_ORG]) for (const [t, c] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${c}\` = ?`, [org]).catch(() => {});
}

describe.skipIf(!DB)("R9 / SEM-048 — correção × revisão/aprovação/promoção (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    await cleanup().catch(() => {});
    await conn?.end();
  });

  it("(a) sessão APROVADA: correção reabre o item e invalida a aprovação; promoção exige nova aprovação", async () => {
    const { sessionId, itemIds: [a, b] } = await seed({ status: "approved" }, ["approved", "approved"]);
    const r = await correctStagingItem(params(sessionId, a));
    expect(r).toMatchObject({ idempotent: false, revision: 1, reviewReopened: true, sessionReopened: true });

    const itemA = await getStagingItem(a, ORG);
    expect(itemA).toMatchObject({ reviewStatus: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null, correctionRevision: 1 });
    expect(itemA?.rawUnitPrice).toBe("5,00"); // raw imutável
    expect((await getStagingItem(b, ORG))?.reviewStatus).toBe("approved"); // decisão do outro item preservada
    const session = await getImportSession(sessionId, ORG);
    expect(session).toMatchObject({ status: "awaiting_review", stage: "awaiting_review", promotionStatus: "none" });
    expect(await getItemCorrectionHistory(a, ORG)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND action = 'import_review_reopened_by_correction' AND entityId = ?", [ORG, a])).toBe(1);

    // Gestor não promove conteúdo que ninguém aprovou depois da correção.
    await expect(promoteApprovedSessionToDomain({ sessionId, organizationId: ORG, procurementProcessId: PROC, actorUserId: U, idempotencyKey: `promo-${sessionId}`, correlationId: "r9" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await count("SELECT COUNT(*) n FROM import_promotions WHERE organizationId = ? AND importSessionId = ?", [ORG, sessionId])).toBe(0);
  }, 60_000);

  it("(a') sessão aguardando revisão: item aceito corrigido volta a pendente; sessão inalterada", async () => {
    const { sessionId, itemIds: [a] } = await seed({ status: "awaiting_review" }, ["approved", "pending"]);
    const r = await correctStagingItem(params(sessionId, a));
    expect(r).toMatchObject({ reviewReopened: true, sessionReopened: false });
    expect((await getStagingItem(a, ORG))?.reviewStatus).toBe("pending");
    expect((await getImportSession(sessionId, ORG))?.status).toBe("awaiting_review");
  }, 60_000);

  it("(b) sessão PROMOVIDA ⇒ SESSION_ALREADY_PROMOTED, nenhuma escrita, chave não cacheada como sucesso", async () => {
    const { sessionId, itemIds: [a] } = await seed({ status: "approved", promotionStatus: "promoted" }, ["approved"]);
    const p = params(sessionId, a);
    await expect(correctStagingItem(p)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^SESSION_ALREADY_PROMOTED/) });
    expect(await getStagingItem(a, ORG)).toMatchObject({ reviewStatus: "approved", correctionRevision: 0, correctedPayload: null });
    expect(await getItemCorrectionHistory(a, ORG)).toHaveLength(0);
    expect(await getImportSession(sessionId, ORG)).toMatchObject({ status: "approved", promotionStatus: "promoted" });
    expect(await idemStatus(p.idempotencyKey)).toBe("failed");
  }, 60_000);

  it("(c) ATOMICIDADE: falha no histórico ⇒ rollback de item + reabertura + sessão; retry com a mesma chave funciona", async () => {
    const { sessionId, itemIds: [a] } = await seed({ status: "approved" }, ["approved"]);
    // Falha injetada: a revisão 1 do item já está registrada (UNIQUE org+item+toRevision) ⇒ o INSERT do histórico
    // falha DEPOIS do UPDATE do item e ANTES da reabertura da sessão.
    const db = (await getDb())!;
    const [blocker] = await db.insert(importItemCorrections).values({
      organizationId: ORG, procurementProcessId: PROC, importSessionId: sessionId, stagingItemId: a,
      fromRevision: 0, toRevision: 1, beforePayload: {}, afterPayload: { description: "outro" }, changedFields: ["description"],
      justification: "registro concorrente", actorUserId: U, idempotencyKey: `blocker-${a}`,
    }).$returningId();
    const p = params(sessionId, a);
    await expect(correctStagingItem(p)).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await getStagingItem(a, ORG)).toMatchObject({
      reviewStatus: "approved", reviewedBy: U, correctionRevision: 0, correctedPayload: null, correctedByUserId: null,
    });
    expect((await getImportSession(sessionId, ORG))?.status).toBe("approved");
    expect(await getItemCorrectionHistory(a, ORG)).toHaveLength(1); // só o bloqueador
    expect(await count("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND action = 'import_review_reopened_by_correction' AND entityId = ?", [ORG, a])).toBe(0);
    expect(await idemStatus(p.idempotencyKey)).toBe("failed");

    // Sem o bloqueador, o retry com a MESMA chave e o MESMO payload executa (falha não virou sucesso cacheado).
    await conn.query("DELETE FROM import_item_corrections WHERE id = ?", [blocker.id]);
    const retry = await correctStagingItem(p);
    expect(retry).toMatchObject({ idempotent: false, revision: 1, reviewReopened: true, sessionReopened: true });
    const hist = await getItemCorrectionHistory(a, ORG);
    expect(hist).toHaveLength(1);
    expect(hist[0].idempotencyKey).toBe(p.idempotencyKey);
    expect((await getStagingItem(a, ORG))?.correctionRevision).toBe(1);
    expect(await idemStatus(p.idempotencyKey)).toBe("completed");
  }, 60_000);

  it("(d) mesma chave + mesmo payload ⇒ replay sem 2ª escrita; payload diferente ⇒ CONFLICT", async () => {
    const { sessionId, itemIds: [a] } = await seed({ status: "approved" }, ["approved"]);
    const p = params(sessionId, a);
    const r1 = await correctStagingItem(p);
    const r2 = await correctStagingItem(p);
    expect(r1).toMatchObject({ idempotent: false, revision: 1, sessionReopened: true });
    expect(r2).toMatchObject({ idempotent: true, revision: 1, sessionReopened: true, reviewReopened: true });
    expect(await getItemCorrectionHistory(a, ORG)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND action = 'import_review_reopened_by_correction' AND entityId = ?", [ORG, a])).toBe(1);

    await expect(correctStagingItem({ ...p, corrections: { unitPrice: "9,99" } }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/IDEMPOTENCY_CONFLICT|payload diferente/) });
    await expect(correctStagingItem({ ...p, justification: "outro motivo" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getItemCorrectionHistory(a, ORG)).toHaveLength(1);
    expect((await getStagingItem(a, ORG))?.correctionRevision).toBe(1);
  }, 60_000);

  it("(d') chave já usada no histórico pré-R9 com OUTRO conteúdo ⇒ CONFLICT (nunca replay silencioso)", async () => {
    const { sessionId, itemIds: [a, b] } = await seed({ status: "awaiting_review" }, ["pending", "pending"]);
    const legacyKey = `legacy-${a}-${++seq}`;
    const db = (await getDb())!;
    await db.insert(importItemCorrections).values({
      organizationId: ORG, procurementProcessId: PROC, importSessionId: sessionId, stagingItemId: b,
      fromRevision: 0, toRevision: 1, beforePayload: {}, afterPayload: { unitPrice: "7.50" }, changedFields: ["unitPrice"],
      justification: "valor unitário digitado errado", actorUserId: U, idempotencyKey: legacyKey,
    });
    await expect(correctStagingItem(params(sessionId, a, { idempotencyKey: legacyKey }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getStagingItem(a, ORG)).toMatchObject({ correctionRevision: 0, correctedPayload: null });
  }, 60_000);

  it("(e) concorrência otimista: duas correções simultâneas na mesma revisão ⇒ uma vence, a outra CONFLICT", async () => {
    const { sessionId, itemIds: [a] } = await seed({ status: "awaiting_review" }, ["pending"]);
    const out = await Promise.allSettled([
      correctStagingItem(params(sessionId, a, { corrections: { unitPrice: "6,00" } })),
      correctStagingItem(params(sessionId, a, { corrections: { unitPrice: "8,00" } })),
    ]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = out.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "CONFLICT" });
    expect(await getItemCorrectionHistory(a, ORG)).toHaveLength(1);
    expect((await getStagingItem(a, ORG))?.correctionRevision).toBe(1);
  }, 60_000);

  it("(f) outro tenant não corrige o item (NOT_FOUND) e nada é gravado", async () => {
    const { sessionId, itemIds: [a] } = await seed({ status: "approved" }, ["approved"]);
    await expect(correctStagingItem(params(sessionId, a, { organizationId: OTHER_ORG }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getStagingItem(a, ORG)).toMatchObject({ reviewStatus: "approved", correctionRevision: 0 });
    expect((await getImportSession(sessionId, ORG))?.status).toBe("approved");
  }, 60_000);
});
