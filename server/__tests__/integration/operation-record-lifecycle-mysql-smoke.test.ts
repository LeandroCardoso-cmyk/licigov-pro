/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Centro de Operações — ciclo de vida (Concluir/Reabrir) e backfill genérico de agenda contra MySQL REAL.
 * Dados 100% sintéticos (prefixo de referência fictício, objetos fictícios). Cobre: tenant A × B, RBAC,
 * idempotência, timeline, preservação de agenda/eventos, superfícies ativas, backfill dry-run/apply/replay,
 * conflito sem sobrescrita, NOT_FOUND sem inserção, AMBIGUOUS sem atualização, par consolidado → 1 registro,
 * evento vinculado sem duplicação e processo canônico independente.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const DB = process.env.DATABASE_URL;
const ORG = 990931;
const ORG2 = 990932;
const PREFIX = "Lote.Smoke";

vi.mock("../../services/featureFlagService", async (orig) => {
  const actual = await orig<typeof import("../../services/featureFlagService")>();
  return { ...actual, isFeatureEnabled: vi.fn(async () => true) };
});

import { runMigrations } from "../../bootstrap";
import { insertOperationRecord, listOperationRecords, listScheduledOperationRecords } from "../../db/departmentOperation";
import { createOperationRecord } from "../../domain/operationRecord";
import { createManualEvent } from "../../services/operationRecordService";
import { getCalendar, getDashboard, getMonitoringPanel } from "../../services/departmentOperationService";
import { insertProcess } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { main as backfillMain, ConfigError } from "../../../scripts/operation-record-schedule-backfill";

let conn: mysql.Connection;
let seq = 0;
const users: Record<string, number> = {};
const ids: Record<string, string> = {};
let canonicalId = "";

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params as any[]);
  return Number((rows[0] as any).n);
}
async function mkUser(org: number, role: string): Promise<number> {
  const tag = `${role}-${org}-${Date.now()}-${++seq}`;
  const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'Ops', ?)", [`opl-${tag}`, `opl-${tag}@teste.local`]);
  await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u.insertId, role]);
  return u.insertId;
}
async function asUser(id: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({ user: { id, role: "user" }, req: { headers: {} }, res: {}, correlationId: `opl-${id}-${++seq}`, requestId: `req-${seq}` } as any);
}
async function mkRecord(org: number, key: string, stage: string, over: Partial<{ eventDate: string; eventTime: string; object: string }> = {}) {
  const r = createOperationRecord({
    organizationId: org, recordType: "processo_licitatorio_legado", number: `${key}/2026`, object: over.object ?? `Objeto fictício ${key}`,
    currentStage: stage, eventDate: over.eventDate ?? "", eventTime: over.eventTime ?? "", correlationId: `opl-${key}-${++seq}`,
  });
  await insertOperationRecord(r);
  ids[key] = r.id;
  return r.id;
}
async function recordRow(id: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>("SELECT * FROM operation_records WHERE id = ?", [id]);
  return rows[0] as any;
}
function datasetFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "opbf-"));
  const f = join(dir, "dataset.json");
  writeFileSync(f, JSON.stringify(content));
  return f;
}
async function cleanup() {
  const tables: Array<[string, string]> = [
    ["operational_timeline", "organization_id"], ["operational_events", "organization_id"], ["operation_records", "organization_id"],
    ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"], ["activity_logs", "organizationId"],
    ["organization_members", "organizationId"],
  ];
  for (const org of [ORG, ORG2]) for (const [t, col] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(() => {});
  await conn.query("DELETE FROM users WHERE openId LIKE 'opl-%'").catch(() => {});
}

describe.skipIf(!DB)("Centro de Operações — ciclo de vida e backfill de agenda (MySQL real)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    for (const [id, slug] of [[ORG, "ops-lifecycle-org"], [ORG2, "ops-lifecycle-org-2"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE slug = VALUES(slug)", [id, slug, slug]);
    }
    await cleanup();
    users.operator = await mkUser(ORG, "operator");
    users.viewer = await mkUser(ORG, "viewer");
    users.operatorB = await mkUser(ORG2, "operator");
    await mkRecord(ORG, "r1", `Em andamento · ${PREFIX} item 1`);
    await mkRecord(ORG, "r2", `Finalizado · ${PREFIX} item 2`, { eventDate: "2026-03-10" });
    await mkRecord(ORG, "r3", `${PREFIX} item 3`, { eventDate: "2026-03-05" });
    await mkRecord(ORG, "r78", `Certame · ${PREFIX} itens 7/8`, { object: "Aquisição fictícia consolidada" });
    await mkRecord(ORG, "r9a", `${PREFIX} item 9`);
    await mkRecord(ORG, "r9b", `${PREFIX} item 9`);
    await mkRecord(ORG, "r6", `${PREFIX} item 6`); // fora do dataset: deve continuar sem data
    await mkRecord(ORG2, "b1", `${PREFIX} item 1`); // mesmo item, OUTRO tenant: nunca tocado
    const p = createProcurementWorkspace({ organizationId: ORG, processNumber: `CANON-${Date.now()}`, object: "Processo canônico fictício", startOption: "importar_tr", responsibleUser: users.operator, correlationId: "opl-canon" });
    await insertProcess(p);
    canonicalId = p.id;
  }, 180_000);
  afterAll(async () => { await cleanup().catch(() => {}); await conn?.end(); });

  it("1) backfill: dry-run não grava; classificação correta; gate bloqueia com AMBIGUOUS/CONFLICT/NOT_FOUND", async () => {
    const file = datasetFile({ referencePrefix: PREFIX, expected: 6, schedules: [
      { item: 1, eventDate: "2026-04-01" }, { item: 2, eventDate: "2026-03-10" }, { item: 3, eventDate: "2026-04-03" },
      { item: 7, eventDate: "2026-04-07" }, { item: 9, eventDate: "2026-04-09" }, { item: 47, eventDate: "2026-04-11" },
    ] });
    const records = await count("SELECT COUNT(*) n FROM operation_records WHERE organization_id = ?", [ORG]);
    const code = await backfillMain(["--org", String(ORG), "--expect-slug", "ops-lifecycle-org", "--file", file, "--apply"]);
    expect(code).toBe(3); // gate bloqueado ⇒ nada gravado
    expect((await recordRow(ids.r1)).event_date).toBe("");
    expect((await recordRow(ids.r3)).event_date).toBe("2026-03-05"); // conflito nunca sobrescrito
    expect((await recordRow(ids.r9a)).event_date).toBe("");
    expect(await count("SELECT COUNT(*) n FROM operation_records WHERE organization_id = ?", [ORG])).toBe(records); // NOT_FOUND não insere
  });

  it("2) backfill válido: apply grava só MATCH (1 transação + timeline), respeita tenant; replay ⇒ ALREADY_CORRECT sem nova escrita", async () => {
    const dataset = { referencePrefix: PREFIX, expected: 3,
      schedules: [{ item: 1, eventDate: "2026-04-01" }, { item: 2, eventDate: "2026-03-10" }, { item: 7, eventDate: "2026-04-07" }],
      events: [{ item: 7, eventType: "certame", number: "99/2026", eventDate: "2026-10-20", eventTime: "09:30" }] };
    const file = datasetFile(dataset);
    await expect(backfillMain(["--org", String(ORG), "--expect-slug", "outro-slug", "--file", file])).rejects.toBeInstanceOf(ConfigError);
    expect(await backfillMain(["--org", String(ORG), "--expect-slug", "ops-lifecycle-org", "--file", file])).toBe(0); // dry-run
    expect((await recordRow(ids.r1)).event_date).toBe("");
    expect(await backfillMain(["--org", String(ORG), "--expect-slug", "ops-lifecycle-org", "--file", file, "--apply"])).toBe(0);
    const r1 = await recordRow(ids.r1);
    expect([r1.event_date, r1.event_end_date, r1.event_time]).toEqual(["2026-04-01", "", ""]);
    const r78 = await recordRow(ids.r78);
    expect(r78.event_date).toBe("2026-04-07"); // par consolidado → um único registro
    expect((await recordRow(ids.r6)).event_date).toBe(""); // fora do dataset: permanece sem data
    expect((await recordRow(ids.b1)).event_date).toBe(""); // tenant B intocado
    const [tl] = await conn.execute<mysql.RowDataPacket[]>("SELECT correlation_id FROM operational_timeline WHERE organization_id = ? AND action = 'agenda_registro_atualizada'", [ORG]);
    expect(tl).toHaveLength(2);
    expect(new Set((tl as any[]).map((t) => t.correlation_id)).size).toBe(1); // correlationId único da execução
    expect(await count("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ? AND event_type = 'certame'", [ORG, ids.r78])).toBe(1);

    // replay: nada novo
    expect(await backfillMain(["--org", String(ORG), "--expect-slug", "ops-lifecycle-org", "--file", file, "--apply"])).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM operational_timeline WHERE organization_id = ? AND action = 'agenda_registro_atualizada'", [ORG])).toBe(2);
    expect(await count("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ? AND event_type = 'certame'", [ORG, ids.r78])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM operation_records WHERE organization_id = ?", [ORG])).toBe(7);
  });

  it("3) Concluir/Reabrir: RBAC, tenant A × B, idempotência, timeline, dados e eventos preservados", async () => {
    const op = await asUser(users.operator);
    const viewer = await asUser(users.viewer);
    const opB = await asUser(users.operatorB);
    await createManualEvent({ organizationId: ORG, eventType: "assinatura", title: "Aditivo fictício", eventDate: "2026-11-02", eventTime: "", referenceType: "operation_record", referenceId: ids.r1, actor: "t", correlationId: "opl-ev" });
    const eventsBefore = await count("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ?", [ORG, ids.r1]);

    await expect(viewer.operationRecord.complete({ recordId: ids.r1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(opB.operationRecord.complete({ recordId: ids.r1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await recordRow(ids.r1)).lifecycle_status).toBe("active");

    const done = await op.operationRecord.complete({ recordId: ids.r1, reason: "processo encerrado (fictício)" });
    expect(done).toMatchObject({ changed: true, from: "active", to: "completed" });
    const again = await op.operationRecord.complete({ recordId: ids.r1 });
    expect(again).toMatchObject({ changed: false, from: "completed", to: "completed" });
    const row = await recordRow(ids.r1);
    expect(row.lifecycle_status).toBe("completed");
    expect(row.completed_by).toBe(users.operator);
    expect(row.completed_at).toBeTruthy();
    expect(row.event_date).toBe("2026-04-01"); // agenda preservada
    expect(await count("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ?", [ORG, ids.r1])).toBe(eventsBefore);
    const [tl] = await conn.execute<mysql.RowDataPacket[]>("SELECT actor, summary, correlation_id FROM operational_timeline WHERE organization_id = ? AND action = 'registro_concluido' AND reference_id = ?", [ORG, ids.r1]);
    expect(tl).toHaveLength(1); // idempotente: uma entrada
    expect((tl as any[])[0]).toMatchObject({ actor: String(users.operator) });
    expect((tl as any[])[0].summary).toContain("ativo → concluído");
    expect((tl as any[])[0].correlation_id).toMatch(/^opl-/);

    // superfícies ativas
    expect((await listOperationRecords(ORG, 200, "active")).map((r) => r.id)).not.toContain(ids.r1);
    expect((await listOperationRecords(ORG, 200, "completed")).map((r) => r.id)).toEqual([ids.r1]);
    expect((await listScheduledOperationRecords(ORG, "2026-01-01", "2026-12-31")).map((r) => r.id)).not.toContain(ids.r1);
    const cal = await getCalendar({ organizationId: ORG, from: "2026-01-01", to: "2026-12-31" });
    expect(cal.map((e) => e.id)).not.toContain(`record:${ids.r1}`);
    expect(cal.some((e) => e.referenceId === ids.r1 && e.eventType === "assinatura")).toBe(true); // evento vinculado mantém ciclo próprio
    const panel = await getMonitoringPanel({ organizationId: ORG, today: "2026-09-29" });
    expect(panel.map((r) => r.processId)).not.toContain(ids.r1);
    expect(panel.map((r) => r.processId)).toContain(canonicalId); // canônico independente
    const dash = await getDashboard({ organizationId: ORG, today: "2026-01-01" });
    expect(dash.indicators.trackedRecords).toBe(6);
    expect(dash.indicators.completedRecords).toBe(1);
    const listed = await op.operationRecord.listRecords({ limit: 200 });
    expect(listed.records.map((r) => r.id)).not.toContain(ids.r1);
    expect((await op.operationRecord.listRecords({ limit: 200, lifecycle: "all" })).records.map((r) => r.id)).toContain(ids.r1);

    // reabrir
    await expect(opB.operationRecord.reopen({ recordId: ids.r1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(viewer.operationRecord.reopen({ recordId: ids.r1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await op.operationRecord.reopen({ recordId: ids.r1 })).toMatchObject({ changed: true, from: "completed", to: "active" });
    expect(await op.operationRecord.reopen({ recordId: ids.r1 })).toMatchObject({ changed: false });
    const reopened = await recordRow(ids.r1);
    expect([reopened.lifecycle_status, reopened.completed_at, reopened.completed_by, reopened.event_date]).toEqual(["active", null, null, "2026-04-01"]);
    expect(await count("SELECT COUNT(*) n FROM operational_timeline WHERE organization_id = ? AND action = 'registro_reaberto' AND reference_id = ?", [ORG, ids.r1])).toBe(1);
    expect((await getCalendar({ organizationId: ORG, from: "2026-01-01", to: "2026-12-31" })).map((e) => e.id)).toContain(`record:${ids.r1}`);
    expect(await count("SELECT COUNT(*) n FROM operation_records WHERE organization_id = ?", [ORG])).toBe(7); // nada recriado
    expect(await count("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ?", [ORG, ids.r1])).toBe(eventsBefore);
    expect(await count("SELECT COUNT(*) n FROM procurement_processes WHERE organization_id = ? AND id = ?", [ORG, canonicalId])).toBe(1);
  });
});
