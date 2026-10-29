/**
 * SECURITY-02 — BOOTSTRAP da primeira autoridade institucional (convite `owner`) contra MySQL REAL.
 *
 * Contrato verificado (concorrência REAL: dois aceites em conexões distintas do pool):
 *  - o convite `owner` só concede a primeira autoridade com EVIDÊNCIA verificável do onboarding de tenant:
 *    emitido por admin de plataforma (users.role='admin') e com o registro `tenant.onboarded` do órgão para o
 *    MESMO e-mail; convite `owner` legado sem essa evidência NÃO é presumido bootstrap;
 *  - "órgão sem membros ativos" é verificado SOB TRAVA da organização, dentro da transação do aceite: dois aceites
 *    concorrentes de convites `owner` do mesmo órgão resultam em exatamente UM titular;
 *  - o onboarding existente (onboardTenant → e-mail → aceite) continua funcionando.
 * Organizações sintéticas 9562xx; nada toca a organização 1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_RACE = 956201;
const ORG_LEGACY = 956202;
const ORG_NONADMIN = 956203;
const SLUG_ONBOARD = "s02-bootstrap-onboard";

describe.skipIf(!DB)("SECURITY-02 — bootstrap owner: evidência + serialização (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  const users: Record<string, { id: number; email: string }> = {};
  const orgs: number[] = [ORG_RACE, ORG_LEGACY, ORG_NONADMIN];
  let onboardedOrg = 0;

  let svc: typeof import("../../services/invitationService");
  let tokens: typeof import("../../services/security/opaqueTokens");
  let inv: typeof import("../../domain/invitations");

  async function insertUser(tag: string, role: "user" | "admin" = "user") {
    const email = `s02-boot-${tag}-${stamp}@teste.local`;
    const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)", [`s02-boot-${tag}-${stamp}`, `S02 ${tag}`, email, role]);
    users[tag] = { id: r.insertId, email };
  }

  /** Convite `owner` pendente gravado DIRETO no banco (cenário "legado"); devolve o token em claro. */
  async function insertOwnerInvitation(org: number, email: string, createdBy: number): Promise<string> {
    const token = tokens.generateOpaqueToken();
    await conn.execute(
      "INSERT INTO institutional_invitations (organizationId, emailNormalized, role, status, tokenHash, activeKey, invitedName, expiresAt, createdByUserId, resendCount) VALUES (?, ?, 'owner', 'pending', ?, ?, 'S02', ?, ?, 0)",
      [org, email, tokens.hashOpaqueToken(token), inv.computeInvitationActiveKey(org, email, "pending"), inv.computeInvitationExpiresAt(new Date()), createdBy],
    );
    return token;
  }

  /** Registro de onboarding (o mesmo que `onboardTenant` grava) para o órgão + e-mail. */
  async function insertOnboardedEvidence(org: number, actor: number, email: string): Promise<void> {
    await conn.execute("INSERT INTO activity_logs (organizationId, userId, action, entityType, entityId, details) VALUES (?, ?, 'tenant.onboarded', 'organization', ?, ?)",
      [org, actor, org, JSON.stringify({ slug: `s02-${org}`, firstAdminEmail: email })]);
  }

  const owners = async (org: number) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>("SELECT userId FROM organization_members WHERE organizationId = ? AND ativo = 1", [org]);
    return rows.map((r) => Number(r.userId));
  };
  const settle = async (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string; message?: string }) => `${e.code}:${e.message}`);

  async function cleanup() {
    const all = onboardedOrg ? [...orgs, onboardedOrg] : orgs;
    const q = all.join(",");
    for (const sql of [
      `DELETE FROM organization_members WHERE organizationId IN (${q})`,
      `DELETE FROM institutional_invitations WHERE organizationId IN (${q})`,
      `DELETE FROM activity_logs WHERE organizationId IN (${q})`,
      `DELETE FROM email_outbox WHERE organizationId IN (${q})`,
      `DELETE FROM organizations WHERE id IN (${q})`,
    ]) await conn.query(sql).catch(() => {});
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    svc = await import("../../services/invitationService");
    tokens = await import("../../services/security/opaqueTokens");
    inv = await import("../../domain/invitations");
    const [prev] = await conn.execute<mysql.RowDataPacket[]>("SELECT id FROM organizations WHERE slug = ?", [SLUG_ONBOARD]);
    if (prev[0]) onboardedOrg = Number(prev[0].id);
    await cleanup();
    for (const org of orgs) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, esfera, ativo) VALUES (?, ?, ?, 'municipal', 1)", [org, `S02 Bootstrap ${org}`, `s02-boot-${org}-${stamp}`]);
    }
    await insertUser("platform", "admin");
    await insertUser("comum");
    for (const t of ["a", "b", "legacy", "nonadmin", "first", "late"]) await insertUser(t);
  }, 120_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup();
    const ids = Object.values(users).map((u) => u.id);
    if (ids.length) await conn.query(`DELETE FROM users WHERE id IN (${ids.join(",")})`).catch(() => {});
    await conn.end();
  });

  it("CONCORRÊNCIA: dois aceites simultâneos de convites `owner` do MESMO órgão vazio ⇒ exatamente UM titular", async () => {
    const ta = await insertOwnerInvitation(ORG_RACE, users.a.email, users.platform.id);
    const tb = await insertOwnerInvitation(ORG_RACE, users.b.email, users.platform.id);
    await insertOnboardedEvidence(ORG_RACE, users.platform.id, users.a.email);
    await insertOnboardedEvidence(ORG_RACE, users.platform.id, users.b.email);
    const results = await Promise.all([
      settle(svc.acceptExistingInvitation({ token: ta, userId: users.a.id, userEmail: users.a.email, correlationId: "s02-race-a" })),
      settle(svc.acceptExistingInvitation({ token: tb, userId: users.b.id, userEmail: users.b.email, correlationId: "s02-race-b" })),
    ]);
    expect(results.filter((r) => r === "ok"), JSON.stringify(results)).toHaveLength(1);
    expect(results.find((r) => r !== "ok")).toMatch(/^FORBIDDEN:.*INVITATION_GRANT_AUTHORITY_REQUIRED/);
    expect(await owners(ORG_RACE)).toHaveLength(1);
  }, 60_000);

  it("convite `owner` LEGADO sem evidência de onboarding não é presumido bootstrap (sem vínculo)", async () => {
    const t = await insertOwnerInvitation(ORG_LEGACY, users.legacy.email, users.platform.id);
    expect(await settle(svc.acceptExistingInvitation({ token: t, userId: users.legacy.id, userEmail: users.legacy.email })))
      .toMatch(/^FORBIDDEN:.*INVITATION_GRANT_AUTHORITY_REQUIRED/);
    expect(await owners(ORG_LEGACY)).toEqual([]);
  });

  it("convite `owner` emitido por quem NÃO é admin de plataforma não concede autoridade, mesmo com registro de onboarding", async () => {
    const t = await insertOwnerInvitation(ORG_NONADMIN, users.nonadmin.email, users.comum.id);
    await insertOnboardedEvidence(ORG_NONADMIN, users.comum.id, users.nonadmin.email);
    expect(await settle(svc.acceptExistingInvitation({ token: t, userId: users.nonadmin.id, userEmail: users.nonadmin.email })))
      .toMatch(/^FORBIDDEN:.*INVITATION_GRANT_AUTHORITY_REQUIRED/);
    expect(await owners(ORG_NONADMIN)).toEqual([]);
  });

  it("ONBOARDING legítimo continua funcionando: onboardTenant → e-mail → aceite cria o 1º titular; depois o órgão não aceita outro bootstrap", async () => {
    const { onboardTenant } = await import("../../services/tenantOnboardingService");
    const res = await onboardTenant({
      nome: `S02 Bootstrap Onboard ${stamp}`, slug: SLUG_ONBOARD, esfera: "municipal",
      firstAdminName: "Primeira Autoridade", firstAdminEmail: users.first.email, actorUserId: users.platform.id, correlationId: "s02-onboard",
    });
    onboardedOrg = res.organizationId;
    const [rows] = await conn.execute<mysql.RowDataPacket[]>("SELECT payload FROM email_outbox WHERE organizationId = ? AND recipient = ? ORDER BY id DESC LIMIT 1", [onboardedOrg, users.first.email]);
    const payload = (typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload) as { acceptUrl: string };
    const token = decodeURIComponent(/[?&]token=([^&]+)/.exec(payload.acceptUrl)![1]);
    await expect(svc.acceptExistingInvitation({ token, userId: users.first.id, userEmail: users.first.email, correlationId: "s02-onboard-accept" }))
      .resolves.toEqual({ organizationId: onboardedOrg });
    const [m] = await conn.execute<mysql.RowDataPacket[]>("SELECT role FROM organization_members WHERE organizationId = ? AND userId = ? AND ativo = 1", [onboardedOrg, users.first.id]);
    expect(m[0]?.role).toBe("owner");
    // um segundo convite owner (mesmo com evidência para o e-mail) não concede mais nada: o órgão já tem autoridade
    const t2 = await insertOwnerInvitation(onboardedOrg, users.late.email, users.platform.id);
    await insertOnboardedEvidence(onboardedOrg, users.platform.id, users.late.email);
    expect(await settle(svc.acceptExistingInvitation({ token: t2, userId: users.late.id, userEmail: users.late.email })))
      .toMatch(/^FORBIDDEN:/);
    expect(await owners(onboardedOrg)).toEqual([users.first.id]);
  }, 60_000);
});
