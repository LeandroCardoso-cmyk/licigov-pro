/**
 * POST-BLOCKERS — Prova de PERSISTÊNCIA e ISOLAMENTO real (MySQL) das três correções da PR #229.
 * Só roda com DATABASE_URL definido (skip caso contrário), como os demais `*-mysql-smoke`.
 *
 * Complementa (não substitui) os testes de caller com mock:
 *   - analytics-tenant-scope.test.ts
 *   - edital-parameters-tenant-scope.test.ts
 *   - notifications-owner-scope.test.ts
 * Aqui a evidência é o EFEITO PERSISTIDO no MySQL real — dados da Org B jamais alteram os
 * contadores/leituras da Org A, e nenhuma escrita cross-tenant/cross-user materializa.
 *
 * Correções cobertas:
 *   A. analytics.getOverview → helpers org-scoped
 *      (getProcessCountByStatusForOrg / getDocumentCountByMonthForOrg / getMostActiveMembersForOrg).
 *   B. editalParameters.get/save → tenantProcedure + getProcessByIdForOrganization (NOT_FOUND cross-tenant).
 *   C. notifications.markAsRead → escopado por dono (WHERE id AND userId).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import * as db from "../../db";

const DB = process.env.DATABASE_URL;
const ORG_A = 960001;
const ORG_B = 960002;

describe.skipIf(!DB)("POST-BLOCKERS — isolamento persistido das correções da PR #229 (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();

  let userA1: number;
  let userA2: number;
  let userB1: number;

  // Org A: 3 processos (em_dfd, em_dfd, em_etp) → {em_dfd:2, em_etp:1}
  const processesA: number[] = [];
  // Org B: 5 processos (todos em_dfd) → {em_dfd:5}
  const processesB: number[] = [];

  let notificationB: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);

    async function insertUser(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
        [`post-blockers-${tag}-${stamp}`, `Usuário ${tag}`, `post-blockers-${tag}-${stamp}@teste.local`],
      );
      return r.insertId;
    }
    userA1 = await insertUser("a1");
    userA2 = await insertUser("a2");
    userB1 = await insertUser("b1");

    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_A, userA1]);
    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)`, [ORG_A, userA2]);
    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_B, userB1]);

    async function insertProcess(org: number, owner: number, status: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, 'Processo POST-BLOCKERS', 'Objeto', ?, ?)`,
        [org, owner, status],
      );
      return r.insertId;
    }
    processesA.push(await insertProcess(ORG_A, userA1, "em_dfd"));
    processesA.push(await insertProcess(ORG_A, userA1, "em_dfd"));
    processesA.push(await insertProcess(ORG_A, userA1, "em_etp"));
    for (let i = 0; i < 5; i++) processesB.push(await insertProcess(ORG_B, userB1, "em_dfd"));

    async function insertDocument(org: number, processId: number, owner: number): Promise<void> {
      await conn.execute(
        `INSERT INTO documents (organizationId, processId, type, content, version, createdBy, documentStatus) VALUES (?, ?, 'dfd', '# DFD', 1, ?, 'draft')`,
        [org, processId, owner],
      );
    }
    // Org A: 2 documentos; Org B: 3 documentos (mês corrente, defaultNow()).
    await insertDocument(ORG_A, processesA[0], userA1);
    await insertDocument(ORG_A, processesA[1], userA1);
    await insertDocument(ORG_B, processesB[0], userB1);
    await insertDocument(ORG_B, processesB[1], userB1);
    await insertDocument(ORG_B, processesB[2], userB1);

    async function insertActivity(org: number, userId: number, n: number): Promise<void> {
      for (let i = 0; i < n; i++) {
        await conn.execute(
          `INSERT INTO activity_logs (organizationId, userId, action, sourceContext) VALUES (?, ?, 'ação de teste', 'test')`,
          [org, userId],
        );
      }
    }
    // Org A: userA1 ×3, userA2 ×1. Org B: userB1 ×10 (NÃO pode aparecer no ranking de A).
    await insertActivity(ORG_A, userA1, 3);
    await insertActivity(ORG_A, userA2, 1);
    await insertActivity(ORG_B, userB1, 10);

    // Parâmetros de edital PRÉ-EXISTENTES do processo B (para provar invariância na tentativa cross-tenant).
    await conn.execute(
      `INSERT INTO edital_parameters (processId, modalidade, formato) VALUES (?, 'pregao-B-original', 'eletronico')`,
      [processesB[0]],
    );

    // Notificação pertencente ao User B (isRead=false).
    const [n] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO notifications (userId, title, message, type, isRead) VALUES (?, 'Notificação B', 'corpo', 'general', 0)`,
      [userB1],
    );
    notificationB = n.insertId;
  });

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    const allProcesses = [...processesA, ...processesB];
    if (allProcesses.length) {
      const ph = allProcesses.map(() => "?").join(",");
      await del(`DELETE FROM edital_parameters WHERE processId IN (${ph})`, allProcesses);
    }
    await del(`DELETE FROM notifications WHERE userId IN (?, ?, ?)`, [userA1, userA2, userB1]);
    await del(`DELETE FROM activity_logs WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM documents WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM processes WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM users WHERE id IN (?, ?, ?)`, [userA1, userA2, userB1]);
    await conn.end();
  });

  async function makeCaller(userId: number, role: "user" | "admin" = "user") {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role, name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers: {} },
      res: {},
      correlationId: "test-post-blockers",
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }

  // ── A. Analytics org-scoped (helpers reais contra MySQL) ──────────────────────
  it("getProcessCountByStatusForOrg conta SÓ a própria org (B não vaza para A)", async () => {
    const a = await db.getProcessCountByStatusForOrg(ORG_A);
    const byStatusA = Object.fromEntries(a.map((x) => [x.status, x.count]));
    expect(byStatusA["em_dfd"]).toBe(2); // não 7 (2 de A + 5 de B)
    expect(byStatusA["em_etp"]).toBe(1);
    expect(a.reduce((s, x) => s + x.count, 0)).toBe(3);

    const b = await db.getProcessCountByStatusForOrg(ORG_B);
    const byStatusB = Object.fromEntries(b.map((x) => [x.status, x.count]));
    expect(byStatusB["em_dfd"]).toBe(5); // cada org enxerga só a si
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(5);
  }, 30000);

  it("getDocumentCountByMonthForOrg conta SÓ documentos da própria org", async () => {
    const a = await db.getDocumentCountByMonthForOrg(ORG_A, 6);
    const b = await db.getDocumentCountByMonthForOrg(ORG_B, 6);
    expect(a.reduce((s, x) => s + x.count, 0)).toBe(2); // A: 2 (não 5)
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(3); // B: 3
  }, 30000);

  it("getMostActiveMembersForOrg ignora atividade da outra org", async () => {
    const a = await db.getMostActiveMembersForOrg(ORG_A, 10);
    const idsA = a.map((m) => m.userId);
    expect(idsA).not.toContain(userB1); // atividade de B (×10) jamais aparece em A
    expect(idsA.every((id) => id === userA1 || id === userA2)).toBe(true);
    expect(a[0]?.userId).toBe(userA1); // A1 (×3) é o mais ativo de A
    expect(a.find((m) => m.userId === userA1)?.activityCount).toBeGreaterThanOrEqual(3);

    const b = await db.getMostActiveMembersForOrg(ORG_B, 10);
    const b1 = b.find((m) => m.userId === userB1);
    expect(b1?.activityCount).toBe(10);
    expect(b.map((m) => m.userId)).not.toContain(userA1);
  }, 30000);

  it("analytics.getOverview (caller real) agrega só pela org do contexto — nunca pelo input", async () => {
    const overviewA = await (await makeCaller(userA1)).analytics.getOverview();
    expect(overviewA.totalProcesses).toBe(3); // só A
    expect(overviewA.totalUsers).toBe(2); // membros ativos de A
    expect(overviewA.mostActiveMembers.map((m) => m.userId)).not.toContain(userB1);

    const overviewB = await (await makeCaller(userB1)).analytics.getOverview();
    expect(overviewB.totalProcesses).toBe(5); // só B
    expect(overviewB.totalUsers).toBe(1);
    expect(overviewB.mostActiveMembers.map((m) => m.userId)).not.toContain(userA1);
  }, 30000);

  // ── B. Edital — tenant guard com prova de não-mutação ─────────────────────────
  it("edital: happy path — A lê/salva os parâmetros do PRÓPRIO processo", async () => {
    const callerA = await makeCaller(userA1);
    const r = await callerA.editalParameters.save({
      processId: processesA[0], modalidade: "pregao-A", formato: "eletronico",
    });
    expect(r).toEqual({ success: true });

    const got = await callerA.editalParameters.get({ processId: processesA[0] });
    expect(got?.modalidade).toBe("pregao-A");

    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT modalidade FROM edital_parameters WHERE processId = ?`, [processesA[0]],
    );
    expect(rows[0]?.modalidade).toBe("pregao-A"); // efeito persistido no MySQL
  }, 30000);

  it("edital: A tenta GET de processo de B → NOT_FOUND (nenhum dado de B retornado)", async () => {
    const callerA = await makeCaller(userA1);
    await expect(callerA.editalParameters.get({ processId: processesB[0] })).rejects.toThrow(/não encontrad/i);
  }, 30000);

  it("edital: A tenta SAVE em processo de B → NOT_FOUND, sem UPSERT e sem activity log", async () => {
    const callerA = await makeCaller(userA1);
    await expect(
      callerA.editalParameters.save({ processId: processesB[0], modalidade: "HACKED", formato: "presencial" }),
    ).rejects.toThrow(/não encontrad/i);

    // Parâmetros de B intactos (prova direta no MySQL).
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT modalidade, formato FROM edital_parameters WHERE processId = ?`, [processesB[0]],
    );
    expect(rows[0]?.modalidade).toBe("pregao-B-original");
    expect(rows[0]?.formato).toBe("eletronico");

    // Nenhum activity_log foi inserido pela tentativa cross-tenant de A no processo de B.
    const [logs] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM activity_logs WHERE processId = ? AND userId = ?`, [processesB[0], userA1],
    );
    expect(Number(logs[0]?.c)).toBe(0);
  }, 30000);

  // ── C. Notificações — escopo por dono com prova de não-mutação ────────────────
  it("notifications: A tenta marcar como lida a notificação de B → permanece NÃO lida", async () => {
    const callerA = await makeCaller(userA1);
    const r = await callerA.notifications.markAsRead({ notificationId: notificationB });
    expect(r).toEqual({ success: true }); // endpoint não é oracle de existência

    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT isRead FROM notifications WHERE id = ?`, [notificationB],
    );
    expect(Number(rows[0]?.isRead)).toBe(0); // efeito: continua não lida
  }, 30000);

  it("notifications: o DONO (B) marca a própria como lida → efetivamente lida", async () => {
    const callerB = await makeCaller(userB1);
    const r = await callerB.notifications.markAsRead({ notificationId: notificationB });
    expect(r).toEqual({ success: true });

    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT isRead FROM notifications WHERE id = ?`, [notificationB],
    );
    expect(Number(rows[0]?.isRead)).toBe(1); // efeito: agora lida
  }, 30000);
});
