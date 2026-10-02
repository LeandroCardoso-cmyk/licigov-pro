/**
 * R7 / PR-16 (SEM-020) — documento obrigatório da Contratação Direta exige evidência REAL. MySQL 8, dados sintéticos
 * (órgãos 960851/960852). O Storage Service (S3) é substituído por memória — mesmo contrato (`storagePut`/`storageDelete`).
 *
 *   D1. validar sem anexo ⇒ PRECONDITION_FAILED REQUIRED_DOCUMENT_ATTACHMENT_REQUIRED, zero escrita;
 *   D2. "anexado" pelo checklist (sem upload) ⇒ REQUIRED_DOCUMENT_UPLOAD_REQUIRED; referência do cliente ignorada;
 *   D3. linha LEGADA `s3://anexo` (sem hash) não valida;
 *   D4. upload real: chave `contratacao_direta/{ws}/…`, SHA-256 confere, autor registrado; então valida (validador registrado);
 *   D5. arquivo inválido (MIME/magic-bytes) ⇒ BAD_REQUEST, nenhum objeto gravado;
 *   D6. outro órgão ⇒ NOT_FOUND antes de qualquer upload;
 *   D7. migration 0314: reaplicar à mão é no-op (colunas e dados intactos).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const mem = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", () => ({
  assertStorageUsable: () => undefined,
  storagePut: async (key: string, data: Buffer) => { mem.set(key, Buffer.from(data)); return { key, url: `mem://${key}` }; },
  storageDelete: async (key: string) => ({ key, deleted: mem.delete(key) }),
}));

import { runMigrations } from "../../bootstrap";
import { createDirectProcurementWorkspace } from "../../domain/directProcurementWorkspace";
import { insertDirectProcurementWorkspace, listRequiredDocuments } from "../../db/directProcurement";
import { attachRequiredDocument, seedRequiredDocuments, setRequiredDocumentStatus } from "../../services/directProcurementService";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 960851;
const ORG_B = 960852;
const ACTOR = 51;
const VALIDATOR = 52;
const CORR = "pr16-smoke";
const RUN = Date.now().toString(36);
const PDF = Buffer.from("%PDF-1.4\n% sintético PR-16\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n", "latin1");

let conn: mysql.Connection;

async function rows(org: number) {
  const [r] = await conn.query("SELECT id, status, document_reference, content_hash, size_bytes, mime_type, attached_by, validated_by FROM required_documents WHERE organization_id = ? ORDER BY id", [org]);
  return r as Array<Record<string, unknown>>;
}
async function errOf(fn: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await fn(); } catch (e) { return e as { code?: string; message: string }; }
  throw new Error("esperava erro");
}
async function seed(n: string) {
  const ws = createDirectProcurementWorkspace({
    organizationId: ORG, processNumber: `SINT-PR16/${RUN}/${n}`, object: "Aquisição sintética PR-16",
    procurementType: "dispensa", startOption: "sem_dfd", responsibleUser: ACTOR, correlationId: CORR,
  });
  await insertDirectProcurementWorkspace(ws);
  const docs = await seedRequiredDocuments({ workspaceId: ws.id, organizationId: ORG, correlationId: CORR });
  return { ws, doc: docs[0]! };
}

describe.skipIf(!DB)("PR-16 — evidência documental real (MySQL 8)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    for (const id of [ORG, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `PR16 ${id}`, `pr16-${id}`]);
    }
    for (const t of ["required_documents", "process_timeline", "direct_procurement_workspaces"]) {
      await conn.execute(`DELETE FROM ${t} WHERE organization_id IN (?, ?)`, [ORG, ORG_B]);
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    for (const t of ["required_documents", "process_timeline", "direct_procurement_workspaces"]) {
      await conn.execute(`DELETE FROM ${t} WHERE organization_id IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
    }
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("D1) validar sem anexo ⇒ REQUIRED_DOCUMENT_ATTACHMENT_REQUIRED, zero escrita", async () => {
    const { ws, doc } = await seed("D1");
    const before = await rows(ORG);
    const e = await errOf(() => setRequiredDocumentStatus({ workspaceId: ws.id, organizationId: ORG, documentId: doc.id, status: "validado", actorUserId: VALIDATOR, correlationId: CORR }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toContain("REQUIRED_DOCUMENT_ATTACHMENT_REQUIRED");
    expect(await rows(ORG)).toEqual(before);
  }, 60_000);

  it("D2) 'anexado' sem upload ⇒ REQUIRED_DOCUMENT_UPLOAD_REQUIRED (a referência do cliente não existe mais)", async () => {
    const { ws, doc } = await seed("D2");
    const e = await errOf(() => setRequiredDocumentStatus({ workspaceId: ws.id, organizationId: ORG, documentId: doc.id, status: "anexado", actorUserId: ACTOR, correlationId: CORR }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toContain("REQUIRED_DOCUMENT_UPLOAD_REQUIRED");
    expect((await listRequiredDocuments(ws.id, ORG)).find((d) => d.id === doc.id)).toMatchObject({ status: "pendente", documentReference: "", contentHash: "" });
  }, 60_000);

  it("D3) linha LEGADA 's3://anexo' sem hash não valida", async () => {
    const { ws, doc } = await seed("D3");
    await conn.execute("UPDATE required_documents SET status = 'anexado', document_reference = 's3://anexo' WHERE id = ?", [doc.id]);
    const e = await errOf(() => setRequiredDocumentStatus({ workspaceId: ws.id, organizationId: ORG, documentId: doc.id, status: "validado", actorUserId: VALIDATOR, correlationId: CORR }));
    expect(e.message).toContain("REQUIRED_DOCUMENT_ATTACHMENT_REQUIRED");
  }, 60_000);

  it("D4) upload real ⇒ chave do servidor + SHA-256 + autor; depois valida com o validador registrado", async () => {
    const { ws, doc } = await seed("D4");
    const { document, contentHash } = await attachRequiredDocument({
      workspaceId: ws.id, organizationId: ORG, documentId: doc.id, fileName: "certidao negativa.pdf", mimeType: "application/pdf",
      content: PDF, actorUserId: ACTOR, correlationId: CORR,
    });
    expect(contentHash).toBe(createHash("sha256").update(PDF).digest("hex"));
    expect(document.documentReference.startsWith(`contratacao_direta/${ws.id}/`)).toBe(true);
    expect(document).toMatchObject({ status: "anexado", contentHash, sizeBytes: PDF.length, mimeType: "application/pdf", attachedBy: ACTOR, validatedBy: null });
    expect(mem.get(document.documentReference)?.equals(PDF)).toBe(true);
    const after = await setRequiredDocumentStatus({ workspaceId: ws.id, organizationId: ORG, documentId: doc.id, status: "validado", actorUserId: VALIDATOR, correlationId: CORR });
    expect(after.find((d) => d.id === doc.id)).toMatchObject({ status: "validado", validatedBy: VALIDATOR, contentHash });
  }, 60_000);

  it("D5) arquivo inválido ⇒ BAD_REQUEST, nenhum objeto gravado", async () => {
    const { ws, doc } = await seed("D5");
    const n = mem.size;
    for (const [mimeType, content] of [["application/pdf", Buffer.from("não é pdf")], ["application/x-msdownload", PDF]] as const) {
      const e = await errOf(() => attachRequiredDocument({ workspaceId: ws.id, organizationId: ORG, documentId: doc.id, fileName: "x.pdf", mimeType, content, actorUserId: ACTOR, correlationId: CORR }));
      expect(e.code).toBe("BAD_REQUEST");
    }
    expect(mem.size).toBe(n);
    expect((await listRequiredDocuments(ws.id, ORG)).find((d) => d.id === doc.id)).toMatchObject({ status: "pendente", contentHash: "" });
  }, 60_000);

  it("D6) outro órgão ⇒ NOT_FOUND antes de qualquer upload", async () => {
    const { ws, doc } = await seed("D6");
    const n = mem.size;
    const e = await errOf(() => attachRequiredDocument({ workspaceId: ws.id, organizationId: ORG_B, documentId: doc.id, fileName: "x.pdf", mimeType: "application/pdf", content: PDF, actorUserId: ACTOR, correlationId: CORR }));
    expect(e.message).toMatch(/não encontrado/);
    expect(mem.size).toBe(n);
    const e2 = await errOf(() => setRequiredDocumentStatus({ workspaceId: ws.id, organizationId: ORG_B, documentId: doc.id, status: "pendente", actorUserId: ACTOR, correlationId: CORR }));
    expect(e2.message).toMatch(/não encontrado/);
  }, 60_000);

  it("D7) migration 0314 reaplicada à mão é no-op", async () => {
    const before = await rows(ORG);
    const sqlText = readFileSync(path.resolve(import.meta.dirname, "../../../drizzle/0314_required_document_evidence.sql"), "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) {
      await conn.query(stmt);
    }
    expect(await rows(ORG)).toEqual(before);
  }, 60_000);
});
