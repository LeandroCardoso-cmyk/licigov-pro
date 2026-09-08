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

  it("está registrada no journal como idx 285, corretamente sequenciada após a 284", () => {
    // Busca por idx (não por "última entry") — migrations legítimas continuam sendo
    // adicionadas depois da 0285 (ex.: 0286), então "última" não é mais um invariante válido.
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const idx285 = journal.entries.find((e: { idx: number }) => e.idx === 285);
    expect(idx285).toBeTruthy();
    expect(idx285.tag).toBe("0285_schema_reconciliation");
    expect(idx285.breakpoints).toBe(true);
    const idx284 = journal.entries.find((e: { idx: number }) => e.idx === 284);
    expect(idx284).toBeTruthy();
  });
});

describe("Reconciliação · colunas migradas para a migration versionada 0297 (Fase B)", () => {
  // Fase B (RUNTIME & RELEASE SAFETY): as colunas que ANTES só o reconciliador em runtime
  // (ensureSchema.addColumnIfMissing / renameColumnIfNeeded) fechava passaram a existir na
  // migration VERSIONADA drizzle/0297_phase_b_schema_closure.sql. Cada coluna do manifesto
  // aparece lá como CALL licigov_pb_add_col('tabela','coluna',…) OU como alvo de um
  // CALL licigov_pb_rename_col('tabela',…,'coluna'). O boot NÃO muta mais o schema.
  const closure = readFileSync(
    path.join(ROOT, "drizzle", "0297_phase_b_schema_closure.sql"),
    "utf8",
  );
  const bootstrap = readFileSync(BOOTSTRAP_PATH, "utf8");

  it("o boot deixou de reconciliar colunas em runtime (sem addColumnIfMissing)", () => {
    expect(bootstrap).not.toContain("addColumnIfMissing");
    expect(bootstrap).toContain("export async function validateSchema");
  });

  // Colunas que ANTES SÓ o reconciliador de runtime fechava (a diferença migrate()-apenas vs
  // migrate()+ensureSchema, calculada empiricamente). Cada uma agora está na migration 0297,
  // como ADD ou como alvo de RENAME. (A prova FUNCIONAL de que a cadeia de migrations produz
  // TODAS as colunas do schema.ts é o cenário CLEAN INSTALL do reconciliation-mysql-smoke,
  // diffSchema 0/0/0 — os manifestos antigos misturam colunas já criadas por migrations
  // anteriores, que não precisam da 0297.)
  const ADDS: ReadonlyArray<readonly [string, string]> = [
    ["users", "tokenVersion"],
    ["process_members", "functionalRole"],
    ["contract_addenda", "request_origin"],
    ["contract_ws_documents", "metadata"],
    ["semantic_chunks", "replay_key"],
    ["legal_reference_nodes", "numero"],
    ["ontology_taxonomy", "category"],
    ["extraction_evidence", "provenanceSheet"],
  ];
  const RENAMES: ReadonlyArray<readonly [string, string]> = [
    ["semantic_search_entries", "organizationId"],
    ["semantic_candidates", "organizationId"],
    ["parser_capabilities", "parserType"],
    ["import_review_transitions", "toState"],
    ["department_permissions", "createdAt"],
  ];

  it.each(ADDS)("a coluna reconciliada %s.%s virou ADD na migration 0297", (table, column) => {
    const asAdd = new RegExp(`licigov_pb_add_col\\(\\s*'${table}'\\s*,\\s*'${column}'\\s*,`);
    expect(asAdd.test(closure), `Faltou add de ${table}.${column} na 0297`).toBe(true);
  });

  it.each(RENAMES)("a coluna reconciliada %s.%s virou RENAME (snake→camel) na 0297", (table, column) => {
    const asRename = new RegExp(
      `licigov_pb_rename_col\\(\\s*'${table}'\\s*,\\s*'[^']+'\\s*,\\s*'${column}'\\s*\\)`,
    );
    expect(asRename.test(closure), `Faltou rename para ${table}.${column} na 0297`).toBe(true);
  });

  it("a migration 0297 nunca faz DROP nem perda de dados (só ADD/RENAME guardados)", () => {
    // Preservadora de dados: o corpo executável não contém DROP COLUMN/TABLE nem DELETE/TRUNCATE
    // (o DROP PROCEDURE dos helpers temporários é legítimo e não toca dados).
    expect(closure).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(closure).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(closure).not.toMatch(/\bTRUNCATE\b/i);
    expect(closure).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
