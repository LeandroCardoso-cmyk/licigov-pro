/**
 * LICIGOV-LAUNCH-READY DELTA-03 — evidência DIRETA da migration 0320 (`proposal_requests` plano opcional) contra MySQL REAL, em
 * bancos DEDICADOS e descartáveis (herméticos). Só roda com DATABASE_URL. Pré-estado do upgrade = PREFIXO do journal (idx < 320).
 *
 *  P1  FRESH: banco limpo → cadeia completa (runner canônico sob advisory lock); as 3 colunas anuláveis; schema sem problemas;
 *      ledger com a 0320 uma única vez; replay no-op; solicitação SEM plano persiste.
 *  P2  UPGRADE 0319 → 0320 COM DADOS: linha pré-existente (com plano/preço) preservada byte a byte; SOMENTE as 3 colunas mudam e
 *      SOMENTE na nulabilidade (tipo/default/extra/índices/todas as demais tabelas idênticos); replay no-op.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { migrateWithAdvisoryLock } from "../../db/releaseMigrate";
import { collectSchemaProblems } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const DRZ = path.join(process.cwd(), "drizzle");
const IDX = 320;
const JOURNAL: Array<{ idx: number; tag: string }> = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")).entries;
const PLAN_COLUMNS = ["planName", "planPrice", "planSlug"];
const urlFor = (dbName: string): string => { const u = new URL(DB!); u.pathname = `/${dbName}`; return u.toString(); };
type Row = mysql.RowDataPacket;
const rows = async (c: mysql.Connection, sql: string, a: unknown[] = []) => (await c.query<Row[]>(sql, a))[0];
const columns = async (c: mysql.Connection) => rows(c, `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLUMN_DEFAULT d, EXTRA e
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
const indexes = async (c: mysql.Connection) => JSON.stringify(await rows(c, `SELECT TABLE_NAME t, INDEX_NAME i, NON_UNIQUE u, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c
  FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME`));
const ledgerCount = async (c: mysql.Connection) => Number((await rows(c, "SELECT COUNT(*) n FROM __drizzle_migrations"))[0].n);
const INSERT_SQL = `INSERT INTO proposal_requests (orgaoNome, orgaoCnpj, orgaoEndereco, orgaoCidade, orgaoEstado, orgaoCep, responsavelNome,
  responsavelEmail, responsavelTelefone, planSlug, planName, planPrice, status) VALUES (?, ?, 'Rua 1', 'Cidade', 'SP', '01310100', 'Resp', ?, '11999998888', ?, ?, ?, 'pending')`;

describe.skipIf(!DB)("migration 0320 — proposal_requests plano opcional (MySQL real, bancos dedicados)", () => {
  const stamp = Date.now();
  const dbs = { fresh: `lr_0320_fresh_${stamp}`, up: `lr_0320_up_${stamp}` };
  let admin: mysql.Connection;
  let pre = "";

  beforeAll(async () => {
    expect(JOURNAL.find((e) => e.idx === IDX)?.tag).toBe("0320_proposal_requests_plan_optional");
    admin = await mysql.createConnection(DB!);
    for (const d of Object.values(dbs)) await admin.query(`CREATE DATABASE \`${d}\``);
    pre = mkdtempSync(path.join(os.tmpdir(), "lr-pre0320-"));
    mkdirSync(path.join(pre, "meta"));
    const prefix = JOURNAL.filter((e) => e.idx < IDX);
    const tags = new Set(prefix.map((e) => e.tag));
    for (const f of readdirSync(DRZ).filter((x) => /^\d{4}_.+\.sql$/.test(x) && tags.has(x.replace(/\.sql$/, "")))) cpSync(path.join(DRZ, f), path.join(pre, f));
    writeFileSync(path.join(pre, "meta", "_journal.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")), entries: prefix }));
  }, 60_000);

  afterAll(async () => {
    if (admin) { for (const d of Object.values(dbs)) await admin.query(`DROP DATABASE IF EXISTS \`${d}\``).catch(() => {}); await admin.end(); }
    if (pre) rmSync(pre, { recursive: true, force: true });
  }, 60_000);

  it("P1 — FRESH: cadeia completa sob lock; 3 colunas anuláveis; schema válido; ledger estável no replay; proposta sem plano persiste", async () => {
    const c = await mysql.createConnection(urlFor(dbs.fresh));
    try {
      await migrateWithAdvisoryLock(c);
      const cols = (await columns(c)).filter((r) => r.t === "proposal_requests" && PLAN_COLUMNS.includes(r.c));
      expect(cols.map((r) => [r.c, r.n]).sort()).toEqual([["planName", "YES"], ["planPrice", "YES"], ["planSlug", "YES"]]);
      expect(await collectSchemaProblems(c)).toEqual([]);
      const n = await ledgerCount(c);
      expect(n).toBe(JOURNAL.length);
      await migrateWithAdvisoryLock(c);
      expect(await ledgerCount(c)).toBe(n);
      await c.query(INSERT_SQL, ["Órgão Sintético", "11222333000181", `p1-${stamp}@teste.local`, null, null, null]);
      expect((await rows(c, "SELECT planSlug, planName, planPrice FROM proposal_requests"))[0]).toMatchObject({ planSlug: null, planName: null, planPrice: null });
    } finally { await c.end(); }
  }, 300_000);

  it("P2 — UPGRADE 0319→0320 com dados: linha preservada; só nulabilidade das 3 colunas muda; replay no-op", async () => {
    const c = await mysql.createConnection(urlFor(dbs.up));
    try {
      await migrate(drizzle(c), { migrationsFolder: pre });
      const beforeCols = await columns(c);
      const beforeIdx = await indexes(c);
      expect(beforeCols.filter((r) => r.t === "proposal_requests" && PLAN_COLUMNS.includes(r.c)).every((r) => r.n === "NO")).toBe(true);
      // Sem plano o build anterior não grava (NOT NULL) — o pré-estado exige os 3 valores.
      await expect(c.query(INSERT_SQL, ["Órgão A", "11222333000181", `p2a-${stamp}@teste.local`, null, null, null])).rejects.toBeTruthy();
      await c.query(INSERT_SQL, ["Órgão Legado", "11222333000181", `p2-${stamp}@teste.local`, "municipal-basico", "Municipal Básico", 39900]);
      const legacyBefore = await rows(c, "SELECT * FROM proposal_requests ORDER BY id");

      await migrateWithAdvisoryLock(c);

      expect(await rows(c, "SELECT * FROM proposal_requests ORDER BY id")).toEqual(legacyBefore);
      const afterCols = await columns(c);
      expect(afterCols.length).toBe(beforeCols.length);
      const changed = afterCols.filter((a, i) => JSON.stringify(a) !== JSON.stringify(beforeCols[i]));
      expect(changed.map((r) => `${r.t}.${r.c}`).sort()).toEqual(PLAN_COLUMNS.map((c2) => `proposal_requests.${c2}`).sort());
      for (const r of changed) {
        const b = beforeCols.find((x) => x.t === r.t && x.c === r.c)!;
        expect({ ...r, n: b.n }).toEqual(b);
        expect([b.n, r.n]).toEqual(["NO", "YES"]);
      }
      expect(await indexes(c)).toBe(beforeIdx);
      expect(await collectSchemaProblems(c)).toEqual([]);
      const n = await ledgerCount(c);
      await migrateWithAdvisoryLock(c);
      expect(await ledgerCount(c)).toBe(n);
      expect(await rows(c, "SELECT * FROM proposal_requests ORDER BY id")).toEqual(legacyBefore);
    } finally { await c.end(); }
  }, 300_000);
});
