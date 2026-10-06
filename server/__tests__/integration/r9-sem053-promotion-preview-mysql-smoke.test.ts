/**
 * R9 / SEM-053 — Prévia do impacto da promoção nos Itens Inteligentes contra MySQL REAL.
 *
 * Cenário: o processo já tem Itens Inteligentes de uma promoção anterior (um pendente, um APROVADO) e dois itens
 * legados com a mesma descrição (identidade ambígua). Uma nova sessão aprovada traz: a mesma caneta (mescla +
 * média recalculada), o mesmo papel (item aprovado ⇒ "Fonte alterada"), um grampeador (novo) e a cadeira
 * (ambígua ⇒ "Identidade a revisar"). Cobre: números da prévia (criados, mesclados antes × depois, fonte alterada
 * com aprovados, identidade a revisar); prévia SEM nenhuma escrita; a promoção real produz exatamente o previsto;
 * pré-condições (sessão não aprovada / já promovida / outro processo). Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { getDb } from "../../db/connection";
import { importSessions, importStagingItems } from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import { previewSessionPromotion, promoteApprovedSessionToDomain } from "../../services/importPromotionService";

const DB = process.env.DATABASE_URL;
const ORG = 960482;
const PROC = "R9-S053";
const U = 5301;
let conn: mysql.Connection;
let seq = 0;

type Row = { description: string; quantity: string; unit: string; price: string };

async function seedApprovedSession(rows: Row[], over: Record<string, unknown> = {}): Promise<number> {
  const db = (await getDb())!;
  const [s] = await db.insert(importSessions).values({
    organizationId: ORG, uploadedBy: U, sourceFileId: `imports/${ORG}/${++seq}-cot.xlsx`, sourceFileName: "cot.xlsx",
    sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", checksum: `${seq}`.padStart(64, "b"),
    procurementProcessId: PROC, importType: "price_research", parserType: "xlsx", parserVersion: "1.0.0",
    status: "approved", stage: "approved", ...over,
  }).$returningId();
  for (const r of rows) {
    await db.insert(importStagingItems).values({
      importSessionId: s.id, organizationId: ORG, rawDescription: r.description, rawQuantity: r.quantity, rawUnit: r.unit,
      rawUnitPrice: r.price, reviewStatus: "approved", reviewedBy: U, reviewedAt: new Date(),
    });
  }
  return s.id;
}

const promote = (sessionId: number) => promoteApprovedSessionToDomain({
  sessionId, organizationId: ORG, procurementProcessId: PROC, actorUserId: U, idempotencyKey: `s053-${sessionId}`, correlationId: `s053-${sessionId}`,
});

async function snapshot(): Promise<string> {
  const [items] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT id, status, approved_by, average_price, suppliers, source_state, pending_suppliers FROM intelligent_items WHERE organization_id = ? AND process_id = ? ORDER BY id",
    [ORG, PROC],
  );
  const [aliases] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM intelligent_item_identity_aliases WHERE organization_id = ?", [ORG]);
  const [promos] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM import_promotions WHERE organizationId = ?", [ORG]);
  const [research] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM price_research_items WHERE organization_id = ?", [ORG]);
  return JSON.stringify({ items, aliases: aliases[0].n, promos: promos[0].n, research: research[0].n });
}

async function itemByDescription(description: string): Promise<mysql.RowDataPacket> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT * FROM intelligent_items WHERE organization_id = ? AND process_id = ? AND description = ?", [ORG, PROC, description],
  );
  return rows[0];
}

async function cleanup(): Promise<void> {
  const tables: Array<[string, string]> = [
    ["import_promotions", "organizationId"], ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"],
    ["import_sessions", "organizationId"], ["price_research_items", "organization_id"], ["price_research", "organization_id"],
    ["intelligent_item_identity_aliases", "organization_id"], ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"],
    ["item_recommendations", "organization_id"], ["intelligent_items", "organization_id"], ["process_timeline", "organization_id"],
    ["activity_logs", "organizationId"], ["idempotency_keys", "organizationId"],
  ];
  for (const [t, c] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${c}\` = ?`, [ORG]).catch(() => {});
}

describe.skipIf(!DB)("R9 / SEM-053 — prévia do impacto da promoção (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();

    // Base: promoção anterior cria "Caneta azul" e "Papel A4"; o papel é APROVADO por humano.
    const first = await seedApprovedSession([
      { description: "Caneta azul", quantity: "100", unit: "UN", price: "1,50" },
      { description: "Papel A4", quantity: "50", unit: "RESMA", price: "18,90" },
    ]);
    const r = await promote(first);
    expect(r.intelligentItems).toMatchObject({ created: 2 });
    await conn.query("UPDATE intelligent_items SET status = 'aprovado', approved_by = ? WHERE organization_id = ? AND process_id = ? AND description = 'Papel A4'", [U, ORG, PROC]);
    // Dois itens LEGADOS com a mesma descrição ⇒ identidade ambígua para "Cadeira".
    for (const id of ["r9s053-leg-a", "r9s053-leg-b"]) {
      await conn.query(
        `INSERT INTO intelligent_items (id, organization_id, process_id, source_research_id, description, quantity, unit, average_price, suppliers,
           suggested_catmat, alternative_catmat, specifications, risks, recommendations, status, approved_by, enrichment_status, correlation_id)
         VALUES (?, ?, ?, 'legacy-r', 'Cadeira', 5, 'UN', '90.00', ?, NULL, '[]', '[]', '[]', '[]', 'pendente', NULL, 'done', 'legacy')`,
        [id, ORG, PROC, JSON.stringify([{ name: "Fornecedor legado", value: 90 }])],
      );
    }
  }, 300_000);

  afterAll(async () => {
    await cleanup().catch(() => {});
    await conn?.end();
  });

  it("prévia: criados, mesclados (antes × depois), fonte alterada (aprovado) e identidade a revisar — sem escrita; a promoção faz o previsto", async () => {
    const second = await seedApprovedSession([
      { description: "Caneta azul", quantity: "100", unit: "UN", price: "2,00" },
      { description: "Papel A4", quantity: "50", unit: "RESMA", price: "20,00" },
      { description: "Grampeador", quantity: "10", unit: "UN", price: "30,00" },
      { description: "Cadeira", quantity: "5", unit: "UN", price: "100,00" },
    ]);
    const before = await snapshot();
    const preview = await previewSessionPromotion({ sessionId: second, organizationId: ORG, procurementProcessId: PROC });

    expect(preview.quotesToPromote).toBe(4);
    expect(preview.intelligentItems).toEqual({
      create: 1, merge: 1, unchanged: 0, preserved: 0, sourceChanged: 1, sourceChangedApproved: 1, reviewRequired: 2, reconciled: 0,
    });
    expect(preview.merges).toEqual([expect.objectContaining({
      description: "Caneta azul", status: "pendente", beforeQuoteCount: 1, afterQuoteCount: 2, beforeAverageCents: 150, afterAverageCents: 175,
    })]);
    expect(preview.sourceChanges).toEqual([expect.objectContaining({
      description: "Papel A4", status: "aprovado", beforeQuoteCount: 1, afterQuoteCount: 2, beforeAverageCents: 1890, afterAverageCents: 1945,
    })]);

    // Somente leitura: nada mudou (itens, aliases, ledger, pesquisa, sessão).
    expect(await snapshot()).toBe(before);
    const [sess] = await conn.query<mysql.RowDataPacket[]>("SELECT status, promotionStatus FROM import_sessions WHERE id = ?", [second]);
    expect(sess[0]).toMatchObject({ status: "approved", promotionStatus: "none" });

    // A promoção real (lógica inalterada) produz exatamente o que a prévia anunciou.
    const r = await promote(second);
    expect(r.idempotent).toBe(false);
    expect(r.itemsPromoted).toBe(preview.quotesToPromote);
    expect(r.intelligentItems).toMatchObject({ created: preview.intelligentItems.create, updated: preview.intelligentItems.merge, sourceChanged: preview.intelligentItems.sourceChanged });
    expect(Number((await itemByDescription("Caneta azul")).average_price)).toBe(1.75);
    const papel = await itemByDescription("Papel A4");
    expect(papel).toMatchObject({ status: "aprovado", source_state: "source_changed" });
    expect(Number(papel.average_price)).toBe(18.9); // números do item aprovado preservados (proposta pendente)
    const [legacy] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM intelligent_items WHERE organization_id = ? AND source_state = 'review_required'", [ORG]);
    expect(Number(legacy[0].n)).toBe(preview.intelligentItems.reviewRequired);
    expect(await itemByDescription("Grampeador")).toBeTruthy();
  }, 120_000);

  it("pré-condições: sessão já promovida, não aprovada ou de outro processo não têm prévia", async () => {
    const pending = await seedApprovedSession([{ description: "Lápis", quantity: "1", unit: "UN", price: "1,00" }], { status: "awaiting_review", stage: "awaiting_review" });
    await expect(previewSessionPromotion({ sessionId: pending, organizationId: ORG, procurementProcessId: PROC })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(previewSessionPromotion({ sessionId: pending, organizationId: ORG, procurementProcessId: "OUTRO" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const promoted = await seedApprovedSession([{ description: "Borracha", quantity: "1", unit: "UN", price: "1,00" }], { promotionStatus: "promoted" });
    await expect(previewSessionPromotion({ sessionId: promoted, organizationId: ORG, procurementProcessId: PROC })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(previewSessionPromotion({ sessionId: promoted, organizationId: ORG + 1, procurementProcessId: PROC })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 60_000);
});
