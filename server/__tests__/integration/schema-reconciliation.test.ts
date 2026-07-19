/**
 * Reconciliação de schema — testes ESTÁTICOS (sem banco).
 *
 * Garante a paridade entre o manifesto da auditoria (17 tabelas + 54 colunas) e os dois
 * artefatos que corrigem a produção:
 *   - drizzle/0285_schema_reconciliation.sql (tabelas, CREATE TABLE IF NOT EXISTS)
 *   - server/bootstrap.ts → ensureSchema (colunas, addColumnIfMissing)
 *
 * Também blinda as regras de segurança: migration puramente aditiva (sem DROP/ALTER),
 * journal com idx 285, e o bloco de colunas DENTRO de ensureSchema (regressão do bug
 * "código depois do fechamento da função" de sprints anteriores).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MISSING_TABLES,
  MISSING_COLUMNS,
  MISSING_COLUMNS_TOTAL,
} from "../../../scripts/schema-reconciliation-manifest";

const ROOT = process.cwd();
const MIGRATION_PATH = path.join(ROOT, "drizzle", "0285_schema_reconciliation.sql");
const JOURNAL_PATH = path.join(ROOT, "drizzle", "meta", "_journal.json");
const BOOTSTRAP_PATH = path.join(ROOT, "server", "bootstrap.ts");

function migrationStatements(): string[] {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim()) // remove comentários de cabeçalho
    .filter((s) => s.length > 0);
}

describe("Reconciliação · manifesto", () => {
  it("cobre exatamente 17 tabelas e 54 colunas (números da auditoria)", () => {
    expect(MISSING_TABLES).toHaveLength(17);
    expect(MISSING_COLUMNS_TOTAL).toBe(54);
  });

  it("tabelas do manifesto não se sobrepõem às tabelas das colunas (tabela ausente × tabela existente)", () => {
    for (const table of Object.keys(MISSING_COLUMNS)) {
      expect(MISSING_TABLES).not.toContain(table);
    }
  });
});

describe("Reconciliação · migration 0285 (tabelas)", () => {
  it("contém exatamente um CREATE TABLE IF NOT EXISTS por tabela ausente", () => {
    const stmts = migrationStatements();
    expect(stmts).toHaveLength(MISSING_TABLES.length);

    const created = stmts.map((s) => {
      const m = s.match(/^CREATE TABLE IF NOT EXISTS `([^`]+)`/);
      expect(m, `Statement inesperado (não é CREATE TABLE IF NOT EXISTS):\n${s.slice(0, 120)}`).toBeTruthy();
      return m![1];
    });
    expect([...created].sort()).toEqual([...MISSING_TABLES].sort());
  });

  it("é puramente aditiva — nenhum statement DROP/ALTER/UPDATE/DELETE/TRUNCATE/RENAME", () => {
    // Verificação por STATEMENT (o texto "on update CURRENT_TIMESTAMP" dentro de uma
    // definição de coluna é legítimo e não conta como comando UPDATE).
    for (const stmt of migrationStatements()) {
      expect(stmt).toMatch(/^CREATE TABLE IF NOT EXISTS /);
      expect(stmt).not.toMatch(/^(DROP|ALTER|UPDATE|DELETE|TRUNCATE|RENAME)\b/i);
    }
  });

  it("está registrada no journal como idx 285 (última entry, tag correta)", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const last = journal.entries[journal.entries.length - 1];
    expect(last.idx).toBe(285);
    expect(last.tag).toBe("0285_schema_reconciliation");
    expect(last.breakpoints).toBe(true);
    // idx únicos e sequenciais no fim (sanidade do journal)
    const prev = journal.entries[journal.entries.length - 2];
    expect(prev.idx).toBe(284);
  });
});

describe("Reconciliação · bootstrap ensureSchema (colunas)", () => {
  const source = readFileSync(BOOTSTRAP_PATH, "utf8");

  // Corpo de ensureSchema: da assinatura até o marcador do Step 3 (seed admin).
  const start = source.indexOf("export async function ensureSchema");
  const end = source.indexOf("Step 3: seed admin");
  const body = source.slice(start, end);

  it("ensureSchema existe e o marcador do Step 3 vem depois dele", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it.each(Object.entries(MISSING_COLUMNS).flatMap(([table, cols]) => cols.map((c) => [table, c])))(
    "adiciona %s.%s via addColumnIfMissing DENTRO de ensureSchema",
    (table, column) => {
      const call = new RegExp(
        `addColumnIfMissing\\(\\s*"${table}"\\s*,\\s*"${column}"\\s*,`
      );
      expect(body, `Faltou addColumnIfMissing("${table}", "${column}") no corpo de ensureSchema`).toMatch(call);
    }
  );

  it("o bloco de reconciliação está antes do fechamento da função (sem código órfão)", () => {
    // A última chamada do bloco aparece no corpo extraído, seguida do fechamento da
    // função ("}" no início de linha) e de NADA executável depois (só o comentário
    // separador do Step 3) — regressão do bug "código depois do fechamento".
    const lastCall = body.lastIndexOf('addColumnIfMissing("semantic_search_entries", "catmatClass"');
    expect(lastCall).toBeGreaterThan(-1);
    const tail = body.slice(lastCall);
    const closing = tail.indexOf("\n}");
    expect(closing, "fechamento da função não encontrado após o bloco").toBeGreaterThan(-1);
    const afterClosing = tail.slice(closing + 2);
    expect(afterClosing).not.toMatch(/\bawait\b|\baddColumnIfMissing\b|connection\.execute/);
  });
});
