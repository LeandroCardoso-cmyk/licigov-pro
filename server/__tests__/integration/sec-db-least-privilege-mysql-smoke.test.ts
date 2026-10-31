/**
 * SEC-AUD-2026-10 — contas de banco com menor privilégio (scripts/ops/db-roles.ts) contra MySQL real.
 *
 * Banco e contas DEDICADOS e descartáveis (nome aleatório; nunca o banco compartilhado do job). Prova que:
 *   - migrator aplica a cadeia completa de migrations (e o replay) só com os privilégios declarados;
 *   - runtime valida o schema como o boot e faz DML, mas DDL é recusado;
 *   - audit lê só metadados (INFORMATION_SCHEMA) — SELECT nos dados é recusado;
 *   - backup lê dados mas não escreve; com o mysqldump do runner, o dump sai completo.
 * Uma migration futura que exija privilégio novo quebra este smoke antes de quebrar o pre-deploy.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DB_ROLES, grantStatements, type DbRole } from "../../../scripts/ops/db-roles";
import { runMigrations, collectSchemaProblems } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const SUFFIX = randomBytes(4).toString("hex");
const DB_NAME = `lp_smoke_${SUFFIX}`;
const ROLES: DbRole[] = ["runtime", "migrator", "backup", "audit"];
const users = Object.fromEntries(ROLES.map((r) => [r, { user: `lp_${r}_${SUFFIX}`, password: randomBytes(18).toString("base64url") }])) as Record<
  DbRole,
  { user: string; password: string }
>;

function connect(role: DbRole): Promise<mysql.Connection> {
  const u = new URL(DB!);
  return mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: users[role].user,
    password: users[role].password,
    database: DB_NAME,
    // backup/audit exigem TLS no servidor (REQUIRE SSL); o MySQL da CI usa certificado autogerado.
    ...(DB_ROLES[role].requireSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

describe.skipIf(!DB)("SEC-AUD-2026-10 — contas MySQL com menor privilégio", () => {
  let admin: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection(DB!);
    await admin.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4`);
    for (const role of ROLES) {
      await admin.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [users[role].user, users[role].password]);
      for (const s of grantStatements(role, DB_NAME, users[role].user)) await admin.query(s);
    }
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const role of ROLES) await admin.query(`DROP USER IF EXISTS ?@'%'`, [users[role].user]).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``).catch(() => undefined);
    await admin.end();
  });

  it("migrator aplica todas as migrations e o replay só com os privilégios declarados", async () => {
    const conn = await connect("migrator");
    try {
      await runMigrations(conn);
      await runMigrations(conn); // replay idempotente
      const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM __drizzle_migrations");
      expect(Number(rows[0].n)).toBeGreaterThan(300);
    } finally {
      await conn.end();
    }
  }, 300_000);

  it("runtime: schema válido como no boot, DML permitido, DDL recusado", async () => {
    const conn = await connect("runtime");
    try {
      expect(await collectSchemaProblems(conn)).toEqual([]);
      const [ins] = await conn.query<mysql.ResultSetHeader>("INSERT INTO organizations (nome, slug) VALUES (?, ?)", ["Órgão sintético LP", `lp-${SUFFIX}`]);
      await conn.query("UPDATE organizations SET nome = ? WHERE id = ?", ["Órgão sintético LP (editado)", ins.insertId]);
      await conn.query("SELECT id FROM organizations WHERE id = ? FOR UPDATE", [ins.insertId]);
      await conn.query("DELETE FROM organizations WHERE id = ?", [ins.insertId]);
      await expect(conn.query("CREATE TABLE lp_ddl_probe (id INT)")).rejects.toMatchObject({ code: "ER_TABLEACCESS_DENIED_ERROR" });
      await expect(conn.query("DROP TABLE organizations")).rejects.toMatchObject({ code: "ER_TABLEACCESS_DENIED_ERROR" });
      await expect(conn.query("ALTER TABLE organizations ADD COLUMN lp_probe INT")).rejects.toMatchObject({ code: "ER_TABLEACCESS_DENIED_ERROR" });
    } finally {
      await conn.end();
    }
  });

  it("audit: enxerga metadados em INFORMATION_SCHEMA, mas não lê dados", async () => {
    const conn = await connect("audit");
    try {
      const [cols] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ?",
        [DB_NAME],
      );
      expect(Number(cols[0].n)).toBeGreaterThan(1000);
      await expect(conn.query("SELECT COUNT(*) FROM users")).rejects.toMatchObject({ code: "ER_TABLEACCESS_DENIED_ERROR" });
    } finally {
      await conn.end();
    }
  });

  it("backup: lê dados, não escreve; mysqldump do runner gera dump completo", async () => {
    const conn = await connect("backup");
    try {
      await conn.query("SELECT COUNT(*) FROM organizations");
      await expect(conn.query("INSERT INTO organizations (nome, slug) VALUES ('x', 'x')")).rejects.toMatchObject({ code: "ER_TABLEACCESS_DENIED_ERROR" });
    } finally {
      await conn.end();
    }
    const probe = spawnSync("mysqldump", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) return; // runner sem cliente MySQL: o restante foi provado acima
    const u = new URL(DB!);
    const dump = spawnSync(
      "mysqldump",
      [
        "--protocol=TCP", `--host=${u.hostname}`, `--port=${u.port || "3306"}`, `--user=${users.backup.user}`,
        "--ssl-mode=REQUIRED", "--single-transaction", "--routines", "--triggers", "--events",
        "--set-gtid-purged=OFF", "--no-tablespaces", DB_NAME,
      ],
      { encoding: "utf8", env: { ...process.env, MYSQL_PWD: users.backup.password }, maxBuffer: 256 * 1024 * 1024 },
    );
    expect(dump.status).toBe(0);
    expect(dump.stdout).toContain("CREATE TABLE `organizations`");
    expect(dump.stdout).toContain("-- Dump completed");
  }, 120_000);
});
