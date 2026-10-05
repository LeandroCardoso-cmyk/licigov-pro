/**
 * R9 / SEM-043 — migration 0315 (ledger append-only `official_document_artifacts`) contra MySQL REAL, em bancos
 * DEDICADOS (herméticos). Só roda com DATABASE_URL. Pré-estado do upgrade = PREFIXO do journal (idx < 315).
 *
 *  M0  a 0315 está no journal (idx 315, depois da 0314) e o SQL é aditivo: só CREATE TABLE IF NOT EXISTS
 *  M1  banco LIMPO: colunas/índices/UNIQUE do contrato; schema válido para o validator do boot; rerun no-op
 *  M2  UPGRADE com dados: `official_documents`/timeline com colunas legadas preenchidas ficam BYTE a BYTE idênticas
 *      (sem backfill — ledger vazio); reaplicar o SQL à mão é no-op; a UNIQUE vale (mesmo formato+hash ⇒ ER_DUP_ENTRY;
 *      outro formato / outro tenant / outro hash ⇒ ok)
 *  M3  ROLLBACK: DROP TABLE só da tabela nova não altera nenhuma outra tabela nem o ledger do drizzle
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { migrateWithAdvisoryLock } from "../../db/releaseMigrate";
import { collectSchemaProblems } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const DRZ = path.join(process.cwd(), "drizzle");
const TAG = "0315_official_document_artifacts";
const IDX = 315;
const JOURNAL: Array<{ idx: number; tag: string; when: number }> = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")).entries;
const FROM_COUNT = JOURNAL.filter((e) => e.idx >= IDX).length;

function urlFor(dbName: string): string {
  const u = new URL(DB!);
  u.pathname = `/${dbName}`;
  return u.toString();
}
const ledger = async (c: mysql.Connection) => Number(((await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM __drizzle_migrations"))[0])[0].n);
const cols = async (c: mysql.Connection) => (await c.query<mysql.RowDataPacket[]>(
  `SELECT COLUMN_NAME c, COLUMN_TYPE t, IS_NULLABLE n, COLUMN_DEFAULT d, COLLATION_NAME k FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'official_document_artifacts' ORDER BY ORDINAL_POSITION`))[0];
const idx = async (c: mysql.Connection) => (await c.query<mysql.RowDataPacket[]>(
  `SELECT INDEX_NAME i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c, MIN(NON_UNIQUE) nu FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'official_document_artifacts' GROUP BY INDEX_NAME`))[0].map((r) => `${r.i}:${r.c}:${Number(r.nu)}`).sort();
const tableExists = async (c: mysql.Connection) => Number(((await c.query<mysql.RowDataPacket[]>(
  `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'official_document_artifacts'`))[0])[0].n) === 1;
const dump = async (c: mysql.Connection, t: string) => JSON.stringify((await c.query<mysql.RowDataPacket[]>(`SELECT * FROM \`${t}\` ORDER BY id`))[0]);
const ins = `INSERT INTO official_document_artifacts (id, tenant_id, document_id, format, artifact_hash, created_by) VALUES (?, ?, ?, ?, ?, 'user:1')`;

describe.skipIf(!DB)("SEM-043 — migration 0315 (MySQL real, bancos dedicados)", () => {
  const stamp = Date.now();
  const cleanDb = `sem043_0315_clean_${stamp}`;
  const upDb = `sem043_0315_up_${stamp}`;
  let admin: mysql.Connection;
  let pre = "";

  beforeAll(async () => {
    admin = await mysql.createConnection(DB!);
    for (const d of [cleanDb, upDb]) await admin.query(`CREATE DATABASE \`${d}\``);
    pre = mkdtempSync(path.join(os.tmpdir(), "sem043-pre0315-"));
    mkdirSync(path.join(pre, "meta"));
    const prefix = JOURNAL.filter((e) => e.idx < IDX);
    const tags = new Set(prefix.map((e) => e.tag));
    for (const f of readdirSync(DRZ).filter((x) => /^\d{4}_.+\.sql$/.test(x) && tags.has(x.replace(/\.sql$/, "")))) cpSync(path.join(DRZ, f), path.join(pre, f));
    writeFileSync(path.join(pre, "meta", "_journal.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")), entries: prefix }));
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      for (const d of [cleanDb, upDb]) await admin.query(`DROP DATABASE IF EXISTS \`${d}\``).catch(() => {});
      await admin.end();
    }
    if (pre) rmSync(pre, { recursive: true, force: true });
  }, 60_000);

  it("M0 — a 0315 está no journal (idx 315, depois da 0314) e o SQL é puramente aditivo (CREATE TABLE IF NOT EXISTS)", () => {
    const e = JOURNAL.find((x) => x.idx === IDX)!;
    expect(e.tag).toBe(TAG);
    expect(e.when).toBeGreaterThan(JOURNAL.find((x) => x.idx === IDX - 1)!.when);
    const sql = readFileSync(path.join(DRZ, `${TAG}.sql`), "utf8").replace(/^\s*--.*$/gm, "");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS `official_document_artifacts`/);
    expect(sql).not.toMatch(/\b(DROP\s+|UPDATE\s+`|DELETE\s+FROM|TRUNCATE|RENAME|ALTER\s+TABLE|INSERT\s+INTO)\b/i);
    expect(sql).not.toMatch(/`official_documents`|`official_document_timeline`/); // não toca as tabelas existentes
  });

  it("M1 — banco limpo: colunas e índices do contrato; schema válido; rerun no-op", async () => {
    const c = await mysql.createConnection(urlFor(cleanDb));
    try {
      await migrateWithAdvisoryLock(c);
      const byName = Object.fromEntries((await cols(c)).map((r) => [r.c, r]));
      expect(Object.keys(byName)).toEqual([
        "id", "tenant_id", "document_id", "lineage_id", "version", "format", "artifact_hash", "size_bytes", "mime_type",
        "storage_key", "source_content_hash", "source_replay_hash", "identity_fingerprint", "correlation_id", "created_by", "created_at",
      ]);
      for (const k of ["id", "tenant_id", "document_id", "format", "artifact_hash", "created_by", "created_at"]) expect(byName[k].n, k).toBe("NO");
      expect(byName.artifact_hash).toMatchObject({ t: "varchar(64)", k: "utf8mb4_unicode_ci" });
      expect(byName.created_by.d).toBeNull(); // sem default: ator humano obrigatório
      expect(await idx(c)).toEqual([
        "PRIMARY:id:0",
        "idx_oda_doc_format_created:tenant_id,document_id,format,created_at:1",
        "idx_oda_lineage:tenant_id,lineage_id,version:1",
        "uq_oda_doc_format_hash:tenant_id,document_id,format,artifact_hash:0",
      ].sort());
      expect(await collectSchemaProblems(c)).toEqual([]);
      const n = await ledger(c);
      await migrateWithAdvisoryLock(c);
      expect(await ledger(c)).toBe(n);
    } finally { await c.end(); }
  }, 240_000);

  it("M2 — upgrade com dados: linhas existentes intactas (sem backfill); reaplicar = no-op; UNIQUE por tenant+doc+formato+hash", async () => {
    const c = await mysql.createConnection(urlFor(upDb));
    try {
      await migrate(drizzle(c), { migrationsFolder: pre });
      expect(await tableExists(c)).toBe(false);
      // versão exportada ANTES da 0315 (colunas legadas preenchidas) e outra nunca exportada
      await c.query(
        `INSERT INTO official_documents (id, tenant_id, business_domain, document_type, origin, title, version, status, content, lineage_id, replay_hash, storage_key, mime_type, size_bytes, content_hash)
         VALUES ('doc00000000000000001', 1, 'contratos', 'contrato', 'o1', 'Legado', 1, 'gerado', 'conteúdo legado', 'lin00000000000000001', 'rh1', 'document-engine/1/lin/doc-legado.pdf', 'application/pdf', 321, REPEAT('a', 64)),
                ('doc00000000000000002', 2, 'contratos', 'contrato', 'o2', 'Nunca exportado', 1, 'gerado', 'outro', 'lin00000000000000002', 'rh2', '', '', 0, '')`);
      await c.query(
        `INSERT INTO official_document_timeline (id, tenant_id, lineage_id, document_id, event_order, event_type, actor, summary, correlation_id)
         VALUES ('tl000000000000000001', 1, 'lin00000000000000001', 'doc00000000000000001', 0, 'documento_exportado', '1', 'export legado', 'c')`);
      const before = [await dump(c, "official_documents"), await dump(c, "official_document_timeline")];
      const l0 = await ledger(c);

      await migrateWithAdvisoryLock(c);
      expect(await ledger(c)).toBe(l0 + FROM_COUNT);
      expect([await dump(c, "official_documents"), await dump(c, "official_document_timeline")]).toEqual(before);
      expect(Number(((await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM official_document_artifacts"))[0])[0].n)).toBe(0); // sem backfill

      await c.query(ins, ["a1", 1, "doc00000000000000001", "pdf", "h".repeat(64)]);
      await expect(c.query(ins, ["a2", 1, "doc00000000000000001", "pdf", "h".repeat(64)])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" }); // mesmos bytes
      await c.query(ins, ["a3", 1, "doc00000000000000001", "docx", "h".repeat(64)]);        // outro formato: coexiste
      await c.query(ins, ["a4", 1, "doc00000000000000001", "pdf", "i".repeat(64)]);         // bytes diferentes: anexa
      await c.query(ins, ["a5", 2, "doc00000000000000001", "pdf", "h".repeat(64)]);         // outro tenant: isolado
      expect(await collectSchemaProblems(c)).toEqual([]);

      const schema = JSON.stringify([await cols(c), await idx(c)]);
      for (const s of readFileSync(path.join(DRZ, `${TAG}.sql`), "utf8").split("--> statement-breakpoint").map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) {
        await c.query(s);
      }
      expect(JSON.stringify([await cols(c), await idx(c)])).toBe(schema);
      expect(Number(((await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM official_document_artifacts"))[0])[0].n)).toBe(4); // dados preservados
    } finally { await c.end(); }
  }, 240_000);

  it("M3 — rollback: DROP TABLE só da tabela nova não altera outras tabelas nem o ledger do drizzle", async () => {
    const c = await mysql.createConnection(urlFor(upDb));
    try {
      const before = [await dump(c, "official_documents"), await dump(c, "official_document_timeline")];
      const l0 = await ledger(c);
      await c.query("DROP TABLE `official_document_artifacts`");
      expect(await tableExists(c)).toBe(false);
      expect([await dump(c, "official_documents"), await dump(c, "official_document_timeline")]).toEqual(before);
      expect(await ledger(c)).toBe(l0);
      // o build anterior (que só lê/escreve colunas legadas) segue funcionando sobre a linha da versão
      await c.query("UPDATE official_documents SET storage_key = 'k', content_hash = REPEAT('b', 64) WHERE id = 'doc00000000000000002'");
      const [r] = await c.query<mysql.RowDataPacket[]>("SELECT storage_key, content_hash FROM official_documents WHERE id = 'doc00000000000000002'");
      expect(r[0]).toMatchObject({ storage_key: "k" });
    } finally { await c.end(); }
  }, 120_000);
});
