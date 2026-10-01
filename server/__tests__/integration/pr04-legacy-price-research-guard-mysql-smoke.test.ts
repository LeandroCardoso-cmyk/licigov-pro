/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR-04 (preparação) — FCC-03 / LEG-013 (SEM-005) contra MySQL REAL, pelo appRouter REAL e pelo avaliador REAL de
 * feature flags (`isFeatureEnabled`, sem mock):
 *
 *   fixture: `tenant_feature_flags` com `FF_CANONICAL_INGESTION` ligada SÓ para o tenant A (linha de teste, removida
 *   no fim) ⇒
 *     - tenant A: `procurementProcess.importPriceResearch` recusado com FORBIDDEN `LEGACY_ENDPOINT_DISABLED` e as
 *       contagens de price_research / price_research_items / intelligent_items / process_timeline / activity_logs
 *       do tenant A INALTERADAS;
 *     - tenant B (sem linha de flag = estado de produção documentado): continua importando pelo caminho legado;
 *     - `ingestion.getCapabilities` (o que a UI consulta) concorda com o guard em cada tenant.
 *
 * Nenhuma flag real é alterada: só linhas de teste em organizações fictícias. Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 994041;
const ORG_B = 994042;
const FLAG = "FF_CANONICAL_INGESTION";
const TEXT = "Detergente neutro;10;UN;12,50;Fornecedor A";

import { runMigrations } from "../../bootstrap";
import { insertProcess, listIntelligentItems } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { invalidateFlagCache } from "../../services/featureFlagService";

let conn: mysql.Connection;
let seq = 0;
const users: Record<string, number> = {};
const pids: Record<string, string> = {};

const COUNTED: Array<[string, string]> = [
  ["price_research", "organization_id"], ["price_research_items", "organization_id"], ["intelligent_items", "organization_id"],
  ["process_timeline", "organization_id"], ["activity_logs", "organizationId"],
];

async function counts(org: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [t, col] of COUNTED) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE \`${col}\` = ?`, [org]);
    out[t] = Number(rows[0].n);
  }
  return out;
}

async function asUser(id: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({ user: { id, role: "user" }, req: { headers: {} }, res: {}, correlationId: `pr04-corr-${id}-${++seq}`, requestId: `req-${seq}` } as any);
}

async function mkUser(org: number, role: string): Promise<number> {
  const tag = `${role}-${org}-${Date.now()}-${++seq}`;
  const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'PR04', ?)", [`pr04-${tag}`, `pr04-${tag}@teste.local`]);
  await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u.insertId, role]);
  return u.insertId;
}

async function newProcess(org: number, responsible: number): Promise<string> {
  const p = createProcurementWorkspace({
    organizationId: org, processNumber: `PR04-${Date.now()}-${++seq}`, object: "Material de limpeza (fictício)",
    startOption: "iniciar_pesquisa", responsibleUser: responsible, correlationId: "pr04-smoke",
  });
  await insertProcess(p);
  return p.id;
}

/** Remove SÓ dados das organizações fictícias deste teste (inclui a linha de flag de teste). */
async function cleanup() {
  const tables: Array<[string, string]> = [
    ["item_catmat_matches", "organization_id"], ["item_risks", "organization_id"], ["item_recommendations", "organization_id"],
    ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
    ["price_research_items", "organization_id"], ["price_research", "organization_id"], ["intelligent_items", "organization_id"],
    ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"], ["activity_logs", "organizationId"],
    ["tenant_feature_flags", "organizationId"], ["organization_members", "organizationId"],
  ];
  for (const org of [ORG_A, ORG_B]) for (const [t, col] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(() => {});
  await conn.query("DELETE FROM users WHERE openId LIKE 'pr04-%'").catch(() => {});
  invalidateFlagCache(FLAG);
}

describe.skipIf(!DB)("PR-04 prep — guard server-side da colagem legada da Pesquisa de Preços (MySQL real)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    for (const [id, slug] of [[ORG_A, "pr04-org-a"], [ORG_B, "pr04-org-b"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, slug, slug]).catch(() => {});
    }
    await cleanup();
    users.opA = await mkUser(ORG_A, "operator");
    users.opB = await mkUser(ORG_B, "operator");
    users.viewerB = await mkUser(ORG_B, "viewer");
    pids.a = await newProcess(ORG_A, users.opA);
    pids.b = await newProcess(ORG_B, users.opB);
    // Fixture: flag canônica ligada SÓ para o tenant A (100%, sem expiração). Tenant B sem linha (default OFF).
    await conn.execute(
      "INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage) VALUES (?, ?, 1, 100)",
      [ORG_A, FLAG],
    );
    invalidateFlagCache(FLAG);
  }, 120_000);
  afterAll(async () => { await cleanup().catch(() => {}); await conn?.end(); });

  it("capabilities (o que a UI consulta) concorda com o guard: A ligada, B desligada", async () => {
    expect((await (await asUser(users.opA)).ingestion.getCapabilities()).enabled).toBe(true);
    expect((await (await asUser(users.opB)).ingestion.getCapabilities()).enabled).toBe(false);
  });

  it("tenant A (flag ligada) ⇒ FORBIDDEN LEGACY_ENDPOINT_DISABLED; contagens do tenant A inalteradas", async () => {
    const before = await counts(ORG_A);
    const op = await asUser(users.opA);
    for (const source of ["colar", "manual", "pdf"] as const) {
      await expect(op.procurementProcess.importPriceResearch({ processId: pids.a, source, text: TEXT }))
        .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("LEGACY_ENDPOINT_DISABLED") });
    }
    // Processo inexistente recebe a MESMA recusa (o guard roda antes de qualquer leitura: não revela existência).
    await expect(op.procurementProcess.importPriceResearch({ processId: "nao-existe", source: "colar", text: TEXT }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("LEGACY_ENDPOINT_DISABLED") });
    expect(await counts(ORG_A)).toEqual(before);
    expect(await listIntelligentItems(pids.a, ORG_A)).toHaveLength(0);
  });

  it("tenant B (sem flag = estado de produção) ⇒ caminho legado continua importando", async () => {
    const before = await counts(ORG_B);
    const res = await (await asUser(users.opB)).procurementProcess.importPriceResearch({ processId: pids.b, source: "colar", text: TEXT });
    expect(res.research.itemCount).toBe(1);
    expect(res.intelligentItems).toHaveLength(1);
    const after = await counts(ORG_B);
    expect(after.price_research).toBe(before.price_research + 1);
    expect(after.price_research_items).toBe(before.price_research_items + 1);
    expect(after.intelligent_items).toBe(before.intelligent_items + 1);
    // Nada vazou para o tenant A.
    expect(await listIntelligentItems(pids.a, ORG_A)).toHaveLength(0);
  });

  it("tenant B: viewer continua recusado pelo RBAC (sem LEGACY_ENDPOINT_DISABLED) e nada é gravado", async () => {
    const before = await counts(ORG_B);
    const err = await (await asUser(users.viewerB)).procurementProcess
      .importPriceResearch({ processId: pids.b, source: "colar", text: TEXT }).then(() => null, (e: any) => e);
    expect(err?.code).toBe("FORBIDDEN");
    expect(String(err?.message)).not.toContain("LEGACY_ENDPOINT_DISABLED");
    expect(await counts(ORG_B)).toEqual(before);
  });

  it("tenant B não consegue usar o processo do tenant A pelo legado (isolamento preservado; nada gravado em A)", async () => {
    const beforeA = await counts(ORG_A);
    await expect((await asUser(users.opB)).procurementProcess.importPriceResearch({ processId: pids.a, source: "colar", text: TEXT }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await counts(ORG_A)).toEqual(beforeA);
  });
});
