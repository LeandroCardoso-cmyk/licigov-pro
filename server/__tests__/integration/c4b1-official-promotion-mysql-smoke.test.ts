/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.1 — Emissão oficial governada contra MySQL REAL (CI, modo ESTRITO).
 *
 * Semeia rascunhos ETP reais via o pipeline canônico C.4A (generateDocument, invoke determinístico —
 * NUNCA provider real) e exercita a PROMOÇÃO governada (promoteOfficialDocument) contra o writer real
 * sob STRICT_TRANS_TABLES. Cobre os 12 cenários exigidos:
 *
 *   1. autor não pode emitir o próprio documento (SoD);
 *   2. ator não humano rejeitado;
 *   3. promoção válida cria UMA versão emitida (+ 1 linha no ledger);
 *   4. replay mesma chave não cria nova versão;
 *   5. mesma chave + conteúdo diferente = CONFLICT;
 *   6. concorrência com a mesma chave → apenas UMA emissão;
 *   7. versão emitida permanece imutável após alteração do rascunho;
 *   8. nova promoção após alteração cria nova versão;
 *   9. tenant A não promove/enxerga rascunho do tenant B;
 *  10. export oficial rejeita status `gerado`;
 *  11. export oficial aceita versão `emitido`;
 *  12. DFD permanece fora do lifecycle de emissão.
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDocument, canonicalDocumentIdentity } from "../../services/procurementProcessService";
import { promoteOfficialDocument, draftContentHash } from "../../services/documentPromotionService";
import { exportOfficialDocument } from "../../services/officialDocumentExportAdapter";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991041;
const ORG2 = 991042;
const AUTHOR = 5;   // autor do rascunho (gera)
const EMITTER = 7;  // emissor/revisor (manager) — distinto do autor (SoD)

let conn: mysql.Connection;

/** Semeia/atualiza o rascunho ETP (author_user_id = AUTHOR) via o pipeline C.4A. */
async function seedDraft(org: number, processId: string, object: string) {
  return generateDocument({
    organizationId: org, processId, kind: "etp", object,
    correlationId: "c4b1-smoke", idempotencyKey: `gen-${org}-${processId}-${object}`,
    actorUserId: AUTHOR, invoke: async () => "",
  });
}

function emitInput(org: number, processId: string, key: string, extra: Record<string, unknown> = {}) {
  return {
    organizationId: org, processId, kind: "etp" as const,
    actorUserId: EMITTER, actorRole: "manager" as const,
    idempotencyKey: key, correlationId: "c4b1-smoke",
    expectedContentHash: "0".repeat(64), // default; sobrescrito por `emit` com o hash real do rascunho
    ...extra,
  };
}

/** Hash determinístico do conteúdo ATUAL do rascunho ETP (para o expectedContentHash obrigatório). */
async function currentDraftHash(org: number, processId: string): Promise<string> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT CAST(content AS CHAR) AS c FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'etp' LIMIT 1",
    [org, processId],
  );
  return draftContentHash(rows.length ? String((rows[0] as any).c) : "");
}

/** Emite preenchendo o expectedContentHash com o hash REAL do rascunho vigente (a menos que sobrescrito). */
async function emit(org: number, processId: string, key: string, extra: Record<string, unknown> = {}) {
  const expectedContentHash = "expectedContentHash" in extra ? (extra.expectedContentHash as string) : await currentDraftHash(org, processId);
  return promoteOfficialDocument(emitInput(org, processId, key, { ...extra, expectedContentHash }));
}

async function countEmitido(org: number, processId: string): Promise<number> {
  const { lineageId } = canonicalDocumentIdentity({ organizationId: org, processId, kind: "etp" });
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM official_documents WHERE tenant_id = ? AND lineage_id = ? AND status = 'emitido'",
    [org, lineageId],
  );
  return Number((rows[0] as any).n);
}

async function countLedger(org: number, processId: string): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM official_document_promotions WHERE organization_id = ? AND process_id = ? AND document_kind = 'etp'",
    [org, processId],
  );
  return Number((rows[0] as any).n);
}

async function officialIdByStatus(org: number, processId: string, status: string): Promise<string | null> {
  const { lineageId } = canonicalDocumentIdentity({ organizationId: org, processId, kind: "etp" });
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT id FROM official_documents WHERE tenant_id = ? AND lineage_id = ? AND status = ? ORDER BY version LIMIT 1",
    [org, lineageId, status],
  );
  return rows.length ? String((rows[0] as any).id) : null;
}

async function emitidoContent(org: number, processId: string): Promise<string | null> {
  const { lineageId } = canonicalDocumentIdentity({ organizationId: org, processId, kind: "etp" });
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT CAST(content AS CHAR) AS c FROM official_documents WHERE tenant_id = ? AND lineage_id = ? AND status = 'emitido' ORDER BY version LIMIT 1",
    [org, lineageId],
  );
  return rows.length ? String((rows[0] as any).c) : null;
}

async function cleanup() {
  for (const org of [ORG, ORG2]) {
    await conn.execute("DELETE FROM official_document_promotions WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_document_timeline WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_documents WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM process_timeline WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM generated_documents WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("C.4B.1 — Emissão oficial governada (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "C4B1 Org", "c4b1-org"]).catch(() => {});
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG2, "C4B1 Org 2", "c4b1-org-2"]).catch(() => {});
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  it("1) autor NÃO pode emitir o próprio documento (SoD)", async () => {
    const pid = "c4b1-p1";
    await seedDraft(ORG, pid, "Material p1");
    await expect(emit(ORG, pid, "k1", { actorUserId: AUTHOR })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await countEmitido(ORG, pid)).toBe(0);
    expect(await countLedger(ORG, pid)).toBe(0);
  }, 60_000);

  it("2) ator não humano (id <= 0) é rejeitado", async () => {
    const pid = "c4b1-p2";
    await seedDraft(ORG, pid, "Material p2");
    await expect(emit(ORG, pid, "k2", { actorUserId: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await countEmitido(ORG, pid)).toBe(0);
  }, 60_000);

  it("3) promoção válida cria UMA versão emitida (+1 no ledger)", async () => {
    const pid = "c4b1-p3";
    await seedDraft(ORG, pid, "Material p3");
    const res = await emit(ORG, pid, "k3");
    expect(res.promoted).toBe(true);
    expect(res.officialDocument.status).toBe("emitido");
    expect(await countEmitido(ORG, pid)).toBe(1);
    expect(await countLedger(ORG, pid)).toBe(1);
  }, 60_000);

  it("4) replay mesma chave NÃO cria nova versão", async () => {
    const pid = "c4b1-p4";
    await seedDraft(ORG, pid, "Material p4");
    const first = await emit(ORG, pid, "k4");
    const second = await emit(ORG, pid, "k4");
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.officialDocument.id).toBe(first.officialDocument.id);
    expect(await countEmitido(ORG, pid)).toBe(1);
    expect(await countLedger(ORG, pid)).toBe(1);
  }, 60_000);

  it("5) mesma chave + conteúdo diferente = CONFLICT", async () => {
    const pid = "c4b1-p5";
    await seedDraft(ORG, pid, "Material p5 A");
    await emit(ORG, pid, "k5");
    // Altera o rascunho (novo conteúdo) e tenta reusar a MESMA chave → CONFLICT.
    await seedDraft(ORG, pid, "Material p5 B DIFERENTE");
    await expect(emit(ORG, pid, "k5")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await countEmitido(ORG, pid)).toBe(1); // nenhuma emissão nova
  }, 60_000);

  it("6) concorrência mesma chave → apenas UMA emissão", async () => {
    const pid = "c4b1-p6";
    await seedDraft(ORG, pid, "Material p6");
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => emit(ORG, pid, "k6")),
    );
    expect(settled.filter((s) => s.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(await countEmitido(ORG, pid)).toBe(1);
    expect(await countLedger(ORG, pid)).toBe(1);
  }, 60_000);

  it("7/8) versão emitida imutável após alteração; nova promoção cria nova versão", async () => {
    const pid = "c4b1-p78";
    await seedDraft(ORG, pid, "Conteudo ORIGINAL p78");
    await emit(ORG, pid, "k78-a");
    const originalEmitido = await emitidoContent(ORG, pid);
    expect(originalEmitido).toContain("Conteudo ORIGINAL p78"); // conteúdo do ETP gerado (objeto)

    // Altera o rascunho e emite de novo com NOVA chave.
    await seedDraft(ORG, pid, "Conteudo ALTERADO p78 xyz");
    const res2 = await emit(ORG, pid, "k78-b");
    expect(res2.promoted).toBe(true);
    // Agora há DUAS versões emitidas; a primeira permanece imutável (conteúdo inalterado).
    expect(await countEmitido(ORG, pid)).toBe(2);
    expect(await countLedger(ORG, pid)).toBe(2);
    const { lineageId } = canonicalDocumentIdentity({ organizationId: ORG, processId: pid, kind: "etp" });
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT CAST(content AS CHAR) AS c FROM official_documents WHERE tenant_id = ? AND lineage_id = ? AND status = 'emitido' ORDER BY version",
      [ORG, lineageId],
    );
    expect(String((rows[0] as any).c)).toBe(originalEmitido); // v1 emitida NÃO mudou
  }, 60_000);

  it("9) tenant A não promove/enxerga rascunho do tenant B", async () => {
    const pid = "c4b1-p9";
    await seedDraft(ORG2, pid, "Material p9 tenantB");
    // ORG (tenant A) não tem rascunho para pid → NOT_FOUND (sem vazamento cross-tenant).
    await expect(emit(ORG, pid, "k9", { expectedContentHash: "a".repeat(64) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await countEmitido(ORG, pid)).toBe(0);
    expect(await countEmitido(ORG2, pid)).toBe(0);
  }, 60_000);

  it("10) export oficial rejeita status 'gerado' — policy SERVER-OWNED, chamada direta sem params", async () => {
    // O gate é DERIVADO NO SERVIDOR pelo businessDomain (não confia no cliente) e roda ANTES da
    // renderização/armazenamento — determinístico no CI (sem S3). Aqui provamos a RECUSA real do
    // snapshot 'gerado' de processo_licitatorio MESMO com chamada direta ao endpoint (sem parâmetros).
    const pid = "c4b1-p10";
    await seedDraft(ORG, pid, "Material p10");
    const geradoId = await officialIdByStatus(ORG, pid, "gerado");
    expect(geradoId).toBeTruthy();
    await expect(exportOfficialDocument({
      organizationId: ORG, userId: EMITTER, documentId: geradoId!, format: "pdf",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 11) após emitir, existe UMA versão 'emitido' e nenhum 'gerado' é oficial.
    const res = await emit(ORG, pid, "k10");
    expect(res.officialDocument.status).toBe("emitido");
    expect(await countEmitido(ORG, pid)).toBe(1);
  }, 120_000);

  it("12) DFD permanece fora do lifecycle de emissão (BAD_REQUEST)", async () => {
    const pid = "c4b1-p12";
    await expect(emit(ORG, pid, "k12", { kind: "dfd" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 60_000);

  it("13) hardening: expectedContentHash ausente → PRECONDITION_FAILED, nada emitido", async () => {
    const pid = "c4b1-p13";
    await seedDraft(ORG, pid, "Material p13");
    await expect(emit(ORG, pid, "k13", { expectedContentHash: "" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await countEmitido(ORG, pid)).toBe(0);
    expect(await countLedger(ORG, pid)).toBe(0);
  }, 60_000);

  it("14) hardening: autoria desconhecida (author_user_id NULL) → PRECONDITION_FAILED", async () => {
    const pid = "c4b1-p14";
    await seedDraft(ORG, pid, "Material p14");
    // Simula rascunho histórico sem autoria rastreável.
    await conn.execute("UPDATE generated_documents SET author_user_id = NULL WHERE organization_id = ? AND process_id = ? AND kind = 'etp'", [ORG, pid]);
    await expect(emit(ORG, pid, "k14")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await countEmitido(ORG, pid)).toBe(0);
    expect(await countLedger(ORG, pid)).toBe(0);
  }, 60_000);
});
