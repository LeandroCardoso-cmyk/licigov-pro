/**
 * Reconciliação de schema — smoke contra MySQL REAL (CI).
 *
 * Só roda quando DATABASE_URL está definido (CI com serviço MySQL efêmero); é pulado localmente.
 *
 * Valida os DOIS cenários reais:
 *  1) STAGING/CI (banco zerado): a cadeia completa de migrations (0000→0285) aplica sem erro —
 *     prova que a 0285 convive com as migrations originais (IF NOT EXISTS) — e o ensureSchema
 *     completa as colunas de drift.
 *  2) PRODUÇÃO (drift real): removemos as 17 tabelas e as 54 colunas (simulando o estado da
 *     produção, criada por db:push antigo) e comprovamos que executar a 0285 + ensureSchema
 *     reconstrói TUDO — que é exatamente o que o boot fará no deploy.
 *  3) Idempotência: repetir 0285 + ensureSchema não altera nem falha (seguro re-rodar a cada boot).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runMigrations, ensureSchema } from "../../bootstrap";
import {
  MISSING_TABLES,
  MISSING_COLUMNS,
} from "../../../scripts/schema-reconciliation-manifest";

const DB = process.env.DATABASE_URL;

function reconciliationStatements(): string[] {
  const sql = readFileSync(path.join(process.cwd(), "drizzle", "0285_schema_reconciliation.sql"), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}

describe.skipIf(!DB)("Reconciliação de schema — MySQL real", () => {
  let conn: mysql.Connection;

  async function tableExists(table: string): Promise<boolean> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    return (rows[0] as { cnt: number }).cnt > 0;
  }

  async function columnExists(table: string, column: string): Promise<boolean> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    return (rows[0] as { cnt: number }).cnt > 0;
  }

  async function assertAllPresent(context: string): Promise<void> {
    for (const table of MISSING_TABLES) {
      expect(await tableExists(table), `${context}: tabela ${table} deveria existir`).toBe(true);
    }
    for (const [table, cols] of Object.entries(MISSING_COLUMNS)) {
      for (const col of cols) {
        expect(await columnExists(table, col), `${context}: coluna ${table}.${col} deveria existir`).toBe(true);
      }
    }
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
  });

  afterAll(async () => {
    await conn?.end();
  });

  it("cenário STAGING: cadeia completa de migrations (inclui 0285) + ensureSchema num banco zerado", async () => {
    await runMigrations(conn);
    await ensureSchema(conn);
    await assertAllPresent("staging");
  }, 300_000);

  it("cenário PRODUÇÃO: com o drift reproduzido (tabelas/colunas removidas), 0285 + ensureSchema reconstroem tudo", async () => {
    // Reproduz o estado da produção: sem as 17 tabelas e sem as 54 colunas.
    for (const table of MISSING_TABLES) {
      await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
    for (const [table, cols] of Object.entries(MISSING_COLUMNS)) {
      for (const col of cols) {
        if (await columnExists(table, col)) {
          await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``);
        }
      }
    }

    // Sanidade do cenário: o drift está instalado.
    expect(await tableExists("organizations")).toBe(false);
    expect(await columnExists("process_members", "functionalRole")).toBe(false);

    // O que o boot fará em produção: aplicar a 0285 (única migration nova) + ensureSchema.
    for (const stmt of reconciliationStatements()) {
      await conn.query(stmt);
    }
    await ensureSchema(conn);

    await assertAllPresent("produção");
  }, 180_000);

  it("idempotência: repetir 0285 + ensureSchema não falha nem altera o resultado", async () => {
    for (const stmt of reconciliationStatements()) {
      await conn.query(stmt);
    }
    await ensureSchema(conn);
    await assertAllPresent("idempotência");
  }, 120_000);
});
