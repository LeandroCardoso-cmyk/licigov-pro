/**
 * Seed de licenciamento — smoke contra MySQL REAL (CI/lab).
 *
 * Só roda com DATABASE_URL definido; pulado localmente sem banco.
 * Garante: após o boot, os 5 Business Domains ficam ATIVOS para a org padrão (id=1),
 * e re-executar o seed é idempotente (não duplica, não desativa).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, ensureSchema, seedLicensedModules } from "../../bootstrap";

const DB = process.env.DATABASE_URL;

const EXPECTED_DOMAINS = [
  "processo_licitatorio",
  "parecer_juridico",
  "gestao_departamento",
  "contratacao_direta",
  "contratos",
];

describe.skipIf(!DB)("Seed de licenciamento — MySQL real", () => {
  let conn: mysql.Connection;

  async function activeDomains(orgId: number): Promise<string[]> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT business_domain_code FROM licensed_modules
       WHERE organization_id = ? AND active = 1 ORDER BY business_domain_code`,
      [orgId]
    );
    return rows.map((r) => String(r.business_domain_code));
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    // Garante o schema (a tabela licensed_modules precisa existir).
    await runMigrations(conn);
    await ensureSchema(conn);
  }, 300_000);

  afterAll(async () => {
    await conn?.end();
  });

  it("ativa os 5 Business Domains para a org padrão (id=1)", async () => {
    await seedLicensedModules(conn);
    const active = await activeDomains(1);
    for (const code of EXPECTED_DOMAINS) {
      expect(active, `domínio ${code} deveria estar ativo`).toContain(code);
    }
  }, 60_000);

  it("é idempotente: re-rodar não duplica nem desativa", async () => {
    await seedLicensedModules(conn);
    await seedLicensedModules(conn);
    const [countRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT business_domain_code, COUNT(*) AS n FROM licensed_modules
       WHERE organization_id = 1 GROUP BY business_domain_code`
    );
    for (const r of countRows) {
      expect(Number(r.n), `domínio ${r.business_domain_code} duplicado`).toBe(1);
    }
    const active = await activeDomains(1);
    expect(active.length).toBeGreaterThanOrEqual(EXPECTED_DOMAINS.length);
  }, 60_000);
});
