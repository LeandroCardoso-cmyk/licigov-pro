/**
 * Utilitários puros da auditoria de schema (sem I/O — testáveis sem banco).
 */

/** Normaliza um nome para snake_case minúsculo (camelCase → snake_case). */
export function toSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

export interface SchemaDiff {
  /** Tabelas declaradas no Drizzle que não existem no banco. */
  readonly missingTables: string[];
  /** Colunas que não existem no banco nem sob outro nome/caixa → precisam ser ADICIONADAS. */
  readonly absentColumns: Array<{ table: string; columns: string[] }>;
  /** Colunas que existem no banco com NOME/CAIXA diferente (ex.: Drizzle camelCase × banco snake_case). */
  readonly mismatchColumns: Array<{ table: string; pairs: Array<{ drizzle: string; db: string }> }>;
}

/**
 * Compara o schema esperado (Drizzle: tabela → colunas) com o real (banco: tabela → conjunto de
 * colunas), classificando cada divergência. Uma coluna esperada é:
 *   - IGUAL      se o banco tem exatamente o mesmo nome;
 *   - DIVERGENTE se o banco tem uma coluna com o mesmo nome normalizado (snake_case);
 *   - AUSENTE    caso contrário.
 */
export function diffSchema(
  expected: Map<string, readonly string[]>,
  actual: Map<string, Set<string>>,
): SchemaDiff {
  const missingTables: string[] = [];
  const absentColumns: SchemaDiff["absentColumns"] = [];
  const mismatchColumns: SchemaDiff["mismatchColumns"] = [];

  for (const [table, cols] of expected) {
    const act = actual.get(table);
    if (!act) { missingTables.push(table); continue; }
    const byNorm = new Map<string, string>();
    for (const dbCol of act) byNorm.set(toSnake(dbCol), dbCol);

    const absent: string[] = [];
    const mism: Array<{ drizzle: string; db: string }> = [];
    for (const col of cols) {
      if (act.has(col)) continue;
      const db = byNorm.get(toSnake(col));
      if (db) mism.push({ drizzle: col, db });
      else absent.push(col);
    }
    if (absent.length) absentColumns.push({ table, columns: absent });
    if (mism.length) mismatchColumns.push({ table, pairs: mism });
  }

  return { missingTables: missingTables.sort(), absentColumns, mismatchColumns };
}
