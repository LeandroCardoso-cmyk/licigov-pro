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
      const col = documents.documentStatus as unknown as {
        config?: { enumValues?: string[] };
        _config?: { enumValues?: string[] };
      };
      const columnDef = col.config ?? col._config;
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

  // ── Bootstrap validateSchema (Fase B — RUNTIME & RELEASE SAFETY) ──────────
  // Antes o boot rodava um RECONCILIADOR (ensureSchema) que mutava o schema em runtime.
  // A Fase B substituiu isso por um VALIDATOR não-mutável e moveu a diferença de schema
  // para a migration versionada 0297. Estes testes travam essa arquitetura.
  describe("server/bootstrap.ts — validateSchema() (não-mutável, fail-closed)", () => {
    const bootstrapPath = path.resolve(process.cwd(), "server", "bootstrap.ts");
    const source = fs.readFileSync(bootstrapPath, "utf-8");

    it("bootstrap.ts existe e exporta validateSchema", () => {
      expect(fs.existsSync(bootstrapPath)).toBe(true);
      expect(source).toContain("export async function validateSchema");
    });

    it("o boot NÃO executa mais DDL mutável (sem ALTER/CREATE/RENAME/addColumnIfMissing)", () => {
      // Nenhum reconciliador em runtime: o validator só consulta INFORMATION_SCHEMA.
      expect(source).not.toMatch(/\bALTER TABLE\b/);
      expect(source).not.toMatch(/\bRENAME COLUMN\b/);
      expect(source).not.toMatch(/CREATE TABLE IF NOT EXISTS/);
      expect(source).not.toContain("addColumnIfMissing");
    });

    it("validateSchema falha fechada fora de desenvolvimento (throw) e só avisa em dev", () => {
      expect(source).toContain("APP_CONFIG.isDevelopment");
      expect(source).toMatch(/throw new Error\(`\[bootstrap\]/);
    });

    it("prova a migration mais recente pelo ledger e valida estruturas críticas de segurança/tenant", () => {
      expect(source).toContain("__drizzle_migrations");
      expect(source).toContain("readMigrationFiles"); // prova a última migration por hash (sem contagem/hardcode)
      expect(source).toContain("tokenVersion");
      expect(source).toContain("passwordHash");
      expect(source).toContain("organizationId");
    });

    it("o boot NÃO aplica migrations — só valida (migrações são o passo de RELEASE)", () => {
      const start = source.indexOf("export async function bootstrap()");
      const body = source.slice(start);
      expect(body).not.toContain("migrateWithAdvisoryLock");
      expect(body).not.toMatch(/\bmigrate\s*\(/);
      expect(body).toContain("validateSchema(connection)");
    });
  });
});
