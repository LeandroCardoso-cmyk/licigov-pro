/**
 * PR A.1 — Acesso institucional (convites, recuperação de senha, onboarding de tenants) —
 * smoke contra MySQL REAL. Só roda quando DATABASE_URL está definido (CI com serviço MySQL
 * efêmero); pulado localmente sem banco.
 *
 * Diferente dos testes unitários (db/services mockados), aqui a cadeia completa roda contra o
 * MySQL de verdade: transações (supersede de convite, aceite, redefinição de senha), a
 * constraint UNIQUE de `activeKey`, o outbox de e-mail e o dispatcher (com FakeEmailProvider —
 * nunca rede real — para capturar o TOKEN EM CLARO do e-mail "enviado", já que o banco só
 * guarda o hash e não há como recuperá-lo de outra forma).
 *
 * Cobre:
 *  1. onboarding → convite → aceite → membership + email_outbox (ciclo completo)
 *  2. aceite repetido (replay do link) → rejeitado
 *  3. supersede de convite é atômico — a constraint UNIQUE(activeKey) nunca é violada
 *  4. redefinição de senha: consome o token, incrementa tokenVersion, replay rejeitado
 *  5. proteção "último admin" contra a contagem real do banco
 *  6. isolamento cross-tenant (organização A não enxerga nem manipula dados da B)
 *
 * IDs de organização na faixa 950000+ (convenção do projeto para smoke tests, evita colidir
 * com dados reais). Nota: `claimPendingEmails` no dispatcher não filtra por organização (é um
 * componente de infraestrutura, não de domínio) — em um banco de CI efêmero e limpo isso não é
 * um problema; rodando localmente contra um MySQL com sobras de execuções anteriores, o
 * dispatcher poderia processar e-mails de outra origem também (inofensivo para este teste, que
 * filtra os e-mails capturados pelo destinatário exato).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 950101;
const ORG_B = 950102;
const ORG_C = 950103; // construída via SQL direto para o cenário de "último admin"

describe.skipIf(!DB)("PR A.1 — acesso institucional (MySQL real)", () => {
  let conn: mysql.Connection;
  let stamp: number;
  let platformAdminId: number;
  let ownerAId: number;
  let ownerBId: number;
  let adminCId: number;
  let onboardedOrgId: number;
  let onboardedInvitationId: number;
  let onboardedEmail: string;
  let onboardedUserId: number;
  let onboardedToken: string;
  let orgBInvitationId: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    stamp = Date.now();

    async function insertUser(tag: string, role: "user" | "admin" = "user"): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)`,
        [`invite-smoke-${tag}-${stamp}`, `Usuário ${tag}`, `invite-smoke-${tag}-${stamp}@teste.local`, role]
      );
      return r.insertId;
    }

    platformAdminId = await insertUser("platform-admin", "admin");
    ownerAId = await insertUser("owner-a");
    ownerBId = await insertUser("owner-b");
    adminCId = await insertUser("admin-c");

    async function insertOrg(id: number, nome: string): Promise<void> {
      await conn.execute(
        `INSERT INTO organizations (id, nome, slug, esfera, ativo) VALUES (?, ?, ?, 'municipal', 1)`,
        [id, nome, `${nome.toLowerCase().replace(/\s+/g, "-")}-${stamp}`]
      );
    }
    await insertOrg(ORG_A, `Org Smoke A ${stamp}`);
    await insertOrg(ORG_B, `Org Smoke B ${stamp}`);
    await insertOrg(ORG_C, `Org Smoke C ${stamp}`);

    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_A, ownerAId]);
    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_B, ownerBId]);
    // ORG_C: cenário sintético do teste de "último admin" — NENHUM owner, só 1 admin ativo.
    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'admin', 1)`, [ORG_C, adminCId]);
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, params: unknown[]) => { await conn.execute(sql, params).catch(() => {}); };
    const orgIds = [ORG_A, ORG_B, ORG_C, onboardedOrgId].filter((v): v is number => typeof v === "number");
    await del(`DELETE FROM email_outbox WHERE organizationId IN (${orgIds.map(() => "?").join(",")})`, orgIds);
    await del(`DELETE FROM password_reset_tokens WHERE userId IN (?, ?)`, [onboardedUserId ?? 0, platformAdminId]);
    await del(`DELETE FROM institutional_invitations WHERE organizationId IN (${orgIds.map(() => "?").join(",")})`, orgIds);
    await del(`DELETE FROM organization_members WHERE organizationId IN (${orgIds.map(() => "?").join(",")})`, orgIds);
    if (onboardedOrgId) await del(`DELETE FROM organizations WHERE id = ?`, [onboardedOrgId]);
    await del(`DELETE FROM organizations WHERE id IN (?, ?, ?)`, [ORG_A, ORG_B, ORG_C]);
    const userIds = [platformAdminId, ownerAId, ownerBId, adminCId, onboardedUserId].filter((v): v is number => typeof v === "number");
    await del(`DELETE FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`, userIds);
    await conn.end();
  });

  async function makeCaller(userId: number | null, role: "user" | "admin" = "user") {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: userId === null ? null : ({ id: userId, role, name: `Usuário ${userId}`, email: `invite-smoke-${userId}@teste.local` } as never),
      req: { headers: {}, ip: undefined } as never,
      res: {} as never,
      correlationId: `test-invite-smoke-${userId ?? "anon"}`,
    } as never);
  }

  async function withFakeEmailAndDispatch(): Promise<{
    extractTokenFor: (recipientEmail: string) => Promise<string>;
  }> {
    const { setDispatcherProviderForTests, processOnce } = await import("../../services/email/emailDispatcher");
    const { FakeEmailProvider } = await import("../../services/email/fakeProvider");
    const fake = new FakeEmailProvider();
    setDispatcherProviderForTests(fake);

    return {
      extractTokenFor: async (recipientEmail: string) => {
        await processOnce();
        const sent = fake.sent.filter(s => s.to.toLowerCase() === recipientEmail.toLowerCase());
        const last = sent[sent.length - 1];
        if (!last) throw new Error(`Nenhum e-mail capturado para ${recipientEmail} — outbox não processado?`);
        const match = last.html.match(/token=([A-Za-z0-9_-]+)/);
        if (!match) throw new Error("Token não encontrado no corpo do e-mail capturado.");
        return match[1];
      },
    };
  }

  // ─── 1/2. Onboarding → convite → aceite → membership + email_outbox; replay rejeitado ───────

  it("onboarding cria a organização + convite de owner + linha no email_outbox", async () => {
    const platformAdmin = await makeCaller(platformAdminId, "admin");
    onboardedEmail = `invite-smoke-onboarded-${stamp}@teste.local`;

    const result = await platformAdmin.tenantOnboarding.create({
      nome: `Org Onboarding Smoke ${stamp}`,
      slug: `org-onboarding-smoke-${stamp}`,
      esfera: "municipal",
      firstAdminName: "Primeira Administradora",
      firstAdminEmail: onboardedEmail,
    });

    onboardedOrgId = result.organizationId;
    onboardedInvitationId = result.invitationId;
    expect(result.alreadyExisted).toBe(false);

    const [outboxRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT status, templateKey, recipient FROM email_outbox WHERE organizationId = ?`,
      [onboardedOrgId]
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].templateKey).toBe("invitation");
    expect(outboxRows[0].status).toBe("pending");

    const [invitationRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT role, status, activeKey FROM institutional_invitations WHERE id = ?`,
      [onboardedInvitationId]
    );
    expect(invitationRows[0].role).toBe("owner");
    expect(invitationRows[0].status).toBe("pending");
    expect(invitationRows[0].activeKey).toBe(`${onboardedOrgId}:${onboardedEmail}`);
  }, 30_000);

  it("aceite (conta nova): valida o token, cria user+membership, marca o convite aceito", async () => {
    const { extractTokenFor } = await withFakeEmailAndDispatch();
    onboardedToken = await extractTokenFor(onboardedEmail);

    const [outboxAfter] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT status FROM email_outbox WHERE organizationId = ?`,
      [onboardedOrgId]
    );
    expect(outboxAfter[0].status).toBe("sent");

    const publicCaller = await makeCaller(null);
    const validated = await publicCaller.invitations.validateToken({ token: onboardedToken });
    expect(validated).toMatchObject({ valid: true, role: "owner", emailNormalized: onboardedEmail });

    const acceptResult = await publicCaller.invitations.accept({
      token: onboardedToken,
      name: "Primeira Administradora",
      password: "senhaSmokeForte123",
    });
    expect(acceptResult.success).toBe(true);
    expect(acceptResult.organizationId).toBe(onboardedOrgId);

    const [userRows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT id, tokenVersion FROM users WHERE email = ?`, [onboardedEmail]);
    expect(userRows).toHaveLength(1);
    onboardedUserId = userRows[0].id;
    expect(userRows[0].tokenVersion).toBe(0);

    const [memberRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT role, ativo FROM organization_members WHERE organizationId = ? AND userId = ?`,
      [onboardedOrgId, onboardedUserId]
    );
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0].role).toBe("owner");
    expect(Boolean(memberRows[0].ativo)).toBe(true);

    const [invitationAfter] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT status, acceptedByUserId, activeKey FROM institutional_invitations WHERE id = ?`,
      [onboardedInvitationId]
    );
    expect(invitationAfter[0].status).toBe("accepted");
    expect(invitationAfter[0].acceptedByUserId).toBe(onboardedUserId);
    expect(invitationAfter[0].activeKey).toBeNull();
  }, 30_000);

  it("aceite repetido (replay do link) é rejeitado — convite já 'accepted'", async () => {
    const publicCaller = await makeCaller(null);
    await expect(
      publicCaller.invitations.accept({ token: onboardedToken, name: "Outro Nome", password: "outraSenhaForte123" })
    ).rejects.toThrow();

    const [userRows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM users WHERE email = ?`, [onboardedEmail]);
    expect(Number((userRows[0] as { cnt: number }).cnt)).toBe(1); // nenhuma 2ª conta foi criada
  }, 30_000);

  // ─── 3. Supersede de convite é atômico — UNIQUE(activeKey) nunca é violada ─────────────────

  it("2 convites seguidos para o mesmo org+e-mail: o 1º é superseded, só o 2º fica pending", async () => {
    const ownerA = await makeCaller(ownerAId);
    const targetEmail = `invite-smoke-supersede-${stamp}@teste.local`;

    const first = await ownerA.invitations.create({ email: targetEmail, role: "operator" });
    const second = await ownerA.invitations.create({ email: targetEmail, role: "manager" });
    expect(first.id).not.toBe(second.id);

    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, status, role, activeKey FROM institutional_invitations WHERE organizationId = ? AND emailNormalized = ? ORDER BY id ASC`,
      [ORG_A, targetEmail]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("superseded");
    expect(rows[0].activeKey).toBeNull();
    expect(rows[1].status).toBe("pending");
    expect(rows[1].role).toBe("manager");
    expect(rows[1].activeKey).toBe(`${ORG_A}:${targetEmail}`);

    // A constraint UNIQUE(activeKey) permite exatamente 1 não-nulo para este org+e-mail —
    // se o supersede não fosse atômico, o 2º insert teria falhado com ER_DUP_ENTRY.
    const nonNullActiveKeys = rows.filter(r => r.activeKey !== null);
    expect(nonNullActiveKeys).toHaveLength(1);
  }, 30_000);

  // ─── 4. Redefinição de senha: consome o token, bumpa tokenVersion, replay rejeitado ────────

  it("redefinição de senha: consome o token, incrementa tokenVersion; reuso do token é rejeitado", async () => {
    const { extractTokenFor } = await withFakeEmailAndDispatch();

    const publicCaller = await makeCaller(null);
    await publicCaller.passwordReset.request({ email: onboardedEmail });

    const resetToken = await extractTokenFor(onboardedEmail);

    const [before] = await conn.execute<mysql.RowDataPacket[]>(`SELECT tokenVersion FROM users WHERE id = ?`, [onboardedUserId]);
    expect(before[0].tokenVersion).toBe(0);

    await publicCaller.passwordReset.complete({ token: resetToken, newPassword: "outraSenhaSmokeForte456" });

    const [after] = await conn.execute<mysql.RowDataPacket[]>(`SELECT tokenVersion FROM users WHERE id = ?`, [onboardedUserId]);
    expect(after[0].tokenVersion).toBe(1);

    const [tokenRow] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT consumedAt FROM password_reset_tokens WHERE userId = ? ORDER BY id DESC LIMIT 1`,
      [onboardedUserId]
    );
    expect(tokenRow[0].consumedAt).not.toBeNull();

    await expect(
      publicCaller.passwordReset.complete({ token: resetToken, newPassword: "terceiraSenhaSmoke789" })
    ).rejects.toThrow();

    const [stillOne] = await conn.execute<mysql.RowDataPacket[]>(`SELECT tokenVersion FROM users WHERE id = ?`, [onboardedUserId]);
    expect(stillOne[0].tokenVersion).toBe(1); // replay não incrementou de novo
  }, 30_000);

  // ─── 5. Proteção "último admin" contra a contagem real do banco ────────────────────────────

  it("último admin ativo (sem owner na organização) não pode se autorrebaixar", async () => {
    const adminC = await makeCaller(adminCId);
    await expect(adminC.organizations.updateMemberRole({ userId: adminCId, role: "operator" })).rejects.toMatchObject({
      message: "LAST_TENANT_ADMIN",
    });

    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT role FROM organization_members WHERE organizationId = ? AND userId = ?`,
      [ORG_C, adminCId]
    );
    expect(rows[0].role).toBe("admin"); // inalterado
  }, 30_000);

  // ─── 6. Isolamento cross-tenant (A nunca enxerga nem manipula dados da B) ──────────────────

  it("owner da organização A não consegue reenviar/cancelar convite da organização B", async () => {
    const ownerB = await makeCaller(ownerBId);
    const invitationB = await ownerB.invitations.create({ email: `invite-smoke-orgb-${stamp}@teste.local`, role: "operator" });
    orgBInvitationId = invitationB.id;

    const ownerA = await makeCaller(ownerAId);
    await expect(ownerA.invitations.resend({ invitationId: orgBInvitationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerA.invitations.cancel({ invitationId: orgBInvitationId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const [stillPending] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT status FROM institutional_invitations WHERE id = ?`,
      [orgBInvitationId]
    );
    expect(stillPending[0].status).toBe("pending"); // não foi cancelado pela org errada
  }, 30_000);

  it("listAllMembersWithUsers da organização A nunca inclui membros da organização B", async () => {
    const ownerA = await makeCaller(ownerAId);
    const members = await ownerA.organizations.listAllMembersWithUsers();
    expect(members.some(m => m.userId === ownerBId)).toBe(false);
    expect(members.some(m => m.userId === ownerAId)).toBe(true);
  }, 30_000);
});
