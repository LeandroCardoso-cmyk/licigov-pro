/**
 * Integridade da cadeia de migrations — guarda ESTÁTICA (sem banco).
 *
 * O migrator do drizzle executa cada chunk (separado por "--> statement-breakpoint")
 * como UMA query via mysql2 SEM multipleStatements — um chunk com 2+ statements quebra
 * com ER_PARSE_ERROR em qualquer banco zerado (staging/CI). Esse defeito existia em 30
 * migrations antigas e nunca apareceu porque a produção nasceu de db:push (a cadeia
 * completa nunca tinha sido executada do zero até o smoke de reconciliação).
 *
 * Editar o CONTEÚDO de migration antiga é seguro: o migrator decide o que aplicar
 * apenas pelo timestamp do journal (created_at < folderMillis) — nunca re-executa.
 *
 * Este teste garante que TODA migration (passada e futura) tem no máximo 1 statement
 * por chunk, e que o journal e os arquivos estão 1:1.
 *
 * EXCEÇÃO — rotinas armazenadas (CREATE PROCEDURE/FUNCTION/TRIGGER ... BEGIN ... END): o corpo
 * da rotina contém `;` internos, mas o bloco inteiro é UM ÚNICO statement de topo — o servidor o
 * parseia como uma só query (o `;` interno é do corpo, não separador de topo; DELIMITER é só do
 * cliente CLI, irrelevante no protocolo). Portanto mysql2 SEM multipleStatements aplica um chunk
 * de rotina numa única query sem quebrar (comprovado no reconciliation-mysql-smoke, que roda a
 * 0297 com procedures via migrate() e via query() num MySQL/MariaDB real). A contagem por `;`
 * NÃO se aplica a esses chunks.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DRIZZLE_DIR = path.join(process.cwd(), "drizzle");

const migrationFiles = readdirSync(DRIZZLE_DIR)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

// Um chunk que é uma rotina armazenada (CREATE PROCEDURE/FUNCTION/TRIGGER com bloco BEGIN…END)
// é UM único statement de topo, apesar dos `;` internos — não conta por `;`.
const ROUTINE_RE = /\bCREATE\s+(?:DEFINER\s*=\s*\S+\s+)?(?:PROCEDURE|FUNCTION|TRIGGER)\b/i;

function chunkStatementCounts(file: string): Array<{ chunk: number; statements: number }> {
  const sql = readFileSync(path.join(DRIZZLE_DIR, file), "utf8");
  return sql.split("--> statement-breakpoint").map((chunk, i) => {
    const body = chunk.replace(/^\s*--.*$/gm, "").trim();
    if (body.length === 0) return { chunk: i, statements: 0 };
    // Rotina armazenada: bloco único de topo (o `;` do corpo não separa statements de topo).
    if (ROUTINE_RE.test(body) && /\bBEGIN\b/i.test(body) && /\bEND\b/i.test(body)) {
      return { chunk: i, statements: 1 };
    }
    const statements = Math.max(1, (body.match(/;\s*$/gm) ?? []).length);
    return { chunk: i, statements };
  });
}

describe("Cadeia de migrations · integridade", () => {
  it("existem migrations e o journal está 1:1 com os arquivos", () => {
    expect(migrationFiles.length).toBeGreaterThan(280);
    const journal = JSON.parse(readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8"));
    expect(journal.entries.length).toBe(migrationFiles.length);
    const tags = new Set(journal.entries.map((e: { tag: string }) => e.tag));
    for (const file of migrationFiles) {
      expect(tags.has(file.replace(/\.sql$/, "")), `journal sem entry para ${file}`).toBe(true);
    }
  });

  it.each(migrationFiles)("%s: no máximo 1 statement por chunk (compatível com o migrator)", (file) => {
    const offending = chunkStatementCounts(file).filter((c) => c.statements > 1);
    expect(
      offending,
      `${file} tem chunk(s) multi-statement ${JSON.stringify(offending)} — insira "--> statement-breakpoint" entre os statements`
    ).toEqual([]);
  });
});
