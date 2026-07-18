/**
 * Auditoria de schema — Drizzle × banco real (produção/staging).
 *
 * Compara o schema declarado no Drizzle (drizzle/schema.ts) com o schema REAL do banco apontado por
 * DATABASE_URL, reportando as divergências que causam falhas em runtime:
 *   - TABELAS declaradas no Drizzle que NÃO existem no banco  → "Table doesn't exist"
 *   - COLUNAS declaradas no Drizzle que NÃO existem na tabela → "Unknown column"
 * (colunas extras no banco, não declaradas no Drizzle, são apenas informativas)
 *
 * Uso:
 *   DATABASE_URL="mysql://user:senha@host:3306/db" pnpm db:audit
 *
 * Sai com código 1 se houver divergências (útil como gate), 2 em erro de execução, 0 se alinhado.
 * NÃO altera nada — somente leitura (INFORMATION_SCHEMA).
 */

import mysql, { type RowDataPacket } from "mysql2/promise";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL não definido. Ex.: DATABASE_URL="mysql://user:senha@host:3306/db" pnpm db:audit');
    process.exit(2);
  }

  const conn = await mysql.createConnection(url);
  const [dbRows] = await conn.query<RowDataPacket[]>("SELECT DATABASE() AS db");
  const dbName = String(dbRows[0]?.db ?? "");
  const [colRows] = await conn.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ?",
    [dbName],
  );
  await conn.end();

  // Schema REAL: tabela → conjunto de colunas.
  const actual = new Map<string, Set<string>>();
  for (const r of colRows) {
    const t = String(r.TABLE_NAME);
    if (!actual.has(t)) actual.set(t, new Set());
    actual.get(t)!.add(String(r.COLUMN_NAME));
  }

  const missingTables: string[] = [];
  const missingColumns: Array<{ table: string; columns: string[] }> = [];
  let drizzleTables = 0;

  for (const value of Object.values(schema)) {
    if (!is(value, MySqlTable)) continue;
    drizzleTables++;
    const cfg = getTableConfig(value);
    const expectedCols = cfg.columns.map((c) => c.name);
    const act = actual.get(cfg.name);
    if (!act) { missingTables.push(cfg.name); continue; }
    const missing = expectedCols.filter((c) => !act.has(c));
    if (missing.length) missingColumns.push({ table: cfg.name, columns: missing });
  }

  console.info(`\n=== Auditoria de schema — Drizzle × banco "${dbName}" ===`);
  console.info(`Tabelas Drizzle inspecionadas: ${drizzleTables} | Tabelas no banco: ${actual.size}\n`);

  if (missingTables.length === 0 && missingColumns.length === 0) {
    console.info("✅ Alinhado: todas as tabelas e colunas declaradas no Drizzle existem no banco.");
    process.exit(0);
  }

  if (missingTables.length) {
    console.info(`❌ TABELAS ausentes no banco (${missingTables.length}):`);
    for (const t of missingTables.sort()) console.info(`   - ${t}`);
    console.info("");
  }
  if (missingColumns.length) {
    console.info(`⚠️  COLUNAS ausentes no banco (${missingColumns.length} tabela(s)):`);
    for (const m of missingColumns.sort((a, b) => a.table.localeCompare(b.table))) {
      console.info(`   - ${m.table}: ${m.columns.join(", ")}`);
    }
    console.info("");
  }

  const totalCols = missingColumns.reduce((s, m) => s + m.columns.length, 0);
  console.info(`Resumo: ${missingTables.length} tabela(s) ausente(s), ${totalCols} coluna(s) ausente(s).`);
  console.info("Ação sugerida: gerar/rodar as migrations pendentes (drizzle-kit) ou alinhar o banco ao Drizzle.");
  process.exit(1);
}

main().catch((e) => { console.error("Falha na auditoria de schema:", e instanceof Error ? e.message : e); process.exit(2); });
