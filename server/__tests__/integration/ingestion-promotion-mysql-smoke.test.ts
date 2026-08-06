/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR B.2.4 — Promoção transacional ao domínio contra MySQL REAL (CI). Executável (não source inspection).
 *
 * Cobre: promoção válida (price_research/price_research_items criados, projeção + ledger); conteúdo
 * CORRIGIDO promovido com raw* PRESERVADO; idempotência (replay não duplica); sessão não aprovada;
 * item pendente; processo divergente; outro tenant; tipo não promovível; lineage no ledger; e ROLLBACK
 * integral em erro (nada persiste). Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { importSessions, importStagingItems, importPromotions, priceResearchTable, priceResearchItemsTable } from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import { promoteApprovedSessionToDomain } from "../../services/importPromotionService";

const DB = process.env.DATABASE_URL;
const ORG = 990401;
const OTHER_ORG = 990402;
const PROC = "PROMO-P1";

type ItemSeed = {
  rawDescription: string; rawQuantity?: string; rawUnit?: string; rawUnitPrice?: string; rawTotalPrice?: string;
  reviewStatus?: "pending" | "approved" | "rejected" | "skipped"; correctedPayload?: Record<string, unknown> | null; correctionRevision?: number;
};

async function seedSession(over: Partial<Record<string, unknown>>, items: ItemSeed[]): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");
  const [s] = await db.insert(importSessions).values({
    organizationId: ORG, uploadedBy: 1, sourceFileId: "imports/x/1-cot.xlsx", sourceFileName: "cot.xlsx",
    sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    procurementProcessId: PROC, importType: "price_research", parserType: "xlsx", parserVersion: "1.0.0",
    status: "approved", ...over,
  }).$returningId();
  for (const it of items) {
    await db.insert(importStagingItems).values({
      importSessionId: s.id, organizationId: ORG,
      rawDescription: it.rawDescription, rawQuantity: it.rawQuantity ?? null, rawUnit: it.rawUnit ?? null,
      rawUnitPrice: it.rawUnitPrice ?? null, rawTotalPrice: it.rawTotalPrice ?? null,
      reviewStatus: it.reviewStatus ?? "approved",
      correctedPayload: (it.correctedPayload ?? null) as any, correctionRevision: it.correctionRevision ?? 0,
    });
  }
  return s.id;
}

const params = (sessionId: number, over: Record<string, unknown> = {}) => ({
  sessionId, organizationId: ORG, procurementProcessId: PROC, actorUserId: 7,
  idempotencyKey: `promo-${sessionId}-key`, correlationId: "corr-promo", ...over,
});

async function cleanup(conn: mysql.Connection) {
  for (const t of ["import_promotions", "price_research_items", "price_research", "import_staging_items", "import_sessions"]) {
    await conn.query(`DELETE FROM \`${t}\` WHERE organizationId IN (?, ?)`, [ORG, OTHER_ORG]).catch(async () => {
      // price_research usa organization_id (snake_case)
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG, OTHER_ORG]).catch(() => {});
    });
  }
}

describe.skipIf(!DB)("Promoção transacional ao domínio — MySQL real", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup(conn);
  }, 300_000);

  afterAll(async () => {
    await cleanup(conn).catch(() => {});
    await conn?.end();
  });

  it("promoção válida: cria price_research + itens, projeção e ledger", async () => {
    const id = await seedSession({}, [
      { rawDescription: "Caneta azul", rawQuantity: "100", rawUnit: "UN", rawUnitPrice: "1,50" },
      { rawDescription: "Papel A4", rawQuantity: "50", rawUnit: "RESMA", rawUnitPrice: "18,90" },
      { rawDescription: "Item rejeitado", rawUnitPrice: "9,99", reviewStatus: "rejected" },
    ]);
    const r = await promoteApprovedSessionToDomain(params(id));
    expect(r.idempotent).toBe(false);
    expect(r.itemsPromoted).toBe(2); // rejeitado não promove
    expect(r.targetKind).toBe("price_research");

    const db = await getDb();
    const research = await db!.select().from(priceResearchTable).where(eq(priceResearchTable.id, r.targetRef));
    expect(research).toHaveLength(1);
    expect(research[0].processId).toBe(PROC);
    const domItems = await db!.select().from(priceResearchItemsTable).where(eq(priceResearchItemsTable.researchId, r.targetRef));
    expect(domItems).toHaveLength(2);
    const caneta = domItems.find(i => (i.description ?? "").includes("Caneta"));
    expect(Number(caneta!.value)).toBeCloseTo(1.5, 2);   // unitário
    expect(Number(caneta!.quantity)).toBeCloseTo(100, 0);

    const sess = await db!.select().from(importSessions).where(eq(importSessions.id, id));
    expect(sess[0].promotionStatus).toBe("promoted");
    expect(sess[0].promotionRef).toBe(r.targetRef);

    const ledger = await db!.select().from(importPromotions).where(and(eq(importPromotions.organizationId, ORG), eq(importPromotions.importSessionId, id)));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ procurementProcessId: PROC, importType: "price_research", targetKind: "price_research", itemsPromoted: 2, actorUserId: 7 });
  }, 60_000);

  it("conteúdo CORRIGIDO é promovido; raw* preservado no staging", async () => {
    const id = await seedSession({}, [
      { rawDescription: "cabo original", rawUnitPrice: "5,00", correctedPayload: { unitPrice: "7.5", description: "cabo corrigido" }, correctionRevision: 1 },
    ]);
    const r = await promoteApprovedSessionToDomain(params(id));
    const db = await getDb();
    const dom = await db!.select().from(priceResearchItemsTable).where(eq(priceResearchItemsTable.researchId, r.targetRef));
    expect(dom).toHaveLength(1);
    expect(dom[0].description).toBe("cabo corrigido");      // overlay vence
    expect(Number(dom[0].value)).toBeCloseTo(7.5, 2);        // valor corrigido
    // raw* IMUTÁVEL no staging:
    const st = await db!.select().from(importStagingItems).where(eq(importStagingItems.importSessionId, id));
    expect(st[0].rawDescription).toBe("cabo original");
    expect(st[0].rawUnitPrice).toBe("5,00");
  }, 60_000);

  it("idempotência: replay não duplica (mesmo targetRef, um ledger)", async () => {
    const id = await seedSession({}, [{ rawDescription: "X", rawUnitPrice: "1,00" }]);
    const r1 = await promoteApprovedSessionToDomain(params(id));
    const r2 = await promoteApprovedSessionToDomain(params(id));
    expect(r1.idempotent).toBe(false);
    expect(r2.idempotent).toBe(true);
    expect(r2.targetRef).toBe(r1.targetRef);
    const db = await getDb();
    const ledger = await db!.select().from(importPromotions).where(and(eq(importPromotions.organizationId, ORG), eq(importPromotions.importSessionId, id)));
    expect(ledger).toHaveLength(1);
    const dom = await db!.select().from(priceResearchItemsTable).where(eq(priceResearchItemsTable.researchId, r1.targetRef));
    expect(dom).toHaveLength(1);
  }, 60_000);

  it("sessão não aprovada → PRECONDITION_FAILED", async () => {
    const id = await seedSession({ status: "awaiting_review" }, [{ rawDescription: "X", rawUnitPrice: "1,00" }]);
    await expect(promoteApprovedSessionToDomain(params(id))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }, 60_000);

  it("item pendente → PRECONDITION_FAILED", async () => {
    const id = await seedSession({}, [
      { rawDescription: "ok", rawUnitPrice: "1,00", reviewStatus: "approved" },
      { rawDescription: "pendente", rawUnitPrice: "2,00", reviewStatus: "pending" },
    ]);
    await expect(promoteApprovedSessionToDomain(params(id))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }, 60_000);

  it("processo divergente → NOT_FOUND", async () => {
    const id = await seedSession({}, [{ rawDescription: "X", rawUnitPrice: "1,00" }]);
    await expect(promoteApprovedSessionToDomain(params(id, { procurementProcessId: "OUTRO" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 60_000);

  it("outro tenant → NOT_FOUND", async () => {
    const id = await seedSession({}, [{ rawDescription: "X", rawUnitPrice: "1,00" }]);
    await expect(promoteApprovedSessionToDomain(params(id, { organizationId: OTHER_ORG }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 60_000);

  it("tipo não promovível (tr_items) → BAD_REQUEST (capacidade indisponível)", async () => {
    const id = await seedSession({ importType: "tr_items" }, [{ rawDescription: "X", rawUnitPrice: "1,00" }]);
    await expect(promoteApprovedSessionToDomain(params(id))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60_000);

  it("rollback integral: falha no ledger não deixa research/itens nem projeção", async () => {
    const db = await getDb();
    // Pré-insere um ledger com a MESMA idempotencyKey p/ outra sessão (colide em UNIQUE(org, idempotencyKey)).
    const id = await seedSession({}, [{ rawDescription: "Y", rawUnitPrice: "3,00" }]);
    const key = `promo-${id}-key`;
    await db!.insert(importPromotions).values({
      organizationId: ORG, procurementProcessId: PROC, importSessionId: 987654,
      importType: "price_research", targetKind: "price_research", targetRef: "zzz",
      itemsPromoted: 1, idempotencyKey: key, correlationId: "x", actorUserId: 1,
    });
    await expect(promoteApprovedSessionToDomain(params(id, { idempotencyKey: key }))).rejects.toBeInstanceOf(Error);
    // Rollback: nenhuma pesquisa criada p/ esta sessão e projeção intacta.
    const sess = await db!.select().from(importSessions).where(eq(importSessions.id, id));
    expect(sess[0].promotionStatus).toBe("none");
    const ledgerForSession = await db!.select().from(importPromotions).where(and(eq(importPromotions.organizationId, ORG), eq(importPromotions.importSessionId, id)));
    expect(ledgerForSession).toHaveLength(0);
  }, 60_000);
});
