/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.3A — Fundação de PROVENIÊNCIA do rascunho contra MySQL REAL (CI, modo ESTRITO).
 *
 * Prova, contra o writer real sob STRICT_TRANS_TABLES, o contrato de proveniência/edição governada:
 *   1. 1ª geração define originador (author) e último ator substantivo = criador;
 *   2. regeneração pelo MESMO usuário preserva o originador;
 *   3. regeneração por OUTRO usuário preserva o originador e define último ator substantivo = solicitante;
 *   4. regeneração grava ledger append-only (operation=ai_regenerate) com previous_content + prev/new hash;
 *   5. no-op (conteúdo idêntico) NÃO cria ledger nem muda o último ator;
 *   6. save DFD governado preserva originador, registra usuário real, cria ledger (dfd_manual_edit);
 *   7. concorrência otimista: expectedContentHash obsoleto → CONFLICT (nada alterado, sem ledger);
 *   8. idempotência: mesma chave+payload → replay (sem novo ledger); chave+conteúdo diferente → CONFLICT;
 *   9. SoD de 3 atores: originador e último ator substantivo NÃO emitem; terceiro manager emite;
 *  10. author NULL histórico permanece NULL após edição; emissão continua bloqueada;
 *  11. isolamento multi-tenant.
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDocument, saveDFDDraft, generateDFDDraft } from "../../services/procurementProcessService";
import { promoteOfficialDocument } from "../../services/documentPromotionService";
import { draftContentHash } from "../../domain/generatedDocument";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991081;
const ORG2 = 991082;
const A = 5;   // originador
const B = 9;   // último ator substantivo (edita/regenera)
const C = 7;   // emissor (terceiro manager)

let conn: mysql.Connection;

async function seedEtp(org: number, pid: string, object: string, actor: number) {
  return generateDocument({
    organizationId: org, processId: pid, kind: "etp", object,
    correlationId: "c4b3a-smoke", idempotencyKey: `gen-${org}-${pid}-${object}-${actor}`,
    actorUserId: actor, invoke: async () => "",
  });
}

async function draftRow(org: number, pid: string, kind = "etp") {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT CAST(content AS CHAR) AS c, author_user_id AS a, last_substantive_actor_user_id AS l FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = ? LIMIT 1",
    [org, pid, kind],
  );
  if (rows.length === 0) return null;
  return { content: String((rows[0] as any).c), author: (rows[0] as any).a as number | null, lastSubstantive: (rows[0] as any).l as number | null };
}

async function edits(org: number, pid: string, kind = "etp") {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT actor_user_id AS actor, previous_content_hash AS ph, new_content_hash AS nh, CAST(previous_content AS CHAR) AS pc, operation AS op FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND kind = ? ORDER BY id",
    [org, pid, kind],
  );
  return rows.map((r: any) => ({ actor: r.actor as number, ph: String(r.ph), nh: String(r.nh), pc: r.pc == null ? null : String(r.pc), op: String(r.op) }));
}

function emitInput(org: number, pid: string, actor: number, key: string, expectedContentHash: string) {
  return {
    organizationId: org, processId: pid, kind: "etp" as const,
    actorUserId: actor, actorRole: "manager" as const,
    idempotencyKey: key, correlationId: "c4b3a-smoke", expectedContentHash,
  };
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

describe.skipIf(!DB)("C.4B.3A — proveniência do rascunho (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "C4B3A Org", "c4b3a-org"]).catch(() => {});
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG2, "C4B3A Org 2", "c4b3a-org-2"]).catch(() => {});
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  it("1/2) 1ª geração define originador+último ator; regeneração pelo MESMO usuário preserva originador", async () => {
    const pid = "c4b3a-p1";
    await seedEtp(ORG, pid, "Objeto A", A);
    let row = await draftRow(ORG, pid);
    expect(row!.author).toBe(A);
    expect(row!.lastSubstantive).toBe(A);

    // Regeneração pelo MESMO usuário, conteúdo diferente (objeto diferente) → author preservado.
    await seedEtp(ORG, pid, "Objeto A v2 diferente", A);
    row = await draftRow(ORG, pid);
    expect(row!.author).toBe(A);
    expect(row!.lastSubstantive).toBe(A);
  }, 60_000);

  it("3/4) regeneração por OUTRO usuário preserva originador, último ator = solicitante, ledger ai_regenerate", async () => {
    const pid = "c4b3a-p2";
    const first = await seedEtp(ORG, pid, "Objeto base", A);
    const firstContent = first.document.content;

    await seedEtp(ORG, pid, "Objeto REGENERADO por B", B);
    const row = await draftRow(ORG, pid);
    expect(row!.author).toBe(A);          // originador PRESERVADO
    expect(row!.lastSubstantive).toBe(B); // último ator substantivo = solicitante

    const led = await edits(ORG, pid);
    expect(led.length).toBe(1);
    expect(led[0].op).toBe("ai_regenerate");
    expect(led[0].actor).toBe(B);
    expect(led[0].pc).toBe(firstContent);                       // previous_content = conteúdo anterior EXATO
    expect(led[0].ph).toBe(draftContentHash(firstContent));     // hash anterior
    expect(led[0].nh).toBe(draftContentHash(row!.content));     // hash novo (working copy vigente)
    expect(led[0].nh).not.toBe(led[0].ph);
  }, 60_000);

  it("5) no-op: regeneração com conteúdo IDÊNTICO não cria ledger nem muda último ator", async () => {
    const pid = "c4b3a-p3";
    await seedEtp(ORG, pid, "Objeto estável", A);           // author=A, lastSubst=A, sem ledger (criação)
    await seedEtp(ORG, pid, "Objeto estável", B);           // MESMO objeto → conteúdo idêntico → no-op
    const row = await draftRow(ORG, pid);
    expect(row!.author).toBe(A);
    expect(row!.lastSubstantive).toBe(A);                   // NÃO mudou para B (no-op)
    expect((await edits(ORG, pid)).length).toBe(0);         // nenhum ledger
  }, 60_000);

  it("6) save DFD governado: preserva originador, último ator = editor, ledger dfd_manual_edit + previous_content", async () => {
    const pid = "c4b3a-dfd";
    await generateDFDDraft({ organizationId: ORG, processId: pid, object: "Objeto DFD", correlationId: "c4b3a-smoke", idempotencyKey: `dfd-gen-${pid}`, actorUserId: A });
    const before = await draftRow(ORG, pid, "dfd");
    expect(before!.author).toBe(A);

    const edited = "# DFD editado manualmente\nRevisado pelo servidor B.";
    await saveDFDDraft({
      organizationId: ORG, processId: pid, object: "Objeto DFD", content: edited,
      actorUserId: B, expectedContentHash: draftContentHash(before!.content), idempotencyKey: `dfd-save-${pid}`, correlationId: "c4b3a-smoke",
    });
    const after = await draftRow(ORG, pid, "dfd");
    expect(after!.author).toBe(A);            // originador PRESERVADO (não vira B)
    expect(after!.lastSubstantive).toBe(B);   // último ator substantivo = editor
    expect(after!.content).toBe(edited);

    const led = await edits(ORG, pid, "dfd");
    expect(led.length).toBe(1);
    expect(led[0].op).toBe("dfd_manual_edit");
    expect(led[0].actor).toBe(B);
    expect(led[0].pc).toBe(before!.content);  // previous_content = template anterior

    // Timeline registra o USUÁRIO real (não o organizationId).
    const [tl] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT actor FROM process_timeline WHERE organization_id = ? AND process_id = ? AND summary LIKE 'DFD salvo%' ORDER BY id DESC LIMIT 1",
      [ORG, pid],
    );
    expect(String((tl[0] as any).actor)).toBe(String(B));
  }, 60_000);

  it("7) concorrência otimista: expectedContentHash obsoleto → CONFLICT (nada alterado, sem ledger)", async () => {
    const pid = "c4b3a-dfd2";
    await generateDFDDraft({ organizationId: ORG, processId: pid, object: "Objeto DFD2", correlationId: "c4b3a-smoke", idempotencyKey: `dfd-gen-${pid}`, actorUserId: A });
    const before = await draftRow(ORG, pid, "dfd");

    await expect(saveDFDDraft({
      organizationId: ORG, processId: pid, object: "Objeto DFD2", content: "conteúdo novo",
      actorUserId: B, expectedContentHash: "f".repeat(64), idempotencyKey: `dfd-save-stale-${pid}`, correlationId: "c4b3a-smoke",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const after = await draftRow(ORG, pid, "dfd");
    expect(after!.content).toBe(before!.content);   // inalterado
    expect(after!.lastSubstantive).toBe(A);         // não mudou
    expect((await edits(ORG, pid, "dfd")).length).toBe(0);
  }, 60_000);

  it("8) idempotência do save: mesma chave+payload → replay (sem novo ledger); chave+conteúdo diferente → CONFLICT", async () => {
    const pid = "c4b3a-dfd3";
    await generateDFDDraft({ organizationId: ORG, processId: pid, object: "Objeto DFD3", correlationId: "c4b3a-smoke", idempotencyKey: `dfd-gen-${pid}`, actorUserId: A });
    const before = await draftRow(ORG, pid, "dfd");
    const edited = "# DFD v-idem\nconteúdo.";
    const args = {
      organizationId: ORG, processId: pid, object: "Objeto DFD3", content: edited,
      actorUserId: B, expectedContentHash: draftContentHash(before!.content), idempotencyKey: `dfd-idem-${pid}`, correlationId: "c4b3a-smoke",
    };
    const first = await saveDFDDraft(args);
    const second = await saveDFDDraft(args); // mesma chave + mesmo payload → replay
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect((await edits(ORG, pid, "dfd")).length).toBe(1); // UMA linha de ledger

    // Mesma chave + conteúdo DIFERENTE → CONFLICT (payload mismatch).
    await expect(saveDFDDraft({ ...args, content: "conteúdo TOTALMENTE diferente" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  }, 60_000);

  it("9) SoD 3 atores: originador (A) e último ator substantivo (B) NÃO emitem; terceiro manager (C) emite", async () => {
    const pid = "c4b3a-sod";
    await seedEtp(ORG, pid, "Objeto SoD", A);          // author=A, lastSubst=A
    await seedEtp(ORG, pid, "Objeto SoD v2 (B)", B);   // author=A, lastSubst=B
    const row = await draftRow(ORG, pid);
    const h = draftContentHash(row!.content);

    await expect(promoteOfficialDocument(emitInput(ORG, pid, A, "emit-A", h))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(promoteOfficialDocument(emitInput(ORG, pid, B, "emit-B", h))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const res = await promoteOfficialDocument(emitInput(ORG, pid, C, "emit-C", h));
    expect(res.promoted).toBe(true);
    expect(res.officialDocument.status).toBe("emitido");
  }, 120_000);

  it("10) author NULL histórico permanece NULL após edição; emissão continua bloqueada", async () => {
    const pid = "c4b3a-null";
    await seedEtp(ORG, pid, "Objeto null", A);
    // Simula rascunho histórico sem originador rastreável.
    await conn.execute("UPDATE generated_documents SET author_user_id = NULL, last_substantive_actor_user_id = NULL WHERE organization_id = ? AND process_id = ? AND kind = 'etp'", [ORG, pid]);

    // Regeneração por B: NÃO inventa originador (permanece NULL); último ator = B.
    await seedEtp(ORG, pid, "Objeto null REGEN", B);
    const row = await draftRow(ORG, pid);
    expect(row!.author).toBeNull();
    expect(row!.lastSubstantive).toBe(B);

    // Emissão continua bloqueada (sem originador rastreável).
    await expect(promoteOfficialDocument(emitInput(ORG, pid, C, "emit-null", draftContentHash(row!.content))))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }, 60_000);

  it("11) isolamento multi-tenant: tenant A não enxerga/edita o rascunho do tenant B", async () => {
    const pid = "c4b3a-x";
    await seedEtp(ORG2, pid, "Objeto tenantB", A);
    expect(await draftRow(ORG, pid)).toBeNull();               // ORG não vê o rascunho de ORG2
    expect((await draftRow(ORG2, pid))!.author).toBe(A);        // ORG2 (dono) vê o seu
  }, 60_000);
});
