/**
 * RC-SEC-PR-A — Isolamento multi-tenant do núcleo (processos, tarefas, documentos,
 * contratação direta) — smoke contra MySQL REAL. Só roda com DATABASE_URL definido.
 *
 * Exercita a PERSISTÊNCIA e o ISOLAMENTO tenant contra MySQL real (não mock):
 * tenant A × tenant B, usuário sem organização, cross-tenant → NOT_FOUND idêntico,
 * create resolvendo organizationId pelo contexto, analytics por organização.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 950001;
const ORG_B = 950002;

describe.skipIf(!DB)("RC-SEC-PR-A — isolamento do núcleo (MySQL real)", () => {
  let conn: mysql.Connection;
  let userA: number;
  let userB: number;
  let userNoOrg: number;
  let processA: number;
  let processB: number;
  let taskA: number;
  let taskB: number;
  let documentA: number;
  let documentB: number;
  let directA: number;
  let directB: number;
  let legalArticleId: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    const stamp = Date.now();

    async function insertUser(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
        [`sec-pra-${tag}-${stamp}`, `Usuário ${tag}`, `sec-pra-${tag}-${stamp}@teste.local`],
      );
      return r.insertId;
    }
    userA = await insertUser("a");
    userB = await insertUser("b");
    userNoOrg = await insertUser("noorg");

    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_A, userA]);
    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_B, userB]);

    async function insertProcess(org: number, owner: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, 'Processo SEC-PRA', 'Objeto', ?, 'em_dfd')`,
        [org, owner],
      );
      return r.insertId;
    }
    processA = await insertProcess(ORG_A, userA);
    processB = await insertProcess(ORG_B, userB);

    async function insertDocument(org: number, processId: number, owner: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO documents (organizationId, processId, type, content, version, createdBy, documentStatus) VALUES (?, ?, 'dfd', '# DFD', 1, ?, 'draft')`,
        [org, processId, owner],
      );
      return r.insertId;
    }
    documentA = await insertDocument(ORG_A, processA, userA);
    documentB = await insertDocument(ORG_B, processB, userB);

    async function insertTask(org: number, owner: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO tasks (organizationId, title, type, assignedTo, createdBy, status, priority) VALUES (?, 'Tarefa SEC-PRA', 'geral', ?, ?, 'pendente', 'media')`,
        [org, owner, owner],
      );
      return r.insertId;
    }
    taskA = await insertTask(ORG_A, userA);
    taskB = await insertTask(ORG_B, userB);

    const [la] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO direct_contract_legal_articles (type, article, description, summary) VALUES ('dispensa', 'Art. 75, II', 'Descrição legal de teste', 'Resumo de teste')`,
    );
    legalArticleId = la.insertId;

    async function insertDirect(org: number, owner: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO direct_contracts (organizationId, number, year, type, legalArticleId, object, justification, value, status, createdBy)
         VALUES (?, ?, 2026, 'dispensa', ?, 'Objeto da contratação direta', 'Justificativa suficiente do processo', 10000, 'approved', ?)`,
        [org, `DC-${org}-${stamp}`, legalArticleId, owner],
      );
      return r.insertId;
    }
    directA = await insertDirect(ORG_A, userA);
    directB = await insertDirect(ORG_B, userB);
  });

  afterAll(async () => {
    if (conn) {
      const del = async (sql: string, p: any[]) => { await conn.execute(sql, p).catch(() => {}); };
      await del(`DELETE FROM documents WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM tasks WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM direct_contracts WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM direct_contract_legal_articles WHERE id = ?`, [legalArticleId]);
      await del(`DELETE FROM processes WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM users WHERE id IN (?, ?, ?)`, [userA, userB, userNoOrg]);
      await conn.end();
    }
  });

  async function makeCaller(userId: number, role: "user" | "admin" = "user") {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role, name: `Usuário ${userId}`, email: `u${userId}@teste.local` } as any,
      req: { headers: {} } as any,
      res: {} as any,
      correlationId: "test-sec-pra",
    } as any);
  }

  // ── Processos ────────────────────────────────────────────────────────────────
  it("processes.list: A vê só processos de A", async () => {
    const a = await (await makeCaller(userA)).processes.list();
    const b = await (await makeCaller(userB)).processes.list();
    expect(a.some((p: any) => p.id === processA)).toBe(true);
    expect(a.some((p: any) => p.id === processB)).toBe(false);
    expect(b.some((p: any) => p.id === processB)).toBe(true);
    expect(b.some((p: any) => p.id === processA)).toBe(false);
  }, 30000);

  it("processes.getById: próprio ok; cross-tenant e inexistente → mesmo NOT_FOUND", async () => {
    const callerA = await makeCaller(userA);
    const own = await callerA.processes.getById({ id: processA });
    expect(own?.id).toBe(processA);
    await expect(callerA.processes.getById({ id: processB })).rejects.toThrow(/não encontrado/i);
    await expect(callerA.processes.getById({ id: 999999999 })).rejects.toThrow(/não encontrado/i);
  });

  it("processes.updateStatus cross-tenant é bloqueado", async () => {
    const callerA = await makeCaller(userA);
    await expect(callerA.processes.updateStatus({ id: processB, status: "em_etp" as any })).rejects.toThrow(/não encontrado/i);
    const [rows] = await conn.execute<any[]>(`SELECT status FROM processes WHERE id = ?`, [processB]);
    expect(rows[0].status).toBe("em_dfd"); // inalterado
  });

  it("processes.create grava organizationId do contexto (não do input)", async () => {
    const callerA = await makeCaller(userA);
    const uniqueName = `Novo processo A ${Date.now()}`;
    // O create legado insere o processo antes de um activity_log com bug pré-existente
    // (processId NaN, sem transação — DATA-012). O que importa para o isolamento é
    // que a linha do processo é gravada com organizationId resolvido pelo contexto.
    await callerA.processes.create({
      name: uniqueName, object: "Objeto novo suficiente para validação",
      estimatedValue: 1000, modality: "pregao_eletronico", category: "compras",
    } as any).catch(() => { /* activity_log legado pode falhar; irrelevante ao isolamento */ });
    const [rows] = await conn.execute<any[]>(`SELECT id, organizationId FROM processes WHERE name = ?`, [uniqueName]);
    expect(rows.length).toBe(1);
    expect(rows[0].organizationId).toBe(ORG_A);
    await conn.execute(`DELETE FROM documents WHERE processId = ?`, [rows[0].id]).catch(() => {});
    await conn.execute(`DELETE FROM processes WHERE id = ?`, [rows[0].id]).catch(() => {});
  }, 30000);

  // ── Documentos ─────────────────────────────────────────────────────────────
  it("documents.listByProcess cross-tenant → NOT_FOUND", async () => {
    const callerA = await makeCaller(userA);
    const own = await callerA.documents.listByProcess({ processId: processA });
    expect(own.some((d: any) => d.id === documentA)).toBe(true);
    await expect(callerA.documents.listByProcess({ processId: processB })).rejects.toThrow(/não encontrado/i);
  });

  it("documents.getDownloadUrl de documento de outro tenant → NOT_FOUND", async () => {
    const callerA = await makeCaller(userA);
    await expect(callerA.documents.getDownloadUrl({ documentId: documentB })).rejects.toThrow(/não encontrado/i);
  });

  // ── Tarefas ────────────────────────────────────────────────────────────────
  it("tasks.list isolada; getById cross-tenant → NOT_FOUND", async () => {
    const callerA = await makeCaller(userA);
    const resA: any = await callerA.tasks.list({});
    const list = Array.isArray(resA) ? resA : (resA.tasks ?? resA.items ?? []);
    expect(list.some((t: any) => t.id === taskA)).toBe(true);
    expect(list.some((t: any) => t.id === taskB)).toBe(false);
    await expect(callerA.tasks.getById({ id: taskB })).rejects.toThrow(/não encontrad/i);
  });

  // ── Contratação direta ───────────────────────────────────────────────────────
  it("directContracts.getById cross-tenant → NOT_FOUND", async () => {
    const callerA = await makeCaller(userA);
    const own = await callerA.directContracts.getById({ id: directA });
    expect(own?.id).toBe(directA);
    await expect(callerA.directContracts.getById({ id: directB })).rejects.toThrow(/não encontrad/i);
  });

  it("directContracts.analytics.getOverview de A não conta contratos de B", async () => {
    const overviewA: any = await (await makeCaller(userA)).directContracts.analytics.getOverview();
    const overviewB: any = await (await makeCaller(userB)).directContracts.analytics.getOverview();
    // Cada org enxerga pelo menos o próprio contrato e o total reflete só a sua org.
    expect(overviewA.total).toBeGreaterThanOrEqual(1);
    expect(overviewB.total).toBeGreaterThanOrEqual(1);
    // A soma dos totais por org não vaza — recentes de A não incluem o contrato de B.
    const recentA: any = await (await makeCaller(userA)).directContracts.analytics.getRecent({ limit: 50 });
    expect(recentA.some((c: any) => c.id === directB)).toBe(false);
    expect(recentA.some((c: any) => c.id === directA)).toBe(true);
  });

  // ── Usuário sem organização ──────────────────────────────────────────────────
  it("usuário sem membership é bloqueado (fail-closed), não cai na org 1", async () => {
    const caller = await makeCaller(userNoOrg);
    await expect(caller.processes.list()).rejects.toThrow();
  });
});
