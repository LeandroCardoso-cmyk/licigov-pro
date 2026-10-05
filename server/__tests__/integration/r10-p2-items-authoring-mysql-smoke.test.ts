/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * R10 / P2 — MySQL REAL (órgãos sintéticos 960510/960511):
 *   S1 (SEM-044) ETP gerado por A e reescrito por humano B ⇒ `sources` ganha o marcador (origem humana + ator + hash), o ledger
 *      `generated_document_edits` registra a edição, a origem a montante passa de "gerado" para "manual"; nova edição por C
 *      substitui ator/hash; no-op não altera; outro tenant não enxerga.
 *   S2 (SEM-090) promoção com quantidade AUSENTE: o domínio carrega null (a coluna NOT NULL guarda 0, coerção única); repetir a
 *      promoção NÃO duplica o item; item com quantidade informada continua separado; o TR mostra "[REVISAR: quantidade não
 *      informada]" em vez de 0 e não calcula valor.
 *   S3 (SEM-045) descrição/unidade do item canônico projetadas com a proveniência REAL (manual ⇒ user com o ator; correção ⇒ o corretor).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { getDb } from "../../db/connection";
import { importSessions, importStagingItems } from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import { generateDocument, saveReviewableDraft } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { resolveAuthoritativeUpstream } from "../../services/authoring/upstreamAuthority";
import { resolveDocumentAuthoringContext } from "../../services/authoring/authoringContext";
import { promoteApprovedSessionToDomain } from "../../services/importPromotionService";
import { createManualItem, updateProcurementItem } from "../../services/procurementItemsService";
import { resolveProcurementContext } from "../../services/canonicalContextService";
import { draftContentHash } from "../../domain/generatedDocument";
import { readHumanEditMarker } from "../../domain/humanEditMarker";
import { QUANTITY_NOT_INFORMED_TEXT } from "../../domain/authoritativeItems";

const DB = process.env.DATABASE_URL;
const ORG = 960510;
const ORG2 = 960511;
const A = 5, B = 9, C = 7;
const PROC = "R10-P2-PROMO";
let conn: mysql.Connection;
let seq = 0;

async function cleanup() {
  for (const org of [ORG, ORG2]) {
    for (const [t, c] of [
      ["generated_document_edits", "organization_id"], ["generated_documents", "organization_id"], ["process_timeline", "organization_id"],
      ["import_promotions", "organizationId"], ["import_item_corrections", "organizationId"], ["import_staging_items", "organizationId"], ["import_sessions", "organizationId"],
      ["price_research_items", "organization_id"], ["price_research", "organization_id"], ["intelligent_item_identity_aliases", "organization_id"],
      ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"], ["intelligent_items", "organization_id"],
      ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
      ["procurement_context_facts", "organization_id"], ["procurement_processes", "organization_id"], ["activity_logs", "organizationId"], ["idempotency_keys", "organizationId"],
    ] as const) await conn.query(`DELETE FROM \`${t}\` WHERE \`${c}\` = ?`, [org]).catch(() => {});
  }
}

async function seedSession(rows: Array<{ description: string; quantity: string | null; unit: string; price: string }>): Promise<number> {
  const db = (await getDb())!;
  const [s] = await db.insert(importSessions).values({
    organizationId: ORG, uploadedBy: A, sourceFileId: `imports/${ORG}/${++seq}-cot.xlsx`, sourceFileName: "cot.xlsx",
    sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", checksum: `${seq}`.padStart(64, "d"),
    procurementProcessId: PROC, importType: "price_research", parserType: "xlsx", parserVersion: "1.0.0", status: "approved", stage: "approved",
  }).$returningId();
  for (const r of rows) {
    await db.insert(importStagingItems).values({
      importSessionId: s.id, organizationId: ORG, rawDescription: r.description, rawQuantity: r.quantity, rawUnit: r.unit,
      rawUnitPrice: r.price, reviewStatus: "approved", reviewedBy: A, reviewedAt: new Date(),
    });
  }
  return s.id;
}
const promote = (sessionId: number) => promoteApprovedSessionToDomain({
  sessionId, organizationId: ORG, procurementProcessId: PROC, actorUserId: A, idempotencyKey: `r10-${sessionId}`, correlationId: `r10-${sessionId}`,
});

describe.skipIf(!DB)("R10 / P2 — itens e autoria (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const [id, slug] of [[ORG, "r10-p2"], [ORG2, "r10-p2-b"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `R10 P2 ${id}`, slug]);
    }
  }, 300_000);
  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  it("S1) SEM-044: ETP reescrito por humano deixa marcador (ator + hash), ledger e origem 'manual'; no-op não altera; tenant isolado", async () => {
    const pid = "r10-etp";
    await generateDocument({ organizationId: ORG, processId: pid, kind: "etp", object: "Objeto ETP", correlationId: "r10-seed", idempotencyKey: `gen-${pid}`, actorUserId: A, invoke: async () => buildMockProviderAuthoring("etp") });
    const row = async () => {
      const [r] = await conn.execute<mysql.RowDataPacket[]>("SELECT CAST(content AS CHAR) c, CAST(sources AS CHAR) s FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'etp'", [ORG, pid]);
      return { content: String((r[0] as any).c), sources: JSON.parse(String((r[0] as any).s ?? "[]")) as string[] };
    };
    const gen = await row();
    expect(readHumanEditMarker(gen.sources)).toBeNull();
    expect((await resolveAuthoritativeUpstream(ORG, pid, "etp"))?.origin).toBe("generated");

    const text1 = "# ETP reescrito\nconteúdo humano 1.";
    await saveReviewableDraft({ organizationId: ORG, processId: pid, kind: "etp", content: text1, actorUserId: B, expectedContentHash: draftContentHash(gen.content), idempotencyKey: `e1-${pid}`, correlationId: "r10-e1" });
    const e1 = await row();
    expect(readHumanEditMarker(e1.sources)).toEqual({ actorUserId: B, contentHash: draftContentHash(text1).slice(0, 16) });
    expect(gen.sources.every((s) => e1.sources.includes(s))).toBe(true); // lineage de geração preservada
    expect((await resolveAuthoritativeUpstream(ORG, pid, "etp"))?.origin).toBe("manual");
    const [ledger] = await conn.execute<mysql.RowDataPacket[]>("SELECT actor_user_id a, operation op FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND kind = 'etp'", [ORG, pid]);
    expect(ledger).toEqual([expect.objectContaining({ a: B, op: "human_edit" })]);

    // no-op (mesmo conteúdo): nada muda
    await saveReviewableDraft({ organizationId: ORG, processId: pid, kind: "etp", content: text1, actorUserId: C, expectedContentHash: draftContentHash(text1), idempotencyKey: `e1b-${pid}`, correlationId: "r10-e1b" });
    expect((await row()).sources).toEqual(e1.sources);
    // nova edição por C substitui ator/hash
    const text2 = text1 + "\nmais uma linha.";
    await saveReviewableDraft({ organizationId: ORG, processId: pid, kind: "etp", content: text2, actorUserId: C, expectedContentHash: draftContentHash(text1), idempotencyKey: `e2-${pid}`, correlationId: "r10-e2" });
    const e2 = await row();
    expect(readHumanEditMarker(e2.sources)).toEqual({ actorUserId: C, contentHash: draftContentHash(text2).slice(0, 16) });
    expect(e2.sources.filter((s) => s.startsWith("edicao_humana:ator="))).toHaveLength(1);
    // outro tenant não vê o documento
    expect(await resolveAuthoritativeUpstream(ORG2, pid, "etp")).toBeNull();
  }, 120_000);

  it("S2) SEM-090: quantidade ausente ≠ 0 — domínio null, sem duplicar na repetição, TR mostra [REVISAR] e não calcula valor", async () => {
    const s1 = await seedSession([
      { description: "Caneta sem quantidade", quantity: null, unit: "UN", price: "2,00" },
      { description: "Papel com quantidade", quantity: "10", unit: "RESMA", price: "20,00" },
    ]);
    const r1 = await promote(s1);
    expect(r1.intelligentItems).toMatchObject({ created: 2 });
    const [pri] = await conn.query<mysql.RowDataPacket[]>("SELECT description, quantity FROM price_research_items WHERE organization_id = ? AND process_id = ? ORDER BY description", [ORG, PROC]);
    expect((pri as any[]).map((x) => [x.description, Number(x.quantity)])).toEqual([["Caneta sem quantidade", 0], ["Papel com quantidade", 10]]);

    // repetir com OUTRA cotação do mesmo item sem quantidade ⇒ mescla no MESMO item (chave estável), nada duplicado
    const s2 = await seedSession([{ description: "Caneta sem quantidade", quantity: null, unit: "UN", price: "3,00" }]);
    const r2 = await promote(s2);
    expect(r2.intelligentItems).toMatchObject({ created: 0, updated: 1 });
    const [items] = await conn.query<mysql.RowDataPacket[]>("SELECT id, description, quantity, status FROM intelligent_items WHERE organization_id = ? AND process_id = ? ORDER BY description", [ORG, PROC]);
    expect(items).toHaveLength(2);
    expect(Number((items as any[])[0].quantity)).toBe(0);

    // TR (legado, itens aprovados): quantidade ausente vira [REVISAR], valor não calculado
    await conn.query("UPDATE intelligent_items SET status = 'aprovado', approved_by = ? WHERE organization_id = ? AND process_id = ?", [A, ORG, PROC]);
    const ctx = await resolveDocumentAuthoringContext({ organizationId: ORG, processId: PROC, kind: "tr", object: "Material de escritório" });
    const block = ctx.authoritativeBlock!;
    expect(block).toContain(`| Caneta sem quantidade | ${QUANTITY_NOT_INFORMED_TEXT} |`);
    expect(block).not.toMatch(/Caneta sem quantidade \| 0 \|/);
    expect(block).toMatch(/1 item\(ns\) sem quantidade informada/);
    expect(ctx.promptContext).toContain(QUANTITY_NOT_INFORMED_TEXT);
    expect(ctx.promptContext).not.toMatch(/Caneta sem quantidade[^\n]*\b0 UN\b/);
  }, 120_000);

  it("S3) SEM-045: descrição/unidade do item canônico com proveniência real (manual ⇒ ator criador; correção ⇒ corretor)", async () => {
    const pid = "r10-prov";
    await conn.execute(
      "INSERT INTO procurement_processes (id, organization_id, process_number, object, current_stage, status, responsible_user, created_at, updated_at) VALUES (?, ?, ?, 'Objeto', 'DFD', 'rascunho', ?, NOW(), NOW())",
      [pid, ORG, `R10-${Date.now()}`, A],
    ).catch(async () => { /* esquema difere: o serviço de contexto exige só o processo existente */ });
    const base = { organizationId: ORG, processId: pid, correlationId: "r10-s3" };
    const created = await createManualItem({ ...base, actorUserId: A, description: "Detergente", unit: "UN", plannedQuantity: 5, idempotencyKey: "r10-s3-1" });
    const itemId = created.result.itemId;
    let ctx = await resolveProcurementContext({ organizationId: ORG, processId: pid, correlationId: "r10-s3" });
    expect(ctx.items.find((i) => i.key === itemId)!.description).toMatchObject({ status: "confirmed", actorUserId: A, source: { type: "user" } });
    await updateProcurementItem({ ...base, actorUserId: B, itemId, expectedRevision: 1, description: "Detergente neutro", idempotencyKey: "r10-s3-2" });
    ctx = await resolveProcurementContext({ organizationId: ORG, processId: pid, correlationId: "r10-s3" });
    const it = ctx.items.find((i) => i.key === itemId)!;
    expect(it.description).toMatchObject({ value: "Detergente neutro", status: "confirmed", actorUserId: B });
    expect(it.unit.actorUserId).toBe(A); // a unidade continua sendo a do criador
  }, 120_000);
});
