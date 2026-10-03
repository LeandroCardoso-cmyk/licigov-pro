/**
 * R9 / SEM-074 — Analytics/auditoria sobre as fontes CANÔNICAS, MySQL 8 real (órgãos sintéticos 960741/960742).
 *
 *   C1. processos por etapa vêm de `procurement_processes` (por órgão); linhas legadas em `processes` são IGNORADAS;
 *   C2. documentos por mês vêm de `generated_documents` (janela de 6 meses UTC, por órgão); `documents` legado IGNORADO;
 *   C3. ranking de atividade agregado em SQL, sem vazar o outro órgão;
 *   C4. `getUserStats` (admin) conta processos/documentos canônicos do responsável;
 *   C5. `analytics.getOverview` (appRouter real) reflete as fontes canônicas do órgão do contexto.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import * as db from "../../db";
import { toDbDatetime } from "../../db/institutionalConsultations";

const DB = process.env.DATABASE_URL;
const ORG_A = 960741;
const ORG_B = 960742;

describe.skipIf(!DB)("R9 / SEM-074 — analytics canônico (MySQL 8)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let userA1 = 0, userA2 = 0, userB1 = 0;
  const nowDb = toDbDatetime(new Date().toISOString()) ?? "";
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  async function cleanup() {
    for (const t of ["generated_documents", "procurement_processes"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
    }
    for (const t of ["activity_logs", "documents", "processes", "organization_members"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
    }
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();

    const mkUser = async (tag: string) => (await conn.execute<mysql.ResultSetHeader>(
      "INSERT INTO users (openId, name, email) VALUES (?, ?, ?)",
      [`sem074-${tag}-${stamp}`, `Usuário ${tag}`, `sem074-${tag}-${stamp}@teste.local`],
    ))[0].insertId;
    userA1 = await mkUser("a1"); userA2 = await mkUser("a2"); userB1 = await mkUser("b1");
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)", [ORG_A, userA1]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG_A, userA2]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)", [ORG_B, userB1]);

    const mkProc = async (id: string, org: number, stage: string, owner: number) => conn.execute(
      "INSERT INTO procurement_processes (id, organization_id, process_number, object, current_stage, responsible_user, created_at, updated_at) VALUES (?, ?, ?, 'Objeto', ?, ?, ?, ?)",
      [id, org, `${id}/2026`, stage, owner, nowDb, nowDb],
    );
    // Órgão A: NEW_PROCESS ×2, ETP ×1. Órgão B: DFD ×5.
    await mkProc("s074a1", ORG_A, "NEW_PROCESS", userA1);
    await mkProc("s074a2", ORG_A, "NEW_PROCESS", userA1);
    await mkProc("s074a3", ORG_A, "ETP", userA1);
    for (let i = 1; i <= 5; i++) await mkProc(`s074b${i}`, ORG_B, "DFD", userB1);

    const mkDoc = async (id: string, org: number, processId: string, createdAt: string) => conn.execute(
      "INSERT INTO generated_documents (id, organization_id, process_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, 'etp', 'ETP', '# ETP', ?, ?)",
      [id, org, processId, createdAt, createdAt],
    );
    // A: 2 no mês corrente + 1 antigo (fora da janela de 6 meses). B: 3 no mês corrente.
    await mkDoc("s074da1", ORG_A, "s074a1", nowDb);
    await mkDoc("s074da2", ORG_A, "s074a3", nowDb);
    await mkDoc("s074da3", ORG_A, "s074a2", "2020-01-15 10:00:00.000");
    for (let i = 1; i <= 3; i++) await mkDoc(`s074db${i}`, ORG_B, `s074b${i}`, nowDb);

    // LEGADO (sem escrita hoje): 4 processos + 4 documentos no órgão A — NÃO podem aparecer em nenhuma métrica.
    for (let i = 0; i < 4; i++) {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        "INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, 'Legado', 'Objeto', ?, 'em_dfd')", [ORG_A, userA1],
      );
      await conn.execute(
        "INSERT INTO documents (organizationId, processId, type, content, version, createdBy, documentStatus) VALUES (?, ?, 'dfd', '# DFD', 1, ?, 'draft')",
        [ORG_A, r.insertId, userA1],
      );
    }

    const act = async (org: number, userId: number, n: number) => {
      for (let i = 0; i < n; i++) {
        await conn.execute("INSERT INTO activity_logs (organizationId, userId, action, sourceContext) VALUES (?, ?, 'ação', 'test')", [org, userId]);
      }
    };
    await act(ORG_A, userA1, 3); await act(ORG_A, userA2, 1); await act(ORG_B, userB1, 10);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup();
    await conn.query("DELETE FROM users WHERE id IN (?, ?, ?)", [userA1, userA2, userB1]).catch(() => {});
    await conn.end();
  });

  it("C1) processos por etapa: só procurement_processes do órgão, na ordem canônica", async () => {
    expect(await db.getProcessCountByStatusForOrg(ORG_A)).toEqual([
      { status: "NEW_PROCESS", count: 2 }, { status: "ETP", count: 1 },
    ]); // os 4 `processes` legados (em_dfd) NÃO entram
    expect(await db.getProcessCountByStatusForOrg(ORG_B)).toEqual([{ status: "DFD", count: 5 }]);
    const global = await db.getProcessCountByStatus(); // escopo plataforma preservado (inclui A e B)
    expect(global.find((r) => r.status === "DFD")?.count ?? 0).toBeGreaterThanOrEqual(5);
    expect(global.some((r) => r.status === "em_dfd")).toBe(false);
  }, 30_000);

  it("C2) documentos por mês: generated_documents do órgão na janela; documento antigo fora", async () => {
    expect(await db.getDocumentCountByMonthForOrg(ORG_A, 6)).toEqual([{ month: currentMonth, count: 2 }]);
    expect(await db.getDocumentCountByMonthForOrg(ORG_B, 6)).toEqual([{ month: currentMonth, count: 3 }]);
    const global = await db.getDocumentCountByMonth(6);
    expect(global.find((r) => r.month === currentMonth)?.count ?? 0).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it("C3) ranking de atividade em SQL, sem vazar o outro órgão", async () => {
    const a = await db.getMostActiveMembersForOrg(ORG_A, 10);
    expect(a.map((m) => [m.userId, m.activityCount])).toEqual([[userA1, 3], [userA2, 1]]);
    expect(a[0].userName).toBe("Usuário a1");
    expect(a[0].userEmail).toBe(`sem074-a1-${stamp}@teste.local`);
    expect((await db.getMostActiveMembersForOrg(ORG_A, 1)).map((m) => m.userId)).toEqual([userA1]);
    const b = await db.getMostActiveMembersForOrg(ORG_B, 10);
    expect(b.map((m) => [m.userId, m.activityCount])).toEqual([[userB1, 10]]);
  }, 30_000);

  it("C4) getUserStats conta processos/documentos CANÔNICOS do responsável (legado ignorado)", async () => {
    expect(await db.getUserStats(userA1)).toEqual({ processCount: 3, documentCount: 3, commentCount: 0 });
    expect(await db.getUserStats(userA2)).toEqual({ processCount: 0, documentCount: 0, commentCount: 0 });
  }, 30_000);

  it("C5) analytics.getOverview (appRouter real) usa as fontes canônicas do órgão do contexto", async () => {
    const { appRouter } = await import("../../routers");
    const caller = appRouter.createCaller({
      user: { id: userA1, role: "user", name: "A1", email: "a1@teste.local" },
      req: { headers: {} }, res: {}, correlationId: "sem074-overview",
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
    const o = await caller.analytics.getOverview();
    expect(o.totalProcesses).toBe(3);
    expect(o.processesByStatus).toEqual([{ status: "NEW_PROCESS", count: 2 }, { status: "ETP", count: 1 }]);
    expect(o.documentsByMonth).toEqual([{ month: currentMonth, count: 2 }]);
    expect(o.totalUsers).toBe(2);
    expect(o.mostActiveMembers.map((m) => m.userId)).not.toContain(userB1);
  }, 30_000);
});
