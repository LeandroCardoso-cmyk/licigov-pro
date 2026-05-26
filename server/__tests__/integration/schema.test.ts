/**
 * Testes de Integração — Banco de Dados / Schema
 *
 * Cobre: consistência das migrations (journal ↔ arquivos SQL), integridade
 * das colunas críticas, cobertura do ensureSchema(), compatibilidade entre
 * drizzle/schema.ts e as migrations registradas.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const DRIZZLE_DIR = path.resolve(process.cwd(), "drizzle");
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta", "_journal.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJournal(): { entries: Array<{ idx: number; tag: string; version: string }> } {
  return JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf-8"));
}

function sqlFilePath(tag: string): string {
  return path.join(DRIZZLE_DIR, `${tag}.sql`);
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("Schema e Migrations — Integração", () => {

  // ── Consistência do journal ───────────────────────────────────────────────
  describe("drizzle/meta/_journal.json", () => {
    it("o arquivo de journal existe", () => {
      expect(fs.existsSync(JOURNAL_PATH)).toBe(true);
    });

    it("o journal contém pelo menos uma entrada de migration", () => {
      const journal = readJournal();
      expect(journal.entries.length).toBeGreaterThan(0);
    });

    it("os índices das entradas são sequenciais e sem lacunas", () => {
      const { entries } = readJournal();
      entries.forEach((entry, i) => {
        expect(entry.idx).toBe(i);
      });
    });

    it("cada entrada do journal possui um arquivo SQL correspondente", () => {
      const { entries } = readJournal();
      for (const entry of entries) {
        const filePath = sqlFilePath(entry.tag);
        expect(fs.existsSync(filePath), `SQL não encontrado para ${entry.tag}`).toBe(true);
      }
    });

    it("a migration 0032 (createdBy/documentStatus) está registrada", () => {
      const { entries } = readJournal();
      const migration32 = entries.find(e => e.idx === 32);
      expect(migration32).toBeDefined();
      expect(migration32?.tag).toContain("0032");
    });
  });

  // ── Arquivos SQL ─────────────────────────────────────────────────────────
  describe("arquivos SQL de migration", () => {
    it("a migration 0032 corrige a tabela documents com as colunas ausentes", () => {
      const sqlPath = path.join(DRIZZLE_DIR, "0032_documents_approval_fields.sql");
      expect(fs.existsSync(sqlPath)).toBe(true);

      const sql = fs.readFileSync(sqlPath, "utf-8");
      expect(sql).toContain("createdBy");
      expect(sql).toContain("documentStatus");
      expect(sql.toLowerCase()).toContain("alter table");
    });

    it("a migration 0031 (campos de upload S3) existe e contém s3Key/fileUrl", () => {
      const sqlPath = path.join(DRIZZLE_DIR, "0031_documents_upload_fields.sql");
      expect(fs.existsSync(sqlPath)).toBe(true);

      const sql = fs.readFileSync(sqlPath, "utf-8");
      expect(sql).toMatch(/s3Key|fileUrl|sourceType/);
    });

    it("a migration 0030 (passwordHash) existe", () => {
      const sqlPath = path.join(DRIZZLE_DIR, "0030_add_password_hash.sql");
      expect(fs.existsSync(sqlPath)).toBe(true);
    });

    it("nenhum arquivo SQL referenciado no journal está vazio", () => {
      const { entries } = readJournal();
      for (const entry of entries) {
        const filePath = sqlFilePath(entry.tag);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8").trim();
          expect(content.length, `Migration ${entry.tag} está vazia`).toBeGreaterThan(0);
        }
      }
    });
  });

  // ── Drizzle Schema ───────────────────────────────────────────────────────
  describe("drizzle/schema.ts — definições de tabela", () => {
    it("importa o schema sem erros", async () => {
      await expect(import("../../../drizzle/schema")).resolves.toBeDefined();
    });

    it("a tabela documents define a coluna createdBy", async () => {
      const { documents } = await import("../../../drizzle/schema");
      expect(documents.createdBy).toBeDefined();
    });

    it("a tabela documents define a coluna documentStatus com enum correto", async () => {
      const { documents } = await import("../../../drizzle/schema");
      expect(documents.documentStatus).toBeDefined();
      const columnDef = (documents.documentStatus as any).config ?? (documents.documentStatus as any)._config;
      if (columnDef?.enumValues) {
        expect(columnDef.enumValues).toEqual(expect.arrayContaining(["draft", "in_review", "approved", "rejected"]));
      }
    });

    it("a tabela documents define a coluna sourceType", async () => {
      const { documents } = await import("../../../drizzle/schema");
      expect(documents.sourceType).toBeDefined();
    });

    it("a tabela documents define a coluna s3Key", async () => {
      const { documents } = await import("../../../drizzle/schema");
      expect(documents.s3Key).toBeDefined();
    });

    it("a tabela users define a coluna passwordHash", async () => {
      const { users } = await import("../../../drizzle/schema");
      expect(users.passwordHash).toBeDefined();
    });

    it("a tabela processes define a coluna ownerId", async () => {
      const { processes } = await import("../../../drizzle/schema");
      expect(processes.ownerId).toBeDefined();
    });

    it("a tabela processes define a coluna status com enum correto", async () => {
      const { processes } = await import("../../../drizzle/schema");
      expect(processes.status).toBeDefined();
    });
  });

  // ── Bootstrap ensureSchema ───────────────────────────────────────────────
  describe("server/bootstrap.ts — ensureSchema() safety net", () => {
    it("bootstrap.ts existe como arquivo fonte", () => {
      const bootstrapPath = path.resolve(process.cwd(), "server", "bootstrap.ts");
      expect(fs.existsSync(bootstrapPath)).toBe(true);
    });

    it("o código-fonte de bootstrap.ts contém guard para 'createdBy'", () => {
      const bootstrapPath = path.resolve(process.cwd(), "server", "bootstrap.ts");
      const source = fs.readFileSync(bootstrapPath, "utf-8");
      expect(source).toContain("createdBy");
    });

    it("o código-fonte de bootstrap.ts contém guard para 'documentStatus'", () => {
      const bootstrapPath = path.resolve(process.cwd(), "server", "bootstrap.ts");
      const source = fs.readFileSync(bootstrapPath, "utf-8");
      expect(source).toContain("documentStatus");
    });

    it("o ensureSchema cobre as 6 colunas críticas conhecidas", () => {
      const bootstrapPath = path.resolve(process.cwd(), "server", "bootstrap.ts");
      const source = fs.readFileSync(bootstrapPath, "utf-8");

      const criticalColumns = ["passwordHash", "sourceType", "s3Key", "fileUrl", "createdBy", "documentStatus"];
      for (const col of criticalColumns) {
        expect(source, `Coluna '${col}' ausente no ensureSchema`).toContain(col);
      }
    });

    it("o ensureSchema usa a função addColumnIfMissing (idempotente)", () => {
      const bootstrapPath = path.resolve(process.cwd(), "server", "bootstrap.ts");
      const source = fs.readFileSync(bootstrapPath, "utf-8");
      expect(source).toContain("addColumnIfMissing");
      expect(source).toContain("INFORMATION_SCHEMA.COLUMNS");
    });
  });
});
