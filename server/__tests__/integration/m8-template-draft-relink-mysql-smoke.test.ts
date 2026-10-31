/**
 * M8 P2.1 — consequência controlada: a referência institucional do Anexo I não carrega mais id/hash do TR, então um M1 NOVO (outro pin
 * oficial) pode compor o MESMO texto. O adaptador real do rascunho (`writeDraft`) precisa então:
 *  - mesmo M1 ⇒ replay puro (nada muda);
 *  - outro M1, texto idêntico ⇒ o vínculo `tpl-m1:` muda; conteúdo, autoria, último ator substantivo e ledger de edições intactos; a
 *    revisão anterior deixa de valer (updatedAt/correlationId mudam) e um evento de processo AUDITA a troca (mesma transação);
 *  - documento com versão OFICIAL emitida ⇒ recusa (mesma trava da recomposição) e NADA muda — sem isso nasceria uma versão `gerado`
 *    depois da emissão;
 *  - tenant-scoped (o lock/atualização usam a organização do rascunho).
 * Só roda com DATABASE_URL (MySQL efêmero do CI / banco local isolado); pulado sem banco.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { runMigrations } from "../../bootstrap";
import { generatedDocumentEditsTable, generatedDocumentsTable, officialDocumentPromotionsTable, processTimelineTable } from "../../../drizzle/schema";
import { createTemplateDraftAdapter, templateDraftId } from "../../services/institutionalTemplates/adapters/draftAdapter";
import type { TemplateTxExecutor } from "../../services/institutionalTemplates/ports";

const DB = process.env.DATABASE_URL;
const ORG = 997901;
const ORG_OTHER = 997902;
const PID = "M8-RELINK-P1";
const AUTHOR = 997911;
const CONTENT = "# Edital\n\nDocumento de referência: Termo de Referência (Termo de Referência — versão oficial emitida no processo).";

describe.skipIf(!DB)("M8 P2.1 — rascunho por modelo: mesmo texto com outro M1 ⇒ só revincula (MySQL real)", () => {
  let conn: mysql.Connection;
  const id = templateDraftId(ORG, PID, "edital");
  const adapter = createTemplateDraftAdapter();
  const cleanup = async () => {
    await conn.query("DELETE FROM `generated_document_edits` WHERE organization_id IN (?, ?)", [ORG, ORG_OTHER]);
    await conn.query("DELETE FROM `generated_documents` WHERE organization_id IN (?, ?)", [ORG, ORG_OTHER]);
    await conn.query("DELETE FROM `official_document_promotions` WHERE organization_id IN (?, ?)", [ORG, ORG_OTHER]);
    await conn.query("DELETE FROM `process_timeline` WHERE organization_id IN (?, ?)", [ORG, ORG_OTHER]);
  };
  const events = async () => (await getDb())!.select().from(processTimelineTable)
    .where(and(eq(processTimelineTable.organizationId, ORG), eq(processTimelineTable.processId, PID)));
  const row = async (org = ORG) => (await (await getDb())!.select().from(generatedDocumentsTable)
    .where(and(eq(generatedDocumentsTable.id, id), eq(generatedDocumentsTable.organizationId, org))))[0];
  const edits = async () => (await (await getDb())!.select().from(generatedDocumentEditsTable).where(eq(generatedDocumentEditsTable.organizationId, ORG))).length;
  const write = async (m1: string, actorUserId = AUTHOR + 1) => {
    const db = (await getDb())!;
    await db.transaction(async (tx) => adapter.writeDraft({
      id, organizationId: ORG, subjectId: PID, documentType: "edital", title: "Edital", content: CONTENT, actorUserId,
      correlationId: `m8-relink-${m1}`, generationManifestId: m1,
    }, tx as unknown as TemplateTxExecutor));
  };

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    await (await getDb())!.insert(generatedDocumentsTable).values({
      id, organizationId: ORG, processId: PID, kind: "edital", title: "Edital", content: CONTENT, status: "rascunho",
      sources: JSON.stringify(["origem:template", "tpl-m1:tplm1_A"]), authorUserId: AUTHOR, lastSubstantiveActorUserId: AUTHOR,
      lastSubstantiveAt: "2026-10-28 09:00:00.000", correlationId: "seed", updatedAt: "2026-10-28 09:00:00.000",
    });
  }, 300_000);
  afterAll(async () => { await cleanup().catch(() => {}); await conn?.end(); });

  it("mesmo M1 ⇒ replay puro", async () => {
    const before = await row();
    await write("tplm1_A");
    expect(await row()).toEqual(before);
  });

  it("outro M1 com texto idêntico ⇒ vínculo muda, revisão anterior invalidada, troca auditada; conteúdo/autoria/ledger intactos", async () => {
    const before = await row();
    const editsBefore = await edits();
    expect(await events()).toHaveLength(0);
    await write("tplm1_B");
    const after = await row();
    expect(JSON.parse(after.sources ?? "[]")).toEqual(["origem:template", "tpl-m1:tplm1_B"]);
    expect(after.updatedAt).not.toBe(before.updatedAt);                 // o pin de revisão (id+hash+updatedAt) deixa de valer
    expect(after.correlationId).toBe("m8-relink-tplm1_B");
    const { sources: _s, updatedAt: _u, correlationId: _c, ...stable } = after;
    const { sources: _s0, updatedAt: _u0, correlationId: _c0, ...stableBefore } = before;
    expect(stable).toEqual(stableBefore);                               // conteúdo, autoria, último ator substantivo, status
    expect(await edits()).toBe(editsBefore);                            // nenhuma "edição" fictícia no ledger
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toContain("tplm1_A → tplm1_B");
    expect(ev[0].correlationId).toBe("m8-relink-tplm1_B");
  });

  it("documento com versão oficial emitida ⇒ recusa e nada muda (nunca um 'gerado' depois da emissão)", async () => {
    await (await getDb())!.insert(officialDocumentPromotionsTable).values({
      organizationId: ORG, processId: PID, officialDocumentId: "OD-M8-RELINK", lineageId: "LN-M8-RELINK", documentKind: "edital", version: 2,
      contentHash: "c".repeat(64), actorUserId: AUTHOR + 2, idempotencyKey: "m8-relink-promo",
    });
    const before = await row();
    await expect(write("tplm1_C")).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE:/) });
    expect(await row()).toEqual(before);
    // replay do M1 vigente continua sendo no-op (sem recusa e sem novo evento) mesmo após a emissão
    await write("tplm1_B");
    expect(await row()).toEqual(before);
    expect(await events()).toHaveLength(1);
  });

  it("isolamento: o rascunho de outro órgão não é tocado", async () => {
    expect(await row(ORG_OTHER)).toBeUndefined();
  });
});
