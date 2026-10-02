/**
 * Pilot Reset B2/B3 — migration 0313 (lifecycle do Processo Licitatório) contra MySQL REAL, em bancos DEDICADOS
 * (herméticos). Só roda com DATABASE_URL definido. Mesmo método do smoke da 0310 (pré-estado = PREFIXO do journal).
 *
 *  M1  banco LIMPO: cadeia completa ⇒ colunas/índices do contrato; schema válido para o validator do boot; rerun no-op
 *  M2  UPGRADE com dados: linhas existentes recebem só os DEFAULTs (active, revisão 0, geração 1, linhagem NULL) e
 *      ficam idênticas nas colunas antigas; unicidade de número ativo e de geração ativa passa a valer; reaplicar o
 *      SQL à mão é no-op
 *  M3  PRECONDIÇÃO: número duplicado no órgão (estado impossível pela PK, simulado) ⇒ o guard ABORTA antes de qualquer
 *      DDL com mensagem estável; nada criado, ledger inalterado, linhas intactas
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
const TAG = "0313_procurement_process_lifecycle";
const IDX = 313;
const JOURNAL: Array<{ idx: number; tag: string; when: number }> = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")).entries;
const FROM_COUNT = JOURNAL.filter((e) => e.idx >= IDX).length;
const LAST_TAG = JOURNAL[JOURNAL.length - 1].tag;

function urlFor(dbName: string): string {
  const u = new URL(DB!);
  u.pathname = `/${dbName}`;
  return u.toString();
}
const ledger = async (c: mysql.Connection) => Number(((await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM __drizzle_migrations"))[0])[0].n);
const cols = async (c: mysql.Connection) => (await c.query<mysql.RowDataPacket[]>(
  `SELECT COLUMN_NAME c, COLUMN_TYPE t, IS_NULLABLE n, COLUMN_DEFAULT d, COLLATION_NAME k, EXTRA x FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_processes'
      AND COLUMN_NAME IN ('lineage_id','generation_no','lifecycle_state','lifecycle_revision','supersedes_process_id','active_lineage_key','active_number_key')
    ORDER BY COLUMN_NAME`))[0];
const idx = async (c: mysql.Connection) => (await c.query<mysql.RowDataPacket[]>(
  `SELECT INDEX_NAME i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c, MIN(NON_UNIQUE) nu FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_processes' AND INDEX_NAME IN ('uq_pp_active_lineage','uq_pp_active_number','idx_pp_lineage')
    GROUP BY INDEX_NAME ORDER BY INDEX_NAME`))[0].map((r) => `${r.i}:${r.c}:${Number(r.nu)}`);
const ledgerTable = async (c: mysql.Connection) => Number(((await c.query<mysql.RowDataPacket[]>(
  `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_process_lifecycle_events'`))[0])[0].n);
const OLD_COLS = "id, organization_id, process_number, object, modality, current_stage, status, start_option, responsible_user, correlation_id, created_at, updated_at";
const rowsOld = async (c: mysql.Connection) => JSON.stringify((await c.query<mysql.RowDataPacket[]>(`SELECT ${OLD_COLS} FROM procurement_processes ORDER BY id`))[0]);
const ins = `INSERT INTO procurement_processes (id, organization_id, process_number, object, status, current_stage) VALUES (?, ?, ?, 'obj', ?, ?)`;

describe.skipIf(!DB)("Pilot Reset — migration 0313 (MySQL real, bancos dedicados)", () => {
  const stamp = Date.now();
  const cleanDb = `preset_0313_clean_${stamp}`;
  const upDb = `preset_0313_up_${stamp}`;
  const dupDb = `preset_0313_dup_${stamp}`;
  let admin: mysql.Connection;
  let pre = "";

  beforeAll(async () => {
    admin = await mysql.createConnection(DB!);
    for (const d of [cleanDb, upDb, dupDb]) await admin.query(`CREATE DATABASE \`${d}\``);
    pre = mkdtempSync(path.join(os.tmpdir(), "preset-pre0313-"));
    mkdirSync(path.join(pre, "meta"));
    const prefix = JOURNAL.filter((e) => e.idx < IDX);
    const tags = new Set(prefix.map((e) => e.tag));
    for (const f of readdirSync(DRZ).filter((x) => /^\d{4}_.+\.sql$/.test(x) && tags.has(x.replace(/\.sql$/, "")))) cpSync(path.join(DRZ, f), path.join(pre, f));
    writeFileSync(path.join(pre, "meta", "_journal.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")), entries: prefix }));
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      for (const d of [cleanDb, upDb, dupDb]) await admin.query(`DROP DATABASE IF EXISTS \`${d}\``).catch(() => {});
      await admin.end();
    }
    if (pre) rmSync(pre, { recursive: true, force: true });
  }, 60_000);

  it("a 0313 está no journal (idx 313, depois da 0312) e o SQL é aditivo, com guard ANTES de qualquer DDL", () => {
    const e = JOURNAL.find((x) => x.idx === IDX)!;
    expect(e.tag).toBe(TAG);
    expect(e.when).toBeGreaterThan(JOURNAL.find((x) => x.idx === IDX - 1)!.when);
    const sql = readFileSync(path.join(DRZ, `${TAG}.sql`), "utf8").replace(/^\s*--.*$/gm, "");
    expect(sql.indexOf("CALL `_pp0313_guard`()")).toBeGreaterThan(-1);
    expect(sql.indexOf("CALL `_pp0313_guard`()")).toBeLessThan(sql.indexOf("ADD COLUMN"));
    expect(sql).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|INDEX)|UPDATE\s+`|DELETE\s+FROM|TRUNCATE|RENAME)\b/i);
  });

  it("M1 — banco limpo: colunas e índices do contrato; schema válido; rerun no-op", async () => {
    const c = await mysql.createConnection(urlFor(cleanDb));
    try {
      await migrateWithAdvisoryLock(c);
      const byName = Object.fromEntries((await cols(c)).map((r) => [r.c, r]));
      expect(byName.lifecycle_state).toMatchObject({ t: "varchar(20)", n: "NO", d: "active" });
      expect(byName.lifecycle_revision).toMatchObject({ t: "int", n: "NO", d: "0" });
      expect(byName.generation_no).toMatchObject({ t: "int", n: "NO", d: "1" });
      expect(byName.lineage_id).toMatchObject({ n: "YES" });
      expect(byName.active_number_key).toMatchObject({ k: "utf8mb4_bin" });
      expect(String(byName.active_number_key.x)).toMatch(/STORED GENERATED/i);
      expect(await idx(c)).toEqual([
        "idx_pp_lineage:organization_id,lineage_id:1",
        "uq_pp_active_lineage:organization_id,active_lineage_key:0",
        "uq_pp_active_number:organization_id,active_number_key:0",
      ]);
      expect(await ledgerTable(c)).toBe(1);
      expect(await collectSchemaProblems(c)).toEqual([]);
      const n = await ledger(c);
      await migrateWithAdvisoryLock(c);
      expect(await ledger(c)).toBe(n);
    } finally { await c.end(); }
  }, 240_000);

  it("M2 — upgrade com dados: só DEFAULTs; colunas antigas idênticas; unicidade ativa; reaplicar à mão = no-op", async () => {
    const c = await mysql.createConnection(urlFor(upDb));
    try {
      await migrate(drizzle(c), { migrationsFolder: pre });
      await c.query(ins, ["aaaaaaaaaaaaaaaaaaa1", 1, "2026/1", "rascunho", "NEW_PROCESS"]);
      await c.query(ins, ["aaaaaaaaaaaaaaaaaaa2", 1, "2026/2", "emitido", "ISSUED"]);
      await c.query(ins, ["aaaaaaaaaaaaaaaaaaa3", 2, "2026/1", "rascunho", "ETP"]);   // mesmo número em outro órgão
      await c.query(ins, ["aaaaaaaaaaaaaaaaaaa4", 1, "", "rascunho", "NEW_PROCESS"]);    // vazio não entra na chave
      await c.query(ins, ["aaaaaaaaaaaaaaaaaaa5", 1, "", "rascunho", "NEW_PROCESS"]);
      const before = await rowsOld(c);
      const l0 = await ledger(c);
      await migrateWithAdvisoryLock(c);
      expect(await ledger(c)).toBe(l0 + FROM_COUNT);
      expect(await rowsOld(c)).toBe(before);
      const [vals] = await c.query<mysql.RowDataPacket[]>(`SELECT id, lineage_id, generation_no, lifecycle_state, lifecycle_revision, supersedes_process_id, active_number_key FROM procurement_processes ORDER BY id`);
      for (const v of vals) expect(v).toMatchObject({ lineage_id: null, generation_no: 1, lifecycle_state: "active", lifecycle_revision: 0, supersedes_process_id: null });
      expect(vals.map((v) => v.active_number_key)).toEqual(["2026/1", "2026/2", "2026/1", null, null]);
      // banco garante: um número ativo por órgão; uma geração ativa por linhagem
      await expect(c.query(ins, ["bbbbbbbbbbbbbbbbbbb1", 1, "2026/1", "rascunho", "NEW_PROCESS"])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      await c.query(`UPDATE procurement_processes SET lifecycle_state = 'superseded' WHERE id = 'aaaaaaaaaaaaaaaaaaa1'`);
      await c.query(ins, ["bbbbbbbbbbbbbbbbbbb1", 1, "2026/1", "rascunho", "NEW_PROCESS"]); // número livre quando a geração não é ativa
      await c.query(`UPDATE procurement_processes SET lineage_id = 'pln_x' WHERE id IN ('aaaaaaaaaaaaaaaaaaa1', 'bbbbbbbbbbbbbbbbbbb1')`);
      await expect(c.query(`UPDATE procurement_processes SET lifecycle_state = 'active' WHERE id = 'aaaaaaaaaaaaaaaaaaa1'`)).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      expect(await collectSchemaProblems(c)).toEqual([]);
      const schema = JSON.stringify([await cols(c), await idx(c)]);
      for (const s of readFileSync(path.join(DRZ, `${TAG}.sql`), "utf8").split("--> statement-breakpoint").map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) {
        await c.query(s);
      }
      expect(JSON.stringify([await cols(c), await idx(c)])).toBe(schema);
    } finally { await c.end(); }
  }, 240_000);

  it("M3 — precondição: número duplicado no órgão ⇒ guard aborta ANTES de qualquer DDL; nada tocado", async () => {
    const c = await mysql.createConnection(urlFor(dupDb));
    try {
      await migrate(drizzle(c), { migrationsFolder: pre });
      await c.query(ins, ["ccccccccccccccccccc1", 1, "2026/9", "rascunho", "NEW_PROCESS"]);
      await c.query(ins, ["ccccccccccccccccccc2", 1, "2026/9", "rascunho", "NEW_PROCESS"]); // impossível pela PK; simulado
      const before = await rowsOld(c);
      const l0 = await ledger(c);
      const failure = await migrateWithAdvisoryLock(c).then(() => null, (e: unknown) => e);
      const chain: string[] = [];
      for (let x: unknown = failure, i = 0; x && typeof x === "object" && i < 5; i++) { chain.push(String((x as { message?: string }).message ?? "")); x = (x as { cause?: unknown }).cause; }
      expect(chain.join(" | ")).toMatch(/0313_FC_DUP_ACTIVE_PROCESS_NUMBER/);
      expect(await cols(c)).toEqual([]);
      expect(await ledgerTable(c)).toBe(0);
      expect(await ledger(c)).toBe(l0);
      expect(await rowsOld(c)).toBe(before);
      expect((await collectSchemaProblems(c)).join("\n")).toContain(LAST_TAG);
    } finally { await c.end(); }
  }, 240_000);
});
