/**
 * Auditoria de schema — Drizzle × banco real (produção/staging).
 *
 * Compara o schema declarado no Drizzle (drizzle/schema.ts) com o real (INFORMATION_SCHEMA) e
 * classifica as divergências:
 *   - TABELAS ausentes             → não existem no banco (precisam ser criadas)
 *   - COLUNAS ausentes             → não existem nem sob outro nome (precisam ser adicionadas)
 *   - COLUNAS com nome divergente  → existem com outro nome/caixa (ex.: Drizzle camelCase × banco
 *                                    snake_case) → alinhar o SCHEMA (Drizzle), não o banco
 *
 * Uso:
 *   DATABASE_URL="mysql://user:senha@host:3306/db" pnpm db:audit
 *
 * Somente leitura. Exit 1 se houver divergências, 2 em erro de execução, 0 se alinhado.
 */

import mysql, { type RowDataPacket } from "mysql2/promise";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";
import { diffSchema } from "./schema-audit-util";

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

  // Real: tabela → conjunto de colunas.
  const actual = new Map<string, Set<string>>();
  for (const r of colRows) {
    const t = String(r.TABLE_NAME);
    if (!actual.has(t)) actual.set(t, new Set());
    actual.get(t)!.add(String(r.COLUMN_NAME));
  }

  // Esperado: tabela (Drizzle) → colunas declaradas.
  const expected = new Map<string, readonly string[]>();
  for (const value of Object.values(schema)) {
    if (!is(value, MySqlTable)) continue;
    const cfg = getTableConfig(value);
    expected.set(cfg.name, cfg.columns.map((c) => c.name));
  }

  const { missingTables, absentColumns, mismatchColumns } = diffSchema(expected, actual);

  console.info(`\n=== Auditoria de schema — Drizzle × banco "${dbName}" ===`);
  console.info(`Tabelas Drizzle: ${expected.size} | Tabelas no banco: ${actual.size}\n`);

  if (!missingTables.length && !absentColumns.length && !mismatchColumns.length) {
    console.info("✅ Alinhado: todas as tabelas/colunas do Drizzle existem no banco com o mesmo nome.");
    process.exit(0);
  }

  if (missingTables.length) {
    console.info(`❌ TABELAS ausentes no banco (${missingTables.length}) — criar via migration:`);
    for (const t of missingTables) console.info(`   - ${t}`);
    console.info("");
  }
  if (absentColumns.length) {
    const n = absentColumns.reduce((s, m) => s + m.columns.length, 0);
    console.info(`❌ COLUNAS realmente AUSENTES (${n}) — não existem no banco, ADICIONAR via migration:`);
    for (const m of [...absentColumns].sort((a, b) => a.table.localeCompare(b.table))) {
      console.info(`   - ${m.table}: ${m.columns.join(", ")}`);
    }
    console.info("");
  }
  if (mismatchColumns.length) {
    const n = mismatchColumns.reduce((s, m) => s + m.pairs.length, 0);
    console.info(`⚠️  COLUNAS com NOME DIVERGENTE (${n}) — existem no banco com outro nome/caixa`);
    console.info(`    (ex.: Drizzle camelCase × banco snake_case). Corrigir o SCHEMA Drizzle, NÃO o banco:`);
    for (const m of [...mismatchColumns].sort((a, b) => a.table.localeCompare(b.table))) {
      console.info(`   - ${m.table}: ${m.pairs.map((p) => `${p.drizzle} → ${p.db}`).join(", ")}`);
    }
    console.info("");
  }

  const absN = absentColumns.reduce((s, m) => s + m.columns.length, 0);
  const misN = mismatchColumns.reduce((s, m) => s + m.pairs.length, 0);
  console.info(`Resumo: ${missingTables.length} tabela(s) ausente(s) · ${absN} coluna(s) ausente(s) · ${misN} coluna(s) com nome divergente.`);
  console.info("Ação: 'ausentes' → migration para criar/adicionar; 'nome divergente' → alinhar o Drizzle ao banco (snake_case). Revisar em staging antes de produção.");
  process.exit(1);
}

main().catch((e) => { console.error("Falha na auditoria de schema:", e instanceof Error ? e.message : e); process.exit(2); });
