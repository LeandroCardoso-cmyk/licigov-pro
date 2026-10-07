/**
 * Lane A / multi-modelo — migration 0317 (escopo forma+plataforma do binding e `display_name` da identidade) contra MySQL REAL,
 * em bancos DEDICADOS (herméticos). Só roda com DATABASE_URL. Pré-estado do upgrade = PREFIXO do journal (idx < 317).
 *
 *  M0  a 0317 está no journal (idx 317, depois da 0316); SQL aditivo, guardado por INFORMATION_SCHEMA, sem DDL em pai produtivo
 *  M1  FRESH: banco limpo → 0317; colunas/chave gerada/UNIQUE do contrato; FKs HD-26 intactas; schema válido; rerun no-op
 *  M2  UPGRADE 0316→0317 com dados: bindings antigos preservados e chave recalculada; tabelas produtivas byte a byte idênticas;
 *      a aplicação antiga (sem forma/plataforma) continua escrevendo; reaplicar à mão = no-op
 *  M3  ESTADO PARCIAL: só as colunas aplicadas / sem índice ⇒ a reaplicação converge
 *  M4  MESMO tenant: escopo completo igual ⇒ conflito; forma/plataforma diferentes COEXISTEM; inativo não conflita
 *  M5  CROSS tenant: o mesmo escopo em tenants distintos coexiste; FK composta de tenant (HD-26) segue rejeitando cross-tenant
 *  M6  CONCORRÊNCIA: N inserções simultâneas do MESMO escopo ⇒ exatamente uma vence; escopos distintos ⇒ todas vencem
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
import { checkForeignKeyContract } from "../../db/schemaForeignKeyGuard";
import { INSTITUTIONAL_TEMPLATES_TABLES } from "../../db/institutionalTemplates/schemaContract";

const DB = process.env.DATABASE_URL;
const DRZ = path.join(process.cwd(), "drizzle");
const TAG = "0317_institutional_template_multimodel_scope";
const IDX = 317;
const JOURNAL: Array<{ idx: number; tag: string; when: number }> = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")).entries;
const FROM_COUNT = JOURNAL.filter((e) => e.idx >= IDX).length;
const NEW = [...INSTITUTIONAL_TEMPLATES_TABLES] as string[];
const STATEMENTS = readFileSync(path.join(DRZ, `${TAG}.sql`), "utf8").split("--> statement-breakpoint")
  .map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);

function urlFor(dbName: string): string {
  const u = new URL(DB!);
  u.pathname = `/${dbName}`;
  return u.toString();
}
type Row = mysql.RowDataPacket;
const rows = async (c: mysql.Connection, sql: string, a: unknown[] = []) => (await c.query<Row[]>(sql, a))[0];
const ledger = async (c: mysql.Connection) => Number((await rows(c, "SELECT COUNT(*) n FROM __drizzle_migrations"))[0].n);
const inList = (xs: string[]) => xs.map((x) => `'${x}'`).join(",");
const sqlCode = async (p: Promise<unknown>) => { try { await p; return "NO_ERROR"; } catch (e) { return (e as { code?: string }).code ?? "UNKNOWN"; } };
const dump = async (c: mysql.Connection, t: string) => JSON.stringify(await rows(c, `SELECT * FROM \`${t}\` ORDER BY id`));

/** Assinatura estrutural (colunas + índices + FKs) das tabelas SELECIONADAS. */
async function signature(c: mysql.Connection, tables: string[] | "EXISTING"): Promise<string> {
  const filter = tables === "EXISTING" ? `NOT IN (${inList(NEW)})` : `IN (${inList(tables)})`;
  const cols = await rows(c, `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLUMN_DEFAULT d, COLLATION_NAME k, EXTRA e, GENERATION_EXPRESSION g
    FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME ${filter} ORDER BY TABLE_NAME, ORDINAL_POSITION`);
  const idx = await rows(c, `SELECT TABLE_NAME t, INDEX_NAME i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c, MIN(NON_UNIQUE) nu FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME ${filter} GROUP BY TABLE_NAME, INDEX_NAME ORDER BY TABLE_NAME, INDEX_NAME`);
  const fks = await rows(c, `SELECT rc.TABLE_NAME t, rc.CONSTRAINT_NAME n, rc.REFERENCED_TABLE_NAME r, rc.DELETE_RULE d, rc.UPDATE_RULE u FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
    WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND rc.TABLE_NAME ${filter} ORDER BY rc.TABLE_NAME, rc.CONSTRAINT_NAME`);
  return JSON.stringify([cols, idx, fks]);
}
const fkSignature = async (c: mysql.Connection) => JSON.stringify(await rows(c, `SELECT TABLE_NAME t, CONSTRAINT_NAME n, REFERENCED_TABLE_NAME r, DELETE_RULE d, UPDATE_RULE u
  FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME`));

const H = "h".repeat(64);
async function seedParents(c: mysql.Connection, org: number, tag: string) {
  await c.query(`INSERT INTO institutional_template_identities (id, organization_id, document_kind, slug, created_by_user_id, created_at_iso) VALUES (?, ?, 'edital', ?, 1, '2026-10-01T00:00:00Z')`, [`ti-${tag}`, org, `s-${tag}`]);
  await c.query(`INSERT INTO institutional_template_revisions (id, organization_id, identity_id, revision, status, ast_json, variable_catalog_version, semantic_hash, hash_version, source_format)
    VALUES (?, ?, ?, 1, 'DRAFT', '{}', 'cat/1', ?, 'tpl-hash/1', 'NATIVE')`, [`tr-${tag}`, org, `ti-${tag}`, H]);
}
const bind = (c: mysql.Connection, id: string, org: number, tag: string, scope: { m?: string; f?: string; p?: string; active?: number }) => c.query(
  `INSERT INTO institutional_template_bindings (id, organization_id, document_kind, scope_modality, scope_form, scope_platform, identity_id, pinned_revision_id, active, effective_from_iso)
   VALUES (?, ?, 'edital', ?, ?, ?, ?, ?, ?, '2026-10-01T00:00:00Z')`, [id, org, scope.m ?? "", scope.f ?? "", scope.p ?? "", `ti-${tag}`, `tr-${tag}`, scope.active ?? 1]);

describe.skipIf(!DB)("Lane A — migration 0317 multi-modelo (MySQL real, bancos dedicados)", () => {
  const stamp = Date.now();
  const dbs = { fresh: `t2_0317_fresh_${stamp}`, up: `t2_0317_up_${stamp}`, partial: `t2_0317_part_${stamp}` };
  let admin: mysql.Connection;
  let pre = "";
  const prefixMigrate = async (c: mysql.Connection) => migrate(drizzle(c), { migrationsFolder: pre });

  beforeAll(async () => {
    admin = await mysql.createConnection(DB!);
    for (const d of Object.values(dbs)) await admin.query(`CREATE DATABASE \`${d}\``);
    pre = mkdtempSync(path.join(os.tmpdir(), "t2-pre0317-"));
    mkdirSync(path.join(pre, "meta"));
    const prefix = JOURNAL.filter((e) => e.idx < IDX);
    const tags = new Set(prefix.map((e) => e.tag));
    for (const f of readdirSync(DRZ).filter((x) => /^\d{4}_.+\.sql$/.test(x) && tags.has(x.replace(/\.sql$/, "")))) cpSync(path.join(DRZ, f), path.join(pre, f));
    writeFileSync(path.join(pre, "meta", "_journal.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")), entries: prefix }));
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      for (const d of Object.values(dbs)) await admin.query(`DROP DATABASE IF EXISTS \`${d}\``).catch(() => {});
      await admin.end();
    }
    if (pre) rmSync(pre, { recursive: true, force: true });
  }, 60_000);

  it("M0 — a 0317 está no journal (idx 317, depois da 0316); SQL aditivo, guardado e sem DDL em pai produtivo", () => {
    const e = JOURNAL.find((x) => x.idx === IDX)!;
    expect(e.tag).toBe(TAG);
    expect(e.when).toBeGreaterThan(JOURNAL.find((x) => x.idx === IDX - 1)!.when);
    const sql = STATEMENTS.join("\n");
    // todo ALTER mira só tabelas deste bounded context
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+`([a-z_]+)`/gi)) expect(NEW, m[1]).toContain(m[1]);
    for (const t of ["official_documents", "generated_documents", "institutional_decisions", "official_document_artifacts", "organizations"]) expect(sql).not.toContain(`\`${t}\``);
    expect(sql).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|FOREIGN)|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO|UPDATE\s+`)\b/i);
    expect(sql).not.toMatch(/FOREIGN\s+KEY|ON\s+(DELETE|UPDATE)\s+CASCADE|SET\s+NULL/i);   // HD-26: nenhuma FK criada/alterada
    expect(sql).toMatch(/information_schema/i);                                           // guardas de replay
  });

  it("M1 — FRESH: 0317 aplicada; colunas, chave gerada e UNIQUE no contrato; FKs HD-26 intactas; rerun no-op", async () => {
    const c = await mysql.createConnection(urlFor(dbs.fresh));
    try {
      await migrateWithAdvisoryLock(c);
      expect(await checkForeignKeyContract(c)).toEqual([]);
      expect(await collectSchemaProblems(c)).toEqual([]);
      const col = async (t: string, n: string) => (await rows(c, `SELECT COLUMN_TYPE ty, IS_NULLABLE nul, COLUMN_DEFAULT d, COLLATION_NAME k, EXTRA e, GENERATION_EXPRESSION g
        FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [t, n]))[0];
      for (const n of ["scope_form", "scope_platform"]) expect(await col("institutional_template_bindings", n), n).toMatchObject({ ty: "varchar(64)", nul: "NO", d: "" });
      expect(await col("institutional_template_identities", "display_name")).toMatchObject({ ty: "varchar(160)", nul: "NO", d: "" });
      const key = await col("institutional_template_bindings", "active_scope_key");
      expect(key).toMatchObject({ ty: "varchar(352)", k: "utf8mb4_bin" });
      expect(String(key.e)).toMatch(/STORED GENERATED/i);
      for (const part of ["scope_modality", "scope_form", "scope_platform", "scope_regime", "scope_criterion", "document_kind"]) expect(String(key.g), part).toContain(part);
      const uq = await rows(c, `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_template_bindings' AND INDEX_NAME = 'uq_itb_active_scope' AND NON_UNIQUE = 0 GROUP BY INDEX_NAME`);
      expect(uq.map((r) => r.c)).toEqual(["organization_id,active_scope_key"]);
      expect(Number((await rows(c, `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN (${inList(NEW)})`))[0].n)).toBeGreaterThanOrEqual(9);
      const n = await ledger(c);
      await migrateWithAdvisoryLock(c);
      expect(await ledger(c)).toBe(n);
    } finally { await c.end(); }
  }, 300_000);

  it("M2 — UPGRADE 0316→0317 com dados: bindings preservados e chave recalculada; produtivas intactas; app antiga segue escrevendo; replay = no-op", async () => {
    const c = await mysql.createConnection(urlFor(dbs.up));
    try {
      await prefixMigrate(c);
      expect(await rows(c, `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_template_bindings' AND COLUMN_NAME = 'scope_form'`)).toHaveLength(0);
      await c.query(
        `INSERT INTO official_documents (id, tenant_id, business_domain, document_type, origin, title, version, status, content, lineage_id, replay_hash, storage_key, mime_type, size_bytes, content_hash)
         VALUES ('doc00000000000000001', 1, 'contratos', 'contrato', 'o1', 'Legado', 1, 'gerado', 'conteúdo legado', 'lin00000000000000001', 'rh1', 'document-engine/1/lin/doc-legado.pdf', 'application/pdf', 321, REPEAT('a', 64))`);
      await seedParents(c, 1, "A");
      // binding gravado pelo build 0316 (sem forma/plataforma)
      await c.query(`INSERT INTO institutional_template_bindings (id, organization_id, document_kind, scope_modality, identity_id, pinned_revision_id, active, effective_from_iso)
        VALUES ('tb-old', 1, 'edital', 'pregao', 'ti-A', 'tr-A', 1, '2026-10-01T00:00:00Z')`);
      const prodSig = await signature(c, "EXISTING");
      const prodData = await dump(c, "official_documents");
      const fksBefore = await fkSignature(c);
      const l0 = await ledger(c);

      await migrateWithAdvisoryLock(c);
      expect(await ledger(c)).toBe(l0 + FROM_COUNT);
      expect(await signature(c, "EXISTING")).toBe(prodSig);            // nenhuma tabela produtiva mudou (e as do contexto, só nas colunas aditivas)
      expect(await dump(c, "official_documents")).toBe(prodData);
      expect(await fkSignature(c)).toBe(fksBefore);                    // HD-26: FKs byte a byte iguais
      const old = (await rows(c, "SELECT scope_modality m, scope_form f, scope_platform p, active_scope_key k, pinned_revision_id r FROM institutional_template_bindings WHERE id = 'tb-old'"))[0];
      expect(old).toMatchObject({ m: "pregao", f: "", p: "", k: "edital|pregao||||", r: "tr-A" });      // preservado; nada inferido
      expect((await rows(c, "SELECT display_name d FROM institutional_template_identities WHERE id = 'ti-A'"))[0].d).toBe("");
      // a aplicação ANTIGA (não conhece as colunas novas) continua escrevendo e respeitando a unicidade
      expect(await sqlCode(c.query(`INSERT INTO institutional_template_bindings (id, organization_id, document_kind, scope_modality, identity_id, pinned_revision_id, active, effective_from_iso)
        VALUES ('tb-old2', 1, 'edital', 'pregao', 'ti-A', 'tr-A', 1, '2026-10-01T00:00:00Z')`))).toBe("ER_DUP_ENTRY");
      expect(await sqlCode(c.query(`INSERT INTO institutional_template_identities (id, organization_id, document_kind, slug, created_by_user_id, created_at_iso)
        VALUES ('ti-old', 1, 'edital', 's-old', 1, '2026-10-01T00:00:00Z')`))).toBe("NO_ERROR");
      expect(await collectSchemaProblems(c)).toEqual([]);

      const sigNew = await signature(c, NEW);
      const bindingsData = await dump(c, "institutional_template_bindings");
      for (const s of STATEMENTS) await c.query(s);                    // replay manual: no-op
      expect(await signature(c, NEW)).toBe(sigNew);
      expect(await dump(c, "institutional_template_bindings")).toBe(bindingsData);
      expect(await checkForeignKeyContract(c)).toEqual([]);
    } finally { await c.end(); }
  }, 300_000);

  it("M3 — ESTADO PARCIAL: só colunas / sem UNIQUE / sem display_name ⇒ a reaplicação converge", async () => {
    const c = await mysql.createConnection(urlFor(dbs.partial));
    try {
      await prefixMigrate(c);
      await seedParents(c, 1, "P");
      await c.query(`INSERT INTO institutional_template_bindings (id, organization_id, document_kind, scope_modality, identity_id, pinned_revision_id, active, effective_from_iso)
        VALUES ('tb-p', 1, 'edital', 'pregao', 'ti-P', 'tr-P', 1, '2026-10-01T00:00:00Z')`);
      // processo morto depois de adicionar SÓ as colunas
      await c.query("ALTER TABLE institutional_template_bindings ADD COLUMN scope_form varchar(64) NOT NULL DEFAULT '' AFTER scope_modality, ADD COLUMN scope_platform varchar(64) NOT NULL DEFAULT '' AFTER scope_form");
      await migrateWithAdvisoryLock(c);
      expect(await collectSchemaProblems(c)).toEqual([]);
      expect((await rows(c, "SELECT active_scope_key k FROM institutional_template_bindings WHERE id = 'tb-p'"))[0].k).toBe("edital|pregao||||");
      expect(await sqlCode(bind(c, "tb-p2", 1, "P", { m: "pregao" }))).toBe("ER_DUP_ENTRY");
      expect(await sqlCode(bind(c, "tb-p3", 1, "P", { m: "pregao", p: "bll" }))).toBe("NO_ERROR");

      // processo morto DEPOIS de recriar a chave, antes do UNIQUE e do display_name (reaplicação direta do SQL)
      await c.query("ALTER TABLE institutional_template_bindings DROP INDEX uq_itb_active_scope");
      await c.query("ALTER TABLE institutional_template_identities DROP COLUMN display_name");
      for (const s of STATEMENTS) await c.query(s);
      expect(await collectSchemaProblems(c)).toEqual([]);
      expect(await sqlCode(bind(c, "tb-p4", 1, "P", { m: "pregao", p: "bll" }))).toBe("ER_DUP_ENTRY");
    } finally { await c.end(); }
  }, 300_000);

  it("M4 — MESMO tenant: escopo completo igual ⇒ conflito; forma/plataforma diferentes COEXISTEM; inativo não conflita", async () => {
    const c = await mysql.createConnection(urlFor(dbs.fresh));
    try {
      await migrateWithAdvisoryLock(c);
      await seedParents(c, 11, "S");
      const s = { m: "pregao", f: "eletronico", p: "bll" };
      expect(await sqlCode(bind(c, "s1", 11, "S", s))).toBe("NO_ERROR");
      expect(await sqlCode(bind(c, "s2", 11, "S", s))).toBe("ER_DUP_ENTRY");                                      // mesmo escopo exato
      expect(await sqlCode(bind(c, "s3", 11, "S", { ...s, f: "presencial" }))).toBe("NO_ERROR");                  // forma diferente
      expect(await sqlCode(bind(c, "s4", 11, "S", { ...s, p: "licitanet" }))).toBe("NO_ERROR");                   // plataforma diferente
      expect(await sqlCode(bind(c, "s5", 11, "S", { m: "pregao", f: "eletronico" }))).toBe("NO_ERROR");           // sem plataforma ≠ com plataforma
      expect(await sqlCode(bind(c, "s6", 11, "S", { m: "pregao" }))).toBe("NO_ERROR");
      expect(await sqlCode(bind(c, "s8", 11, "S", { ...s, active: 0 }))).toBe("NO_ERROR");                        // inativo não ocupa a chave
      expect(await sqlCode(bind(c, "s8b", 11, "S", { ...s, active: 0 }))).toBe("NO_ERROR");                       // vários inativos coexistem (histórico)
      // injetividade da chave: componentes vazios em posições diferentes não colidem
      expect(await sqlCode(bind(c, "s9", 11, "S", { f: "eletronico" }))).toBe("NO_ERROR");
      expect(await sqlCode(bind(c, "s10", 11, "S", { p: "eletronico" }))).toBe("NO_ERROR");
      expect(await sqlCode(bind(c, "s11", 11, "S", { m: "eletronico" }))).toBe("NO_ERROR");
      // sensível a maiúsculas (colação binária): a normalização é do domínio, o banco não "aproxima"
      expect(await sqlCode(bind(c, "s12", 11, "S", { m: "pregao", f: "eletronico", p: "BLL" }))).toBe("NO_ERROR");
    } finally { await c.end(); }
  }, 120_000);

  it("M5 — CROSS tenant: mesmo escopo em tenants distintos coexiste; FK composta de tenant continua rejeitando cross-tenant", async () => {
    const c = await mysql.createConnection(urlFor(dbs.fresh));
    try {
      await migrateWithAdvisoryLock(c);
      await seedParents(c, 21, "X"); await seedParents(c, 22, "Y");
      const s = { m: "pregao", f: "eletronico", p: "bll" };
      expect(await sqlCode(bind(c, "x1", 21, "X", s))).toBe("NO_ERROR");
      expect(await sqlCode(bind(c, "y1", 22, "Y", s))).toBe("NO_ERROR");
      expect(await sqlCode(bind(c, "x2", 21, "X", s))).toBe("ER_DUP_ENTRY");
      // revisão/identidade de OUTRO tenant: rejeitado pela FK composta (HD-26), qualquer que seja o escopo
      expect(await sqlCode(c.query(`INSERT INTO institutional_template_bindings (id, organization_id, document_kind, scope_modality, scope_form, scope_platform, identity_id, pinned_revision_id, active, effective_from_iso)
        VALUES ('xz', 21, 'edital', 'pregao', 'presencial', '', 'ti-Y', 'tr-Y', 1, '2026-10-01T00:00:00Z')`))).toBe("ER_NO_REFERENCED_ROW_2");
      expect(await sqlCode(c.query(`INSERT INTO institutional_template_bindings (id, organization_id, document_kind, scope_modality, scope_form, scope_platform, identity_id, pinned_revision_id, active, effective_from_iso)
        VALUES ('xw', 21, 'edital', 'pregao', 'presencial', '', 'ti-X', 'tr-Y', 1, '2026-10-01T00:00:00Z')`))).toBe("ER_NO_REFERENCED_ROW_2");
      expect(Number((await rows(c, "SELECT COUNT(*) n FROM institutional_template_bindings WHERE id IN ('xz','xw')"))[0].n)).toBe(0);
      // display_name é por identidade/tenant: o mesmo rótulo em tenants distintos coexiste
      await c.query("UPDATE institutional_template_identities SET display_name = 'Edital Pregão BLL' WHERE id IN ('ti-X','ti-Y')");
      expect((await rows(c, "SELECT COUNT(*) n FROM institutional_template_identities WHERE display_name = 'Edital Pregão BLL'"))[0].n).toBe(2);
    } finally { await c.end(); }
  }, 120_000);

  it("M6 — CONCORRÊNCIA: 12 inserções simultâneas do MESMO escopo ⇒ exatamente uma vence; escopos distintos ⇒ todas vencem", async () => {
    const setup = await mysql.createConnection(urlFor(dbs.fresh));
    const conns: mysql.Connection[] = [];
    try {
      await migrateWithAdvisoryLock(setup);
      await seedParents(setup, 31, "C");
      for (let i = 0; i < 12; i++) conns.push(await mysql.createConnection(urlFor(dbs.fresh)));
      const same = await Promise.all(conns.map((c, i) => sqlCode(bind(c, `cc-${i}`, 31, "C", { m: "concorrencia", f: "eletronico", p: "bll" }))));
      expect(same.filter((x) => x === "NO_ERROR")).toHaveLength(1);
      expect(same.filter((x) => x === "ER_DUP_ENTRY")).toHaveLength(11);
      const distinct = await Promise.all(conns.map((c, i) => sqlCode(bind(c, `cd-${i}`, 31, "C", { m: "concorrencia", f: "eletronico", p: `plataforma-${i}` }))));
      expect(distinct.every((x) => x === "NO_ERROR")).toBe(true);
      expect(Number((await rows(setup, "SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = 31 AND active = 1"))[0].n)).toBe(13);
    } finally {
      await Promise.all(conns.map((c) => c.end().catch(() => {})));
      await setup.end();
    }
  }, 120_000);
});
