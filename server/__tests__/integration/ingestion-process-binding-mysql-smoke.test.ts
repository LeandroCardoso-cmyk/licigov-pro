/**
 * PR B.2.2 (correções) — Vínculo da ingestão ao PROCESSO CANÔNICO contra MySQL REAL (CI).
 *
 * Executável (não é source inspection): exercita fileIngestionService contra o banco.
 * Cobre: persistência do procurementProcessId; ownership (processo de outro tenant e forjado →
 * NOT_FOUND); retomada escopada por processo; dedup por checksum escopado por processo (uma sessão
 * de um processo nunca é reutilizada por outro processo do mesmo tenant).
 *
 * Só roda com DATABASE_URL (serviço MySQL efêmero do CI); pulado localmente.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../db/connection";
import { procurementProcessesTable } from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import {
  createImportSession,
  getImportSession,
  findResumableSessionForProcess,
  findActiveSessionByChecksum,
} from "../../services/fileIngestionService";
import type { TrpcAuditCtx } from "../../services/activityLogService";

const DB = process.env.DATABASE_URL;
const ORG_A = 990101;
const ORG_B = 990102;

function ctx(orgId: number): TrpcAuditCtx {
  return {
    organizationId: orgId,
    user: { id: 1, name: "Tester", email: "tester@example.gov" },
    correlationId: "corr-bind",
    requestId: "req-bind",
    orgMembership: { role: "owner" },
  };
}

const baseSession = (over: Record<string, unknown>) => ({
  sourceFileName: "cotacao.csv",
  sourceMimeType: "text/csv",
  sourceSize: 10,
  sourceFileId: `imports/x/${Math.round(1)}-cotacao.csv`,
  importType: "price_research" as const,
  ...over,
});

describe.skipIf(!DB)("Ingestão × processo canônico — MySQL real", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    const db = await getDb();
    if (!db) throw new Error("DB indisponível");
    // Estado limpo para os orgs de teste.
    await conn.query("DELETE FROM `import_sessions` WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]);
    await conn.query("DELETE FROM `procurement_processes` WHERE organization_id IN (?, ?)", [ORG_A, ORG_B]);
    // Processos: P-A e P-B do tenant A; P-C do tenant B.
    await db.insert(procurementProcessesTable).values([
      { id: "P-A", organizationId: ORG_A, processNumber: "0001/2026" },
      { id: "P-B", organizationId: ORG_A, processNumber: "0002/2026" },
      { id: "P-C", organizationId: ORG_B, processNumber: "0003/2026" },
    ]);
  }, 300_000);

  afterAll(async () => {
    await conn?.query("DELETE FROM `import_sessions` WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn?.query("DELETE FROM `procurement_processes` WHERE organization_id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn?.end();
  });

  it("persiste o vínculo canônico ao criar a sessão", async () => {
    const s = await createImportSession(baseSession({ procurementProcessId: "P-A", checksum: "a".repeat(64) }), ctx(ORG_A));
    const loaded = await getImportSession(s.id, ORG_A);
    expect(loaded?.procurementProcessId).toBe("P-A");
  });

  it("processo canônico de OUTRO tenant → NOT_FOUND", async () => {
    // P-C pertence ao ORG_B; criar sob ORG_A deve falhar.
    await expect(createImportSession(baseSession({ procurementProcessId: "P-C" }), ctx(ORG_A)))
      .rejects.toBeInstanceOf(TRPCError);
  });

  it("procurementProcessId FORJADO (inexistente) → NOT_FOUND", async () => {
    await expect(createImportSession(baseSession({ procurementProcessId: "NAO-EXISTE" }), ctx(ORG_A)))
      .rejects.toBeInstanceOf(TRPCError);
  });

  it("retomada é escopada por processo (e por tenant)", async () => {
    const resumA = await findResumableSessionForProcess(ORG_A, "P-A");
    expect(resumA?.procurementProcessId).toBe("P-A");
    // P-B do mesmo tenant não retoma a sessão de P-A.
    expect(await findResumableSessionForProcess(ORG_A, "P-B")).toBeNull();
    // Outro tenant não enxerga P-A.
    expect(await findResumableSessionForProcess(ORG_B, "P-A")).toBeNull();
  });

  it("dedup por checksum é escopado por processo (não cruza processos do mesmo tenant)", async () => {
    const dup = await findActiveSessionByChecksum(ORG_A, "a".repeat(64), "P-A");
    expect(dup?.procurementProcessId).toBe("P-A");
    // Mesmo checksum, processo diferente → não deduplica (sessão distinta por processo).
    expect(await findActiveSessionByChecksum(ORG_A, "a".repeat(64), "P-B")).toBeNull();
  });
});
