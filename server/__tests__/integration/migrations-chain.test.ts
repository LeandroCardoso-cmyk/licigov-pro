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
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DRIZZLE_DIR = path.join(process.cwd(), "drizzle");

const migrationFiles = readdirSync(DRIZZLE_DIR)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

function chunkStatementCounts(file: string): Array<{ chunk: number; statements: number }> {
  const sql = readFileSync(path.join(DRIZZLE_DIR, file), "utf8");
  return sql.split("--> statement-breakpoint").map((chunk, i) => {
    const body = chunk.replace(/^\s*--.*$/gm, "").trim();
    const statements = body.length === 0 ? 0 : Math.max(1, (body.match(/;\s*$/gm) ?? []).length);
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
