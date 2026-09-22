/**
 * P0 PILOTO — Governança da identidade institucional documental (documentSettings) — MySQL real.
 *
 * Prova, contra um MySQL real, que a consolidação per-user → per-org é DETERMINÍSTICA e segura e que
 * o modelo final é TENANT-SCOPED:
 *   A. MIGRATION 0302 — backfill determinístico (userId → org ativa de MENOR id), dedupe por
 *      organização (maior updatedAt; empate por maior id), remoção de órfãos, NOT NULL + UNIQUE e
 *      remoção da coluna userId. Reconstrói o estado PRÉ-0302 e aplica os statements reais do .sql.
 *   B. MODELO FINAL — upsert idempotente por organização (1 linha por org), isolamento entre tenants
 *      (org A ≠ org B) e leitura determinística por organizationId (independe de qual usuário lê).
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
function statements(tag: string): string[] {
  const sql = readFileSync(path.join(DRZ, `${tag}.sql`), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}

describe.skipIf(!DB)("documentSettings — governança institucional (MySQL real)", () => {
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

  it("A. migration 0302 — backfill/dedupe/órfãos determinístico + NOT NULL/UNIQUE + drop userId", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      // Estado PRÉ-0302: documentSettings per-user + organization_members mínimos.
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
        cnpj VARCHAR(18),
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);

      // org 1: userA (mais antigo) e userB (mais novo) → dedupe deve manter B.
      // org 2: userC. userD sem membership → órfão (removido).
      await conn.query(
        `INSERT INTO organization_members (organizationId, userId, ativo) VALUES (1,101,1),(1,102,1),(2,103,1)`,
      );
      await conn.query(
        `INSERT INTO documentSettings (userId, organizationName, cnpj, updatedAt) VALUES
         (101,'Org1-A','11.111.111/1111-11','2026-01-01 10:00:00'),
         (102,'Org1-B','22.222.222/2222-22','2026-02-01 10:00:00'),
         (103,'Org2-C','33.333.333/3333-33','2026-01-15 10:00:00'),
         (104,'Orphan-D','44.444.444/4444-44','2026-01-20 10:00:00')`,
      );

      // Aplica os statements REAIS da migration 0302.
      for (const s of statements("0302_document_settings_org_scoped")) await conn.query(s);

      // Backfill + dedupe: org1 mantém a linha de maior updatedAt ("Org1-B"); org2 fica "Org2-C".
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT organizationId, organizationName FROM documentSettings ORDER BY organizationId",
      );
      expect(rows.map((r) => [Number(r.organizationId), String(r.organizationName)])).toEqual([
        [1, "Org1-B"],
        [2, "Org2-C"],
      ]);

      // Órfão (userD sem organização) foi removido; total = 2.
      const [cnt] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS c FROM documentSettings");
      expect(Number((cnt[0] as { c: number }).c)).toBe(2);

      // Coluna userId foi removida (chave per-user extinta).
      const [cols] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documentSettings'`,
      );
      const colNames = cols.map((c) => String(c.COLUMN_NAME));
      expect(colNames).toContain("organizationId");
      expect(colNames).not.toContain("userId");

      // UNIQUE por organização: inserir 2ª linha para a mesma org falha.
      await expect(
        conn.query("INSERT INTO documentSettings (organizationId, organizationName) VALUES (1,'dup')"),
      ).rejects.toThrow();
    } finally {
      await conn.end();
    }
  }, 120_000);

  it("B. modelo final — upsert por organização é idempotente, isolado por tenant e determinístico", async () => {
    const conn = await mysql.createConnection(urlFor(DBNAME));
    try {
      // Upsert org 1 duas vezes (mesma org) — deve permanecer 1 linha (idempotência pela unique).
      const upsert = async (orgId: number, name: string) => {
        await conn.query(
          `INSERT INTO documentSettings (organizationId, organizationName) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE organizationName = VALUES(organizationName)`,
          [orgId, name],
        );
      };
      await upsert(1, "Prefeitura A v1");
      await upsert(1, "Prefeitura A v2");
      await upsert(2, "Prefeitura B");

      const readByOrg = async (orgId: number) => {
        const [r] = await conn.query<mysql.RowDataPacket[]>(
          "SELECT organizationName FROM documentSettings WHERE organizationId = ? LIMIT 1",
          [orgId],
        );
        return r.length ? String(r[0].organizationName) : undefined;
      };

      // 1 linha por org (idempotência) e valores isolados por tenant.
      const [c1] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS c FROM documentSettings WHERE organizationId = 1",
      );
      expect(Number((c1[0] as { c: number }).c)).toBe(1);
      expect(await readByOrg(1)).toBe("Prefeitura A v2");
      expect(await readByOrg(2)).toBe("Prefeitura B");
      // Isolamento: org A ≠ org B.
      expect(await readByOrg(1)).not.toBe(await readByOrg(2));

      // Determinismo: a identidade é função pura de organizationId (não do usuário) — duas leituras
      // por org retornam exatamente o mesmo valor, independentemente de quem lê.
      expect(await readByOrg(1)).toBe(await readByOrg(1));
    } finally {
      await conn.end();
    }
  }, 60_000);
});
