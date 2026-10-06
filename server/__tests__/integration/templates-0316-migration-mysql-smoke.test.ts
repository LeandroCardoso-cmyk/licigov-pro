/**
 * T2 / HD-26 — migration 0316 (persistência dos Templates Institucionais) contra MySQL REAL, em bancos DEDICADOS
 * (herméticos). Só roda com DATABASE_URL. Pré-estado do upgrade = PREFIXO do journal (idx < 316).
 *
 *  M0  a 0316 está no journal (idx 316, depois da 0315); o SQL é aditivo, replay-safe e NÃO toca tabelas existentes
 *  M1  FRESH: banco limpo → 0316 (6 tabelas, colunas/índices/collation/FKs do contrato); `collectSchemaProblems` = []; rerun no-op
 *  M2  UPGRADE 0315→0316 com dados: tabelas existentes byte a byte idênticas e com a MESMA estrutura (compatibilidade com a
 *      aplicação antiga); tabelas novas vazias; reaplicar o SQL à mão = no-op
 *  M3  ESTADO PARCIAL: k de 6 tabelas aplicadas → o guard acusa PARTIAL_MIGRATION_STATE; a migration completa converge
 *  M4  FK composta de tenant: cross-tenant rejeitado, mesmo tenant aceito, órfão rejeitado, RESTRICT (sem CASCADE)
 *  M5  DRIFT: FK ausente / alvo errado / sem tenant / CASCADE / tabela ausente / índice do pai ausente são detectados pelo guard
 *  M6  ROLLBACK: DROP só das 6 tabelas (ordem inversa) não altera nenhuma outra tabela nem o ledger
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
import { INSTITUTIONAL_TEMPLATES_FK_CONTRACT, INSTITUTIONAL_TEMPLATES_TABLES } from "../../db/institutionalTemplates/schemaContract";

const DB = process.env.DATABASE_URL;
const DRZ = path.join(process.cwd(), "drizzle");
const TAG = "0316_institutional_templates_persistence";
const IDX = 316;
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
const newTablesPresent = async (c: mysql.Connection) => Number((await rows(c,
  `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${inList(NEW)})`))[0].n);
const codes = async (c: mysql.Connection) => (await checkForeignKeyContract(c)).map((p) => p.code);
const sqlCode = async (p: Promise<unknown>) => { try { await p; return "NO_ERROR"; } catch (e) { return (e as { code?: string }).code ?? "UNKNOWN"; } };

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
const dump = async (c: mysql.Connection, t: string) => JSON.stringify(await rows(c, `SELECT * FROM \`${t}\` ORDER BY id`));

describe.skipIf(!DB)("T2 — migration 0316 (MySQL real, bancos dedicados)", () => {
  const stamp = Date.now();
  const dbs = { fresh: `t2_0316_fresh_${stamp}`, up: `t2_0316_up_${stamp}`, partial: `t2_0316_part_${stamp}`, drift: `t2_0316_drift_${stamp}` };
  let admin: mysql.Connection;
  let pre = "";

  const prefixMigrate = async (c: mysql.Connection) => migrate(drizzle(c), { migrationsFolder: pre });

  beforeAll(async () => {
    admin = await mysql.createConnection(DB!);
    for (const d of Object.values(dbs)) await admin.query(`CREATE DATABASE \`${d}\``);
    pre = mkdtempSync(path.join(os.tmpdir(), "t2-pre0316-"));
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

  it("M0 — a 0316 está no journal (idx 316, depois da 0315) e o SQL é aditivo, replay-safe e não toca tabelas existentes", () => {
    const e = JOURNAL.find((x) => x.idx === IDX)!;
    expect(e.tag).toBe(TAG);
    expect(e.when).toBeGreaterThan(JOURNAL.find((x) => x.idx === IDX - 1)!.when);
    expect(STATEMENTS).toHaveLength(6);
    for (const s of STATEMENTS) expect(s).toMatch(/^CREATE TABLE IF NOT EXISTS `/);
    const sql = STATEMENTS.join("\n");
    expect(sql).not.toMatch(/\b(DROP\s+|UPDATE\s+`|DELETE\s+FROM|TRUNCATE|RENAME|ALTER\s+TABLE|INSERT\s+INTO)\b/i);
    expect(sql).not.toMatch(/ON\s+(DELETE|UPDATE)\s+CASCADE|SET\s+NULL/i);
    for (const t of ["official_documents", "generated_documents", "institutional_decisions", "official_document_artifacts"]) expect(sql).not.toContain(`\`${t}\``);
  });

  it("M1 — FRESH: banco limpo → 0316 (contrato de FKs/índices/collation); schema válido; rerun no-op", async () => {
    const c = await mysql.createConnection(urlFor(dbs.fresh));
    try {
      await migrateWithAdvisoryLock(c);
      expect(await newTablesPresent(c)).toBe(6);
      expect(await checkForeignKeyContract(c)).toEqual([]);
      expect(await collectSchemaProblems(c)).toEqual([]);
      for (const r of await rows(c, `SELECT TABLE_NAME t, TABLE_COLLATION k, ENGINE e FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${inList(NEW)})`)) {
        expect(r.k, r.t).toBe("utf8mb4_unicode_ci");
        expect(r.e, r.t).toBe("InnoDB");
      }
      // tenant NOT NULL em TODA estrutura V1 (nunca NULL = global)
      for (const t of NEW) {
        const col = (await rows(c, `SELECT IS_NULLABLE n, COLUMN_TYPE ty FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'organization_id'`, [t]))[0];
        expect(col, t).toMatchObject({ n: "NO", ty: "int" });
      }
      // UNIQUE(organization_id, id) em todo pai referenciado
      for (const parent of new Set(INSTITUTIONAL_TEMPLATES_FK_CONTRACT.foreignKeys.map((f) => f.refTable))) {
        const u = await rows(c, `SELECT INDEX_NAME i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 GROUP BY INDEX_NAME`, [parent]);
        expect(u.map((r) => r.c), parent).toContain("organization_id,id");
      }
      // nenhuma FK nova usa CASCADE/SET NULL
      const bad = await rows(c, `SELECT CONSTRAINT_NAME n FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${inList(NEW)}) AND (DELETE_RULE NOT IN ('RESTRICT','NO ACTION') OR UPDATE_RULE NOT IN ('RESTRICT','NO ACTION'))`);
      expect(bad).toEqual([]);
      const n = await ledger(c);
      await migrateWithAdvisoryLock(c);
      expect(await ledger(c)).toBe(n);
    } finally { await c.end(); }
  }, 300_000);

  it("M2 — UPGRADE 0315→0316 com dados: tabelas existentes intactas e com a mesma estrutura; novas vazias; replay manual = no-op", async () => {
    const c = await mysql.createConnection(urlFor(dbs.up));
    try {
      await prefixMigrate(c);
      expect(await newTablesPresent(c)).toBe(0);
      await c.query(
        `INSERT INTO official_documents (id, tenant_id, business_domain, document_type, origin, title, version, status, content, lineage_id, replay_hash, storage_key, mime_type, size_bytes, content_hash)
         VALUES ('doc00000000000000001', 1, 'contratos', 'contrato', 'o1', 'Legado', 1, 'gerado', 'conteúdo legado', 'lin00000000000000001', 'rh1', 'document-engine/1/lin/doc-legado.pdf', 'application/pdf', 321, REPEAT('a', 64))`);
      const sigBefore = await signature(c, "EXISTING");
      const dataBefore = await dump(c, "official_documents");
      const l0 = await ledger(c);

      await migrateWithAdvisoryLock(c);
      expect(await ledger(c)).toBe(l0 + FROM_COUNT);
      expect(await newTablesPresent(c)).toBe(6);
      // compatibilidade com a aplicação antiga: nenhuma tabela existente mudou (colunas, índices, FKs) nem seus dados
      expect(await signature(c, "EXISTING")).toBe(sigBefore);
      expect(await dump(c, "official_documents")).toBe(dataBefore);
      // …e a aplicação antiga continua escrevendo normalmente
      await c.query(
        `INSERT INTO official_documents (id, tenant_id, business_domain, document_type, origin, title, version, status, content, lineage_id, replay_hash, storage_key, mime_type, size_bytes, content_hash)
         VALUES ('doc00000000000000002', 2, 'contratos', 'contrato', 'o2', 'Novo', 1, 'gerado', 'x', 'lin00000000000000002', 'rh2', '', '', 0, '')`);
      for (const t of NEW) expect(Number((await rows(c, `SELECT COUNT(*) n FROM \`${t}\``))[0].n), t).toBe(0);
      expect(await collectSchemaProblems(c)).toEqual([]);

      const sigNew = await signature(c, NEW);
      for (const s of STATEMENTS) await c.query(s);   // replay manual: no-op
      expect(await signature(c, NEW)).toBe(sigNew);
      expect(await checkForeignKeyContract(c)).toEqual([]);
    } finally { await c.end(); }
  }, 300_000);

  it("M3 — ESTADO PARCIAL: k de 6 tabelas aplicadas ⇒ o guard acusa PARTIAL_MIGRATION_STATE; a migration completa converge", async () => {
    const c = await mysql.createConnection(urlFor(dbs.partial));
    try {
      await prefixMigrate(c);
      expect(await codes(c)).toEqual([]);                       // nenhuma tabela: estado "antes da 0316" é legítimo
      for (const k of [1, 3, 5]) {
        for (const s of STATEMENTS.slice(0, k)) await c.query(s);
        const got = await codes(c);
        expect(got, `k=${k}`).toContain("PARTIAL_MIGRATION_STATE");
        expect((await collectSchemaProblems(c)).some((p) => p.includes("PARTIAL_MIGRATION_STATE"))).toBe(true);
      }
      await migrateWithAdvisoryLock(c);                         // completa o que falta (CREATE IF NOT EXISTS)
      expect(await newTablesPresent(c)).toBe(6);
      expect(await checkForeignKeyContract(c)).toEqual([]);
      expect(await collectSchemaProblems(c)).toEqual([]);
    } finally { await c.end(); }
  }, 300_000);

  it("M4 — FK composta de tenant: cross-tenant rejeitado, mesmo tenant aceito, órfão rejeitado, RESTRICT sem CASCADE", async () => {
    const c = await mysql.createConnection(urlFor(dbs.fresh));
    try {
      await migrateWithAdvisoryLock(c);   // idempotente: o teste não depende da ordem dos anteriores
      const H = "h".repeat(64);
      const ident = (id: string, org: number) => c.query(
        `INSERT INTO institutional_template_identities (id, organization_id, document_kind, slug, created_by_user_id, created_at_iso) VALUES (?, ?, 'edital', ?, 1, '2026-10-01T00:00:00Z')`, [id, org, `s-${id}`]);
      await ident("ti-A", 1); await ident("ti-B", 2);
      const rev = (id: string, org: number, identity: string, n: number) => c.query(
        `INSERT INTO institutional_template_revisions (id, organization_id, identity_id, revision, status, ast_json, variable_catalog_version, semantic_hash, hash_version, source_format)
         VALUES (?, ?, ?, ?, 'DRAFT', '{}', 'cat/1', ?, 'tpl-hash/1', 'NATIVE')`, [id, org, identity, n, H]);
      expect(await sqlCode(rev("tr-A1", 1, "ti-A", 1))).toBe("NO_ERROR");            // mesmo tenant: aceito
      expect(await sqlCode(rev("tr-X1", 1, "ti-B", 1))).toBe("ER_NO_REFERENCED_ROW_2"); // identidade de OUTRO tenant: rejeitado
      expect(await sqlCode(rev("tr-X2", 1, "inexistente", 1))).toBe("ER_NO_REFERENCED_ROW_2"); // órfão: rejeitado
      expect(await sqlCode(rev("tr-B1", 2, "ti-B", 1))).toBe("NO_ERROR");

      const bind = (id: string, org: number, identity: string, revision: string, modality: string) => c.query(
        `INSERT INTO institutional_template_bindings (id, organization_id, document_kind, scope_modality, identity_id, pinned_revision_id, active, effective_from_iso) VALUES (?, ?, 'edital', ?, ?, ?, 1, '2026-10-01T00:00:00Z')`,
        [id, org, modality, identity, revision]);
      expect(await sqlCode(bind("tb-A", 1, "ti-A", "tr-A1", "m1"))).toBe("NO_ERROR");
      expect(await sqlCode(bind("tb-X", 1, "ti-A", "tr-B1", "m2"))).toBe("ER_NO_REFERENCED_ROW_2");   // revisão de outro tenant
      expect(await sqlCode(bind("tb-Y", 2, "ti-A", "tr-A1", "m3"))).toBe("ER_NO_REFERENCED_ROW_2");   // tenant ≠ do pai
      expect(await sqlCode(bind("tb-Z", 1, "ti-B", "tr-A1", "m4"))).toBe("ER_NO_REFERENCED_ROW_2");   // identidade ≠ da revisão (pin exato)
      expect(await sqlCode(bind("tb-D", 1, "ti-A", "tr-A1", "m1"))).toBe("ER_DUP_ENTRY");             // um ativo por escopo

      // RESTRICT: pai referenciado não some nem muda de chave/tenant
      expect(await sqlCode(c.query("DELETE FROM institutional_template_revisions WHERE organization_id = 1 AND id = 'tr-A1'"))).toBe("ER_ROW_IS_REFERENCED_2");
      expect(await sqlCode(c.query("DELETE FROM institutional_template_identities WHERE organization_id = 1 AND id = 'ti-A'"))).toBe("ER_ROW_IS_REFERENCED_2");
      expect(await sqlCode(c.query("UPDATE institutional_template_revisions SET organization_id = 2 WHERE id = 'tr-A1'"))).not.toBe("NO_ERROR");
      expect(await sqlCode(c.query("UPDATE institutional_template_identities SET id = 'zz' WHERE organization_id = 1 AND id = 'ti-A'"))).toBe("ER_ROW_IS_REFERENCED_2");
      expect(Number((await rows(c, "SELECT COUNT(*) n FROM institutional_template_revisions WHERE organization_id = 1"))[0].n)).toBe(1);
      // sem filhos, o pai pode ser removido (RESTRICT ≠ imutável): prova de que não há CASCADE escondido
      await c.query("DELETE FROM institutional_template_bindings WHERE organization_id = 1 AND id = 'tb-A'");
      expect(Number((await rows(c, "SELECT COUNT(*) n FROM institutional_template_revisions WHERE organization_id = 1"))[0].n)).toBe(1);
      expect(await sqlCode(c.query("DELETE FROM institutional_template_revisions WHERE organization_id = 1 AND id = 'tr-A1'"))).toBe("NO_ERROR");
      expect(await sqlCode(c.query("DELETE FROM institutional_template_identities WHERE organization_id = 1 AND id = 'ti-A'"))).toBe("NO_ERROR");
      await c.query("DELETE FROM institutional_template_revisions WHERE organization_id = 2");
      await c.query("DELETE FROM institutional_template_identities WHERE organization_id = 2");
    } finally { await c.end(); }
  }, 120_000);

  it("M5 — DRIFT: o guard detecta FK ausente, alvo errado, tenant fora da FK, CASCADE, tabela ausente e índice do pai ausente", async () => {
    const c = await mysql.createConnection(urlFor(dbs.drift));
    try {
      await migrateWithAdvisoryLock(c);
      expect(await codes(c)).toEqual([]);
      const def = async (table: string, name: string) => String((await rows(c, `SHOW CREATE TABLE \`${table}\``))[0]["Create Table"]).split("\n").find((l) => l.includes(`CONSTRAINT \`${name}\``))!.trim().replace(/,$/, "");

      // 1) FK crítica ausente
      const dcr = await def("document_composition_references", "fk_dcr_manifest");
      await c.query("ALTER TABLE document_composition_references DROP FOREIGN KEY fk_dcr_manifest");
      expect(await codes(c)).toContain("MISSING_CRITICAL_FK");
      expect((await collectSchemaProblems(c)).some((p) => p.includes("MISSING_CRITICAL_FK"))).toBe(true);
      await c.query(`ALTER TABLE document_composition_references ADD ${dcr}`);
      expect(await codes(c)).toEqual([]);

      // 2) FK sem tenant (só id) — tenant ausente da FK composta
      await c.query("ALTER TABLE document_composition_references DROP FOREIGN KEY fk_dcr_manifest");
      await c.query("ALTER TABLE document_composition_manifests ADD UNIQUE KEY uq_tmp_id (id)");
      await c.query("ALTER TABLE document_composition_references ADD INDEX idx_tmp_m (manifest_id)");
      await c.query("ALTER TABLE document_composition_references ADD CONSTRAINT fk_dcr_manifest FOREIGN KEY (manifest_id) REFERENCES document_composition_manifests (id) ON DELETE RESTRICT ON UPDATE RESTRICT");
      expect(await codes(c)).toContain("TENANT_MISSING_FROM_COMPOSITE_FK");
      await c.query("ALTER TABLE document_composition_references DROP FOREIGN KEY fk_dcr_manifest");
      await c.query("ALTER TABLE document_composition_references DROP INDEX idx_tmp_m");
      await c.query("ALTER TABLE document_composition_manifests DROP INDEX uq_tmp_id");
      await c.query(`ALTER TABLE document_composition_references ADD ${dcr}`);
      expect(await codes(c)).toEqual([]);

      // 3) CASCADE proibido
      await c.query("ALTER TABLE document_composition_references DROP FOREIGN KEY fk_dcr_manifest");
      await c.query(`ALTER TABLE document_composition_references ADD ${dcr.replace(/ON DELETE RESTRICT/, "ON DELETE CASCADE")}`);
      expect(await codes(c)).toContain("FORBIDDEN_CASCADE");
      await c.query("ALTER TABLE document_composition_references DROP FOREIGN KEY fk_dcr_manifest");
      await c.query(`ALTER TABLE document_composition_references ADD ${dcr}`);
      expect(await codes(c)).toEqual([]);

      // 4) FK apontando para o alvo errado (colunas diferentes no pai)
      const ite = await def("institutional_template_events", "fk_ite_revision");
      await c.query("ALTER TABLE institutional_template_events DROP FOREIGN KEY fk_ite_revision");
      await c.query("ALTER TABLE institutional_template_events ADD CONSTRAINT fk_ite_revision FOREIGN KEY (organization_id, identity_id, revision_id) REFERENCES institutional_template_revisions (organization_id, identity_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT");
      expect(await codes(c)).toContain("WRONG_FK_COLUMNS");
      await c.query("ALTER TABLE institutional_template_events DROP FOREIGN KEY fk_ite_revision");
      await c.query(`ALTER TABLE institutional_template_events ADD ${ite}`);
      expect(await codes(c)).toEqual([]);

      // 5) tabela ausente ⇒ estado parcial
      await c.query("DROP TABLE document_composition_references");
      expect(await codes(c)).toContain("PARTIAL_MIGRATION_STATE");
      await c.query(STATEMENTS[5]);
      expect(await codes(c)).toEqual([]);

      // 6) UNIQUE(org,id) do pai ausente (FK existente impede o drop → derruba a FK, o índice e mede)
      const evt = await def("institutional_template_events", "fk_ite_binding");
      await c.query("ALTER TABLE institutional_template_events DROP FOREIGN KEY fk_ite_binding");
      const fkb = await def("institutional_template_bindings", "fk_itb_identity");
      void fkb;
      await c.query("ALTER TABLE institutional_template_bindings DROP INDEX uq_itb_org_id");
      expect(await codes(c)).toEqual(expect.arrayContaining(["MISSING_CRITICAL_FK"]));
      await c.query("ALTER TABLE institutional_template_bindings ADD CONSTRAINT uq_itb_org_id UNIQUE (organization_id, id)");
      await c.query(`ALTER TABLE institutional_template_events ADD ${evt}`);
      expect(await codes(c)).toEqual([]);
      expect(await collectSchemaProblems(c)).toEqual([]);
    } finally { await c.end(); }
  }, 300_000);

  it("M6 — ROLLBACK: DROP só das 6 tabelas (ordem inversa) não altera nenhuma outra tabela nem o ledger", async () => {
    const c = await mysql.createConnection(urlFor(dbs.up));
    try {
      await migrateWithAdvisoryLock(c);   // idempotente: o teste não depende da ordem dos anteriores
      const sig = await signature(c, "EXISTING");
      const data = await dump(c, "official_documents");
      const l = await ledger(c);
      for (const t of [...NEW].reverse()) await c.query(`DROP TABLE \`${t}\``);
      expect(await newTablesPresent(c)).toBe(0);
      expect(await signature(c, "EXISTING")).toBe(sig);
      expect(await dump(c, "official_documents")).toBe(data);
      expect(await ledger(c)).toBe(l);
      expect(await codes(c)).toEqual([]);             // zero tabelas = pré-0316 legítimo
      for (const s of STATEMENTS) await c.query(s);   // e reaplicável
      expect(await checkForeignKeyContract(c)).toEqual([]);
    } finally { await c.end(); }
  }, 120_000);
});
