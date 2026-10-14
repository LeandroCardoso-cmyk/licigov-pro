/**
 * Template Governance V2 — migration 0318 (marco de transição: tabela platform-level imutável, semeada no instante efetivo da aplicação) contra MySQL REAL,
 * em bancos DEDICADOS (herméticos). Só roda com DATABASE_URL. Pré-estado do upgrade = PREFIXO do journal (idx < 318).
 *
 *  M1  FRESH: banco limpo → 0318; a linha do marco existe, no formato ISO/UTC com ms, dentro da janela da aplicação; schema válido; rerun no-op
 *  M2  UPGRADE 0317→0318 com dados: tabelas existentes byte a byte iguais; o marco = instante da aplicação; modelos criados ANTES ⇒ órgão legado,
 *      DEPOIS ⇒ novo; reaplicar a migration à mão e migrar de novo NÃO move o marco (deploys futuros não reclassificam)
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
import { isLegacyTemplateOrganization } from "../../domain/institutionalTemplates/governance/templateGovernanceV2";

const DB = process.env.DATABASE_URL;
const DRZ = path.join(process.cwd(), "drizzle");
const TAG = "0318_template_governance_transition";
const IDX = 318;
const JOURNAL: Array<{ idx: number; tag: string; when: number }> = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")).entries;
const STATEMENTS = readFileSync(path.join(DRZ, `${TAG}.sql`), "utf8").split("--> statement-breakpoint")
  .map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
const urlFor = (dbName: string): string => { const u = new URL(DB!); u.pathname = `/${dbName}`; return u.toString(); };
type Row = mysql.RowDataPacket;
const rows = async (c: mysql.Connection, sql: string, a: unknown[] = []) => (await c.query<Row[]>(sql, a))[0];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const signature = async (c: mysql.Connection): Promise<string> => JSON.stringify([
  await rows(c, `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLUMN_DEFAULT d, EXTRA e FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'template_governance_transitions' ORDER BY TABLE_NAME, ORDINAL_POSITION`),
  await rows(c, `SELECT TABLE_NAME t, INDEX_NAME i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'template_governance_transitions' GROUP BY TABLE_NAME, INDEX_NAME ORDER BY TABLE_NAME, INDEX_NAME`),
]);
const marker = async (c: mysql.Connection) => rows(c, "SELECT marker_key, cutover_at_iso, recorded_by FROM template_governance_transitions");

describe.skipIf(!DB)("Governance V2 — migration 0318 (marco de transição, MySQL real, bancos dedicados)", () => {
  const stamp = Date.now();
  const dbs = { fresh: `t2_0318_fresh_${stamp}`, up: `t2_0318_up_${stamp}` };
  let admin: mysql.Connection;
  let pre = "";
  const prefixMigrate = async (c: mysql.Connection) => migrate(drizzle(c), { migrationsFolder: pre });

  beforeAll(async () => {
    admin = await mysql.createConnection(DB!);
    for (const d of Object.values(dbs)) await admin.query(`CREATE DATABASE \`${d}\``);
    pre = mkdtempSync(path.join(os.tmpdir(), "t2-pre0318-"));
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

  it("M1 — FRESH: banco limpo → 0318; marco semeado uma vez (ISO/UTC ms, janela da aplicação); schema válido; rerun no-op", async () => {
    const c = await mysql.createConnection(urlFor(dbs.fresh));
    try {
      const t0 = Date.now() - 2000;
      await migrateWithAdvisoryLock(c);
      const t1 = Date.now() + 2000;
      const m = await marker(c);
      expect(m).toHaveLength(1);
      expect(m[0]).toMatchObject({ marker_key: "LEGACY_POLICY_CUTOVER", recorded_by: "migration:0318_template_governance_transition" });
      expect(m[0].cutover_at_iso).toMatch(ISO);
      expect(Date.parse(m[0].cutover_at_iso)).toBeGreaterThanOrEqual(t0); expect(Date.parse(m[0].cutover_at_iso)).toBeLessThanOrEqual(t1);
      expect(await collectSchemaProblems(c)).toEqual([]);
      await migrateWithAdvisoryLock(c);
      expect(await marker(c)).toEqual(m);
    } finally { await c.end(); }
  }, 300_000);

  it("M2 — UPGRADE 0317→0318 com dados: existentes intactas; marco = instante da aplicação; antes ⇒ legado, depois ⇒ novo; reaplicar/deploys futuros NÃO movem o marco", async () => {
    const c = await mysql.createConnection(urlFor(dbs.up));
    try {
      await prefixMigrate(c);
      expect((await rows(c, "SHOW TABLES LIKE 'template_governance_transitions'"))).toHaveLength(0);
      // órgão LEGADO: modelo criado ANTES da aplicação da 0318
      await c.query(`INSERT INTO institutional_template_identities (id, organization_id, document_kind, slug, created_by_user_id, created_at_iso) VALUES ('ti-legacy', 11, 'edital', 'edital-legado', 1, ?)`, [new Date().toISOString()]);
      const sigBefore = await signature(c);
      await new Promise((r) => setTimeout(r, 30));
      await migrateWithAdvisoryLock(c);
      await new Promise((r) => setTimeout(r, 30));
      // órgão NOVO: modelo criado DEPOIS
      await c.query(`INSERT INTO institutional_template_identities (id, organization_id, document_kind, slug, created_by_user_id, created_at_iso) VALUES ('ti-new', 12, 'edital', 'edital-novo', 1, ?)`, [new Date().toISOString()]);
      expect(await signature(c)).toBe(sigBefore);                          // nenhuma tabela existente mudou
      const [m] = await marker(c);
      const identities = (org: number) => rows(c, "SELECT created_at_iso AS createdAt FROM institutional_template_identities WHERE organization_id = ?", [org]) as Promise<{ createdAt: string }[]>;
      expect(isLegacyTemplateOrganization(await identities(11), m.cutover_at_iso)).toBe(true);
      expect(isLegacyTemplateOrganization(await identities(12), m.cutover_at_iso)).toBe(false);
      // "deploys futuros": reaplicação manual das instruções e nova migração ⇒ marco idêntico; classificação idêntica
      for (const s of STATEMENTS) await c.query(s);
      await new Promise((r) => setTimeout(r, 30));
      await migrateWithAdvisoryLock(c);
      expect(await marker(c)).toEqual([m]);
      expect(isLegacyTemplateOrganization(await identities(11), (await marker(c))[0].cutover_at_iso)).toBe(true);
      expect(isLegacyTemplateOrganization(await identities(12), (await marker(c))[0].cutover_at_iso)).toBe(false);
      // estado PARCIAL (tabela criada, sem linha — processo morto no meio): a reaplicação semeia UMA vez, sem duplicar
      await c.query("DELETE FROM template_governance_transitions");
      for (const s of STATEMENTS) await c.query(s);
      expect(await marker(c)).toHaveLength(1);
      expect(await collectSchemaProblems(c)).toEqual([]);
    } finally { await c.end(); }
  }, 300_000);
});
