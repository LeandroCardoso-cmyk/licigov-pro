/**
 * R3 / PR-06 (SEM-007) — migration 0310 REESTRUTURADA (2º passe): número normalizado + índice NÃO único, sem política.
 * O escopo "número único por órgão, qualquer origem" é decisão humana pendente (CONTRACT_NUMBER_SCOPE, HD-15); a
 * opção A está preparada FORA da cadeia (`drizzle/policy-pending/`). MySQL 8 real, bancos dedicados.
 *
 *  S   estática: 0310 no journal; SQL aditivo sem UNIQUE/SIGNAL; o SQL da opção A não está no journal.
 *  M1  banco LIMPO: cadeia completa ⇒ coluna gerada utf8mb4_bin STORED + índice NÃO único; schema válido; rerun no-op.
 *  M2  UPGRADE com o MESMO número em várias origens (estado permitido pela PK hash(org, origem, número)) ⇒ a 0310
 *      APLICA (nada aborta, nada é deduplicado), backfill = TRIM pelo banco, linhas intactas, reaplicação manual no-op;
 *      enquanto HD-15 está pendente o mesmo número em outra origem continua aceito (comportamento anterior).
 *  A1  opção A (preparada) sobre esse banco: o preflight read-only acusa o grupo e o SQL ABORTA fail-closed sem DDL.
 *  A2  opção A num banco sem duplicatas: cria a UNIQUE, que passa a recusar o mesmo número em outra origem; reaplicar = no-op.
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
const TAG_0310 = "0310_contract_number_normalized_index";
const PENDING = path.join(DRZ, "policy-pending");
const PREFLIGHT = path.join(PENDING, "preflight_contract_number_scope_A.sql");
const OPTION_A = path.join(PENDING, "contract_number_scope_A_unique_per_org.sql");
const IDX_0310 = 310;
const JOURNAL_ENTRIES: Array<{ idx: number; tag: string; when: number }> =
  JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")).entries;
/** Entries a partir da 0310 (inclusive): o que o upgrade a partir do prefixo aplica. */
const FROM_0310_COUNT = JOURNAL_ENTRIES.filter((e) => e.idx >= IDX_0310).length;

function urlFor(dbName: string): string {
  const u = new URL(DB!);
  u.pathname = `/${dbName}`;
  return u.toString();
}
async function ledgerCount(conn: mysql.Connection): Promise<number> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM __drizzle_migrations");
  return Number(rows[0].n);
}
async function columnInfo(conn: mysql.Connection) {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n, COLLATION_NAME AS c, EXTRA AS x, GENERATION_EXPRESSION AS g
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_workspaces' AND COLUMN_NAME = 'normalized_number'`);
  return rows[0] ?? null;
}
async function indexCols(conn: mysql.Connection, name: string): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME AS c, NON_UNIQUE AS nu FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_workspaces' AND INDEX_NAME = ?
      ORDER BY SEQ_IN_INDEX`, [name]);
  return rows.map((r) => `${r.c}:${Number(r.nu)}`);
}
/** Statements de um arquivo SQL com `--> statement-breakpoint` (mesmo formato das migrations). */
function statementsOf(file: string): string[] {
  return readFileSync(file, "utf8").split("--> statement-breakpoint").map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
}
function errorChain(e: unknown): string {
  const chain: string[] = [];
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 5; i++) {
    chain.push(String((x as { message?: string }).message ?? ""));
    x = (x as { cause?: unknown }).cause;
  }
  return chain.join(" | ");
}
async function rowsSnapshot(conn: mysql.Connection): Promise<string> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id, organization_id, origin_type, origin_process, contract_number, contractor, object, value, term, status,
            manager, inspector, correlation_id, created_by, created_at, updated_at FROM contract_workspaces ORDER BY id`);
  return JSON.stringify(rows);
}
/** Executa o preflight read-only (um SELECT por statement) e devolve metrica → valor. */
async function runPreflight(conn: mysql.Connection): Promise<Map<string, number>> {
  const sql = readFileSync(PREFLIGHT, "utf8").replace(/^\s*--.*$/gm, "");
  const out = new Map<string, number>();
  for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    expect(stmt).toMatch(/^SELECT\b/i); // SOMENTE LEITURA
    const [rows] = await conn.query<mysql.RowDataPacket[]>(stmt);
    for (const r of rows) {
      const vals = Object.values(r);
      out.set(String(vals[0]), Number(vals[1]));
    }
  }
  return out;
}


const ins = `INSERT INTO contract_workspaces (id, organization_id, origin_type, origin_process, contract_number, contractor, object, value, term, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, 'objeto', 10, '', ?, ?)`;

describe.skipIf(!DB)("R3 / PR-06 — 0310 sem política de escopo + opção A pendente (MySQL real, bancos dedicados)", () => {
  const stamp = Date.now();
  const cleanDb = `pr06_0310_clean_${stamp}`;
  const upgradeDb = `pr06_0310_upgrade_${stamp}`;
  let admin: mysql.Connection;
  let pre0310 = "";

  beforeAll(async () => {
    admin = await mysql.createConnection(DB!);
    for (const d of [cleanDb, upgradeDb]) await admin.query(`CREATE DATABASE \`${d}\``);
    // Pasta de migrations = PREFIXO do journal (idx < 310): estado imediatamente anterior à 0310.
    pre0310 = mkdtempSync(path.join(os.tmpdir(), "pr06-pre0310-"));
    mkdirSync(path.join(pre0310, "meta"));
    const journal = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < IDX_0310);
    const prefixTags = new Set(journal.entries.map((e: { tag: string }) => e.tag));
    for (const f of readdirSync(DRZ).filter((x) => /^\d{4}_.+\.sql$/.test(x) && prefixTags.has(x.replace(/\.sql$/, "")))) {
      cpSync(path.join(DRZ, f), path.join(pre0310, f));
    }
    writeFileSync(path.join(pre0310, "meta", "_journal.json"), JSON.stringify(journal));
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      for (const d of [cleanDb, upgradeDb]) await admin.query(`DROP DATABASE IF EXISTS \`${d}\``).catch(() => {});
      await admin.end();
    }
    if (pre0310) rmSync(pre0310, { recursive: true, force: true });
  }, 60_000);

  it("S — 0310 no journal, aditiva, sem UNIQUE/SIGNAL; a opção A fica fora do journal", () => {
    const e310 = JOURNAL_ENTRIES.find((e) => e.idx === IDX_0310)!;
    expect(e310.tag).toBe(TAG_0310);
    expect(e310.when).toBeGreaterThan(JOURNAL_ENTRIES.find((e) => e.idx === IDX_0310 - 1)!.when);
    const sql = statementsOf(path.join(DRZ, `${TAG_0310}.sql`)).join("\n");
    expect(sql).toMatch(/ADD INDEX `idx_ctw_org_normalized_number`/);
    expect(sql).not.toMatch(/\bUNIQUE\b|SIGNAL/i);
    expect(sql).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|INDEX)|UPDATE\s+`|DELETE\s+FROM|TRUNCATE|RENAME)\b/i);
    expect(JOURNAL_ENTRIES.some((e) => /scope_A|unique_per_org/.test(e.tag))).toBe(false);
    expect(statementsOf(OPTION_A).join("\n")).toMatch(/UNIQUE \(`organization_id`, `normalized_number`\)/);
  });

  it("M1 — banco LIMPO: coluna gerada utf8mb4_bin STORED + índice NÃO único; schema válido; rerun no-op", async () => {
    const conn = await mysql.createConnection(urlFor(cleanDb));
    try {
      await migrateWithAdvisoryLock(conn);
      const col = await columnInfo(conn);
      expect(col).not.toBeNull();
      expect(String(col!.t)).toBe("varchar(80)");
      expect(String(col!.c)).toBe("utf8mb4_bin");
      expect(String(col!.x)).toMatch(/STORED GENERATED|PERSISTENT|STORED/i);
      expect(String(col!.g).toLowerCase().replace(/\s/g, "").replace(/_utf8mb4/g, "").replace(/\\/g, ""))
        .toContain("nullif(trim(`contract_number`),'')");
      expect(await indexCols(conn, "idx_ctw_org_normalized_number")).toEqual(["organization_id:1", "normalized_number:1"]);
      expect(await indexCols(conn, "uq_ctw_org_normalized_number")).toEqual([]);
      expect(await collectSchemaProblems(conn)).toEqual([]);
      const n = await ledgerCount(conn);
      await migrateWithAdvisoryLock(conn);
      expect(await ledgerCount(conn)).toBe(n);
    } finally {
      await conn.end();
    }
  }, 240_000);

  it("M2 + A1 — UPGRADE com o mesmo número em várias origens: 0310 aplica sem tocar dados; opção A aborta fail-closed", async () => {
    const conn = await mysql.createConnection(urlFor(upgradeDb));
    try {
      await migrate(drizzle(conn), { migrationsFolder: pre0310 });
      await conn.query(ins, ["d1", 1, "processo_licitatorio", "p1", "CT-DUP/2026", "Fornecedor Sigiloso A", "vigente", 7]);
      await conn.query(ins, ["d2", 1, "contratacao_direta", "dp1", "CT-DUP/2026", "Fornecedor Sigiloso B", "minuta", 7]);
      await conn.query(ins, ["d3", 1, "avulso", "", "  CT-DUP/2026 ", "Fornecedor Sigiloso C", "minuta", 8]);
      await conn.query(ins, ["d4", 1, "externo", "", "", "Fornecedor D", "minuta", null]);
      await conn.query(ins, ["d5", 2, "processo_licitatorio", "p9", "CT-DUP/2026", "Outro órgão", "minuta", 9]);
      const before = await rowsSnapshot(conn);
      const ledgerBefore = await ledgerCount(conn);

      await migrateWithAdvisoryLock(conn);
      expect(await ledgerCount(conn)).toBe(ledgerBefore + FROM_0310_COUNT);
      expect(await rowsSnapshot(conn)).toBe(before);
      const [norm] = await conn.query<mysql.RowDataPacket[]>(`SELECT id, normalized_number AS n FROM contract_workspaces ORDER BY id`);
      expect(Object.fromEntries(norm.map((r) => [r.id, r.n]))).toEqual({ d1: "CT-DUP/2026", d2: "CT-DUP/2026", d3: "CT-DUP/2026", d4: null, d5: "CT-DUP/2026" });
      expect(await collectSchemaProblems(conn)).toEqual([]);
      const schemaOf = async () => JSON.stringify([await columnInfo(conn), await indexCols(conn, "idx_ctw_org_normalized_number")]);
      const schemaBefore = await schemaOf();
      for (const st of statementsOf(path.join(DRZ, `${TAG_0310}.sql`))) await conn.query(st);
      expect(await schemaOf()).toBe(schemaBefore);
      // HD-15 pendente: o mesmo número em outra origem continua aceito (comportamento anterior; nada decidido aqui).
      await conn.query(ins, ["d6", 1, "externo", "", "CT-DUP/2026", "F", "minuta", 1]);

      // A1 — opção A preparada: preflight acusa (só contagens) e o SQL aborta ANTES de qualquer DDL.
      const pf = await runPreflight(conn);
      expect(pf.get("GUARD (bloqueia): grupos duplicados")).toBe(1);
      expect([...pf.keys()].join("|")).not.toMatch(/CT-|Sigiloso/);
      const snap = await rowsSnapshot(conn);
      let failure: unknown = null;
      for (const st of statementsOf(OPTION_A)) {
        try { await conn.query(st); } catch (e) { failure = e; break; }
      }
      expect(errorChain(failure)).toMatch(/CNS_A_FC_DUP_CONTRACT_NUMBER_PER_ORG/);
      expect(await indexCols(conn, "uq_ctw_org_normalized_number")).toEqual([]);
      expect(await rowsSnapshot(conn)).toBe(snap);
      await conn.query("DROP PROCEDURE IF EXISTS `_ctwA_guard`");
    } finally {
      await conn.end();
    }
  }, 240_000);

  it("A2 — opção A num banco sem duplicatas: UNIQUE criada, recusa o mesmo número em outra origem; reaplicar = no-op", async () => {
    const conn = await mysql.createConnection(urlFor(cleanDb));
    try {
      await conn.query(ins, ["a1", 1, "processo_licitatorio", "p1", "CT-001/2026", "F", "minuta", 1]);
      await conn.query(ins, ["a2", 1, "contratacao_direta", "dp1", "CT-1/2026", "F", "minuta", 1]);
      for (let i = 0; i < 2; i++) for (const st of statementsOf(OPTION_A)) await conn.query(st);
      expect(await indexCols(conn, "uq_ctw_org_normalized_number")).toEqual(["organization_id:0", "normalized_number:0"]);
      await expect(conn.query(ins, ["a3", 1, "avulso", "", " CT-001/2026", "F", "minuta", 1])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      await conn.query(ins, ["a4", 2, "avulso", "", "CT-001/2026", "F", "minuta", 1]);
    } finally {
      await conn.end();
    }
  }, 240_000);
});
