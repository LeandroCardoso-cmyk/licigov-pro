/**
 * PR B.2.1 — Reconciliação da migration 0288 (campos canônicos de ingestão) contra MySQL REAL (CI).
 *
 * Só roda quando DATABASE_URL está definido (CI com serviço MySQL efêmero); é pulado localmente.
 *
 * Diagnóstico de origem: o staging deployou um estado intermediário (commit 91bd893) cujo ensureSchema
 * criava checksum/processId/importPurpose via addColumnIfMissing. Ao subir a migration FORMAL (0288),
 * o `ALTER ... ADD checksum` colidia com a coluna já existente (ER_DUP_FIELDNAME / 42S21), derrubando
 * o boot no runMigrations(). A 0288 passou a ser RECONCILIADORA (INFORMATION_SCHEMA + SQL dinâmico):
 * adiciona só o que falta, valida o que existe e aborta de forma acionável se for incompatível.
 *
 * Cobre os cenários exigidos:
 *   A. banco novo (sem as 3 colunas)                         → adiciona colunas + índice;
 *   B. banco transitório (as 3 colunas já criadas, corretas) → não recria; adiciona só o índice;
 *   C. banco parcialmente reconciliado                       → completa o que falta;
 *   D. coluna existente com tipo incompatível                → falha EXPLÍCITA e acionável;
 *   E. índice ausente / índice já presente                   → cria / no-op idempotente;
 *   F. linhas históricas preservadas (sem backfill);
 *   G. idempotência (reaplicar não altera nem falha);
 *   H. journal registra 0288 UMA única vez + 2ª init não reaplica (boot real);
 *   I. cadeia completa de migrations aplica no banco zerado;
 *   J. isolamento multi-tenant: índice NÃO exclusivo (mesmo checksum em orgs distintas e re-import).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const ROOT = process.cwd();

/** Statements da 0288 (mesma separação do migrator: 1 por chunk, sem comentários). */
function migration0288Statements(): string[] {
  const sql = readFileSync(path.join(ROOT, "drizzle", "0288_import_session_canonical_fields.sql"), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}

/** folderMillis da 0288 no journal (drizzle grava created_at = folderMillis). */
function migration0288FolderMillis(): number {
  const journal = JSON.parse(readFileSync(path.join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
  const entry = journal.entries.find((e: { tag: string }) => e.tag === "0288_import_session_canonical_fields");
  return Number(entry.when);
}

describe.skipIf(!DB)("Reconciliação da migration 0288 — MySQL real", () => {
  let conn: mysql.Connection;
  const STMTS = migration0288Statements();

  async function applyMigration(): Promise<void> {
    // Roda cada chunk como uma query (mesmo mecanismo do migrator do drizzle: mysql2 .query()).
    // Variáveis de sessão e prepared statements persistem na mesma conexão entre os chunks.
    for (const stmt of STMTS) {
      await conn.query(stmt);
    }
  }

  /** Recria import_sessions do zero com as colunas canônicas pedidas (FK desligada p/ isolar o drop). */
  async function recreateImportSessions(opts: {
    checksum?: string | null;       // definição SQL da coluna, ou null p/ ausente
    processId?: string | null;
    importPurpose?: string | null;
    withIndex?: boolean;
  }): Promise<void> {
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await conn.query("DROP TABLE IF EXISTS `import_sessions`");
    const cols: string[] = [
      "`id` INT NOT NULL AUTO_INCREMENT",
      "`organizationId` INT NOT NULL",
      "`uploadedBy` INT NOT NULL DEFAULT 0",
      "`sourceFileId` VARCHAR(255) NOT NULL DEFAULT ''",
      "`status` VARCHAR(30) NOT NULL DEFAULT 'uploaded'",
      "`createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    ];
    if (opts.checksum) cols.push(`\`checksum\` ${opts.checksum}`);
    if (opts.processId) cols.push(`\`processId\` ${opts.processId}`);
    if (opts.importPurpose) cols.push(`\`importPurpose\` ${opts.importPurpose}`);
    cols.push("PRIMARY KEY (`id`)");
    cols.push("INDEX `idx_import_sessions_org` (`organizationId`)");
    if (opts.withIndex) cols.push("INDEX `import_sessions_org_checksum_idx` (`organizationId`,`checksum`)");
    await conn.query(
      `CREATE TABLE \`import_sessions\` (${cols.join(", ")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  }

  async function column(name: string): Promise<{ dataType: string; charLen: number | null; nullable: boolean } | null> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_sessions' AND COLUMN_NAME = ?`,
      [name]
    );
    if (rows.length === 0) return null;
    return {
      dataType: String(rows[0].DATA_TYPE).toLowerCase(),
      charLen: rows[0].CHARACTER_MAXIMUM_LENGTH == null ? null : Number(rows[0].CHARACTER_MAXIMUM_LENGTH),
      nullable: String(rows[0].IS_NULLABLE).toUpperCase() === "YES",
    };
  }

  /** Índice de dedup: {existe, nãoExclusivo, nºColunas}. */
  async function checksumIndex(): Promise<{ exists: boolean; nonUnique: boolean; columns: number }> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT NON_UNIQUE, COUNT(*) AS cols FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_sessions'
         AND INDEX_NAME = 'import_sessions_org_checksum_idx'
       GROUP BY NON_UNIQUE`,
      []
    );
    if (rows.length === 0) return { exists: false, nonUnique: false, columns: 0 };
    return { exists: true, nonUnique: Number(rows[0].NON_UNIQUE) === 1, columns: Number(rows[0].cols) };
  }

  async function expectCanonicalShape(): Promise<void> {
    expect(await column("checksum")).toEqual({ dataType: "varchar", charLen: 64, nullable: true });
    expect(await column("processId")).toEqual({ dataType: "int", charLen: null, nullable: true });
    expect(await column("importPurpose")).toEqual({ dataType: "varchar", charLen: 50, nullable: true });
    const idx = await checksumIndex();
    expect(idx.exists, "índice de dedup deve existir").toBe(true);
    expect(idx.nonUnique, "índice de dedup deve ser NÃO exclusivo").toBe(true);
    expect(idx.columns, "índice deve cobrir (organizationId, checksum)").toBe(2);
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
  });

  afterAll(async () => {
    await conn?.end();
  });

  // ── H + I: boot real (cadeia completa + journal) ────────────────────────────────────────────────
  it("cadeia completa aplica e o journal registra a 0288 uma única vez; 2ª init não reaplica", async () => {
    await runMigrations(conn);                       // aplica a cadeia (ou no-op se já aplicada)
    await runMigrations(conn);                       // segunda inicialização: não pode falhar nem reaplicar

    const folderMillis = migration0288FolderMillis();
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM `__drizzle_migrations` WHERE created_at = ?",
      [folderMillis]
    );
    expect(Number(rows[0].cnt), "0288 deve estar registrada exatamente uma vez no journal").toBe(1);
    await expectCanonicalShape();
  }, 300_000);

  // ── A: banco novo, sem as colunas ───────────────────────────────────────────────────────────────
  it("A) banco novo: adiciona checksum/processId/importPurpose + índice não exclusivo", async () => {
    await recreateImportSessions({});
    expect(await column("checksum")).toBeNull();
    await applyMigration();
    await expectCanonicalShape();
  }, 120_000);

  // ── B: as três colunas já existem e estão corretas ──────────────────────────────────────────────
  it("B) transitório: 3 colunas já presentes e corretas → não recria; adiciona só o índice", async () => {
    await recreateImportSessions({
      checksum: "varchar(64) NULL",
      processId: "int NULL",
      importPurpose: "varchar(50) NULL",
      withIndex: false,
    });
    expect((await checksumIndex()).exists).toBe(false);
    await applyMigration();                          // não pode lançar ER_DUP_FIELDNAME
    await expectCanonicalShape();
  }, 120_000);

  // ── C: parcialmente reconciliado ────────────────────────────────────────────────────────────────
  it("C) parcial: só checksum presente → completa processId/importPurpose + índice", async () => {
    await recreateImportSessions({ checksum: "varchar(64) NULL" });
    expect(await column("processId")).toBeNull();
    await applyMigration();
    await expectCanonicalShape();
  }, 120_000);

  // ── D: coluna existente com tipo incompatível → falha explícita e acionável ──────────────────────
  it("D) incompatível: checksum varchar(32) → aborta com mensagem acionável (não muta a coluna)", async () => {
    await recreateImportSessions({ checksum: "varchar(32) NULL" });
    await expect(applyMigration()).rejects.toThrow(/erro_0288_import_sessions_checksum_deve_ser_varchar_64/);
    // A coluna divergente NÃO foi silenciosamente alterada:
    expect(await column("checksum")).toEqual({ dataType: "varchar", charLen: 32, nullable: true });
  }, 120_000);

  it("D2) incompatível: processId bigint → aborta acionável", async () => {
    await recreateImportSessions({ checksum: "varchar(64) NULL", processId: "bigint NULL" });
    await expect(applyMigration()).rejects.toThrow(/erro_0288_import_sessions_processId_deve_ser_int/);
  }, 120_000);

  it("D3) incompatível: checksum NOT NULL (nulabilidade) → aborta acionável", async () => {
    await recreateImportSessions({ checksum: "varchar(64) NOT NULL DEFAULT ''" });
    await expect(applyMigration()).rejects.toThrow(/erro_0288_import_sessions_checksum_deve_ser_varchar_64_e_nulavel/);
  }, 120_000);

  // ── E: índice já existente (não exclusivo) → idempotente ─────────────────────────────────────────
  it("E) índice já presente (não exclusivo): reaplicar não duplica nem falha", async () => {
    await recreateImportSessions({
      checksum: "varchar(64) NULL",
      processId: "int NULL",
      importPurpose: "varchar(50) NULL",
      withIndex: true,
    });
    const before = await checksumIndex();
    expect(before.exists && before.nonUnique).toBe(true);
    await applyMigration();
    await expectCanonicalShape();
  }, 120_000);

  // ── G: idempotência (reaplicar a 0288 sobre banco já reconciliado) ───────────────────────────────
  it("G) idempotência: aplicar a 0288 duas vezes seguidas não altera nem falha", async () => {
    await recreateImportSessions({});
    await applyMigration();
    await applyMigration();                          // segunda passagem: tudo já existe → no-op
    await expectCanonicalShape();
  }, 120_000);

  // ── F + J: linhas históricas preservadas + isolamento multi-tenant (índice não exclusivo) ────────
  it("F+J) preserva linhas históricas e permite mesmo checksum em orgs distintas e re-import", async () => {
    await recreateImportSessions({});
    // Linha histórica ANTES da reconciliação (sem os campos canônicos):
    await conn.query(
      "INSERT INTO `import_sessions` (`organizationId`, `uploadedBy`, `sourceFileId`, `status`) VALUES (1, 10, 'legacy-file', 'approved')"
    );
    await applyMigration();
    await expectCanonicalShape();

    // A linha histórica sobrevive e checksum ficou NULL (sem backfill especulativo):
    const [histRows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT checksum, processId, importPurpose FROM `import_sessions` WHERE sourceFileId = 'legacy-file'"
    );
    expect(histRows.length).toBe(1);
    expect(histRows[0].checksum).toBeNull();
    expect(histRows[0].processId).toBeNull();
    expect(histRows[0].importPurpose).toBeNull();

    // Índice NÃO exclusivo: mesmo checksum em orgs distintas E re-import na mesma org são permitidos.
    await conn.query(
      "INSERT INTO `import_sessions` (`organizationId`, `uploadedBy`, `sourceFileId`, `status`, `checksum`) VALUES " +
      "(1, 10, 'f1', 'uploaded', 'DEADBEEF'), (2, 20, 'f2', 'uploaded', 'DEADBEEF'), (1, 10, 'f3', 'uploaded', 'DEADBEEF')"
    );
    const [dupRows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM `import_sessions` WHERE checksum = 'DEADBEEF'"
    );
    expect(Number(dupRows[0].cnt), "mesmo checksum deve ser aceito (sem unicidade global)").toBe(3);
  }, 120_000);
});
