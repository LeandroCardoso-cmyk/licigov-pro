/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR C.3A — Shadow da Contratação Direta contra MySQL REAL (CI). Executável.
 *
 * Cobre: flag ON (canônico executa em shadow; comparação persistida em cognitive_observability, sem
 * conteúdo integral); replay (mesma entrada não duplica observabilidade/execução institucional);
 * flag OFF por tenant (fail-closed, não executa); isolamento multi-tenant (observabilidade não vaza
 * entre orgs). O provider canônico usa o mock (AI-015) — determinístico, sem rede.
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { runDirectContractShadow, FF_DIRECT_CONTRACT_SHADOW } from "../../services/directContractShadowService";
import { invalidateAllFlagsForTenant } from "../../services/featureFlagService";
import { getObservabilityByCorrelation } from "../../db/cognitiveObservability";

const DB = process.env.DATABASE_URL;
const ORG_A = 980401; // flag ON
const ORG_B = 980402; // flag OFF

let conn: mysql.Connection;

const dc = (over: Partial<any> = {}) => ({
  id: 5001,
  processId: null as number | null,
  object: "Aquisição de material de escritório",
  value: 150000,
  justification: "Urgência caracterizada nos autos.",
  type: "dispensa" as const,
  legalArticleId: 7,
  ...over,
});

const shadowInput = (organizationId: number, over: Partial<any> = {}) => ({
  organizationId,
  actorUserId: 42,
  correlationId: "corr-c3a-smoke",
  docType: "termo_dispensa" as const,
  directContract: dc(over.directContract),
  legacyContent: "# Termo de Dispensa\n\n## Objeto\nAquisição. Lei 14.133/2021, art. 75. Justificativa: urgência.",
  ...over,
});

async function countObs(correlationId: string): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM cognitive_observability WHERE correlation_id = ?",
    [correlationId],
  );
  return Number((rows[0] as any).n);
}

describe.skipIf(!DB)("PR C.3A — Shadow Contratação Direta (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.execute("DELETE FROM tenant_feature_flags WHERE flagName = ?", [FF_DIRECT_CONTRACT_SHADOW]).catch(() => {});
    // Habilita a flag SOMENTE para ORG_A (tenant-aware). ORG_B permanece OFF (fail-closed).
    await conn.execute(
      "INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage) VALUES (?, ?, 1, 100)",
      [ORG_A, FF_DIRECT_CONTRACT_SHADOW],
    );
    invalidateAllFlagsForTenant(ORG_A);
    invalidateAllFlagsForTenant(ORG_B);
    for (const org of [ORG_A, ORG_B]) {
      await conn.execute("DELETE FROM cognitive_observability WHERE tenant_id = ?", [org]).catch(() => {});
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await conn.execute("DELETE FROM tenant_feature_flags WHERE flagName = ?", [FF_DIRECT_CONTRACT_SHADOW]).catch(() => {});
    for (const org of [ORG_A, ORG_B]) {
      await conn.execute("DELETE FROM cognitive_observability WHERE tenant_id = ?", [org]).catch(() => {});
    }
    await conn.end();
  });

  it("flag ON: canônico executa em shadow; comparação persistida (sem conteúdo integral)", async () => {
    const r = await runDirectContractShadow(shadowInput(ORG_A));
    expect(r.ran).toBe(true);
    expect(r.replayed).toBe(false);
    expect(r.classification).toBeTruthy();
    expect(r.correlationId).toBeTruthy();

    const row = await getObservabilityByCorrelation(r.correlationId!);
    expect(row).not.toBeNull();
    expect(row!.tenantId).toBe(ORG_A);
    const payload = row!.payload as any;
    expect(payload.shadowComparison).toBeTruthy();
    expect(payload.shadowComparison.classification).toBe(r.classification);
    expect(payload.shadowComparison.legacyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.shadowComparison.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
    // Sem conteúdo integral nem chain-of-thought no registro de comparação.
    expect(JSON.stringify(payload.shadowComparison)).not.toContain("Aquisição de material de escritório");
    expect(JSON.stringify(payload.shadowComparison).toLowerCase()).not.toContain("chainofthought");
  }, 60_000);

  it("replay: mesma entrada não duplica execução/observabilidade institucional", async () => {
    const first = await runDirectContractShadow(shadowInput(ORG_A));
    const before = await countObs(first.correlationId!);
    const replay = await runDirectContractShadow(shadowInput(ORG_A));
    expect(replay.replayed).toBe(true);
    expect(replay.correlationId).toBe(first.correlationId);
    expect(await countObs(first.correlationId!)).toBe(before); // sem 2ª linha
  }, 60_000);

  it("flag OFF (tenant B): fail-closed — shadow não executa e não gera observabilidade", async () => {
    const r = await runDirectContractShadow(shadowInput(ORG_B));
    expect(r.ran).toBe(false);
    expect(r.reason).toBe("flag_off");
    expect(await countObs("dcshadow-anything-b")).toBe(0);
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM cognitive_observability WHERE tenant_id = ?",
      [ORG_B],
    );
    expect(Number((rows[0] as any).n)).toBe(0); // nada atribuído ao tenant B
  }, 60_000);

  it("isolamento: observabilidade do shadow é atribuída ao tenant correto", async () => {
    const r = await runDirectContractShadow(shadowInput(ORG_A, { directContract: dc({ id: 5002 }) }));
    const row = await getObservabilityByCorrelation(r.correlationId!);
    expect(row!.tenantId).toBe(ORG_A);
    // a mesma linha nunca aparece sob ORG_B
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM cognitive_observability WHERE correlation_id = ? AND tenant_id = ?",
      [r.correlationId, ORG_B],
    );
    expect(Number((rows[0] as any).n)).toBe(0);
  }, 60_000);
});
