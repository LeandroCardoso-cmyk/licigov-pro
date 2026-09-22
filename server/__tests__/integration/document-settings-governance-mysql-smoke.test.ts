/**
 * P0 PILOTO — Governança FAIL-CLOSED da identidade institucional (documentSettings) — MySQL real.
 *
 * Prova, contra um MySQL/MariaDB real, que a migration 0302:
 *   • ABORTA (SIGNAL) ANTES de qualquer mutação quando há ambiguidade — sem seleção arbitrária e sem
 *     descarte silencioso: órfão (A), multi-org (B), conflito de tenant (C), conflito de nome (D),
 *     conflito de CNPJ (E). Em todos, prova-se que NADA foi mutado (coluna `userId` intacta, sem
 *     `organizationId`);
 *   • CONVERGE quando não há ambiguidade: membership único migra; linhas semanticamente IDÊNTICAS do
 *     mesmo tenant deduplicam para 1; CNPJ do documentSettings é PRESERVADO promovendo-o para a fonte
 *     canônica `organizations` (F) antes de a coluna duplicada ser removida;
 *   • deixa o modelo final TENANT-SCOPED (1 linha por org, UNIQUE) e SEM duplicidade (sem
 *     `organizationName`/`cnpj` em documentSettings — canônicos só em `organizations`);
 *   • é REPLAY-SAFE em clean install (tabela vazia → no-op determinístico, converge igual).
 *
 * Só roda quando DATABASE_URL está definido (CI com MySQL efêmero). Usa BANCO DEDICADO.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import path from "node:path";

const DB = process.env.DATABASE_URL;
const DRZ = path.join(process.cwd(), "drizzle");
const DBNAME = "doc_settings_gov_smoke";

function baseUrl(): string {
  const u = new URL(DB!);
  u.pathname = "/";
  return u.toString();
}
function urlFor(dbName: string): string {
  const u = new URL(DB!);
  u.pathname = `/${dbName}`;
  return u.toString();
}
/** Statements reais da migration, preservando o corpo das procedures (split só no breakpoint). */
function statements(tag: string): string[] {
  const sql = readFileSync(path.join(DRZ, `${tag}.sql`), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}
const MIGRATION = "0302_document_settings_org_scoped";

/** Reconstrói o schema PRÉ-0302 (organizations canônica + membros + documentSettings per-user). */
async function resetPre0302(conn: mysql.Connection) {
  await conn.query("DROP TABLE IF EXISTS documentSettings");
  await conn.query("DROP TABLE IF EXISTS organization_members");
  await conn.query("DROP TABLE IF EXISTS organizations");
  await conn.query(`CREATE TABLE organizations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    cnpj VARCHAR(18) NULL
  )`);
  await conn.query(`CREATE TABLE organization_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organizationId INT NOT NULL,
    userId INT NOT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1
  )`);
  await conn.query(`CREATE TABLE documentSettings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    organizationName TEXT,
    logoUrl TEXT,
    address TEXT,
    cnpj VARCHAR(18),
    phone VARCHAR(20),
    email VARCHAR(320),
    website VARCHAR(255),
    footerText TEXT,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

/** Aplica a migration inteira; propaga o primeiro erro (SIGNAL) — usado para asserir ABORT/CONVERGE. */
async function applyMigration(conn: mysql.Connection) {
  for (const s of statements(MIGRATION)) await conn.query(s);
}

/** Colunas atuais de documentSettings (prova de "nada mutado" no caso de abort). */
async function columnsOf(conn: mysql.Connection): Promise<string[]> {
  const [cols] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documentSettings'`,
  );
  return cols.map((c) => String(c.COLUMN_NAME));
}

describe.skipIf(!DB)("documentSettings — governança FAIL-CLOSED (MySQL real)", () => {
  let admin: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection(baseUrl());
    await admin.query(`DROP DATABASE IF EXISTS \`${DBNAME}\``);
    await admin.query(`CREATE DATABASE \`${DBNAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  }, 60_000);

  afterAll(async () => {
    const c = await mysql.createConnection(baseUrl());
    try {
      await c.query(`DROP DATABASE IF EXISTS \`${DBNAME}\``);
    } finally {
      await c.end();
    }
    await admin?.end();
  }, 30_000);

  it("membership único + sem conflito → CONVERGE (backfill org + drop userId/nome/cnpj + UNIQUE)", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      await resetPre0302(conn);
      await conn.query(`INSERT INTO organizations (id, nome, cnpj) VALUES (1,'Prefeitura X', NULL)`);
      await conn.query(`INSERT INTO organization_members (organizationId, userId, ativo) VALUES (1,101,1)`);
      // nome IGUAL ao canônico; cnpj presente e canônico NULO → deve ser PROMOVIDO (F), não descartado.
      await conn.query(
        `INSERT INTO documentSettings (userId, organizationName, cnpj, address) VALUES
         (101,'Prefeitura X','11.111.111/1111-11','Rua 1')`,
      );

      await applyMigration(conn);

      // 1 linha tenant-scoped, org correta, extensão preservada.
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT organizationId, address FROM documentSettings",
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0].organizationId)).toBe(1);
      expect(String(rows[0].address)).toBe("Rua 1");

      // Duplicidade eliminada: sem userId/organizationName/cnpj em documentSettings.
      const cols = await columnsOf(conn);
      expect(cols).toContain("organizationId");
      expect(cols).not.toContain("userId");
      expect(cols).not.toContain("organizationName");
      expect(cols).not.toContain("cnpj");

      // PRESERVAÇÃO (F): o CNPJ foi promovido para a fonte canônica (organizations), não perdido.
      const [org] = await conn.query<mysql.RowDataPacket[]>("SELECT cnpj FROM organizations WHERE id=1");
      expect(String(org[0].cnpj)).toBe("11.111.111/1111-11");

      // UNIQUE por organização.
      await expect(
        conn.query("INSERT INTO documentSettings (organizationId, address) VALUES (1,'dup')"),
      ).rejects.toThrow();
    } finally {
      await conn.end();
    }
  }, 120_000);

  it("órfão (usuário sem organização ativa) → ABORTA (A) sem mutar nada", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      await resetPre0302(conn);
      await conn.query(`INSERT INTO organizations (id, nome) VALUES (1,'Org 1')`);
      // userId 999 não tem membership ativo → órfão.
      await conn.query(`INSERT INTO documentSettings (userId, organizationName) VALUES (999,'X')`);

      await expect(applyMigration(conn)).rejects.toThrow(/FAIL-CLOSED \(A\)/);

      // Nada mutado: userId intacto, organizationId não criado.
      const cols = await columnsOf(conn);
      expect(cols).toContain("userId");
      expect(cols).not.toContain("organizationId");
    } finally {
      await conn.end();
    }
  }, 60_000);

  it("multi-org (usuário em 2 organizações ativas) → ABORTA (B) sem mutar nada", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      await resetPre0302(conn);
      await conn.query(`INSERT INTO organizations (id, nome) VALUES (1,'Org 1'),(2,'Org 2')`);
      await conn.query(`INSERT INTO organization_members (organizationId, userId, ativo) VALUES (1,101,1),(2,101,1)`);
      await conn.query(`INSERT INTO documentSettings (userId, organizationName) VALUES (101,'Org 1')`);

      await expect(applyMigration(conn)).rejects.toThrow(/FAIL-CLOSED \(B\)/);
      const cols = await columnsOf(conn);
      expect(cols).toContain("userId");
      expect(cols).not.toContain("organizationId");
    } finally {
      await conn.end();
    }
  }, 60_000);

  it("conflito de tenant (2 configs divergentes para a mesma org) → ABORTA (C)", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      await resetPre0302(conn);
      await conn.query(`INSERT INTO organizations (id, nome) VALUES (1,'Org 1')`);
      await conn.query(`INSERT INTO organization_members (organizationId, userId, ativo) VALUES (1,101,1),(1,102,1)`);
      // Mesmo tenant, EXTENSÃO divergente (address diferente) → consolidação ambígua.
      await conn.query(
        `INSERT INTO documentSettings (userId, organizationName, address) VALUES
         (101,'Org 1','Rua A'),(102,'Org 1','Rua B')`,
      );

      await expect(applyMigration(conn)).rejects.toThrow(/FAIL-CLOSED \(C\)/);
      const cols = await columnsOf(conn);
      expect(cols).toContain("userId");
      expect(cols).not.toContain("organizationId");
    } finally {
      await conn.end();
    }
  }, 60_000);

  it("conflito de nome (organizationName ≠ organizations.nome) → ABORTA (D)", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      await resetPre0302(conn);
      await conn.query(`INSERT INTO organizations (id, nome) VALUES (1,'Nome Canonico')`);
      await conn.query(`INSERT INTO organization_members (organizationId, userId, ativo) VALUES (1,101,1)`);
      await conn.query(`INSERT INTO documentSettings (userId, organizationName) VALUES (101,'Nome Divergente')`);

      await expect(applyMigration(conn)).rejects.toThrow(/FAIL-CLOSED \(D\)/);
      const cols = await columnsOf(conn);
      expect(cols).toContain("userId");
      expect(cols).not.toContain("organizationId");
    } finally {
      await conn.end();
    }
  }, 60_000);

  it("conflito de CNPJ (cnpj ≠ organizations.cnpj, ambos presentes) → ABORTA (E)", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      await resetPre0302(conn);
      await conn.query(`INSERT INTO organizations (id, nome, cnpj) VALUES (1,'Org 1','11.111.111/1111-11')`);
      await conn.query(`INSERT INTO organization_members (organizationId, userId, ativo) VALUES (1,101,1)`);
      await conn.query(
        `INSERT INTO documentSettings (userId, organizationName, cnpj) VALUES (101,'Org 1','99.999.999/9999-99')`,
      );

      await expect(applyMigration(conn)).rejects.toThrow(/FAIL-CLOSED \(E\)/);
      const cols = await columnsOf(conn);
      expect(cols).toContain("userId");
      expect(cols).not.toContain("organizationId");
    } finally {
      await conn.end();
    }
  }, 60_000);

  it("não-ambíguo (2 linhas IDÊNTICAS do mesmo tenant) → CONVERGE deduplicando para 1", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      await resetPre0302(conn);
      await conn.query(`INSERT INTO organizations (id, nome, cnpj) VALUES (1,'Org 1','11.111.111/1111-11')`);
      await conn.query(`INSERT INTO organization_members (organizationId, userId, ativo) VALUES (1,101,1),(1,102,1)`);
      // Identidade SEMANTICAMENTE idêntica (mesmos valores) → equivalência provada → dedupe seguro.
      await conn.query(
        `INSERT INTO documentSettings (userId, organizationName, cnpj, address) VALUES
         (101,'Org 1','11.111.111/1111-11','Rua Igual'),
         (102,'Org 1','11.111.111/1111-11','Rua Igual')`,
      );

      await applyMigration(conn);

      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT organizationId, address FROM documentSettings",
      );
      expect(rows.length).toBe(1);
      expect(Number(rows[0].organizationId)).toBe(1);
      expect(String(rows[0].address)).toBe("Rua Igual");
    } finally {
      await conn.end();
    }
  }, 60_000);

  it("clean install (tabela vazia) → REPLAY-SAFE (no-op determinístico, esquema converge)", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      await resetPre0302(conn);
      await conn.query(`INSERT INTO organizations (id, nome) VALUES (1,'Org 1')`);
      // documentSettings vazia → todos os guards contam 0 → converge sem tocar em dados.
      await applyMigration(conn);

      const cols = await columnsOf(conn);
      expect(cols).toContain("organizationId");
      expect(cols).not.toContain("userId");
      expect(cols).not.toContain("organizationName");
      expect(cols).not.toContain("cnpj");
      const [cnt] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS c FROM documentSettings");
      expect(Number((cnt[0] as { c: number }).c)).toBe(0);
    } finally {
      await conn.end();
    }
  }, 60_000);
});
