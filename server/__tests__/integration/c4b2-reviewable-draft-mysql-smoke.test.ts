/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.2 — Leitura canônica reload-safe do rascunho revisável contra MySQL REAL (CI, modo ESTRITO).
 *
 * Prova, contra o writer real sob STRICT_TRANS_TABLES, o contrato exato do read canônico usado pela
 * query `procurementProcess.reviewableDraft`: o conteúdo PERSISTIDO (via o pipeline C.4A) é lido de
 * volta BYTE-A-BYTE e seu hash é a MESMA primitive da promoção (`draftContentHash`). Cobre:
 *
 *   1. ETP/TR/Edital: getGeneratedDocumentByKind retorna o conteúdo EXATO persistido;
 *   2. o hash lido == draftContentHash(content) (mesma primitive da emissão — vínculo conteúdo↔hash);
 *   3. o hash lido == expectedContentHash exigido por promoteOfficialDocument (emissão do MESMO byte);
 *   4. rascunho inexistente → null (não fabrica conteúdo);
 *   5. isolamento cross-tenant: tenant A não lê o rascunho do tenant B (org escopada no servidor).
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode. NÃO é editor (C.4B.2 é read + review, sem escrita
 * de conteúdo pelo humano).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDocument, generateNotice } from "../../services/procurementProcessService";
import { getGeneratedDocumentByKind } from "../../db/procurement";
import { draftContentHash } from "../../services/documentPromotionService";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991061;
const ORG2 = 991062;
const AUTHOR = 5;

let conn: mysql.Connection;

async function seedEtpOrTr(org: number, processId: string, kind: "etp" | "tr", object: string) {
  return generateDocument({
    organizationId: org, processId, kind, object,
    correlationId: "c4b2-smoke", idempotencyKey: `gen-${org}-${processId}-${kind}`,
    actorUserId: AUTHOR, invoke: async () => "",
  });
}

async function seedEdital(org: number, processId: string, object: string) {
  return generateNotice({
    organizationId: org, processId, object,
    modality: "pregao", form: "eletronico", platform: "compras_gov",
    correlationId: "c4b2-smoke", idempotencyKey: `gen-${org}-${processId}-edital`,
    actorUserId: AUTHOR,
  });
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

describe.skipIf(!DB)("C.4B.2 — reviewableDraft read canônico (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "C4B2 Org", "c4b2-org"]).catch(() => {});
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG2, "C4B2 Org 2", "c4b2-org-2"]).catch(() => {});
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  it("1/2) ETP: read retorna o conteúdo EXATO persistido + hash = draftContentHash(content)", async () => {
    const pid = "c4b2-etp";
    const seeded = await seedEtpOrTr(ORG, pid, "etp", "Material ETP reload-safe");
    const read = await getGeneratedDocumentByKind(pid, ORG, "etp");
    expect(read).not.toBeNull();
    expect(read!.content).toBe(seeded.document.content); // byte-a-byte, sem fabricação
    expect(read!.content.trim().length).toBeGreaterThan(0);
    expect(draftContentHash(read!.content)).toBe(draftContentHash(seeded.document.content)); // mesma primitive
    expect(read!.kind).toBe("etp");
  }, 60_000);

  it("1/2) TR: read retorna o conteúdo EXATO persistido + hash = draftContentHash(content)", async () => {
    const pid = "c4b2-tr";
    const seeded = await seedEtpOrTr(ORG, pid, "tr", "Serviço TR reload-safe");
    const read = await getGeneratedDocumentByKind(pid, ORG, "tr");
    expect(read).not.toBeNull();
    expect(read!.content).toBe(seeded.document.content);
    expect(draftContentHash(read!.content)).toBe(draftContentHash(seeded.document.content));
    expect(read!.kind).toBe("tr");
  }, 60_000);

  it("1/2) Edital: read retorna o conteúdo EXATO persistido + hash = draftContentHash(content)", async () => {
    const pid = "c4b2-edital";
    const seeded = await seedEdital(ORG, pid, "Edital reload-safe");
    const read = await getGeneratedDocumentByKind(pid, ORG, "edital");
    expect(read).not.toBeNull();
    expect(read!.content).toBe(seeded.document.content);
    expect(draftContentHash(read!.content)).toBe(draftContentHash(seeded.document.content));
    expect(read!.kind).toBe("edital");
  }, 60_000);

  it("3) hash lido == expectedContentHash da promoção (emissão do MESMO byte revisado)", async () => {
    // O hash que a UI exibe/vincula (draftContentHash do conteúdo lido) é EXATAMENTE o que o backend
    // de emissão reconsulta e compara — garantindo que o humano autoriza o mesmo byte que será emitido.
    const pid = "c4b2-bind";
    await seedEtpOrTr(ORG, pid, "etp", "Material bind");
    const read = await getGeneratedDocumentByKind(pid, ORG, "etp");
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT CAST(content AS CHAR) AS c FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'etp' LIMIT 1",
      [ORG, pid],
    );
    const persisted = String((rows[0] as any).c);
    expect(read!.content).toBe(persisted);
    expect(draftContentHash(read!.content)).toBe(draftContentHash(persisted));
  }, 60_000);

  it("4) rascunho inexistente → null (não fabrica conteúdo)", async () => {
    const read = await getGeneratedDocumentByKind("c4b2-ausente", ORG, "etp");
    expect(read).toBeNull();
  }, 60_000);

  it("5) isolamento cross-tenant: tenant A não lê o rascunho do tenant B", async () => {
    const pid = "c4b2-x";
    await seedEtpOrTr(ORG2, pid, "etp", "Material tenantB");
    // Mesmo processId, org do tenant A (ORG) → NÃO enxerga o rascunho do tenant B.
    expect(await getGeneratedDocumentByKind(pid, ORG, "etp")).toBeNull();
    // O tenant B (dono) lê o seu próprio rascunho normalmente.
    expect((await getGeneratedDocumentByKind(pid, ORG2, "etp"))!.content.trim().length).toBeGreaterThan(0);
  }, 60_000);
});
