/**
 * Gate de FKs do schema (HD-26) — EXTENSÃO do tooling existente (`scripts/schema-audit.ts` e `collectSchemaProblems` do
 * boot), não um sistema paralelo: ambos chamam `collectForeignKeyContractProblems`. O repositório tinha ZERO FKs; este gate
 * reconhece as FKs críticas do primeiro bounded context que as usa e detecta:
 *
 *   MISSING_CRITICAL_FK              FK crítica ausente
 *   WRONG_FK_COLUMNS                 FK existe, mas aponta para colunas/tabela erradas
 *   TENANT_MISSING_FROM_COMPOSITE_FK o tenant não lidera a FK (filho ou pai)
 *   INCOMPATIBLE_PARENT_INDEX        o pai não tem a chave ÚNICA exata referenciada
 *   MISSING_CHILD_INDEX              o filho não tem índice à esquerda com as colunas da FK
 *   FORBIDDEN_CASCADE                ON DELETE/ON UPDATE diferente de RESTRICT/NO ACTION
 *   UNEXPECTED_FOREIGN_KEY           FK fora do contrato (inclusive de/para tabelas produtivas existentes)
 *   PARTIAL_MIGRATION_STATE          só PARTE das tabelas do bounded context existe
 *
 * A comparação é PURA (`diffForeignKeyContract`, testável sem banco); `readObservedStructure` só lê INFORMATION_SCHEMA.
 */
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { INSTITUTIONAL_TEMPLATES_FK_CONTRACT } from "./institutionalTemplates/schemaContract";

export type ReferentialRule = "RESTRICT" | "NO ACTION";

export interface CriticalForeignKey {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly refTable: string;
  readonly refColumns: readonly string[];
  readonly onDelete: ReferentialRule;
  readonly onUpdate: ReferentialRule;
}

export interface ForeignKeyContract {
  readonly name: string;
  readonly tenantColumn: string;
  readonly tables: readonly string[];
  readonly foreignKeys: readonly CriticalForeignKey[];
}

export interface ObservedForeignKey {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly refTable: string;
  readonly refColumns: readonly string[];
  readonly deleteRule: string;
  readonly updateRule: string;
}

export interface ObservedIndex {
  readonly table: string;
  readonly name: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
}

export interface ObservedStructure {
  readonly tables: ReadonlySet<string>;
  readonly foreignKeys: readonly ObservedForeignKey[];
  readonly indexes: readonly ObservedIndex[];
}

export type SchemaGuardCode =
  | "CONTRACT_INVALID" | "PARTIAL_MIGRATION_STATE" | "MISSING_CRITICAL_FK" | "WRONG_FK_COLUMNS"
  | "TENANT_MISSING_FROM_COMPOSITE_FK" | "INCOMPATIBLE_PARENT_INDEX" | "MISSING_CHILD_INDEX" | "FORBIDDEN_CASCADE" | "UNEXPECTED_FOREIGN_KEY";

export interface SchemaGuardProblem {
  readonly code: SchemaGuardCode;
  readonly table: string;
  readonly constraint?: string;
  readonly message: string;
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const startsWith = (cols: readonly string[], prefix: readonly string[]): boolean => prefix.length <= cols.length && prefix.every((v, i) => cols[i] === v);
const SAFE_RULES: readonly string[] = ["RESTRICT", "NO ACTION"];

/** O próprio contrato precisa respeitar as regras (tenant lidera, só RESTRICT/NO ACTION, tabelas declaradas). */
export function validateForeignKeyContract(contract: ForeignKeyContract): SchemaGuardProblem[] {
  const out: SchemaGuardProblem[] = [];
  const tables = new Set(contract.tables);
  for (const f of contract.foreignKeys) {
    if (f.columns[0] !== contract.tenantColumn || f.refColumns[0] !== contract.tenantColumn) {
      out.push({ code: "TENANT_MISSING_FROM_COMPOSITE_FK", table: f.table, constraint: f.name, message: `contrato: ${f.name} precisa liderar com ${contract.tenantColumn} nos dois lados` });
    }
    if (f.columns.length !== f.refColumns.length) {
      out.push({ code: "CONTRACT_INVALID", table: f.table, constraint: f.name, message: `contrato: ${f.name} com número de colunas diferente entre filho e pai` });
    }
    if (!SAFE_RULES.includes(f.onDelete) || !SAFE_RULES.includes(f.onUpdate)) {
      out.push({ code: "FORBIDDEN_CASCADE", table: f.table, constraint: f.name, message: `contrato: ${f.name} só pode usar RESTRICT/NO ACTION` });
    }
    if (!tables.has(f.table) || !tables.has(f.refTable)) {
      out.push({ code: "UNEXPECTED_FOREIGN_KEY", table: f.table, constraint: f.name, message: `contrato: ${f.name} referencia tabela fora do bounded context` });
    }
  }
  return out;
}

/** Comparação PURA contrato × estrutura observada. Sem I/O. */
export function diffForeignKeyContract(contract: ForeignKeyContract, observed: ObservedStructure): SchemaGuardProblem[] {
  const out: SchemaGuardProblem[] = [];
  const inContext = new Set(contract.tables);
  const present = contract.tables.filter((t) => observed.tables.has(t));
  const absent = contract.tables.filter((t) => !observed.tables.has(t));

  // estado PARCIAL: só parte das tabelas existe (nenhuma = migration ainda não aplicada → o ledger do boot já reporta)
  if (present.length > 0 && absent.length > 0) {
    out.push({ code: "PARTIAL_MIGRATION_STATE", table: absent[0], message: `estado parcial da migration: existem ${present.length} de ${contract.tables.length} tabelas; ausentes: ${absent.join(", ")}` });
  }

  // FKs observadas fora do contrato (de/para o bounded context) e regras proibidas em QUALQUER FK do contexto
  const declared = new Set(contract.foreignKeys.map((f) => `${f.table}.${f.name}`));
  for (const o of observed.foreignKeys) {
    const touches = inContext.has(o.table) || inContext.has(o.refTable);
    if (!touches) continue;
    if (!declared.has(`${o.table}.${o.name}`)) {
      out.push({ code: "UNEXPECTED_FOREIGN_KEY", table: o.table, constraint: o.name, message: `FK ${o.table}.${o.name} → ${o.refTable} não está no contrato (tabelas produtivas existentes não ganham FK)` });
    }
    if (!SAFE_RULES.includes(o.deleteRule) || !SAFE_RULES.includes(o.updateRule)) {
      out.push({ code: "FORBIDDEN_CASCADE", table: o.table, constraint: o.name, message: `FK ${o.table}.${o.name} usa ON DELETE ${o.deleteRule} / ON UPDATE ${o.updateRule}; só RESTRICT/NO ACTION` });
    }
  }

  for (const f of contract.foreignKeys) {
    if (!observed.tables.has(f.table) || !observed.tables.has(f.refTable)) continue; // reportado como estado parcial
    const found = observed.foreignKeys.find((o) => o.table === f.table && o.name === f.name);
    if (!found) {
      out.push({ code: "MISSING_CRITICAL_FK", table: f.table, constraint: f.name, message: `FK crítica ausente: ${f.table}.${f.name} (${f.columns.join(", ")}) → ${f.refTable}(${f.refColumns.join(", ")})` });
    } else if (found.columns[0] !== contract.tenantColumn || found.refColumns[0] !== contract.tenantColumn) {
      out.push({ code: "TENANT_MISSING_FROM_COMPOSITE_FK", table: f.table, constraint: f.name, message: `${f.table}.${f.name} não é uma FK composta de tenant (${contract.tenantColumn} deve liderar filho e pai; observado: (${found.columns.join(", ")}) → ${found.refTable}(${found.refColumns.join(", ")}))` });
    } else if (found.refTable !== f.refTable || !same(found.columns, f.columns) || !same(found.refColumns, f.refColumns)) {
      out.push({ code: "WRONG_FK_COLUMNS", table: f.table, constraint: f.name, message: `${f.table}.${f.name} aponta para o alvo errado: esperado (${f.columns.join(", ")}) → ${f.refTable}(${f.refColumns.join(", ")}); observado (${found.columns.join(", ")}) → ${found.refTable}(${found.refColumns.join(", ")})` });
    }

    // pai: chave ÚNICA exata (PRIMARY ou UNIQUE) com as colunas referenciadas
    const parentOk = observed.indexes.some((i) => i.table === f.refTable && i.unique && same(i.columns, f.refColumns));
    if (!parentOk) {
      out.push({ code: "INCOMPATIBLE_PARENT_INDEX", table: f.refTable, constraint: f.name, message: `o pai ${f.refTable} não tem UNIQUE/PRIMARY exato em (${f.refColumns.join(", ")}) exigido por ${f.name}` });
    }
    // filho: índice com as colunas da FK à esquerda
    const childOk = observed.indexes.some((i) => i.table === f.table && startsWith(i.columns, f.columns));
    if (!childOk) {
      out.push({ code: "MISSING_CHILD_INDEX", table: f.table, constraint: f.name, message: `o filho ${f.table} não tem índice à esquerda em (${f.columns.join(", ")}) para ${f.name}` });
    }
  }
  return out;
}

const format = (p: SchemaGuardProblem): string => `[${p.code}] ${p.message}`;

/** Lê a estrutura REAL (INFORMATION_SCHEMA) das tabelas do contrato e das FKs que as tocam. Somente leitura. */
export async function readObservedStructure(connection: mysql.Connection, tables: readonly string[]): Promise<ObservedStructure> {
  const [tableRows] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)", [tables]);
  const [fkRows] = await connection.query<RowDataPacket[]>(
    `SELECT k.CONSTRAINT_NAME AS n, k.TABLE_NAME AS t, k.COLUMN_NAME AS c, k.ORDINAL_POSITION AS o,
            k.REFERENCED_TABLE_NAME AS rt, k.REFERENCED_COLUMN_NAME AS rc, r.DELETE_RULE AS d, r.UPDATE_RULE AS u
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
      WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
        AND (k.TABLE_NAME IN (?) OR k.REFERENCED_TABLE_NAME IN (?))
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [tables, tables]);
  const [idxRows] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS n, NON_UNIQUE AS nu, COLUMN_NAME AS c, SEQ_IN_INDEX AS s
       FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [tables]);

  const fks = new Map<string, { name: string; table: string; columns: string[]; refTable: string; refColumns: string[]; deleteRule: string; updateRule: string }>();
  for (const r of fkRows) {
    const key = `${r.t}\u0000${r.n}`;
    const cur = fks.get(key) ?? { name: String(r.n), table: String(r.t), columns: [], refTable: String(r.rt), refColumns: [], deleteRule: String(r.d), updateRule: String(r.u) };
    cur.columns.push(String(r.c)); cur.refColumns.push(String(r.rc));
    fks.set(key, cur);
  }
  const idx = new Map<string, { table: string; name: string; unique: boolean; columns: string[] }>();
  for (const r of idxRows) {
    const key = `${r.t}\u0000${r.n}`;
    const cur = idx.get(key) ?? { table: String(r.t), name: String(r.n), unique: Number(r.nu) === 0, columns: [] };
    cur.columns.push(String(r.c));
    idx.set(key, cur);
  }
  return { tables: new Set(tableRows.map((r) => String(r.t))), foreignKeys: [...fks.values()], indexes: [...idx.values()] };
}

/** Problemas estruturados do contrato contra o banco real (usado pelos testes e pelo `db:audit`). */
export async function checkForeignKeyContract(
  connection: mysql.Connection, contract: ForeignKeyContract = INSTITUTIONAL_TEMPLATES_FK_CONTRACT,
): Promise<SchemaGuardProblem[]> {
  const observed = await readObservedStructure(connection, contract.tables);
  return [...validateForeignKeyContract(contract), ...diffForeignKeyContract(contract, observed)];
}

/** Mesmos problemas, em texto — a forma que `collectSchemaProblems` (boot) e o `db:audit` consomem. */
export async function collectForeignKeyContractProblems(
  connection: mysql.Connection, contract: ForeignKeyContract = INSTITUTIONAL_TEMPLATES_FK_CONTRACT,
): Promise<string[]> {
  return (await checkForeignKeyContract(connection, contract)).map(format);
}
