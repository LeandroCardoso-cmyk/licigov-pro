/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR B.2.2 — Correção humana auditável contra MySQL REAL (CI). Executável (não source inspection).
 *
 * Cobre: correção válida; raw* IMUTÁVEL; before/after persistidos; justificativa obrigatória; campo
 * desconhecido; patch vazio; idempotência (mesma chave); expectedRevision incorreta → CONFLICT sem
 * histórico parcial; duas correções sequenciais (revisão incremental + histórico); isolamento por
 * tenant. Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../db/connection";
import { importStagingItems } from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import { correctStagingItem, getStagingItem, getItemCorrectionHistory } from "../../services/importStagingService";

const DB = process.env.DATABASE_URL;
const ORG = 990201;
const OTHER_ORG = 990202;
const SESSION = 770201;

async function seedItem(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");
  const [row] = await db.insert(importStagingItems).values({
    importSessionId: SESSION,
    organizationId:  ORG,
    rawDescription:  "cabo original",
    rawQuantity:     "10",
    rawUnit:         "UN",
    rawUnitPrice:    "5,00",
    rawTotalPrice:   "50,00",
    reviewStatus:    "pending",
  }).$returningId();
  return row.id;
}

const baseParams = (itemId: number, over: Record<string, unknown>) => ({
  itemId,
  organizationId:       ORG,
  importSessionId:      SESSION,
  procurementProcessId: "P-CORR",
  importType:           "price_research",
  actorUserId:          1,
  corrections:          { unitPrice: "7,50" },
  justification:        "valor unitário digitado errado",
  expectedRevision:     0,
  idempotencyKey:       "corr-a-000001",
  correlationId:        "corr-corr",
  ...over,
});

describe.skipIf(!DB)("Correção humana auditável — MySQL real", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query("DELETE FROM `import_item_corrections` WHERE organizationId IN (?, ?)", [ORG, OTHER_ORG]);
    await conn.query("DELETE FROM `import_staging_items` WHERE organizationId IN (?, ?)", [ORG, OTHER_ORG]);
  }, 300_000);

  afterAll(async () => {
    await conn?.query("DELETE FROM `import_item_corrections` WHERE organizationId IN (?, ?)", [ORG, OTHER_ORG]).catch(() => {});
    await conn?.query("DELETE FROM `import_staging_items` WHERE organizationId IN (?, ?)", [ORG, OTHER_ORG]).catch(() => {});
    await conn?.end();
  });

  it("correção válida: raw imutável, overlay + revisão + histórico before/after", async () => {
    const id = await seedItem();
    const r = await correctStagingItem(baseParams(id, {}));
    expect(r.idempotent).toBe(false);
    expect(r.revision).toBe(1);

    const item = await getStagingItem(id, ORG);
    expect(item?.rawUnitPrice).toBe("5,00");                     // raw IMUTÁVEL
    expect((item?.correctedPayload as any).unitPrice).toBe("7.5"); // overlay normalizado
    expect(item?.correctionRevision).toBe(1);
    expect(item?.reviewStatus).toBe("pending");                  // correção NÃO aprova

    const hist = await getItemCorrectionHistory(id, ORG);
    expect(hist).toHaveLength(1);
    expect(hist[0].fromRevision).toBe(0);
    expect(hist[0].toRevision).toBe(1);
    expect((hist[0].afterPayload as any).unitPrice).toBe("7.5");
    expect(hist[0].justification).toContain("digitado errado");
  }, 60_000);

  it("justificativa vazia → erro", async () => {
    const id = await seedItem();
    await expect(correctStagingItem(baseParams(id, { justification: "  ", idempotencyKey: "corr-b-1" })))
      .rejects.toBeInstanceOf(TRPCError);
  }, 60_000);

  it("campo desconhecido e patch vazio → erro (sem histórico)", async () => {
    const id = await seedItem();
    await expect(correctStagingItem(baseParams(id, { corrections: { foo: "x" }, idempotencyKey: "corr-c-1" })))
      .rejects.toBeInstanceOf(TRPCError);
    await expect(correctStagingItem(baseParams(id, { corrections: {}, idempotencyKey: "corr-c-2" })))
      .rejects.toBeInstanceOf(TRPCError);
    expect(await getItemCorrectionHistory(id, ORG)).toHaveLength(0);
  }, 60_000);

  it("idempotência: mesma chave não aplica de novo", async () => {
    const id = await seedItem();
    const key = `corr-idem-${id}`;
    const r1 = await correctStagingItem(baseParams(id, { idempotencyKey: key }));
    const r2 = await correctStagingItem(baseParams(id, { idempotencyKey: key, corrections: { unitPrice: "9,99" } }));
    expect(r1.idempotent).toBe(false);
    expect(r2.idempotent).toBe(true);
    expect(r2.revision).toBe(1);
    expect(await getItemCorrectionHistory(id, ORG)).toHaveLength(1);
  }, 60_000);

  it("expectedRevision incorreta → CONFLICT sem histórico parcial", async () => {
    const id = await seedItem();
    await correctStagingItem(baseParams(id, { idempotencyKey: `corr-d1-${id}` })); // revisão → 1
    // expectedRevision=0 de novo (stale) com nova chave → conflito.
    await expect(correctStagingItem(baseParams(id, { expectedRevision: 0, idempotencyKey: `corr-d2-${id}` })))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getItemCorrectionHistory(id, ORG)).toHaveLength(1); // sem histórico parcial
  }, 60_000);

  it("duas correções sequenciais: revisão incremental + histórico com 2", async () => {
    const id = await seedItem();
    await correctStagingItem(baseParams(id, { expectedRevision: 0, idempotencyKey: `corr-e1-${id}` }));
    await correctStagingItem(baseParams(id, { expectedRevision: 1, corrections: { description: "cabo corrigido" }, idempotencyKey: `corr-e2-${id}` }));
    const item = await getStagingItem(id, ORG);
    expect(item?.correctionRevision).toBe(2);
    expect((item?.correctedPayload as any).unitPrice).toBe("7.5");        // overlay acumulado
    expect((item?.correctedPayload as any).description).toBe("cabo corrigido");
    const hist = await getItemCorrectionHistory(id, ORG);
    expect(hist.map(h => h.toRevision)).toEqual([1, 2]);
  }, 60_000);

  it("isolamento por tenant: outro org não corrige o item", async () => {
    const id = await seedItem();
    await expect(correctStagingItem(baseParams(id, { organizationId: OTHER_ORG, idempotencyKey: `corr-f-${id}` })))
      .rejects.toBeInstanceOf(TRPCError);
  }, 60_000);
});
