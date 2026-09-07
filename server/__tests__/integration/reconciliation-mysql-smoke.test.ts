/**
 * V1 PRE-PILOT CLOSURE — Fase B (RUNTIME & RELEASE SAFETY) — MIGRATION SAFETY (MySQL real).
 *
 * Prova, contra um MySQL real (CI), a estratégia de migrations que substituiu o antigo
 * reconciliador de runtime (ensureSchema). Cenários (secao 9 do plano):
 *   A. CLEAN INSTALL  — cadeia completa de migrations (inclui a 0297) num banco ZERADO fecha o
 *      schema.ts em 0/0/0 SEM nenhuma reconciliação em runtime; validateSchema aprova.
 *   B. UPGRADE        — a partir do estado imediatamente ANTERIOR à closure (cadeia 0000..0296,
 *      colunas ainda em snake_case / ausentes), aplicar a 0297 converge e PRESERVA dados.
 *   C. REPLAY         — reaplicar a 0297 num banco já convergido é no-op seguro (idempotente).
 *   E. RENAME PRECONDITIONS — a matriz de precondição do rename guardado da 0297:
 *      from/¬to → renomeia; ¬from/to → no-op; from+to → falha; ¬from/¬to → falha.
 *
 * Só roda quando DATABASE_URL está definido (CI com MySQL efêmero). Usa BANCOS DEDICADOS
 * (CREATE/DROP DATABASE) para ficar hermético e não interferir nos demais smokes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import path from "node:path";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "../../../drizzle/schema";
import { diffSchema } from "../../../scripts/schema-audit-util";
import { runMigrations, validateSchema } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const DRZ = path.join(process.cwd(), "drizzle");
const CLOSURE_TAG = "0297_phase_b_schema_closure";

function baseUrl(): string {
  // Deriva a URL sem o database final (para CREATE/DROP DATABASE).
  const u = new URL(DB!);
  u.pathname = "/";
  return u.toString();
}
function urlFor(dbName: string): string {
  const u = new URL(DB!);
  u.pathname = `/${dbName}`;
  return u.toString();
}
function statements(tag: string): string[] {
  const sql = readFileSync(path.join(DRZ, `${tag}.sql`), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}
async function applyTag(conn: mysql.Connection, tag: string): Promise<void> {
  for (const s of statements(tag)) await conn.query(s);
}
// Cadeia de migrations ANTERIOR à closure (tudo menos a 0297), na ordem do journal.
async function applyPreClosureChain(conn: mysql.Connection): Promise<void> {
  const journal = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8"));
  for (const e of journal.entries as Array<{ tag: string }>) {
    if (e.tag === CLOSURE_TAG) continue;
    await applyTag(conn, e.tag);
  }
}
function expectedSchema(): Map<string, readonly string[]> {
  const m = new Map<string, readonly string[]>();
  for (const v of Object.values(schema)) {
    if (!is(v, MySqlTable)) continue;
    const cfg = getTableConfig(v);
    m.set(cfg.name, cfg.columns.map((c) => c.name));
  }
  return m;
}
async function actualSchema(conn: mysql.Connection): Promise<Map<string, Set<string>>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
  );
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const t = String(r.TABLE_NAME);
    if (!m.has(t)) m.set(t, new Set());
    m.get(t)!.add(String(r.COLUMN_NAME));
  }
  return m;
}
async function assertClosed(conn: mysql.Connection, ctx: string): Promise<void> {
  const d = diffSchema(expectedSchema(), await actualSchema(conn));
  expect(d.missingTables, `${ctx}: tabelas ausentes`).toEqual([]);
  expect(d.absentColumns, `${ctx}: colunas ausentes`).toEqual([]);
  expect(d.mismatchColumns, `${ctx}: colunas com nome divergente`).toEqual([]);
}
async function columnExists(conn: mysql.Connection, table: string, column: string): Promise<boolean> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return (rows[0] as { cnt: number }).cnt > 0;
}
// Recria só os dois procedures da 0297 (a migration os cria e dropa no fim) para exercitar a
// matriz de precondição do rename isoladamente.
async function createClosureProcedures(conn: mysql.Connection): Promise<void> {
  for (const s of statements(CLOSURE_TAG)) {
    if (s.startsWith("CREATE PROCEDURE")) await conn.query(s);
  }
}

describe.skipIf(!DB)("Fase B — migration safety (MySQL real)", () => {
  let admin: mysql.Connection;
  const DBS = {
    clean: "pr_b_clean_install",
    upgrade: "pr_b_upgrade",
    rename: "pr_b_rename_preconditions",
  };

  beforeAll(async () => {
    admin = await mysql.createConnection(baseUrl());
    for (const name of Object.values(DBS)) {
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }
  }, 60_000);

  afterAll(async () => {
    for (const name of Object.values(DBS)) {
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    }
    await admin?.end();
  });

  it("A. CLEAN INSTALL: cadeia completa (inclui 0297) fecha o schema.ts em 0/0/0, sem reconciliação em runtime", async () => {
    const conn = await mysql.createConnection(urlFor(DBS.clean));
    try {
      await runMigrations(conn); // inclui a 0297 via journal — NENHUM ensureSchema/mutação em runtime
      await assertClosed(conn, "clean-install");
      // validateSchema (não-mutável) aprova um banco recém-migrado.
      await expect(validateSchema(conn)).resolves.toBeUndefined();
    } finally {
      await conn.end();
    }
  }, 300_000);

  it("B. UPGRADE: a partir de 0000..0296 (pré-closure, snake_case) a 0297 converge e PRESERVA dados", async () => {
    const conn = await mysql.createConnection(urlFor(DBS.upgrade));
    try {
      await applyPreClosureChain(conn);
      // Estado pré-closure: coluna ainda em snake_case (drift real que a 0297 fecha).
      expect(await columnExists(conn, "semantic_search_entries", "organization_id")).toBe(true);
      expect(await columnExists(conn, "semantic_search_entries", "organizationId")).toBe(false);
      // Semeia um dado na coluna que SERÁ renomeada para provar preservação.
      await conn.query(
        "INSERT INTO semantic_search_entries (id, organization_id, canonical_text, display_text) VALUES ('pb-upg-1', 4242, 'txt', 'disp')",
      );
      // Aplica a closure (o que a próxima release fará neste banco).
      await applyTag(conn, CLOSURE_TAG);
      await assertClosed(conn, "upgrade-after-0297");
      // O dado sobreviveu ao rename (organization_id -> organizationId).
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT organizationId, canonicalText FROM semantic_search_entries WHERE id='pb-upg-1'",
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0].organizationId)).toBe(4242);
      expect(String(rows[0].canonicalText)).toBe("txt");
    } finally {
      await conn.end();
    }
  }, 300_000);

  it("C. REPLAY: reaplicar a 0297 num banco já convergido é no-op seguro (idempotente)", async () => {
    const conn = await mysql.createConnection(urlFor(DBS.upgrade));
    try {
      await applyTag(conn, CLOSURE_TAG); // segunda aplicação
      await applyTag(conn, CLOSURE_TAG); // terceira aplicação
      await assertClosed(conn, "replay");
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT organizationId FROM semantic_search_entries WHERE id='pb-upg-1'",
      );
      expect(Number(rows[0].organizationId)).toBe(4242);
    } finally {
      await conn.end();
    }
  }, 180_000);

  it("E. RENAME PRECONDITIONS: from/¬to renomeia; ¬from/to no-op; from+to falha; ¬from/¬to falha", async () => {
    const conn = await mysql.createConnection(urlFor(DBS.rename));
    try {
      await createClosureProcedures(conn);

      // from existe / to ausente → renomeia
      await conn.query("CREATE TABLE t1 (`old` INT NULL)");
      await conn.query("CALL licigov_pb_rename_col('t1', 'old', 'novo')");
      expect(await columnExists(conn, "t1", "old")).toBe(false);
      expect(await columnExists(conn, "t1", "novo")).toBe(true);

      // from ausente / to existe → no-op (já convergido)
      await conn.query("CREATE TABLE t2 (`novo` INT NULL)");
      await conn.query("CALL licigov_pb_rename_col('t2', 'old', 'novo')");
      expect(await columnExists(conn, "t2", "novo")).toBe(true);

      // from + to existem → falha explícita (ambíguo)
      await conn.query("CREATE TABLE t3 (`old` INT NULL, `novo` INT NULL)");
      await expect(conn.query("CALL licigov_pb_rename_col('t3', 'old', 'novo')")).rejects.toThrow();

      // nem from nem to existem → falha explícita
      await conn.query("CREATE TABLE t4 (`outra` INT NULL)");
      await expect(conn.query("CALL licigov_pb_rename_col('t4', 'old', 'novo')")).rejects.toThrow();
    } finally {
      await conn.end();
    }
  }, 120_000);
});
