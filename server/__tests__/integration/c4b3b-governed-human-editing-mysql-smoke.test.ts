/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.3B — Edição HUMANA governada de ETP/TR/Edital contra MySQL REAL (CI, modo ESTRITO).
 *
 * Prova, contra o writer real sob STRICT_TRANS_TABLES, o contrato de edição humana (saveReviewableDraft),
 * reusando a fundação C.4B.3A:
 *   1. ETP edit: originador preservado, editor = último ator substantivo, ledger human_edit com
 *      previous_content + prev/new hashes; correlação da EDIÇÃO no ledger, correlação da ORIGEM no draft;
 *   2. TR e Edital seguem o MESMO contrato;
 *   3. no-op (conteúdo idêntico) → sem ledger, sem mudar último ator;
 *   4. concorrência otimista: expectedContentHash obsoleto → CONFLICT (nada alterado);
 *   5. idempotência: mesma chave+payload → replay (response=persisted); chave+conteúdo diferente → CONFLICT;
 *   6. response/replay = estado persistido (originador preservado);
 *   7. SoD de 3 atores: originador (A) e editor (B) NÃO emitem; terceiro manager (C) emite;
 *   8. author NULL histórico permanece NULL após edição; emissão continua bloqueada;
 *   9. isolamento multi-tenant.
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDocument, generateNotice, saveReviewableDraft } from "../../services/procurementProcessService";
import { promoteOfficialDocument } from "../../services/documentPromotionService";
import { draftContentHash } from "../../domain/generatedDocument";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991091;
const ORG2 = 991092;
const A = 5;   // originador
const B = 9;   // editor humano
const C = 7;   // emissor (terceiro manager)

let conn: mysql.Connection;

async function seedEtp(org: number, pid: string, object: string, actor: number, correlationId = "c4b3b-seed") {
  return generateDocument({ organizationId: org, processId: pid, kind: "etp", object, correlationId, idempotencyKey: `gen-${org}-${pid}`, actorUserId: actor, invoke: async () => "" });
}
async function seedTr(org: number, pid: string, object: string, actor: number) {
  return generateDocument({ organizationId: org, processId: pid, kind: "tr", object, correlationId: "c4b3b-seed", idempotencyKey: `gen-tr-${org}-${pid}`, actorUserId: actor, invoke: async () => "" });
}
async function seedEdital(org: number, pid: string, object: string, actor: number) {
  return generateNotice({ organizationId: org, processId: pid, object, modality: "pregao", form: "eletronico", platform: "compras_gov", correlationId: "c4b3b-seed", idempotencyKey: `gen-ed-${org}-${pid}`, actorUserId: actor });
}

async function draftRow(org: number, pid: string, kind: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT CAST(content AS CHAR) AS c, author_user_id AS a, last_substantive_actor_user_id AS l, correlation_id AS corr FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = ? LIMIT 1",
    [org, pid, kind],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return { content: String(r.c), author: r.a as number | null, lastSubstantive: r.l as number | null, correlationId: String(r.corr) };
}
async function edits(org: number, pid: string, kind: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT actor_user_id AS actor, previous_content_hash AS ph, new_content_hash AS nh, CAST(previous_content AS CHAR) AS pc, operation AS op, correlation_id AS corr FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND kind = ? ORDER BY id",
    [org, pid, kind],
  );
  return rows.map((r: any) => ({ actor: r.actor as number, ph: String(r.ph), nh: String(r.nh), pc: r.pc == null ? null : String(r.pc), op: String(r.op), corr: String(r.corr) }));
}
async function timelineCount(org: number, pid: string, needle: string): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM process_timeline WHERE organization_id = ? AND process_id = ? AND summary LIKE ?",
    [org, pid, `%${needle}%`],
  );
  return Number((rows[0] as any).n);
}
function editArgs(org: number, pid: string, kind: "etp" | "tr" | "edital", content: string, actor: number, expectedContentHash: string, key: string, correlationId = "c4b3b-edit") {
  return { organizationId: org, processId: pid, kind, content, actorUserId: actor, expectedContentHash, idempotencyKey: key, correlationId };
}
function emitInput(org: number, pid: string, kind: "etp" | "tr" | "edital", actor: number, key: string, expectedContentHash: string) {
  return { organizationId: org, processId: pid, kind, actorUserId: actor, actorRole: "manager" as const, idempotencyKey: key, correlationId: "c4b3b-emit", expectedContentHash };
}

async function cleanup() {
  for (const org of [ORG, ORG2]) {
    await conn.execute("DELETE FROM generated_document_edits WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_document_promotions WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_document_timeline WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_documents WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM process_timeline WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM generated_documents WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("C.4B.3B — edição humana governada (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "C4B3B Org", "c4b3b-org"]).catch(() => {});
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG2, "C4B3B Org 2", "c4b3b-org-2"]).catch(() => {});
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  it("1) ETP edit: originador preservado, editor = último ator, ledger human_edit (previous_content + hashes + correlações)", async () => {
    const pid = "c4b3b-etp";
    const seeded = await seedEtp(ORG, pid, "Objeto ETP", A, "origin-corr");
    const before = await draftRow(ORG, pid, "etp");
    const edited = "# ETP editado por humano\nrevisado.";
    const res = await saveReviewableDraft(editArgs(ORG, pid, "etp", edited, B, draftContentHash(before!.content), `edit-${pid}`, "edit-corr"));

    expect(res.replayed).toBe(false);
    expect(res.document.authorUserId).toBe(A);                 // originador preservado (response = persisted)
    expect(res.document.lastSubstantiveActorUserId).toBe(B);
    expect(res.document.content).toBe(edited);

    const row = await draftRow(ORG, pid, "etp");
    expect(row!.author).toBe(A);
    expect(row!.lastSubstantive).toBe(B);
    expect(row!.content).toBe(edited);
    expect(row!.correlationId).toBe("origin-corr");            // correlação da ORIGEM preservada no draft

    const led = await edits(ORG, pid, "etp");
    expect(led.length).toBe(1);
    expect(led[0].op).toBe("human_edit");
    expect(led[0].actor).toBe(B);
    expect(led[0].pc).toBe(seeded.document.content);           // previous_content EXATO
    expect(led[0].ph).toBe(draftContentHash(seeded.document.content));
    expect(led[0].nh).toBe(draftContentHash(edited));
    expect(led[0].corr).toBe("edit-corr");                     // correlação da EDIÇÃO no ledger
  }, 60_000);

  it("2) TR e Edital seguem o MESMO contrato de edição humana", async () => {
    const tpid = "c4b3b-tr";
    await seedTr(ORG, tpid, "Objeto TR", A);
    const tb = await draftRow(ORG, tpid, "tr");
    await saveReviewableDraft(editArgs(ORG, tpid, "tr", "# TR editado\nx", B, draftContentHash(tb!.content), `edit-${tpid}`));
    const tr = await draftRow(ORG, tpid, "tr");
    expect(tr!.author).toBe(A); expect(tr!.lastSubstantive).toBe(B);
    expect((await edits(ORG, tpid, "tr"))[0].op).toBe("human_edit");

    const epid = "c4b3b-ed";
    await seedEdital(ORG, epid, "Objeto Edital", A);
    const eb = await draftRow(ORG, epid, "edital");
    await saveReviewableDraft(editArgs(ORG, epid, "edital", "# Edital editado\ny", B, draftContentHash(eb!.content), `edit-${epid}`));
    const ed = await draftRow(ORG, epid, "edital");
    expect(ed!.author).toBe(A); expect(ed!.lastSubstantive).toBe(B);
    expect((await edits(ORG, epid, "edital"))[0].op).toBe("human_edit");
  }, 120_000);

  it("3) no-op: conteúdo idêntico → sem ledger, sem mudar último ator", async () => {
    const pid = "c4b3b-noop";
    await seedEtp(ORG, pid, "Objeto noop", A);
    const before = await draftRow(ORG, pid, "etp");
    await saveReviewableDraft(editArgs(ORG, pid, "etp", before!.content, B, draftContentHash(before!.content), `edit-${pid}`));
    const row = await draftRow(ORG, pid, "etp");
    expect(row!.lastSubstantive).toBe(A);                      // não mudou para B
    expect((await edits(ORG, pid, "etp")).length).toBe(0);
  }, 60_000);

  it("4) concorrência otimista: expectedContentHash obsoleto → CONFLICT (nada alterado)", async () => {
    const pid = "c4b3b-stale";
    await seedEtp(ORG, pid, "Objeto stale", A);
    const before = await draftRow(ORG, pid, "etp");
    await expect(saveReviewableDraft(editArgs(ORG, pid, "etp", "novo", B, "f".repeat(64), `edit-${pid}`)))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const row = await draftRow(ORG, pid, "etp");
    expect(row!.content).toBe(before!.content);
    expect(row!.lastSubstantive).toBe(A);
    expect((await edits(ORG, pid, "etp")).length).toBe(0);
  }, 60_000);

  it("5) idempotência: mesma chave+payload → replay (response=persisted); chave+conteúdo diferente → CONFLICT", async () => {
    const pid = "c4b3b-idem";
    await seedEtp(ORG, pid, "Objeto idem", A);
    const before = await draftRow(ORG, pid, "etp");
    const args = editArgs(ORG, pid, "etp", "# ETP idem\nx", B, draftContentHash(before!.content), `idem-${pid}`);
    const first = await saveReviewableDraft(args);
    const second = await saveReviewableDraft(args);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.document.authorUserId).toBe(A);             // replay response = estado persistido
    expect((await edits(ORG, pid, "etp")).length).toBe(1);    // UMA linha de ledger
    await expect(saveReviewableDraft({ ...args, content: "conteúdo diferente" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  }, 60_000);

  it("7) SoD de 3 atores: originador (A) e editor (B) NÃO emitem; terceiro manager (C) emite", async () => {
    const pid = "c4b3b-sod";
    await seedEtp(ORG, pid, "Objeto SoD", A);
    const before = await draftRow(ORG, pid, "etp");
    await saveReviewableDraft(editArgs(ORG, pid, "etp", "# ETP revisado SoD\nx", B, draftContentHash(before!.content), `edit-${pid}`));
    const row = await draftRow(ORG, pid, "etp");
    const h = draftContentHash(row!.content);

    await expect(promoteOfficialDocument(emitInput(ORG, pid, "etp", A, "emit-A", h))).rejects.toMatchObject({ code: "FORBIDDEN" }); // originador
    await expect(promoteOfficialDocument(emitInput(ORG, pid, "etp", B, "emit-B", h))).rejects.toMatchObject({ code: "FORBIDDEN" }); // editor
    const res = await promoteOfficialDocument(emitInput(ORG, pid, "etp", C, "emit-C", h));
    expect(res.promoted).toBe(true);
    expect(res.officialDocument.status).toBe("emitido");
  }, 120_000);

  it("8) author NULL histórico permanece NULL após edição humana; emissão continua bloqueada", async () => {
    const pid = "c4b3b-null";
    await seedEtp(ORG, pid, "Objeto null", A);
    await conn.execute("UPDATE generated_documents SET author_user_id = NULL, last_substantive_actor_user_id = NULL WHERE organization_id = ? AND process_id = ? AND kind = 'etp'", [ORG, pid]);
    const before = await draftRow(ORG, pid, "etp");
    await saveReviewableDraft(editArgs(ORG, pid, "etp", "# ETP editado null\nz", B, draftContentHash(before!.content), `edit-${pid}`));
    const row = await draftRow(ORG, pid, "etp");
    expect(row!.author).toBeNull();                            // NÃO inventa originador
    expect(row!.lastSubstantive).toBe(B);
    await expect(promoteOfficialDocument(emitInput(ORG, pid, "etp", C, "emit-null", draftContentHash(row!.content))))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }, 60_000);

  it("9) isolamento multi-tenant: tenant A não edita o rascunho do tenant B (NOT_FOUND)", async () => {
    const pid = "c4b3b-x";
    await seedEtp(ORG2, pid, "Objeto tenantB", A);
    const b = await draftRow(ORG2, pid, "etp");
    // ORG (tenant A) não tem rascunho para pid → NOT_FOUND (sem vazamento/edição cross-tenant).
    await expect(saveReviewableDraft(editArgs(ORG, pid, "etp", "invasao", B, draftContentHash(b!.content), `edit-x-${pid}`)))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await draftRow(ORG2, pid, "etp"))!.content).toBe(b!.content); // rascunho de B intacto
  }, 60_000);

  it("10) human_edit é CONTENT-ONLY: editar Edital só muda content — metadata preservada (draft/response/replay)", async () => {
    const pid = "c4b3b-content-only";
    await seedEdital(ORG, pid, "Objeto Edital CO", A);
    const [m0] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT title, status, CAST(sources AS CHAR) AS s, modality, form, platform, CAST(legal_justification AS CHAR) AS lj, correlation_id AS corr, author_user_id AS a FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital' LIMIT 1", [ORG, pid],
    );
    const meta0 = m0[0] as any;
    const before = await draftRow(ORG, pid, "edital");

    const edited = "# Edital EDITADO só no conteúdo\nrevisado por humano.";
    const res = await saveReviewableDraft(editArgs(ORG, pid, "edital", edited, B, draftContentHash(before!.content), `edit-${pid}`));

    const [m1] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT title, status, CAST(sources AS CHAR) AS s, modality, form, platform, CAST(legal_justification AS CHAR) AS lj, correlation_id AS corr, author_user_id AS a, CAST(content AS CHAR) AS c FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital' LIMIT 1", [ORG, pid],
    );
    const meta1 = m1[0] as any;
    // Metadata NÃO editada permanece EXATA.
    expect(meta1.title).toBe(meta0.title);
    expect(meta1.status).toBe(meta0.status);
    expect(String(meta1.s)).toBe(String(meta0.s));           // sources
    expect(meta1.modality).toBe(meta0.modality);
    expect(meta1.form).toBe(meta0.form);
    expect(meta1.platform).toBe(meta0.platform);
    expect(String(meta1.lj)).toBe(String(meta0.lj));         // legal_justification
    expect(meta1.corr).toBe(meta0.corr);                     // correlação da origem
    expect(meta1.a).toBe(meta0.a);                           // originador
    expect(String(meta1.c)).toBe(edited);                    // só o content mudou

    // Response e replay refletem a metadata preservada + conteúdo novo.
    expect(res.document.title).toBe(String(meta0.title));
    expect(res.document.modality).toBe(meta0.modality);
    expect(res.document.form).toBe(meta0.form);
    expect(res.document.platform).toBe(meta0.platform);
    expect(res.document.authorUserId).toBe(A);
    expect(res.document.content).toBe(edited);
    const replay = await saveReviewableDraft(editArgs(ORG, pid, "edital", edited, B, draftContentHash(before!.content), `edit-${pid}`));
    expect(replay.replayed).toBe(true);
    expect(replay.document.title).toBe(String(meta0.title));
    expect(replay.document.modality).toBe(meta0.modality);
    expect(replay.document.authorUserId).toBe(A);
    expect(replay.document.content).toBe(edited);
  }, 120_000);

  it("11) ETP/TR não perdem sources ao editar o conteúdo (content-only)", async () => {
    for (const kind of ["etp", "tr"] as const) {
      const pid = `c4b3b-src-${kind}`;
      if (kind === "etp") await seedEtp(ORG, pid, "Objeto src", A); else await seedTr(ORG, pid, "Objeto src", A);
      const [s0] = await conn.execute<mysql.RowDataPacket[]>(
        "SELECT CAST(sources AS CHAR) AS s FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = ? LIMIT 1", [ORG, pid, kind],
      );
      const before = await draftRow(ORG, pid, kind);
      await saveReviewableDraft(editArgs(ORG, pid, kind, `# ${kind} editado\nx`, B, draftContentHash(before!.content), `edit-src-${kind}`));
      const [s1] = await conn.execute<mysql.RowDataPacket[]>(
        "SELECT CAST(sources AS CHAR) AS s FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = ? LIMIT 1", [ORG, pid, kind],
      );
      expect(String((s1[0] as any).s)).toBe(String((s0[0] as any).s)); // sources preservadas
    }
  }, 120_000);

  it("12) no-op: conteúdo idêntico → sem ledger, sem mudar último ator, SEM evento de timeline 'editado', replay seguro", async () => {
    const pid = "c4b3b-noop-tl";
    await seedEtp(ORG, pid, "Objeto noop tl", A);
    const before = await draftRow(ORG, pid, "etp");
    const tlBefore = await timelineCount(ORG, pid, "editado");
    const editsBefore = (await edits(ORG, pid, "etp")).length;

    const res = await saveReviewableDraft(editArgs(ORG, pid, "etp", before!.content, B, draftContentHash(before!.content), `noop-${pid}`));
    expect(res.replayed).toBe(false);
    expect(res.document.authorUserId).toBe(A);
    expect(res.document.lastSubstantiveActorUserId).toBe(A);   // no-op não muda último ator

    const row = await draftRow(ORG, pid, "etp");
    expect(row!.lastSubstantive).toBe(A);
    expect((await edits(ORG, pid, "etp")).length).toBe(editsBefore);           // sem ledger
    expect(await timelineCount(ORG, pid, "editado")).toBe(tlBefore);           // sem timeline "editado"

    // Replay seguro (mesma chave+payload).
    const replay = await saveReviewableDraft(editArgs(ORG, pid, "etp", before!.content, B, draftContentHash(before!.content), `noop-${pid}`));
    expect(replay.replayed).toBe(true);
    expect((await edits(ORG, pid, "etp")).length).toBe(editsBefore);
    expect(await timelineCount(ORG, pid, "editado")).toBe(tlBefore);
  }, 60_000);
});
