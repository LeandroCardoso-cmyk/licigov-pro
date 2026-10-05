/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * R9 / SEM-043 — ledger APPEND-ONLY dos artefatos oficiais (DOCX/PDF) contra MySQL/MariaDB REAL (modo ESTRITO).
 *
 * Defeito reproduzido antes da correção: `storeRenderedArtifact` gravava `official_documents.storage_key/mime_type/
 * size_bytes/content_hash` NA LINHA DA VERSÃO — exportar DOCX e depois PDF da mesma versão sobrescrevia o ponteiro e o
 * hash do primeiro artefato; o export institucional só logava o fingerprint da identidade (nenhum SHA do binário).
 *
 *   L1  DOCX e PDF da MESMA versão (adapter institucional) ⇒ DUAS linhas, hashes ≠, ambas intactas; hash/origem/ator
 *       corretos; log de atividade e timeline citam formato + hash; linha da versão NÃO é tocada
 *   L2  bytes idênticos ⇒ no-op idempotente (1 linha, 1 evento, mesma chave S3); a linha existente é devolvida inalterada
 *   L3  bytes diferentes no MESMO formato ⇒ nova linha; o objeto S3 anterior permanece (chave endereçada pelo hash)
 *   L4  isolamento de tenant: o tenant B não lê, não exporta e não enxerga o ledger do tenant A (NOT_FOUND idêntico)
 *   L5  leitores legados: linha pré-0315 (colunas legadas preenchidas, sem ledger) segue legível, listagem vazia;
 *       um novo export NÃO altera as colunas legadas
 *   L6  concorrência: N exports idênticos ⇒ 1 linha; N exports distintos ⇒ N linhas e timeline sem ordem duplicada
 *   L7  ator humano obrigatório: id inválido ⇒ recusa, ZERO escrita
 *   L8  zero UPDATE/DELETE: varredura estática do código + linhas do ledger idênticas após reexportações
 *   L9  caminho legado `documentEngine.download` (router real) ⇒ ledger + log com hash; `artifacts` tenant-scoped
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode. S3 substituído por memória (mesmo contrato).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const mem = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../storage")>();
  return {
    ...actual,
    assertStorageUsable: () => undefined,
    isStorageConfigured: () => true,
    storagePut: async (key: string, data: Buffer) => { mem.set(key, Buffer.from(data)); return { key, url: `mem://${key}` }; },
    storageSignedUrl: async (key: string) => ({ key, url: `mem-signed://${key}` }),
  };
});

import { runMigrations } from "../../bootstrap";
import { generateOfficialDocument, getOfficialDocument } from "../../services/documentEngineService";
import { exportOfficialDocument } from "../../services/officialDocumentExportAdapter";
import { storeRenderedArtifact, recordOfficialArtifact } from "../../services/officialDocumentLifecycleService";
import { listOfficialDocumentArtifacts } from "../../db/officialDocumentArtifacts";
import { listDocumentTimeline } from "../../db/officialDocuments";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 994301;
const ORG_B = 994302;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const RUN = Date.now().toString(36);

let conn: mysql.Connection;
let userA = 0, userB = 0;

async function insertUser(tag: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)",
    [`sem043-${tag}-${RUN}`, `SEM-043 ${tag}`, `sem043-${tag}-${RUN}@teste.local`]);
  return r.insertId;
}
async function caller(userId: number, orgId: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user" }, req: { headers: {} }, res: {}, correlationId: `sem043-${Math.random().toString(36).slice(2, 10)}`,
    organizationId: orgId,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
async function newDoc(org: number, origin: string, content = "# Contrato SEM-043\n\nCláusula primeira — objeto sintético.") {
  return generateOfficialDocument({
    organizationId: org, businessDomain: "contratos", documentType: "contrato", origin: `${origin}-${RUN}`,
    title: "Contrato SEM-043", content, metadata: { contractNumber: "043/2026", object: "Objeto sintético" },
    author: "1", correlationId: "sem043-smoke",
  });
}
async function ledger(org: number, docId: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT * FROM official_document_artifacts WHERE tenant_id = ? AND document_id = ? ORDER BY created_at, id", [org, docId]);
  return rows as Array<Record<string, any>>;
}
async function versionRow(org: number, docId: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT storage_key, mime_type, size_bytes, content_hash, CAST(content AS CHAR) AS content, status, replay_hash FROM official_documents WHERE tenant_id = ? AND id = ?", [org, docId]);
  return rows[0] as Record<string, any>;
}
async function exportEvents(org: number, lineageId: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT event_order, event_type, actor, document_id, summary, correlation_id FROM official_document_timeline WHERE tenant_id = ? AND lineage_id = ? ORDER BY event_order, id", [org, lineageId]);
  return rows as Array<Record<string, any>>;
}
async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    for (const t of ["official_document_artifacts", "official_document_timeline", "official_documents"]) {
      await conn.execute(`DELETE FROM ${t} WHERE tenant_id = ?`, [org]).catch(() => {});
    }
    await conn.execute("DELETE FROM activity_logs WHERE organizationId = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM organization_members WHERE organizationId = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("SEM-043 — ledger de artefatos oficiais (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await cleanup();
    for (const [id, nome] of [[ORG, "Prefeitura SEM-043"], [ORG_B, "Outra Prefeitura SEM-043"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, nome, `sem043-${id}`]);
    }
    userA = await insertUser("a");
    userB = await insertUser("b");
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'manager', 1)", [ORG, userA]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'manager', 1)", [ORG_B, userB]);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM users WHERE id IN (?, ?)", [userA, userB]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("L1) DOCX e PDF da MESMA versão ⇒ duas linhas, hashes distintos, ambas intactas; linha da versão não é tocada", async () => {
    const doc = await newDoc(ORG, "l1");
    const before = await versionRow(ORG, doc.id);

    const docx = await exportOfficialDocument({ organizationId: ORG, userId: userA, documentId: doc.id, format: "docx", correlationId: "corr-l1-docx" });
    const afterDocx = await ledger(ORG, doc.id);
    const pdf = await exportOfficialDocument({ organizationId: ORG, userId: userA, documentId: doc.id, format: "pdf", correlationId: "corr-l1-pdf" });

    const rows = await ledger(ORG, doc.id);
    expect(rows).toHaveLength(2);
    const byFmt = Object.fromEntries(rows.map((r) => [r.format, r]));
    expect(Object.keys(byFmt).sort()).toEqual(["docx", "pdf"]);
    expect(byFmt.docx.artifact_hash).not.toBe(byFmt.pdf.artifact_hash);
    // a linha DOCX gravada no 1º export permanece EXATAMENTE igual depois do PDF (nenhum overwrite)
    expect(rows.find((r) => r.format === "docx")).toEqual(afterDocx[0]);
    // hash exposto no resultado = hash do ledger = sha256 dos bytes realmente enviados ao storage
    expect(docx.artifactHash).toBe(byFmt.docx.artifact_hash);
    expect(pdf.artifactHash).toBe(byFmt.pdf.artifact_hash);
    expect(sha(mem.get(byFmt.docx.storage_key)!)).toBe(byFmt.docx.artifact_hash);
    expect(sha(mem.get(byFmt.pdf.storage_key)!)).toBe(byFmt.pdf.artifact_hash);
    expect(byFmt.docx.size_bytes).toBe(mem.get(byFmt.docx.storage_key)!.length);
    expect(byFmt.docx.storage_key).not.toBe(byFmt.pdf.storage_key);
    // origem + ator humano + correlação
    for (const r of rows) {
      expect(r).toMatchObject({
        tenant_id: ORG, document_id: doc.id, lineage_id: doc.lineageId, version: doc.version,
        source_content_hash: sha(doc.content), source_replay_hash: doc.replayHash, created_by: `user:${userA}`,
      });
      expect(r.identity_fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(r.created_by).not.toMatch(/multi_copilot/);
    }
    expect(byFmt.docx.correlation_id).toBe("corr-l1-docx");
    expect(byFmt.pdf.correlation_id).toBe("corr-l1-pdf");
    // linha da VERSÃO: nada mais é escrito nas colunas legadas (a causa-raiz)
    expect(await versionRow(ORG, doc.id)).toEqual(before);
    expect(before).toMatchObject({ storage_key: "", mime_type: "", size_bytes: 0, content_hash: "" });
    // timeline: um evento por artefato, com formato + hash, ator humano, 1 id por evento
    const ev = (await exportEvents(ORG, doc.lineageId)).filter((e) => e.event_type === "documento_exportado");
    expect(ev).toHaveLength(2);
    expect(ev.map((e) => e.actor)).toEqual([`user:${userA}`, `user:${userA}`]);
    expect(ev[0].summary).toContain("DOCX"); expect(ev[0].summary).toContain(`sha256:${byFmt.docx.artifact_hash}`);
    expect(ev[1].summary).toContain("PDF"); expect(ev[1].summary).toContain(`sha256:${byFmt.pdf.artifact_hash}`);
    // log de atividade: "hash do artefato"
    const [logs] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT details FROM activity_logs WHERE organizationId = ? AND action = 'exportou documento oficial' ORDER BY id", [ORG]);
    const details = logs.map((l) => JSON.parse(String((l as any).details)));
    expect(details.map((d) => d.artifactHash)).toEqual([byFmt.docx.artifact_hash, byFmt.pdf.artifact_hash]);
    expect(details[0]).toMatchObject({ format: "docx", sourceContentHash: sha(doc.content), sourceReplayHash: doc.replayHash });
  }, 120_000);

  it("L2) bytes idênticos ⇒ no-op idempotente: 1 linha, 1 evento, linha existente inalterada", async () => {
    const doc = await newDoc(ORG, "l2");
    const buf = Buffer.from("PK-bytes-fixos-L2");
    const a = await storeRenderedArtifact({ doc, format: "docx", buffer: buf, actorUserId: userA, correlationId: "c-l2-a" });
    const rowsA = await ledger(ORG, doc.id);
    const b = await storeRenderedArtifact({ doc, format: "docx", buffer: Buffer.from(buf), actorUserId: userB, correlationId: "c-l2-b" });
    const rowsB = await ledger(ORG, doc.id);

    expect(a.artifactRecorded).toBe(true);
    expect(b.artifactRecorded).toBe(false);
    expect(b.artifactId).toBe(a.artifactId);
    expect(b.storageKey).toBe(a.storageKey); // endereçada pelo hash ⇒ mesmo objeto
    expect(rowsB).toHaveLength(1);
    expect(rowsB).toEqual(rowsA); // a reexportação NÃO reescreve autor/correlação/created_at
    expect(rowsB[0].created_by).toBe(`user:${userA}`);
    expect((await exportEvents(ORG, doc.lineageId)).filter((e) => e.event_type === "documento_exportado")).toHaveLength(1);
    expect(await versionRow(ORG, doc.id)).toMatchObject({ storage_key: "", content_hash: "", size_bytes: 0 });
  }, 60_000);

  it("L3) bytes diferentes no MESMO formato ⇒ nova linha; o objeto S3 anterior permanece", async () => {
    const doc = await newDoc(ORG, "l3");
    const b1 = Buffer.from("PK-docx-versao-1");
    const b2 = Buffer.from("PK-docx-versao-2 (rótulo de data diferente)");
    const r1 = await storeRenderedArtifact({ doc, format: "docx", buffer: b1, actorUserId: userA });
    const r2 = await storeRenderedArtifact({ doc, format: "docx", buffer: b2, actorUserId: userA });
    const rows = await ledger(ORG, doc.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.artifact_hash).sort()).toEqual([sha(b1), sha(b2)].sort());
    expect(r1.storageKey).not.toBe(r2.storageKey);
    expect(mem.get(r1.storageKey!)!.equals(b1)).toBe(true); // 1º objeto NÃO foi sobrescrito pelo 2º
    expect(mem.get(r2.storageKey!)!.equals(b2)).toBe(true);
    expect((await exportEvents(ORG, doc.lineageId)).filter((e) => e.event_type === "documento_exportado")).toHaveLength(2);
  }, 60_000);

  it("L4) isolamento de tenant: B não exporta/lê/registra sobre o documento de A; zero escrita", async () => {
    const doc = await newDoc(ORG, "l4");
    await storeRenderedArtifact({ doc, format: "pdf", buffer: Buffer.from("PK-A-pdf"), actorUserId: userA });
    const snapshot = JSON.stringify(await ledger(ORG, doc.id));

    await expect(exportOfficialDocument({ organizationId: ORG_B, userId: userB, documentId: doc.id, format: "pdf" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getOfficialDocument(doc.id, ORG_B)).toBeNull();
    expect(await listOfficialDocumentArtifacts(ORG_B, doc.id)).toEqual([]);
    const cB = await caller(userB, ORG_B);
    await expect(cB.documentEngine.artifacts({ documentId: doc.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cB.documentEngine.download({ documentId: doc.id, format: "pdf" })).rejects.toBeDefined();
    // B registrar com o MESMO hash/documento cria linha PRÓPRIA de B (unicidade inclui o tenant) — nunca toca a de A
    await recordOfficialArtifact({
      doc: { ...doc, tenantId: ORG_B }, format: "pdf", artifactHash: sha(Buffer.from("PK-A-pdf")), sizeBytes: 8,
      mimeType: "application/pdf", actorUserId: userB,
    });
    expect(JSON.stringify(await ledger(ORG, doc.id))).toBe(snapshot);
    expect(await listOfficialDocumentArtifacts(ORG, doc.id)).toHaveLength(1);
    expect((await ledger(ORG_B, doc.id)).every((r) => r.tenant_id === ORG_B)).toBe(true);
    // A enxerga só o seu
    const cA = await caller(userA, ORG);
    const listed = await cA.documentEngine.artifacts({ documentId: doc.id });
    expect(listed.artifacts).toHaveLength(1);
    expect(listed.artifacts[0]).toMatchObject({ tenantId: ORG, format: "pdf", createdBy: `user:${userA}` });
  }, 60_000);

  it("L5) leitores legados: versão pré-0315 (colunas legadas, sem ledger) segue legível; novo export não as altera", async () => {
    const doc = await newDoc(ORG, "l5");
    await conn.execute(
      "UPDATE official_documents SET storage_key = ?, mime_type = 'application/pdf', size_bytes = 77, content_hash = ? WHERE tenant_id = ? AND id = ?",
      ["document-engine/legado/chave.pdf", "f".repeat(64), ORG, doc.id]);
    const legacy = await getOfficialDocument(doc.id, ORG);
    expect(legacy).toMatchObject({ storageKey: "document-engine/legado/chave.pdf", mimeType: "application/pdf", size: 77, hash: "f".repeat(64) });
    expect(await listOfficialDocumentArtifacts(ORG, doc.id)).toEqual([]); // ausência tolerada (nunca inventada)
    const cA = await caller(userA, ORG);
    expect((await cA.documentEngine.artifacts({ documentId: doc.id })).artifacts).toEqual([]);

    await storeRenderedArtifact({ doc, format: "docx", buffer: Buffer.from("PK-novo-L5"), actorUserId: userA });
    expect(await getOfficialDocument(doc.id, ORG)).toMatchObject({ storageKey: "document-engine/legado/chave.pdf", mimeType: "application/pdf", size: 77, hash: "f".repeat(64) });
    expect(await listOfficialDocumentArtifacts(ORG, doc.id)).toHaveLength(1);
  }, 60_000);

  it("L6) concorrência: N exports idênticos ⇒ 1 linha; N distintos ⇒ N linhas e timeline sem ordem duplicada", async () => {
    const doc = await newDoc(ORG, "l6");
    const same = Buffer.from("PK-identico-L6");
    const results = await Promise.all(Array.from({ length: 6 }, () => storeRenderedArtifact({ doc, format: "pdf", buffer: Buffer.from(same), actorUserId: userA })));
    expect(results.filter((r) => r.artifactRecorded).length).toBe(1);
    expect(new Set(results.map((r) => r.artifactId)).size).toBe(1);
    expect(await ledger(ORG, doc.id)).toHaveLength(1);

    const N = 5;
    await Promise.all(Array.from({ length: N }, (_, i) => storeRenderedArtifact({ doc, format: "docx", buffer: Buffer.from(`PK-distinto-L6-${i}`), actorUserId: userA })));
    expect(await ledger(ORG, doc.id)).toHaveLength(1 + N);
    const tl = await exportEvents(ORG, doc.lineageId);
    const orders = tl.map((e) => e.event_order);
    expect(orders).toEqual(orders.map((_, i) => i)); // contíguo 0..n-1, sem duplicata
    expect(tl.filter((e) => e.event_type === "documento_exportado")).toHaveLength(1 + N);
    expect((await listDocumentTimeline(doc.lineageId, ORG)).length).toBe(tl.length);
  }, 90_000);

  it("L7) ator humano obrigatório: id inválido ⇒ recusa e ZERO escrita (ledger e timeline)", async () => {
    const doc = await newDoc(ORG, "l7");
    const tlBefore = (await exportEvents(ORG, doc.lineageId)).length;
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(storeRenderedArtifact({ doc, format: "pdf", buffer: Buffer.from("PK-L7"), actorUserId: bad })).rejects.toThrow(/OFFICIAL_ARTIFACT_ACTOR_REQUIRED/);
    }
    expect(await ledger(ORG, doc.id)).toHaveLength(0);
    expect((await exportEvents(ORG, doc.lineageId)).length).toBe(tlBefore);
  }, 30_000);

  it("L8) zero UPDATE/DELETE: varredura estática + linhas inalteradas após reexportações", async () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const f = path.join(d, e); if (statSync(f).isDirectory()) { if (e !== "__tests__" && e !== "node_modules") walk(f); } else if (f.endsWith(".ts")) files.push(f); } };
    walk(path.join(process.cwd(), "server"));
    const offenders = files.filter((f) => {
      const s = readFileSync(f, "utf8");
      const usesTable = /officialDocumentArtifactsTable/.test(s);
      return (usesTable && (/\.(update|delete)\(\s*officialDocumentArtifactsTable/.test(s) || /onDuplicateKeyUpdate/.test(s)))
        || /(UPDATE|DELETE\s+FROM)\s+`?official_document_artifacts/i.test(s);
    });
    expect(offenders, `UPDATE/DELETE/upsert no ledger: ${offenders.join(", ")}`).toEqual([]);

    const doc = await newDoc(ORG, "l8");
    const buf = Buffer.from("PK-L8");
    await storeRenderedArtifact({ doc, format: "pdf", buffer: buf, actorUserId: userA });
    const before = JSON.stringify(await ledger(ORG, doc.id));
    for (let i = 0; i < 3; i++) await storeRenderedArtifact({ doc, format: "pdf", buffer: Buffer.from(buf), actorUserId: userB });
    expect(JSON.stringify(await ledger(ORG, doc.id))).toBe(before);
  }, 60_000);

  it("L9) caminho legado documentEngine.download (router real) ⇒ ledger + log com hash; DOCX e PDF não se sobrescrevem", async () => {
    const doc = await newDoc(ORG, "l9");
    const cA = await caller(userA, ORG);
    const d = await cA.documentEngine.download({ documentId: doc.id, format: "docx" });
    const p = await cA.documentEngine.download({ documentId: doc.id, format: "pdf" });
    expect(d.artifactHash).not.toBe(p.artifactHash);
    const rows = await ledger(ORG, doc.id);
    expect(rows.map((r) => `${r.format}:${r.artifact_hash}`).sort()).toEqual([`docx:${d.artifactHash}`, `pdf:${p.artifactHash}`].sort());
    expect(rows.every((r) => r.created_by === `user:${userA}` && r.source_content_hash === sha(doc.content))).toBe(true);
    const listed = await cA.documentEngine.artifacts({ documentId: doc.id });
    expect(listed.artifacts.map((a) => a.format).sort()).toEqual(["docx", "pdf"]);
    expect(await versionRow(ORG, doc.id)).toMatchObject({ storage_key: "", content_hash: "" });
    const [logs] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT details FROM activity_logs WHERE organizationId = ? AND action = 'exportou documento oficial' AND details LIKE ?", [ORG, `%${d.artifactHash}%`]);
    expect(logs.length).toBe(1);
  }, 90_000);
});
