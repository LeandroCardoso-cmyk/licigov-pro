/**
 * NEW-002 (P0 operacional / governança de retenção) — `lgpd.deleteMyAccount` desativado — smoke contra MySQL REAL.
 * Só roda com DATABASE_URL definido.
 *
 * Antes: a mutation chamava `db.deleteUserData`, que apagava FISICAMENTE os processos legados do usuário,
 * seus documentos, edital_parameters, activity_logs (trilha de auditoria), comments, process_members,
 * notifications, user_consents e o próprio usuário.
 *
 * Contrato verificado (fixtures diretas no banco):
 *  - qualquer ator (usuário comum, admin do órgão, owner do órgão, admin de plataforma, usuário de outro
 *    órgão) recebe FORBIDDEN com ACCOUNT_HARD_DELETE_DISABLED — mensagem idêntica;
 *  - ZERO delete / ZERO cascata: contagens EXATAS de todas as tabelas acima permanecem iguais, para o
 *    titular e para o usuário de outro órgão; as linhas de `users` continuam existindo;
 *  - `lgpd.exportMyData` (somente leitura) continua funcionando e não altera nenhuma linha;
 *  - evento `account_hard_delete_refused` com actorUserId/correlationId e sem e-mail/nome.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { ACCOUNT_HARD_DELETE_DISABLED, ACCOUNT_HARD_DELETE_DISABLED_MESSAGE } from "../../services/accountRemovalGuard";

const DB = process.env.DATABASE_URL;
const ORG_A = 960201;
const ORG_B = 960202;

describe.skipIf(!DB)("NEW-002 — lgpd.deleteMyAccount sem exclusão física (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  const email = (tag: string) => `n002-${tag}-${stamp}@teste.local`;
  const nameOf = (tag: string) => `N002 ${tag} ${stamp}`;

  let holder: number, coworker: number, orgAdmin: number, orgOwner: number, platformAdmin: number, other: number;
  let pHolder: number, pOther: number, dHolder: number, dOther: number;
  const allUsers = () => [holder, coworker, orgAdmin, orgOwner, platformAdmin, other];

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A N002 ${stamp}`, `org-a-n002-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B N002 ${stamp}`, `org-b-n002-${stamp}`]);

    async function user(tag: string, role: "user" | "admin" = "user"): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)`, [`n002-${tag}-${stamp}`, nameOf(tag), email(tag), role]);
      return r.insertId;
    }
    async function member(org: number, userId: number, role: string) {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, userId, role]);
    }
    holder = await user("holder"); coworker = await user("coworker");
    orgAdmin = await user("org-admin"); orgOwner = await user("org-owner");
    platformAdmin = await user("platform-admin", "admin"); other = await user("other");
    await member(ORG_A, holder, "operator"); await member(ORG_A, coworker, "operator");
    await member(ORG_A, orgAdmin, "admin"); await member(ORG_A, orgOwner, "owner");
    await member(ORG_B, other, "operator");

    /** Conjunto completo de dados que `deleteUserData` apagaria, para um titular. */
    async function seed(org: number, owner: number, peer: number | null): Promise<{ p: number; d: number }> {
      const [pr] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, ?, 'Objeto N002', ?, 'em_dfd')`, [org, `Processo N002 ${owner} ${stamp}`, owner]);
      const p = pr.insertId;
      const [dr] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO documents (organizationId, processId, type, title, content, createdBy) VALUES (?, ?, 'dfd', 'DFD N002', 'conteúdo', ?)`, [org, p, owner]);
      const d = dr.insertId;
      await conn.execute(`INSERT INTO edital_parameters (processId, modalidade, formato) VALUES (?, 'Pregão', 'eletronico')`, [p]);
      await conn.execute(
        `INSERT INTO activity_logs (organizationId, processId, userId, action, entityType, entityId) VALUES (?, ?, ?, 'criou processo', 'process', ?)`, [org, p, owner, p]);
      await conn.execute(
        `INSERT INTO activity_logs (organizationId, processId, userId, action, entityType, entityId) VALUES (?, ?, ?, 'editou documento', 'document', ?)`, [org, p, owner, d]);
      await conn.execute(`INSERT INTO comments (organizationId, documentId, processId, userId, content) VALUES (?, ?, ?, ?, 'comentário do titular')`, [org, d, p, owner]);
      await conn.execute(`INSERT INTO notifications (userId, title, message, type, processId) VALUES (?, 'Aviso', 'Mensagem', 'general', ?)`, [owner, p]);
      await conn.execute(`INSERT INTO process_members (processId, userId, permission, invitedBy) VALUES (?, ?, 'owner', ?)`, [p, owner, owner]);
      await conn.execute(`INSERT INTO user_consents (userId, consentType, version, accepted) VALUES (?, 'privacy_policy', '1.0', 1)`, [owner]);
      await conn.execute(`INSERT INTO user_consents (userId, consentType, version, accepted) VALUES (?, 'terms_of_use', '1.0', 1)`, [owner]);
      if (peer !== null) {
        // colega do mesmo órgão colabora no processo do titular (seria perdido em cascata pelo delete do processo)
        await conn.execute(`INSERT INTO process_members (processId, userId, permission, invitedBy) VALUES (?, ?, 'editor', ?)`, [p, peer, owner]);
        await conn.execute(`INSERT INTO comments (organizationId, documentId, processId, userId, content) VALUES (?, ?, ?, ?, 'comentário do colega')`, [org, d, p, peer]);
        await conn.execute(
          `INSERT INTO activity_logs (organizationId, processId, userId, action) VALUES (?, ?, ?, 'comentou documento')`, [org, p, peer]);
      }
      return { p, d };
    }
    ({ p: pHolder, d: dHolder } = await seed(ORG_A, holder, coworker));
    ({ p: pOther, d: dOther } = await seed(ORG_B, other, null));
  });

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    const users = allUsers().filter((u) => typeof u === "number");
    const inUsers = users.map(() => "?").join(",");
    const procs = [pHolder, pOther].filter((p) => typeof p === "number");
    const inProcs = procs.map(() => "?").join(",") || "NULL";
    await del(`DELETE FROM comments WHERE processId IN (${inProcs})`, procs);
    await del(`DELETE FROM notifications WHERE userId IN (${inUsers})`, users);
    await del(`DELETE FROM process_members WHERE processId IN (${inProcs})`, procs);
    await del(`DELETE FROM activity_logs WHERE userId IN (${inUsers})`, users);
    await del(`DELETE FROM edital_parameters WHERE processId IN (${inProcs})`, procs);
    await del(`DELETE FROM documents WHERE processId IN (${inProcs})`, procs);
    await del(`DELETE FROM processes WHERE id IN (${inProcs})`, procs);
    await del(`DELETE FROM user_consents WHERE userId IN (${inUsers})`, users);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM users WHERE id IN (${inUsers})`, users);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, role: "user" | "admin", org: number | null, correlationId: string) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role, name: nameOf(`actor-${userId}`), email: email(`actor-${userId}`) },
      req: { headers: org ? { "x-organization-id": String(org) } : {}, ip: "127.0.0.1" },
      res: {},
      correlationId,
      requestId: `req-${correlationId}`,
      organizationId: null,
      orgMembership: null,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const count = async (sql: string, p: unknown[]) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, p);
    return Number(rows[0].n);
  };
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  };

  /** Contagens EXATAS de tudo que `deleteUserData` tocaria — do titular, do colega e do usuário de outro órgão. */
  async function snapshot() {
    const per = async (userId: number, procId: number) => ({
      user: await count(`SELECT COUNT(*) n FROM users WHERE id = ?`, [userId]),
      processesOwned: await count(`SELECT COUNT(*) n FROM processes WHERE ownerId = ?`, [userId]),
      documentsOfProcess: await count(`SELECT COUNT(*) n FROM documents WHERE processId = ?`, [procId]),
      editalParamsOfProcess: await count(`SELECT COUNT(*) n FROM edital_parameters WHERE processId = ?`, [procId]),
      activityLogsByUser: await count(`SELECT COUNT(*) n FROM activity_logs WHERE userId = ?`, [userId]),
      activityLogsOfProcess: await count(`SELECT COUNT(*) n FROM activity_logs WHERE processId = ?`, [procId]),
      commentsByUser: await count(`SELECT COUNT(*) n FROM comments WHERE userId = ?`, [userId]),
      commentsOfProcess: await count(`SELECT COUNT(*) n FROM comments WHERE processId = ?`, [procId]),
      notificationsOfUser: await count(`SELECT COUNT(*) n FROM notifications WHERE userId = ?`, [userId]),
      processMembersOfUser: await count(`SELECT COUNT(*) n FROM process_members WHERE userId = ?`, [userId]),
      processMembersOfProcess: await count(`SELECT COUNT(*) n FROM process_members WHERE processId = ?`, [procId]),
      consentsOfUser: await count(`SELECT COUNT(*) n FROM user_consents WHERE userId = ?`, [userId]),
      orgMemberships: await count(`SELECT COUNT(*) n FROM organization_members WHERE userId = ?`, [userId]),
    });
    return {
      holder: await per(holder, pHolder),
      coworker: await per(coworker, pHolder),
      other: await per(other, pOther),
      allUsers: await count(`SELECT COUNT(*) n FROM users WHERE id IN (?, ?, ?, ?, ?, ?)`, allUsers()),
    };
  }

  it("fixtures: o titular tem o conjunto completo de dados que a cascata apagaria", async () => {
    const s = await snapshot();
    expect(s.holder).toEqual({
      user: 1, processesOwned: 1, documentsOfProcess: 1, editalParamsOfProcess: 1,
      activityLogsByUser: 2, activityLogsOfProcess: 3, commentsByUser: 1, commentsOfProcess: 2,
      notificationsOfUser: 1, processMembersOfUser: 1, processMembersOfProcess: 2, consentsOfUser: 2, orgMemberships: 1,
    });
    expect(s.other).toMatchObject({ user: 1, processesOwned: 1, documentsOfProcess: 1, activityLogsByUser: 2, consentsOfUser: 2 });
    expect(s.allUsers).toBe(6);
  });

  it("titular chama deleteMyAccount ⇒ FORBIDDEN (ACCOUNT_HARD_DELETE_DISABLED) e NENHUMA linha é apagada", async () => {
    const before = await snapshot();
    const c = await caller(holder, "user", ORG_A, "n002-holder");
    const err = await errOf(() => c.lgpd.deleteMyAccount());
    expect(err).toEqual({ code: "FORBIDDEN", message: ACCOUNT_HARD_DELETE_DISABLED_MESSAGE });
    expect(err.message).toContain(ACCOUNT_HARD_DELETE_DISABLED);
    expect(await snapshot()).toEqual(before);
    expect(await count(`SELECT COUNT(*) n FROM users WHERE id = ?`, [holder])).toBe(1);
  }, 30000);

  it("admin do órgão, owner do órgão e admin de plataforma ⇒ o MESMO FORBIDDEN, sem nenhum efeito", async () => {
    const before = await snapshot();
    const actors: Array<[number, "user" | "admin", number | null]> = [
      [orgAdmin, "user", ORG_A], [orgOwner, "user", ORG_A], [platformAdmin, "admin", ORG_A], [platformAdmin, "admin", null],
    ];
    const errors = [];
    for (const [id, role, org] of actors) errors.push(await errOf(async () => (await caller(id, role, org, `n002-${id}`)).lgpd.deleteMyAccount()));
    for (const e of errors) expect(e).toEqual({ code: "FORBIDDEN", message: ACCOUNT_HARD_DELETE_DISABLED_MESSAGE });
    expect(await snapshot()).toEqual(before);
  }, 30000);

  it("usuário de OUTRO órgão ⇒ o mesmo FORBIDDEN; nada dele nem do titular é tocado (cross-tenant)", async () => {
    const before = await snapshot();
    const err = await errOf(async () => (await caller(other, "user", ORG_B, "n002-other")).lgpd.deleteMyAccount());
    expect(err).toEqual({ code: "FORBIDDEN", message: ACCOUNT_HARD_DELETE_DISABLED_MESSAGE });
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.other.processesOwned).toBe(1);
    expect(after.holder.processesOwned).toBe(1);
    expect(await count(`SELECT COUNT(*) n FROM documents WHERE id IN (?, ?)`, [dHolder, dOther])).toBe(2);
  }, 30000);

  it("chamadas repetidas continuam recusadas de forma determinística e sem efeito cumulativo", async () => {
    const before = await snapshot();
    const c = await caller(holder, "user", ORG_A, "n002-repeat");
    const e1 = await errOf(() => c.lgpd.deleteMyAccount());
    const e2 = await errOf(() => c.lgpd.deleteMyAccount());
    expect(e2).toEqual(e1);
    expect(await snapshot()).toEqual(before);
  }, 30000);

  it("exportMyData (somente leitura) continua funcionando e não altera nenhuma linha", async () => {
    const before = await snapshot();
    const c = await caller(holder, "user", ORG_A, "n002-export");
    const data = await c.lgpd.exportMyData();
    expect(data.user?.id).toBe(holder);
    expect(data.processes.map((p) => p.id)).toEqual([pHolder]);
    expect(data.documents.map((d) => d.id)).toEqual([dHolder]);
    expect(data.comments).toHaveLength(1);
    expect(data.notifications).toHaveLength(1);
    expect(data.consents).toHaveLength(2);
    expect(data.activities).toHaveLength(2);
    // não mistura dados de outro usuário/órgão
    expect(data.processes.map((p) => p.id)).not.toContain(pOther);
    expect(data.documents.map((d) => d.id)).not.toContain(dOther);
    expect(await snapshot()).toEqual(before);
  }, 30000);

  it("evento account_hard_delete_refused com actorUserId/correlationId, sem e-mail nem nome", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
    try {
      await errOf(async () => (await caller(holder, "user", ORG_A, "n002-evt")).lgpd.deleteMyAccount());
    } finally { spy.mockRestore(); }
    const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.operation === "account_hard_delete_refused");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ service: "accountRemovalGuard", actorUserId: holder, correlationId: "n002-evt" });
    const all = lines.join("\n");
    expect(all).not.toContain(email(`actor-${holder}`));
    expect(all).not.toContain(nameOf(`actor-${holder}`));
    expect(all).not.toContain(email("holder"));
  }, 30000);
});
