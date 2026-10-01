/**
 * R3 / PR-06 — decisão B do responsável: número oficial do contrato ÚNICO POR ORGANIZAÇÃO, qualquer origem —
 * migration 0310 contra MySQL/MariaDB REAL, em bancos DEDICADOS (herméticos). Só roda com DATABASE_URL definido.
 *
 * Matriz:
 *  M1  banco LIMPO: cadeia completa pelo runner de release ⇒ coluna gerada `normalized_number` (utf8mb4_bin, STORED)
 *      + UNIQUE(organization_id, normalized_number); schema válido para o validator do boot (hash da última migration).
 *  M2  UPGRADE com DUPLICATA (mesmo número em duas origens da mesma organização, inclusive variante com espaços nas
 *      pontas) ⇒ o preflight read-only a acusa (só contagens, sem PII) e o guard da 0310 ABORTA (fail-closed) com a
 *      mensagem estável ANTES de qualquer DDL: nenhuma coluna/índice criado, ledger inalterado, linhas intactas.
 *  M3  UPGRADE LIMPO (números distintos, legado com espaços, vazios, variantes só de caixa, mesmo número em outra
 *      organização) ⇒ a 0310 (e as posteriores do journal) aplica; backfill = TRIM determinístico pelo banco (nada inventado; vazio ⇒ NULL);
 *      linhas preservadas byte a byte; rerun = no-op; o UNIQUE recusa duplicata entre origens; a coluna acompanha
 *      edições de `contract_number`.
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
const TAG_0310 = "0310_contract_number_unique_per_org";
const PREFLIGHT = path.join(process.cwd(), "scripts", "preflight-0310-contract-number.sql");
const IDX_0310 = 310;
const JOURNAL_ENTRIES: Array<{ idx: number; tag: string; when: number }> =
  JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")).entries;
/** Entries a partir da 0310 (inclusive): o que o upgrade a partir do prefixo aplica. */
const FROM_0310_COUNT = JOURNAL_ENTRIES.filter((e) => e.idx >= IDX_0310).length;
const LAST_TAG = JOURNAL_ENTRIES[JOURNAL_ENTRIES.length - 1].tag;

function urlFor(dbName: string): string {
  const u = new URL(DB!);
  u.pathname = `/${dbName}`;
  return u.toString();
}
async function ledgerCount(conn: mysql.Connection): Promise<number> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM __drizzle_migrations");
  return Number(rows[0].n);
}
async function columnInfo(conn: mysql.Connection) {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n, COLLATION_NAME AS c, EXTRA AS x, GENERATION_EXPRESSION AS g
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_workspaces' AND COLUMN_NAME = 'normalized_number'`);
  return rows[0] ?? null;
}
async function uniqueIndex(conn: mysql.Connection): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME AS c, NON_UNIQUE AS nu FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_workspaces' AND INDEX_NAME = 'uq_ctw_org_normalized_number'
      ORDER BY SEQ_IN_INDEX`);
  return rows.map((r) => `${r.c}:${Number(r.nu)}`);
}
async function rowsSnapshot(conn: mysql.Connection): Promise<string> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id, organization_id, origin_type, origin_process, contract_number, contractor, object, value, term, status,
            manager, inspector, correlation_id, created_by, created_at, updated_at FROM contract_workspaces ORDER BY id`);
  return JSON.stringify(rows);
}
/** Executa o preflight read-only (um SELECT por statement) e devolve metrica → valor. */
async function runPreflight(conn: mysql.Connection): Promise<Map<string, number>> {
  const sql = readFileSync(PREFLIGHT, "utf8").replace(/^\s*--.*$/gm, "");
  const out = new Map<string, number>();
  for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    expect(stmt).toMatch(/^SELECT\b/i); // SOMENTE LEITURA
    const [rows] = await conn.query<mysql.RowDataPacket[]>(stmt);
    for (const r of rows) {
      const vals = Object.values(r);
      out.set(String(vals[0]), Number(vals[1]));
    }
  }
  return out;
}

const ins = `INSERT INTO contract_workspaces (id, organization_id, origin_type, origin_process, contract_number, contractor, object, value, term, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, 'objeto', 10, '', ?, ?)`;

describe.skipIf(!DB)("R3 / PR-06 — migration 0310: número do contrato único por organização (MySQL real, bancos dedicados)", () => {
  const stamp = Date.now();
  const cleanDb = `pr06_0310_clean_${stamp}`;
  const dirtyDb = `pr06_0310_dirty_${stamp}`;
  const upgradeDb = `pr06_0310_upgrade_${stamp}`;
  let admin: mysql.Connection;
  let pre0310 = "";

  beforeAll(async () => {
    admin = await mysql.createConnection(DB!);
    for (const d of [cleanDb, dirtyDb, upgradeDb]) await admin.query(`CREATE DATABASE \`${d}\``);
    // Pasta de migrations no estado IMEDIATAMENTE ANTERIOR à 0310 = PREFIXO do journal (idx < 310) e só os arquivos
    // dessas entries. Assim o teste não depende de a 0310 ser a última migration (o migrator aplica por timestamp: se
    // uma migration posterior ficasse na pasta "pré-0310", ela seria aplicada e a 0310 pulada).
    pre0310 = mkdtempSync(path.join(os.tmpdir(), "pr06-pre0310-"));
    mkdirSync(path.join(pre0310, "meta"));
    const journal = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < IDX_0310);
    const prefixTags = new Set(journal.entries.map((e: { tag: string }) => e.tag));
    for (const f of readdirSync(DRZ).filter((x) => /^\d{4}_.+\.sql$/.test(x) && prefixTags.has(x.replace(/\.sql$/, "")))) {
      cpSync(path.join(DRZ, f), path.join(pre0310, f));
    }
    writeFileSync(path.join(pre0310, "meta", "_journal.json"), JSON.stringify(journal));
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      for (const d of [cleanDb, dirtyDb, upgradeDb]) await admin.query(`DROP DATABASE IF EXISTS \`${d}\``).catch(() => {});
      await admin.end();
    }
    if (pre0310) rmSync(pre0310, { recursive: true, force: true });
  }, 60_000);

  it("a 0310 está no journal (idx 310), depois da 0309, e o SQL é aditivo com guard ANTES de qualquer DDL", () => {
    const e310 = JOURNAL_ENTRIES.find((e) => e.idx === IDX_0310)!;
    const e309 = JOURNAL_ENTRIES.find((e) => e.idx === IDX_0310 - 1)!;
    expect(e310.tag).toBe(TAG_0310);
    expect(e310.when).toBeGreaterThan(e309.when);
    const sql = readFileSync(path.join(DRZ, `${TAG_0310}.sql`), "utf8").replace(/^\s*--.*$/gm, "");
    expect(sql.indexOf("CALL `_ctw0310_guard`()")).toBeGreaterThan(-1);
    expect(sql.indexOf("CALL `_ctw0310_guard`()")).toBeLessThan(sql.indexOf("ADD COLUMN"));
    expect(sql).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|INDEX)|UPDATE\s+`|DELETE\s+FROM|TRUNCATE|RENAME)\b/i);
  });

  it("M1 — banco LIMPO: cadeia completa ⇒ coluna gerada utf8mb4_bin STORED + UNIQUE(org, número); schema válido", async () => {
    const conn = await mysql.createConnection(urlFor(cleanDb));
    try {
      await migrateWithAdvisoryLock(conn);
      const col = await columnInfo(conn);
      expect(col).not.toBeNull();
      expect(String(col!.t)).toBe("varchar(80)");
      expect(String(col!.n)).toBe("YES");
      expect(String(col!.c)).toBe("utf8mb4_bin");
      expect(String(col!.x)).toMatch(/STORED GENERATED|PERSISTENT|STORED/i);
      // MySQL 8 devolve a expressão com introducer de charset e aspas escapadas (`_utf8mb4\'\'`); MariaDB, literal.
      expect(String(col!.g).toLowerCase().replace(/\s/g, "").replace(/_utf8mb4/g, "").replace(/\\/g, ""))
        .toContain("nullif(trim(`contract_number`),'')");
      expect(await uniqueIndex(conn)).toEqual(["organization_id:0", "normalized_number:0"]);
      expect(await collectSchemaProblems(conn)).toEqual([]);
      // rerun do runner no banco limpo = no-op
      const n = await ledgerCount(conn);
      await migrateWithAdvisoryLock(conn);
      expect(await ledgerCount(conn)).toBe(n);
    } finally {
      await conn.end();
    }
  }, 240_000);

  it("M2 — UPGRADE com duplicata entre origens: preflight acusa (só contagens) e a 0310 ABORTA fail-closed sem tocar em nada", async () => {
    const conn = await mysql.createConnection(urlFor(dirtyDb));
    try {
      await migrate(drizzle(conn), { migrationsFolder: pre0310 }); // estado da main (pré-0310)
      expect(await columnInfo(conn)).toBeNull();
      // Mesmo número em DUAS origens (permitido pela chave antiga hash(org, origem, número)), e a variante com
      // espaços nas pontas numa 3ª origem; mais uma linha limpa e outra organização com o mesmo número (não bloqueia).
      await conn.query(ins, ["d1", 1, "processo_licitatorio", "p1", "CT-DUP/2026", "Fornecedor Sigiloso A", "vigente", 7]);
      await conn.query(ins, ["d2", 1, "contratacao_direta", "dp1", "CT-DUP/2026", "Fornecedor Sigiloso B", "minuta", 7]);
      await conn.query(ins, ["d3", 1, "avulso", "", "  CT-DUP/2026 ", "Fornecedor Sigiloso C", "minuta", 8]);
      await conn.query(ins, ["d4", 1, "externo", "", "CT-OK-1", "Fornecedor D", "minuta", null]);
      await conn.query(ins, ["d5", 2, "processo_licitatorio", "p9", "CT-DUP/2026", "Outro órgão", "minuta", 9]);
      const before = await rowsSnapshot(conn);
      const ledgerBefore = await ledgerCount(conn);

      // Preflight read-only: 1 grupo duplicado (3 contratos, 1 organização, entre origens); nenhum número exposto.
      const pf = await runPreflight(conn);
      expect(pf.get("GUARD (bloqueia): grupos duplicados")).toBe(1);
      expect(pf.get("contratos em grupos duplicados")).toBe(3);
      expect(pf.get("organizacoes afetadas")).toBe(1);
      expect(pf.get("grupos duplicados entre origens diferentes")).toBe(1);
      expect(pf.get("grupos duplicados com contrato fora de minuta")).toBe(1);
      expect(pf.get("INFO numero com espaco nas pontas")).toBe(1);
      expect([...pf.keys()].join("|")).not.toMatch(/CT-|Sigiloso/);
      expect(await rowsSnapshot(conn)).toBe(before); // o preflight não escreveu nada

      // Release real: ABORTA com a mensagem estável do guard.
      // (o drizzle encapsula o erro do driver: a mensagem do SIGNAL está na cadeia `cause`)
      const failure = await migrateWithAdvisoryLock(conn).then(() => null, (e: unknown) => e);
      expect(failure).not.toBeNull();
      const chain: string[] = [];
      for (let x: unknown = failure, i = 0; x && typeof x === "object" && i < 5; i++) {
        chain.push(String((x as { message?: string }).message ?? ""));
        x = (x as { cause?: unknown }).cause;
      }
      expect(chain.join(" | ")).toMatch(/0310_FC_DUP_CONTRACT_NUMBER_PER_ORG/);
      expect(await columnInfo(conn)).toBeNull();                     // nenhuma DDL aplicada
      expect(await uniqueIndex(conn)).toEqual([]);
      expect(await ledgerCount(conn)).toBe(ledgerBefore);            // 0310 NÃO registrada (nem as posteriores)
      expect(await rowsSnapshot(conn)).toBe(before);                 // nenhum dado tocado (sem dedupe)
      // o boot validator continua acusando o schema atrás (fail-closed em staging/produção); ele nomeia a migration
      // MAIS RECENTE do build não aplicada — o "0310 não registrada" já está provado pelo ledger inalterado.
      expect((await collectSchemaProblems(conn)).join("\n")).toContain(LAST_TAG);
    } finally {
      await conn.end();
    }
  }, 240_000);

  it("M3 — UPGRADE limpo: a 0310 aplica, backfill = TRIM pelo banco (vazio ⇒ NULL), dados intactos; rerun no-op; UNIQUE ativo", async () => {
    const conn = await mysql.createConnection(urlFor(upgradeDb));
    try {
      await migrate(drizzle(conn), { migrationsFolder: pre0310 });
      const rows: Array<[string, number, string, string, string]> = [
        ["u1", 1, "processo_licitatorio", "p1", "CT-001/2026"],
        ["u2", 1, "contratacao_direta", "dp1", "CT-1/2026"],     // zeros NÃO são removidos: distinto de CT-001/2026
        ["u3", 1, "avulso", "", "  CT-LEGADO "],                  // legado com espaços nas pontas
        ["u4", 1, "externo", "", ""],                             // vazio ⇒ NULL (não colide)
        ["u5", 1, "externo", "", "   "],                          // só espaços ⇒ NULL (não colide)
        ["u6", 1, "avulso", "", "ct-caixa"],                      // caixa preservada (colação binária)
        ["u7", 1, "processo_licitatorio", "p2", "CT-CAIXA"],
        ["u8", 2, "processo_licitatorio", "p1", "CT-001/2026"],   // outra organização, mesmo número
      ];
      for (const [id, org, origin, proc, num] of rows) await conn.query(ins, [id, org, origin, proc, num, "F", "minuta", 1]);
      const before = await rowsSnapshot(conn);
      const ledgerBefore = await ledgerCount(conn);
      expect((await runPreflight(conn)).get("GUARD (bloqueia): grupos duplicados")).toBe(0);

      await migrateWithAdvisoryLock(conn);
      expect(await ledgerCount(conn)).toBe(ledgerBefore + FROM_0310_COUNT); // a 0310 (+ posteriores do journal)
      expect(await rowsSnapshot(conn)).toBe(before);                // nenhuma coluna existente alterada
      const [norm] = await conn.query<mysql.RowDataPacket[]>(`SELECT id, normalized_number AS n FROM contract_workspaces ORDER BY id`);
      expect(Object.fromEntries(norm.map((r) => [r.id, r.n]))).toEqual({
        u1: "CT-001/2026", u2: "CT-1/2026", u3: "CT-LEGADO", u4: null, u5: null, u6: "ct-caixa", u7: "CT-CAIXA", u8: "CT-001/2026",
      });
      expect(await collectSchemaProblems(conn)).toEqual([]);

      // Rerun: ledger não cresce; schema e dados iguais. Reaplicar o SQL da 0310 à mão também é no-op.
      const schemaOf = async () => JSON.stringify([await columnInfo(conn), await uniqueIndex(conn)]);
      const schemaBefore = await schemaOf();
      await migrateWithAdvisoryLock(conn);
      expect(await ledgerCount(conn)).toBe(ledgerBefore + FROM_0310_COUNT);
      const stmts = readFileSync(path.join(DRZ, `${TAG_0310}.sql`), "utf8").split("--> statement-breakpoint")
        .map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
      for (const s of stmts) await conn.query(s);
      expect(await schemaOf()).toBe(schemaBefore);
      expect(await rowsSnapshot(conn)).toBe(before);

      // Garantia no banco: o mesmo número (após trim) em OUTRA origem da mesma organização é recusado…
      await expect(conn.query(ins, ["x1", 1, "avulso", "", " CT-001/2026", "F", "minuta", 1])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      await expect(conn.query(ins, ["x2", 1, "externo", "", "CT-LEGADO", "F", "minuta", 1])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      // …mas em outra organização, com número vazio ou com caixa diferente, não.
      await conn.query(ins, ["x3", 3, "avulso", "", "CT-001/2026", "F", "minuta", 1]);
      await conn.query(ins, ["x4", 1, "externo", "", "", "F", "minuta", 1]);
      await conn.query(ins, ["x5", 1, "externo", "", "Ct-Caixa", "F", "minuta", 1]);
      // A coluna gerada acompanha QUALQUER escrita de contract_number (edição/upsert legado) — e o UNIQUE vale nela.
      await conn.query(`UPDATE contract_workspaces SET contract_number = ' CT-RENOMEADO ' WHERE id = 'u2'`);
      const [ren] = await conn.query<mysql.RowDataPacket[]>(`SELECT normalized_number AS n FROM contract_workspaces WHERE id = 'u2'`);
      expect(ren[0].n).toBe("CT-RENOMEADO");
      await expect(conn.query(`UPDATE contract_workspaces SET contract_number = 'CT-001/2026' WHERE id = 'u2'`)).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      const [still] = await conn.query<mysql.RowDataPacket[]>(`SELECT contract_number AS c FROM contract_workspaces WHERE id = 'u2'`);
      expect(still[0].c).toBe(" CT-RENOMEADO ");
    } finally {
      await conn.end();
    }
  }, 240_000);
});
