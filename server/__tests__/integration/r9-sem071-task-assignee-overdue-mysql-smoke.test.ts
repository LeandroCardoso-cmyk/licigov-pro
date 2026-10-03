/**
 * R9 / SEM-071 — Gestão do Departamento contra MySQL REAL:
 *  (1) responsável de tarefa validado no servidor como membro ATIVO do órgão (`organization_members.ativo = 1`)
 *      em `departmentTasks.create/update` e `tasks.create/update` — usuário de outro órgão, membro inativo ou
 *      inexistente ⇒ o MESMO BAD_REQUEST e ZERO escrita;
 *  (2) paridade do espelho SQL `taskOverdueCondition` com a regra pura `isTaskOverdue` (shared/taskDeadline.ts)
 *      em `getOverdueTasksForOrganization` e `getTaskStatsForOrganization`, isolado por tenant.
 * Só roda com DATABASE_URL; PULADO sem banco. Org ids sintéticos 9607xx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { getOverdueTasksForOrganization, getTaskStatsForOrganization, listTasksForOrganization } from "../../db/tasks";
import { isTaskOverdue } from "@shared/taskDeadline";
import { TASK_ASSIGNEE_NOT_MEMBER_MESSAGE } from "../../services/taskAssigneePolicy";

const DB = process.env.DATABASE_URL;
const ORG_A = 960711;
const ORG_B = 960712;

describe.skipIf(!DB)("R9 / SEM-071 — responsável validado e 'Atrasada' única (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let owner = 0, member = 0, inactive = 0, foreign = 0;
  const createdUsers: number[] = [];

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A R9 ${stamp}`, `org-a-r9-071-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B R9 ${stamp}`, `org-b-r9-071-${stamp}`]);
    async function user(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')`, [`r9-071-${tag}-${stamp}`, `R9 ${tag}`, `r9-071-${tag}-${stamp}@teste.local`]);
      createdUsers.push(r.insertId);
      return r.insertId;
    }
    async function membership(org: number, userId: number, ativo: 0 | 1, role = "operator") {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, ?)`, [org, userId, role, ativo]);
    }
    owner = await user("owner"); member = await user("member"); inactive = await user("inactive"); foreign = await user("foreign");
    await membership(ORG_A, owner, 1, "owner");
    await membership(ORG_A, member, 1);
    await membership(ORG_A, inactive, 0);
    await membership(ORG_B, foreign, 1);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    await del(`DELETE FROM tasks WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    if (createdUsers.length) await del(`DELETE FROM users WHERE id IN (${createdUsers.map(() => "?").join(",")})`, createdUsers);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, org: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId: `r9-071-${userId}-${org}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const taskCount = async () => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT COUNT(*) n FROM tasks WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    return Number(rows[0].n);
  };
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  };
  const REJECTED = { code: "BAD_REQUEST", message: TASK_ASSIGNEE_NOT_MEMBER_MESSAGE };

  it("create: outro órgão, inativo e inexistente ⇒ mesmo BAD_REQUEST, nenhuma tarefa gravada", async () => {
    const c = await caller(owner, ORG_A);
    const before = await taskCount();
    for (const assignedTo of [foreign, inactive, 2_000_000_000]) {
      expect(await errOf(() => c.departmentTasks.create({ title: "R9", type: "x", deadline: "2026-12-01", assignedTo }))).toEqual(REJECTED);
      expect(await errOf(() => c.tasks.create({ title: "R9", type: "x", priority: "media", assignedTo }))).toEqual(REJECTED);
    }
    expect(await taskCount()).toBe(before);
  }, 60_000);

  it("create com membro ativo grava; update para responsável inválido é recusado sem alterar", async () => {
    const c = await caller(owner, ORG_A);
    const id = await c.departmentTasks.create({ title: "R9 ok", type: "x", deadline: "2026-12-01T12:00:00.000Z", assignedTo: member });
    expect(typeof id).toBe("number");
    const read = async () => {
      const [rows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT assignedTo, organizationId, deadline FROM tasks WHERE id = ?`, [id]);
      return rows[0];
    };
    expect((await read()).assignedTo).toBe(member);
    expect((await read()).organizationId).toBe(ORG_A);

    expect(await errOf(() => c.departmentTasks.update({ id: id as number, assignedTo: foreign }))).toEqual(REJECTED);
    expect(await errOf(() => c.tasks.update({ id: id as number, assignedTo: inactive }))).toEqual(REJECTED);
    expect((await read()).assignedTo).toBe(member);

    await c.tasks.update({ id: id as number, assignedTo: owner });
    expect((await read()).assignedTo).toBe(owner);
  }, 60_000);

  it("paridade: SQL de atrasadas == regra pura; estatística usa a mesma regra; isolada por tenant", async () => {
    const now = Date.now();
    const d = (days: number) => new Date(now + days * 86_400_000);
    const rows: unknown[][] = [
      [ORG_A, "vencida pendente", "pendente", d(-2)],
      [ORG_A, "manual sem prazo", "atrasada", null],
      [ORG_A, "manual prazo futuro", "atrasada", d(10)],
      [ORG_A, "concluída vencida", "concluida", d(-3)],
      [ORG_A, "cancelada vencida", "cancelada", d(-3)],
      [ORG_A, "futura", "em_andamento", d(2)],
      [ORG_A, "sem prazo", "pendente", null],
      [ORG_B, "vencida outro órgão", "pendente", d(-2)],
    ];
    for (const [org, title, status, deadline] of rows) {
      await conn.execute(`INSERT INTO tasks (organizationId, title, type, status, priority, assignedTo, createdBy, deadline) VALUES (?, ?, 'x', ?, 'media', ?, ?, ?)`,
        [org, title, status, owner, owner, deadline]);
    }
    const all = await listTasksForOrganization(ORG_A);
    const expected = all.filter((t) => isTaskOverdue(t, new Date())).map((t) => t.title).sort();
    expect(expected).toEqual(["manual prazo futuro", "manual sem prazo", "vencida pendente"]);
    const sqlOverdue = (await getOverdueTasksForOrganization(ORG_A)).map((t) => t.title).sort();
    expect(sqlOverdue).toEqual(expected);
    expect((await getTaskStatsForOrganization(ORG_A)).overdue).toBe(3);
    expect((await getOverdueTasksForOrganization(ORG_B)).map((t) => t.title)).toEqual(["vencida outro órgão"]);
  }, 60_000);
});
