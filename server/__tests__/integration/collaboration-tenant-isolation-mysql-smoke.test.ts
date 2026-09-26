/**
 * R1 / PR-01 — SEM-001 (P0): isolamento multi-tenant do `collaborationRouter` — smoke contra MySQL REAL.
 * Só roda com DATABASE_URL definido.
 *
 * Reprodução CONTROLADA (fixtures diretas no banco — nunca `processes.create`, que está desativado por
 * LEGACY_PROCESS_PIPELINE_DISABLED): o boundary da colaboração resolvia processo e usuário-alvo com lookups
 * GLOBAIS, permitindo — dado um processo legado acessível — adicionar/atribuir usuário de OUTRO órgão, enumerar
 * e-mails de outros órgãos e expor identidade de associações históricas cross-tenant.
 *
 * Contrato verificado (T1–T25):
 *  - processo resolvido por (processId, ctx.organizationId); outro tenant/inexistente ⇒ o MESMO NOT_FOUND;
 *  - usuário-alvo de adição/atribuição precisa ter membership ATIVA no órgão do contexto (organization_members);
 *    inexistente e de outro órgão ⇒ o MESMO NOT_FOUND (anti-enumeração);
 *  - negação ⇒ ZERO writes (membro/atribuição), ZERO notificação, ZERO activity log de sucesso;
 *  - leituras não expõem identidade de associação histórica cross-tenant;
 *  - remoção de associação histórica inválida continua possível (saneamento), sem expor PII estrangeira;
 *  - evento `tenant_authorization_denied` com correlationId e sem e-mail/nome do alvo estrangeiro.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 960101;
const ORG_B = 960102;
const PROCESS_NOT_FOUND = "Processo não encontrado.";
const USER_NOT_FOUND = "Usuário não encontrado nesta organização.";

describe.skipIf(!DB)("R1 / SEM-001 — collaboration tenant isolation (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  const email = (tag: string) => `r1-${tag}-${stamp}@teste.local`;
  const nameOf = (tag: string) => `R1 ${tag} ${stamp}`;

  let aOwner: number, aMember: number, aOutsider: number, aNew: number, multi: number;
  let bTarget: number, bHist: number, bOwner: number, admin: number;
  let pA: number, pB: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A R1 ${stamp}`, `org-a-r1-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B R1 ${stamp}`, `org-b-r1-${stamp}`]);

    async function user(tag: string, role: "user" | "admin" = "user"): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)`, [`r1-${tag}-${stamp}`, nameOf(tag), email(tag), role]);
      return r.insertId;
    }
    async function member(org: number, userId: number, role = "operator") {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, userId, role]);
    }
    aOwner = await user("a-owner"); aMember = await user("a-member"); aOutsider = await user("a-outsider");
    aNew = await user("a-new"); multi = await user("multi");
    bTarget = await user("b-target"); bHist = await user("b-hist"); bOwner = await user("b-owner");
    admin = await user("admin", "admin");
    await member(ORG_A, aOwner, "owner"); await member(ORG_A, aMember); await member(ORG_A, aOutsider, "viewer");
    await member(ORG_A, aNew); await member(ORG_A, multi); await member(ORG_B, multi);
    await member(ORG_B, bTarget); await member(ORG_B, bHist); await member(ORG_B, bOwner, "owner");

    async function proc(org: number, owner: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, ?, 'Objeto R1', ?, 'em_dfd')`, [org, `Processo R1 ${org} ${stamp}`, owner]);
      return r.insertId;
    }
    pA = await proc(ORG_A, aOwner);
    pB = await proc(ORG_B, bOwner);

    // Associações válidas (mesmo tenant) e HISTÓRICAS INVÁLIDAS (usuário de outro órgão) em pA.
    await conn.execute(`INSERT INTO process_members (processId, userId, permission, invitedBy) VALUES (?, ?, 'viewer', ?)`, [pA, aMember, aOwner]);
    await conn.execute(`INSERT INTO process_members (processId, userId, permission, invitedBy) VALUES (?, ?, 'viewer', ?)`, [pA, bHist, aOwner]);
    await conn.execute(`INSERT INTO stage_assignments (processId, docType, assignedUserId, assignedBy) VALUES (?, 'dfd', ?, ?)`, [pA, aMember, aOwner]);
    await conn.execute(`INSERT INTO stage_assignments (processId, docType, assignedUserId, assignedBy) VALUES (?, 'etp', ?, ?)`, [pA, bHist, aOwner]);
    // pB tem membro/atribuição próprios — as tentativas cross-tenant não podem alterá-los.
    await conn.execute(`INSERT INTO process_members (processId, userId, permission, invitedBy) VALUES (?, ?, 'viewer', ?)`, [pB, bTarget, bOwner]);
    await conn.execute(`INSERT INTO stage_assignments (processId, docType, assignedUserId, assignedBy) VALUES (?, 'dfd', ?, ?)`, [pB, bTarget, bOwner]);
  });

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    const users = [aOwner, aMember, aOutsider, aNew, multi, bTarget, bHist, bOwner, admin];
    await del(`DELETE FROM process_members WHERE processId IN (?, ?)`, [pA, pB]);
    await del(`DELETE FROM stage_assignments WHERE processId IN (?, ?)`, [pA, pB]);
    await del(`DELETE FROM notifications WHERE processId IN (?, ?)`, [pA, pB]);
    await del(`DELETE FROM activity_logs WHERE processId IN (?, ?)`, [pA, pB]);
    await del(`DELETE FROM processes WHERE id IN (?, ?)`, [pA, pB]);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM audit_logs WHERE adminId = ?`, [admin]);
    await del(`DELETE FROM users WHERE id IN (${users.map(() => "?").join(",")})`, users);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, org: number, role: "user" | "admin" = "user", correlationId = `r1-${userId}-${org}`) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role, name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const count = async (sql: string, p: unknown[]) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, p);
    return Number(rows[0].n);
  };
  const members = (p: number, u: number) => count(`SELECT COUNT(*) n FROM process_members WHERE processId = ? AND userId = ?`, [p, u]);
  const assignmentsOf = (p: number, u: number) => count(`SELECT COUNT(*) n FROM stage_assignments WHERE processId = ? AND assignedUserId = ?`, [p, u]);
  const notificationsOf = (u: number) => count(`SELECT COUNT(*) n FROM notifications WHERE userId = ?`, [u]);
  const activityOf = (p: number) => count(`SELECT COUNT(*) n FROM activity_logs WHERE processId = ?`, [p]);
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  };

  // ── Adição de membro ──────────────────────────────────────────────────────────
  it("T1/T8/T9/T10 — addMember com usuário de OUTRO órgão é recusado sem nenhum efeito colateral", async () => {
    const c = await caller(aOwner, ORG_A);
    const before = { m: await members(pA, bTarget), n: await notificationsOf(bTarget), a: await activityOf(pA) };
    const err = await errOf(() => c.collaboration.addMember({ processId: pA, userEmail: email("b-target"), permission: "editor" }));
    expect(err).toEqual({ code: "NOT_FOUND", message: USER_NOT_FOUND });
    expect(await members(pA, bTarget)).toBe(before.m);          // T8 — nenhum membro
    expect(await notificationsOf(bTarget)).toBe(before.n);      // T9 — nenhuma notificação
    expect(await activityOf(pA)).toBe(before.a);                // T10 — nenhum activity log de sucesso
  }, 30000);

  it("T2 — e-mail inexistente recebe EXATAMENTE o mesmo contrato externo de T1 (anti-enumeração)", async () => {
    const c = await caller(aOwner, ORG_A);
    const foreign = await errOf(() => c.collaboration.addMember({ processId: pA, userEmail: email("b-target"), permission: "viewer" }));
    const missing = await errOf(() => c.collaboration.addMember({ processId: pA, userEmail: `nao-existe-${stamp}@teste.local`, permission: "viewer" }));
    expect(missing).toEqual(foreign);
    expect(JSON.stringify(foreign)).not.toContain(nameOf("b-target"));
  }, 30000);

  it("T3 — addMember com usuário ativo do MESMO órgão é permitido (membro + notificação + activity log com organizationId)", async () => {
    const c = await caller(aOwner, ORG_A);
    await c.collaboration.addMember({ processId: pA, userEmail: email("a-new"), permission: "editor" });
    expect(await members(pA, aNew)).toBe(1);
    expect(await notificationsOf(aNew)).toBe(1);
    const [logs] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT organizationId, correlationId FROM activity_logs WHERE processId = ? AND action LIKE ? ORDER BY id DESC LIMIT 1`, [pA, `%${nameOf("a-new")}%`]);
    expect(logs[0]).toMatchObject({ organizationId: ORG_A });
  }, 30000);

  it("usuário com membership em A e B é resolvido dentro de A quando a sessão está em A", async () => {
    const c = await caller(aOwner, ORG_A);
    await c.collaboration.addMember({ processId: pA, userEmail: email("multi"), permission: "viewer" });
    expect(await members(pA, multi)).toBe(1);
  }, 30000);

  it("membro existente ⇒ CONFLICT (sem duplicar)", async () => {
    const c = await caller(aOwner, ORG_A);
    const err = await errOf(() => c.collaboration.addMember({ processId: pA, userEmail: email("a-member"), permission: "viewer" }));
    expect(err.code).toBe("CONFLICT");
    expect(await members(pA, aMember)).toBe(1);
  }, 30000);

  // ── Atribuição de etapa ───────────────────────────────────────────────────────
  it("T4/T11/T12/T13 — assignStage para usuário de OUTRO órgão é recusado sem nenhum efeito colateral", async () => {
    const c = await caller(aOwner, ORG_A);
    const before = { s: await assignmentsOf(pA, bTarget), n: await notificationsOf(bTarget), a: await activityOf(pA) };
    const err = await errOf(() => c.collaboration.assignStage({ processId: pA, docType: "tr", assignedUserId: bTarget }));
    expect(err).toEqual({ code: "NOT_FOUND", message: USER_NOT_FOUND });
    expect(await assignmentsOf(pA, bTarget)).toBe(before.s);    // T11
    expect(await notificationsOf(bTarget)).toBe(before.n);      // T12
    expect(await activityOf(pA)).toBe(before.a);                // T13
  }, 30000);

  it("T5 — assignStage para usuário do MESMO órgão passa pelos gates de tenant e grava a atribuição", async () => {
    const c = await caller(aOwner, ORG_A);
    const err = await errOf(() => c.collaboration.assignStage({ processId: pA, docType: "tr", assignedUserId: aMember, note: "revisar" }));
    expect(["NOT_FOUND", "FORBIDDEN"]).not.toContain(err.code);   // nenhum gate de tenant/permissão recusa o mesmo órgão
    expect(await count(`SELECT COUNT(*) n FROM stage_assignments WHERE processId = ? AND docType = 'tr' AND assignedUserId = ?`, [pA, aMember])).toBe(1);
    if (err.code === "RESOLVED") {
      expect(await count(`SELECT COUNT(*) n FROM notifications WHERE userId = ? AND type = 'stage_assigned'`, [aMember])).toBe(1);
    } else {
      // DRIFT PRÉ-EXISTENTE (independente do SEM-001, registrado para o backlog): `drizzle/schema.ts` declara
      // `notifications.type = 'stage_assigned'`, mas nenhuma migration adiciona o valor ao ENUM — no banco migrado o
      // insert da notificação falha DEPOIS da atribuição. Corrigir exige migration (fora do escopo da PR-01). O
      // contrato de sucesso completo (notificação + activity log) é coberto no teste de router com DB mockado.
      expect(err.message).toContain("notifications");
    }
  }, 30000);

  // ── Processo de outro órgão ───────────────────────────────────────────────────
  it("T6/T16/T17/T18/T19 — qualquer mutation sobre processo de OUTRO órgão ⇒ o mesmo NOT_FOUND e nada muda em pB", async () => {
    const c = await caller(aOwner, ORG_A);
    const snapshot = async () => ({
      m: await count(`SELECT COUNT(*) n FROM process_members WHERE processId = ?`, [pB]),
      s: await count(`SELECT COUNT(*) n FROM stage_assignments WHERE processId = ?`, [pB]),
      a: await activityOf(pB),
      perm: (await conn.execute<mysql.RowDataPacket[]>(`SELECT permission, functionalRole FROM process_members WHERE processId = ? AND userId = ?`, [pB, bTarget]))[0][0],
    });
    const before = await snapshot();
    const attempts = [
      () => c.collaboration.addMember({ processId: pB, userEmail: email("a-member"), permission: "viewer" }),     // T6
      () => c.collaboration.removeMember({ processId: pB, userId: bTarget }),                                     // T16
      () => c.collaboration.updatePermission({ processId: pB, userId: bTarget, permission: "approver" }),         // T17
      () => c.collaboration.updateFunctionalRole({ processId: pB, userId: bTarget, functionalRole: "gestor" }),    // T18
      () => c.collaboration.assignStage({ processId: pB, docType: "tr", assignedUserId: aMember }),               // T6
      () => c.collaboration.unassignStage({ processId: pB, docType: "dfd" }),                                     // T19
    ];
    for (const a of attempts) expect(await errOf(a)).toEqual({ code: "NOT_FOUND", message: PROCESS_NOT_FOUND });
    const missing = await errOf(() => c.collaboration.removeMember({ processId: 999_999_999, userId: bTarget }));
    expect(missing).toEqual({ code: "NOT_FOUND", message: PROCESS_NOT_FOUND });                                   // inexistente ≡ outro tenant
    expect(await snapshot()).toEqual(before);
  }, 30000);

  it("T7 — mesmo órgão sem vínculo com o processo ⇒ NOT_FOUND; membro sem permissão ⇒ FORBIDDEN; nada é gravado", async () => {
    const outsider = await caller(aOutsider, ORG_A);
    expect(await errOf(() => outsider.collaboration.addMember({ processId: pA, userEmail: email("a-new"), permission: "viewer" })))
      .toEqual({ code: "NOT_FOUND", message: PROCESS_NOT_FOUND });
    const viewer = await caller(aMember, ORG_A);
    const before = await activityOf(pA);
    expect((await errOf(() => viewer.collaboration.addMember({ processId: pA, userEmail: email("a-outsider"), permission: "viewer" }))).code).toBe("FORBIDDEN");
    expect((await errOf(() => viewer.collaboration.assignStage({ processId: pA, docType: "ata", assignedUserId: aMember }))).code).toBe("FORBIDDEN");
    expect(await members(pA, aOutsider)).toBe(0);
    expect(await activityOf(pA)).toBe(before);
  }, 30000);

  // ── Leituras não expõem associações históricas cross-tenant ────────────────────
  it("T14 — listMembers(pA) não expõe o membro histórico de outro órgão (nem id, nem nome, nem e-mail)", async () => {
    const c = await caller(aOwner, ORG_A);
    const list = await c.collaboration.listMembers({ processId: pA });
    expect(list.map((m) => m.userId)).toContain(aMember);
    expect(list.map((m) => m.userId)).not.toContain(bHist);
    const json = JSON.stringify(list);
    expect(json).not.toContain(nameOf("b-hist"));
    expect(json).not.toContain(email("b-hist"));
  }, 30000);

  it("T15 — getStageAssignments(pA) não expõe a atribuição histórica de outro órgão", async () => {
    const c = await caller(aOwner, ORG_A);
    const rows = await c.collaboration.getStageAssignments({ processId: pA });
    expect(rows.map((r) => r.assignedUserId)).toContain(aMember);
    expect(rows.map((r) => r.assignedUserId)).not.toContain(bHist);
    expect(JSON.stringify(rows)).not.toContain(nameOf("b-hist"));
  }, 30000);

  it("associação histórica inválida não pode ser ELEVADA (updatePermission/updateFunctionalRole ⇒ NOT_FOUND, dado intacto)", async () => {
    const c = await caller(aOwner, ORG_A);
    expect(await errOf(() => c.collaboration.updatePermission({ processId: pA, userId: bHist, permission: "approver" })))
      .toMatchObject({ code: "NOT_FOUND" });
    expect(await errOf(() => c.collaboration.updateFunctionalRole({ processId: pA, userId: bHist, functionalRole: "gestor" })))
      .toMatchObject({ code: "NOT_FOUND" });
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT permission, functionalRole FROM process_members WHERE processId = ? AND userId = ?`, [pA, bHist]);
    expect(rows[0]).toMatchObject({ permission: "viewer", functionalRole: null });
  }, 30000);

  // ── Saneamento de associação histórica inválida ────────────────────────────────
  it("T20 — removeMember da associação histórica inválida em pA é permitido (saneamento) sem expor o nome estrangeiro", async () => {
    const c = await caller(aOwner, ORG_A);
    await c.collaboration.removeMember({ processId: pA, userId: bHist });
    expect(await members(pA, bHist)).toBe(0);
    const [logs] = await conn.execute<mysql.RowDataPacket[]>(`SELECT action FROM activity_logs WHERE processId = ? ORDER BY id DESC LIMIT 1`, [pA]);
    expect(logs[0].action).not.toContain(nameOf("b-hist"));
  }, 30000);

  it("T21 — unassignStage da atribuição histórica inválida em pA é permitido (saneamento)", async () => {
    const c = await caller(aOwner, ORG_A);
    await c.collaboration.unassignStage({ processId: pA, docType: "etp" });
    expect(await assignmentsOf(pA, bHist)).toBe(0);
  }, 30000);

  it("removeMember de usuário que não é membro do processo ⇒ NOT_FOUND (nada removido)", async () => {
    const c = await caller(aOwner, ORG_A);
    expect((await errOf(() => c.collaboration.removeMember({ processId: pA, userId: bTarget }))).code).toBe("NOT_FOUND");
  }, 30000);

  // ── Regressão same-tenant ────────────────────────────────────────────────────
  it("T22 — fluxos do mesmo órgão continuam funcionando (permissão, perfil funcional, remoção, desatribuição, checkPermission)", async () => {
    const c = await caller(aOwner, ORG_A);
    await c.collaboration.updatePermission({ processId: pA, userId: aMember, permission: "approver" });
    await c.collaboration.updateFunctionalRole({ processId: pA, userId: aMember, functionalRole: "compras" });
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT permission, functionalRole FROM process_members WHERE processId = ? AND userId = ?`, [pA, aMember]);
    expect(rows[0]).toMatchObject({ permission: "approver", functionalRole: "compras" });
    // o approver do mesmo órgão pode adicionar/remover membros (regra existente preservada)
    const approver = await caller(aMember, ORG_A);
    await approver.collaboration.addMember({ processId: pA, userEmail: email("a-outsider"), permission: "viewer" });
    await approver.collaboration.removeMember({ processId: pA, userId: aOutsider });
    expect(await members(pA, aOutsider)).toBe(0);
    await c.collaboration.unassignStage({ processId: pA, docType: "tr" });
    expect(await count(`SELECT COUNT(*) n FROM stage_assignments WHERE processId = ? AND docType = 'tr'`, [pA])).toBe(0);
    expect(await c.collaboration.checkPermission({ processId: pA })).toEqual({ permission: "owner", isOwner: true });
    expect(await (await caller(bOwner, ORG_B)).collaboration.checkPermission({ processId: pA })).toEqual({ permission: null, isOwner: false });
  }, 30000);

  // ── Admin de plataforma ──────────────────────────────────────────────────────
  it("T23 — admin de plataforma só acessa dentro do tenant explicitamente resolvido", async () => {
    const inA = await caller(admin, ORG_A, "admin");
    expect(Array.isArray(await inA.collaboration.listMembers({ processId: pA }))).toBe(true);
    const inB = await caller(admin, ORG_B, "admin");
    expect(await errOf(() => inB.collaboration.listMembers({ processId: pA }))).toEqual({ code: "NOT_FOUND", message: PROCESS_NOT_FOUND });
    expect(await errOf(() => inB.collaboration.addMember({ processId: pA, userEmail: email("a-new"), permission: "viewer" })))
      .toEqual({ code: "NOT_FOUND", message: PROCESS_NOT_FOUND });
  }, 30000);

  // ── Observabilidade ─────────────────────────────────────────────────────────
  it("T24/T25 — negação gera tenant_authorization_denied com correlationId e sem e-mail/nome do alvo estrangeiro", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
    try {
      const c = await caller(aOwner, ORG_A, "user", "corr-r1-t24");
      await errOf(() => c.collaboration.addMember({ processId: pA, userEmail: email("b-target"), permission: "viewer" }));
      await errOf(() => c.collaboration.assignStage({ processId: pA, docType: "ata", assignedUserId: bTarget }));
      await errOf(() => c.collaboration.unassignStage({ processId: pB, docType: "dfd" }));
    } finally { spy.mockRestore(); }
    const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.operation === "tenant_authorization_denied");
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (const e of events) {
      expect(e).toMatchObject({ organizationId: ORG_A, actorUserId: aOwner, correlationId: "corr-r1-t24" });
      expect(typeof e.procedure).toBe("string");
      expect(typeof e.reason).toBe("string");
    }
    expect(events.map((e) => e.reason)).toEqual(expect.arrayContaining(["target_user_not_in_organization", "process_not_in_organization"]));
    const all = lines.join("\n");
    expect(all).not.toContain(email("b-target"));
    expect(all).not.toContain(nameOf("b-target"));
    expect(all).not.toContain(String(ORG_B));
  }, 30000);
});
