/**
 * PR A.1 — Convite institucional: único caminho de entrada de um servidor no sistema (não há
 * cadastro público). Estados/regras puras vivem em domain/invitations.ts; este service faz a
 * orquestração com I/O (banco, e-mail, sessão).
 *
 * Segurança: o token opaco NUNCA é persistido em claro (só o hash) — por isso "reenviar" um
 * convite não pode reaproveitar o token antigo; `resendInvitation` gera um token NOVO,
 * supersedendo o anterior (o link antigo para de funcionar). Isso é estritamente mais seguro que
 * reenviar o mesmo link, e tecnicamente a única opção possível (não há como recuperar o texto
 * claro a partir do hash).
 */

import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { getDb } from "../db/connection";
import { activityLogs, institutionalInvitations, organizationMembers, organizations, users, type InstitutionalInvitation, type OrgRole } from "../../drizzle/schema";
import { getUserByEmail } from "../db/users";
import { getMembersOfOrg, getOrganizationById } from "../db/organizations";
import { hashPassword } from "./passwordSecurity";
import { generateOpaqueToken, hashOpaqueToken, isPlausibleOpaqueToken } from "./security/opaqueTokens";
import { validatePassword } from "../domain/passwordPolicy";
import {
  normalizeInvitationEmail,
  computeInvitationExpiresAt,
  computeInvitationActiveKey,
  canResendInvitation,
  canCancelInvitation,
  bumpResendMetadata,
  checkInvitationAcceptEligibility,
  effectiveInvitationStatus,
  type InvitationAcceptRejectionReason,
} from "../domain/invitations";
import { enqueueEmail } from "./email/emailOutboxService";
import { kick as kickEmailDispatcher } from "./email/emailDispatcher";
import { EMAIL_CONFIG } from "../config/email";
import { logActivity } from "./activityLogService";
import { serviceLogger } from "./observabilityService";
import { requireInstitutionalAuthority, type AuthorityExecutor } from "./institutionalAuthorityService";
import { SELF_GRANT_MESSAGE } from "../domain/institutionalAuthority";
import {
  INVITATION_NOT_FOUND,
  INVITATION_EXPIRED,
  INVITATION_CANCELLED,
  INVITATION_ALREADY_ACCEPTED,
  INVITATION_EMAIL_MISMATCH,
  MEMBER_ALREADY_EXISTS,
} from "../domain/authErrors";

const log = serviceLogger("InvitationService");

/** MySQL "duplicate entry" — usado para traduzir corridas raras em erro de negócio limpo. */
function isDuplicateEntryError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ER_DUP_ENTRY";
}

function mapAcceptRejection(reason: InvitationAcceptRejectionReason): TRPCError {
  switch (reason) {
    case "NOT_FOUND": return new TRPCError({ code: "NOT_FOUND", message: INVITATION_NOT_FOUND });
    case "EXPIRED": return new TRPCError({ code: "BAD_REQUEST", message: INVITATION_EXPIRED });
    case "CANCELLED": return new TRPCError({ code: "BAD_REQUEST", message: INVITATION_CANCELLED });
    case "ALREADY_ACCEPTED": return new TRPCError({ code: "CONFLICT", message: INVITATION_ALREADY_ACCEPTED });
    case "EMAIL_MISMATCH": return new TRPCError({ code: "FORBIDDEN", message: INVITATION_EMAIL_MISMATCH });
  }
}

// ─── create ───────────────────────────────────────────────────────────────────

export interface CreateInvitationInput {
  organizationId: number;
  email: string;
  role: OrgRole;
  invitedName?: string;
  createdByUserId: number;
  correlationId?: string;
  /**
   * SECURITY-02 — SÓ o onboarding de tenant (`tenantOnboardingService`) informa: convite `owner` da PRIMEIRA autoridade de
   * um órgão sem nenhum membro ativo. Fora disso, todo convite exige autoridade REAL (admin+) de quem convida.
   */
  bootstrap?: "tenant_onboarding";
}

/** SECURITY-02 — códigos estáveis (não traduzir) das recusas de concessão de vínculo. */
export { SELF_GRANT_FORBIDDEN } from "../domain/institutionalAuthority";
export const INVITATION_GRANT_AUTHORITY_REQUIRED = "INVITATION_GRANT_AUTHORITY_REQUIRED";
const GRANT_AUTHORITY_MESSAGE =
  `Este convite não é mais válido: quem o emitiu não possui (ou não possui mais) vínculo ativo de administrador no órgão. Solicite um novo convite a um administrador da organização (${INVITATION_GRANT_AUTHORITY_REQUIRED}).`;

/** Órgão sem nenhum membro ativo — única situação em que o convite `owner` de bootstrap (onboarding) é legítimo. */
async function organizationHasNoActiveMembers(organizationId: number): Promise<boolean> {
  // Fail-closed: sem banco, `getMembersOfOrg` devolveria [] e o bootstrap pareceria legítimo.
  if (!(await getDb())) return false;
  return (await getMembersOfOrg(organizationId)).length === 0;
}

/** Ação do activity log gravada pelo onboarding de tenant — a EVIDÊNCIA verificável do bootstrap da 1ª autoridade. */
const TENANT_ONBOARDED_ACTION = "tenant.onboarded";

/**
 * SECURITY-02 — EVIDÊNCIA do bootstrap: o convite `owner` só concede a 1ª autoridade se (a) quem o emitiu é admin de plataforma
 * (`users.role = 'admin'`, o único que executa o onboarding) e (b) existe o registro `tenant.onboarded` DO MESMO órgão para o MESMO
 * e-mail (gravado por `onboardTenant`). Convite `owner` legado/gravado por outra via NÃO é presumido bootstrap. Fail-closed.
 */
async function bootstrapEvidenceHolds(
  executor: AuthorityExecutor, p: { organizationId: number; grantorUserId: number | null; emailNormalized: string },
): Promise<boolean> {
  if (p.grantorUserId == null) return false;
  try {
    const grantor = await executor.select({ role: users.role }).from(users).where(eq(users.id, p.grantorUserId)).limit(1);
    if (grantor[0]?.role !== "admin") return false;
    const logs = await executor.select({ details: activityLogs.details }).from(activityLogs)
      .where(and(eq(activityLogs.organizationId, p.organizationId), eq(activityLogs.action, TENANT_ONBOARDED_ACTION)));
    return logs.some((l) => {
      try {
        const email = (JSON.parse(l.details ?? "{}") as { firstAdminEmail?: unknown }).firstAdminEmail;
        return typeof email === "string" && normalizeInvitationEmail(email) === p.emailNormalized;
      } catch { return false; }
    });
  } catch {
    return false;
  }
}

/**
 * SECURITY-02 — bootstrap `owner` SERIALIZADO: trava a organização (FOR UPDATE) e, sob a trava, exige órgão sem nenhum membro ativo
 * (leitura travada) e a evidência do onboarding. Dois aceites concorrentes de convites `owner` do mesmo órgão se serializam na trava
 * da organização: o segundo vê o titular já criado e é recusado.
 */
async function assertBootstrapUnderLock(tx: AuthorityExecutor, row: InstitutionalInvitation, correlationId?: string): Promise<void> {
  const deny = (reason: string): never => {
    log.warn("invitation_accept_denied", { organizationId: row.organizationId, invitationId: row.id, reason, correlationId });
    throw new TRPCError({ code: "FORBIDDEN", message: GRANT_AUTHORITY_MESSAGE });
  };
  const org = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, row.organizationId)).limit(1).for("update");
  if (!org[0]) deny("bootstrap_organization_missing");
  const active = await tx.select({ id: organizationMembers.id }).from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, row.organizationId), eq(organizationMembers.ativo, true))).limit(1).for("share");
  if (active.length > 0) deny("bootstrap_organization_not_empty");
  if (!(await bootstrapEvidenceHolds(tx, { organizationId: row.organizationId, grantorUserId: row.createdByUserId, emailNormalized: row.emailNormalized }))) {
    deny("bootstrap_evidence_missing");
  }
}

/**
 * SECURITY-02 — releitura DENTRO da transação do aceite: o emissor do convite (não-bootstrap) precisa continuar admin real até o
 * commit (FOR SHARE); o convite `owner` (bootstrap) é revalidado sob a trava da organização com a evidência do onboarding.
 */
async function reassertGrantorInTx(tx: AuthorityExecutor, row: InstitutionalInvitation, correlationId?: string): Promise<void> {
  if (row.role === "owner") {
    await assertBootstrapUnderLock(tx, row, correlationId);
    return;
  }
  try {
    await requireInstitutionalAuthority({
      userId: row.createdByUserId!, organizationId: row.organizationId, minRole: "admin", operation: "invitation.accept", correlationId, executor: tx,
    });
  } catch {
    throw new TRPCError({ code: "FORBIDDEN", message: GRANT_AUTHORITY_MESSAGE });
  }
}

/**
 * SECURITY-02 — quem CONCEDE vínculo no órgão precisa ser autoridade REAL dele (membership persistida e ativa, admin+).
 * O admin de plataforma (projeção sintética `owner`) não concede autoridade municipal — nem a si, nem a terceiros.
 * Exceção única e estreita: convite `owner` de bootstrap para órgão SEM membros ativos (onboarding).
 */
async function assertGrantAuthority(p: {
  organizationId: number; grantorUserId: number; role: OrgRole; operation: string; correlationId?: string | null;
  /**
   * Bootstrap `owner`: `false` (proibido); `"onboarding"` (criação pelo onboarding de um órgão recém-criado — a evidência é gravada
   * logo em seguida); `{ emailNormalized }` (reenvio/aceite: exige a EVIDÊNCIA verificável do onboarding para esse e-mail).
   */
  bootstrap: false | "onboarding" | { emailNormalized: string };
}): Promise<void> {
  if (p.role === "owner") {
    const allowed = p.bootstrap !== false && await organizationHasNoActiveMembers(p.organizationId) && (
      p.bootstrap === "onboarding"
      || await (async () => { const db = await getDb(); return !!db && bootstrapEvidenceHolds(db, { organizationId: p.organizationId, grantorUserId: p.grantorUserId, emailNormalized: (p.bootstrap as { emailNormalized: string }).emailNormalized }); })()
    );
    if (allowed) return;
    log.warn("invitation_grant_denied", { organizationId: p.organizationId, actorUserId: p.grantorUserId, operation: p.operation, reason: "owner_outside_bootstrap", correlationId: p.correlationId ?? undefined });
    throw new TRPCError({ code: "FORBIDDEN", message: GRANT_AUTHORITY_MESSAGE });
  }
  await requireInstitutionalAuthority({
    userId: p.grantorUserId, organizationId: p.organizationId, minRole: "admin", operation: p.operation, correlationId: p.correlationId,
  });
}

/** No ACEITE: o convite só vale se quem o emitiu AINDA é autoridade real (ou é o bootstrap `owner` de órgão vazio). */
async function assertInvitationStillGranted(row: InstitutionalInvitation, acceptingUserId: number | null, correlationId?: string): Promise<void> {
  if (acceptingUserId !== null && acceptingUserId === row.createdByUserId) {
    log.warn("invitation_accept_denied", { organizationId: row.organizationId, invitationId: row.id, reason: "self_grant", correlationId });
    throw new TRPCError({ code: "FORBIDDEN", message: SELF_GRANT_MESSAGE });
  }
  try {
    if (row.createdByUserId == null) throw new Error("grantor_unknown");
    await assertGrantAuthority({
      organizationId: row.organizationId, grantorUserId: row.createdByUserId, role: row.role, operation: "invitation.accept",
      correlationId, bootstrap: { emailNormalized: row.emailNormalized },
    });
  } catch {
    log.warn("invitation_accept_denied", { organizationId: row.organizationId, invitationId: row.id, reason: "grantor_without_authority", correlationId });
    throw new TRPCError({ code: "FORBIDDEN", message: GRANT_AUTHORITY_MESSAGE });
  }
}

/**
 * Cria um convite novo. Se já existir um convite `pending` para o mesmo org+e-mail, ele é
 * SUPERSEDIDO (não editado) — atomicamente, na mesma transação que insere o novo, para nunca
 * haver 2 pendentes ao mesmo tempo (a garantia de banco é `activeKey` UNIQUE).
 */
export async function createInvitation(input: CreateInvitationInput): Promise<InstitutionalInvitation> {
  const emailNormalized = normalizeInvitationEmail(input.email);

  const targetUser = await getUserByEmail(emailNormalized);
  // SECURITY-02 — autoconvite nunca (inclusive no onboarding) e concessão só por autoridade real do órgão, ANTES de qualquer escrita.
  if (targetUser && targetUser.id === input.createdByUserId) {
    log.warn("invitation_grant_denied", { organizationId: input.organizationId, actorUserId: input.createdByUserId, reason: "self_grant", correlationId: input.correlationId });
    throw new TRPCError({ code: "FORBIDDEN", message: SELF_GRANT_MESSAGE });
  }
  await assertGrantAuthority({
    organizationId: input.organizationId, grantorUserId: input.createdByUserId, role: input.role, operation: "invitation.create",
    correlationId: input.correlationId, bootstrap: input.bootstrap === "tenant_onboarding" ? "onboarding" : false,
  });
  if (targetUser) {
    const activeMembers = await getMembersOfOrg(input.organizationId);
    if (activeMembers.some(m => m.userId === targetUser.id)) {
      throw new TRPCError({ code: "CONFLICT", message: MEMBER_ALREADY_EXISTS });
    }
  }

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Serviço de convites indisponível." });

  const org = await getOrganizationById(input.organizationId);
  const organizationName = org?.nome ?? "sua organização";

  const token = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const createdAt = new Date();
  const expiresAt = computeInvitationExpiresAt(createdAt);
  const activeKey = computeInvitationActiveKey(input.organizationId, emailNormalized, "pending");

  let invitationId!: number;
  try {
    await db.transaction(async tx => {
      await tx
        .update(institutionalInvitations)
        .set({ status: "superseded", activeKey: null })
        .where(
          and(
            eq(institutionalInvitations.organizationId, input.organizationId),
            eq(institutionalInvitations.emailNormalized, emailNormalized),
            eq(institutionalInvitations.status, "pending")
          )
        );

      const [result] = await tx.insert(institutionalInvitations).values({
        organizationId: input.organizationId,
        emailNormalized,
        role: input.role,
        status: "pending",
        tokenHash,
        activeKey,
        invitedName: input.invitedName ?? null,
        expiresAt,
        createdByUserId: input.createdByUserId,
        correlationId: input.correlationId ?? null,
      });
      invitationId = (result as { insertId: number }).insertId;

      await enqueueEmail(
        {
          organizationId: input.organizationId,
          messageType: "invitation",
          recipient: emailNormalized,
          templateKey: "invitation",
          payload: {
            organizationName,
            inviterName: "Um administrador do LiciGov Pro",
            role: input.role,
            acceptUrl: `${EMAIL_CONFIG.appBaseUrl}/convite?token=${token}`,
            expiresAt: expiresAt.toISOString(),
            recipientName: input.invitedName,
          },
          idempotencyKey: `invitation:${tokenHash}`,
          correlationId: input.correlationId,
        },
        tx
      );
    });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      throw new TRPCError({ code: "CONFLICT", message: "Já existe um convite sendo processado para este e-mail. Tente novamente em instantes." });
    }
    throw err;
  }

  kickEmailDispatcher();

  await logActivity({
    userId: input.createdByUserId,
    organizationId: input.organizationId,
    action: "invitation.created",
    entityType: "invitation",
    entityId: invitationId,
    correlationId: input.correlationId,
    details: { email: emailNormalized, role: input.role },
  });

  log.info("invitation_created", { organizationId: input.organizationId, invitationId, correlationId: input.correlationId });

  const rows = await db.select().from(institutionalInvitations).where(eq(institutionalInvitations.id, invitationId)).limit(1);
  return rows[0];
}

// ─── list ───────────────────────────────────────────────────────────────────

export async function listInvitations(organizationId: number): Promise<InstitutionalInvitation[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(institutionalInvitations).where(eq(institutionalInvitations.organizationId, organizationId));
}

// ─── resend ───────────────────────────────────────────────────────────────────

export interface ResendInvitationInput {
  invitationId: number;
  organizationId: number;
  actorUserId: number;
  correlationId?: string;
}

/**
 * Reenvia — na prática, EMITE UM NOVO TOKEN (o antigo nunca pode ser recuperado do hash) e
 * supersede o convite anterior, preservando `resendCount` acumulado para a UI mostrar histórico.
 */
export async function resendInvitation(input: ResendInvitationInput): Promise<InstitutionalInvitation> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Serviço de convites indisponível." });

  const rows = await db
    .select()
    .from(institutionalInvitations)
    .where(and(eq(institutionalInvitations.id, input.invitationId), eq(institutionalInvitations.organizationId, input.organizationId)))
    .limit(1);
  const current = rows[0];
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: INVITATION_NOT_FOUND });

  const now = new Date();
  if (!canResendInvitation(current.status, current.expiresAt, now)) {
    const effective = effectiveInvitationStatus(current.status, current.expiresAt, now);
    throw mapAcceptRejection(
      effective === "expired" ? "EXPIRED" : effective === "accepted" ? "ALREADY_ACCEPTED" : "CANCELLED"
    );
  }

  // SECURITY-02 — reenviar EMITE novo token em nome de quem reenvia: mesma exigência de concessão (bootstrap `owner` só com órgão vazio).
  const resendTarget = await getUserByEmail(current.emailNormalized);
  if (resendTarget && resendTarget.id === input.actorUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: SELF_GRANT_MESSAGE });
  }
  await assertGrantAuthority({
    organizationId: input.organizationId, grantorUserId: input.actorUserId, role: current.role, operation: "invitation.resend",
    correlationId: input.correlationId, bootstrap: { emailNormalized: current.emailNormalized },
  });

  const org = await getOrganizationById(input.organizationId);
  const organizationName = org?.nome ?? "sua organização";

  const token = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = computeInvitationExpiresAt(now);
  const activeKey = computeInvitationActiveKey(input.organizationId, current.emailNormalized, "pending");
  const { resendCount, lastSentAt } = bumpResendMetadata(current, now);

  let newInvitationId!: number;
  await db.transaction(async tx => {
    await tx
      .update(institutionalInvitations)
      .set({ status: "superseded", activeKey: null })
      .where(eq(institutionalInvitations.id, current.id));

    const [result] = await tx.insert(institutionalInvitations).values({
      organizationId: input.organizationId,
      emailNormalized: current.emailNormalized,
      role: current.role,
      status: "pending",
      tokenHash,
      activeKey,
      invitedName: current.invitedName,
      expiresAt,
      createdByUserId: input.actorUserId,
      resendCount,
      lastSentAt,
      correlationId: input.correlationId ?? current.correlationId ?? null,
    });
    newInvitationId = (result as { insertId: number }).insertId;

    await enqueueEmail(
      {
        organizationId: input.organizationId,
        messageType: "invitation_resent",
        recipient: current.emailNormalized,
        templateKey: "invitation_resent",
        payload: {
          organizationName,
          inviterName: "Um administrador do LiciGov Pro",
          role: current.role,
          acceptUrl: `${EMAIL_CONFIG.appBaseUrl}/convite?token=${token}`,
          expiresAt: expiresAt.toISOString(),
          recipientName: current.invitedName ?? undefined,
        },
        idempotencyKey: `invitation:${tokenHash}`,
        correlationId: input.correlationId,
      },
      tx
    );
  });
  kickEmailDispatcher();

  await logActivity({
    userId: input.actorUserId,
    organizationId: input.organizationId,
    action: "invitation.resent",
    entityType: "invitation",
    entityId: newInvitationId,
    correlationId: input.correlationId,
  });

  const newRows = await db.select().from(institutionalInvitations).where(eq(institutionalInvitations.id, newInvitationId)).limit(1);
  return newRows[0];
}

// ─── cancel ───────────────────────────────────────────────────────────────────

export interface CancelInvitationInput {
  invitationId: number;
  organizationId: number;
  actorUserId: number;
  correlationId?: string;
}

export async function cancelInvitation(input: CancelInvitationInput): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Serviço de convites indisponível." });

  const rows = await db
    .select()
    .from(institutionalInvitations)
    .where(and(eq(institutionalInvitations.id, input.invitationId), eq(institutionalInvitations.organizationId, input.organizationId)))
    .limit(1);
  const current = rows[0];
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: INVITATION_NOT_FOUND });

  if (!canCancelInvitation(current.status)) {
    throw mapAcceptRejection(current.status === "accepted" ? "ALREADY_ACCEPTED" : "CANCELLED");
  }

  await db
    .update(institutionalInvitations)
    .set({ status: "cancelled", activeKey: null, cancelledAt: new Date() })
    .where(eq(institutionalInvitations.id, current.id));

  await logActivity({
    userId: input.actorUserId,
    organizationId: input.organizationId,
    action: "invitation.cancelled",
    entityType: "invitation",
    entityId: current.id,
    correlationId: input.correlationId,
  });
}

// ─── validateToken (público, sem side-effect) ──────────────────────────────────

export interface ValidateInvitationTokenResult {
  valid: boolean;
  reason?: InvitationAcceptRejectionReason;
  organizationName?: string;
  role?: OrgRole;
  emailNormalized?: string;
}

export async function validateInvitationToken(token: string): Promise<ValidateInvitationTokenResult> {
  if (!isPlausibleOpaqueToken(token)) return { valid: false, reason: "NOT_FOUND" };

  const db = await getDb();
  if (!db) return { valid: false, reason: "NOT_FOUND" };

  const tokenHash = hashOpaqueToken(token);
  const rows = await db.select().from(institutionalInvitations).where(eq(institutionalInvitations.tokenHash, tokenHash)).limit(1);
  const row = rows[0];

  const eligibility = checkInvitationAcceptEligibility({
    invitation: row ? { status: row.status, expiresAt: row.expiresAt, emailNormalized: row.emailNormalized } : null,
    now: new Date(),
  });
  if (!eligibility.eligible) return { valid: false, reason: eligibility.reason };

  const org = await getOrganizationById(row!.organizationId);
  return { valid: true, organizationName: org?.nome, role: row!.role, emailNormalized: row!.emailNormalized };
}

// ─── accept (conta nova) ────────────────────────────────────────────────────

export interface AcceptInvitationInput {
  token: string;
  name: string;
  password: string;
  correlationId?: string;
}

export interface AcceptInvitationResult {
  userId: number;
  openId: string;
  name: string;
  organizationId: number;
}

/**
 * Cria a conta + membership em UMA transação. Se já existir uma conta com este e-mail, o aceite
 * de conta NOVA não é o caminho certo — o client deve orientar login + `acceptExisting`.
 */
export async function acceptInvitation(input: AcceptInvitationInput): Promise<AcceptInvitationResult> {
  if (!isPlausibleOpaqueToken(input.token)) throw new TRPCError({ code: "NOT_FOUND", message: INVITATION_NOT_FOUND });

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Serviço de convites indisponível." });

  const tokenHash = hashOpaqueToken(input.token);
  const rows = await db.select().from(institutionalInvitations).where(eq(institutionalInvitations.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  const now = new Date();

  const eligibility = checkInvitationAcceptEligibility({
    invitation: row ? { status: row.status, expiresAt: row.expiresAt, emailNormalized: row.emailNormalized } : null,
    now,
  });
  if (!eligibility.eligible || !row) throw mapAcceptRejection(eligibility.reason!);
  await assertInvitationStillGranted(row, null, input.correlationId);

  const existingUser = await getUserByEmail(row.emailNormalized);
  if (existingUser) {
    // Já existe conta: o caminho correto é login + acceptExisting, não criar uma 2ª conta.
    throw new TRPCError({ code: "CONFLICT", message: INVITATION_ALREADY_ACCEPTED });
  }

  const policyResult = validatePassword(input.password, { email: row.emailNormalized });
  if (!policyResult.valid) {
    throw new TRPCError({ code: "BAD_REQUEST", message: policyResult.message ?? "Senha inválida." });
  }

  const passwordHash = await hashPassword(input.password);
  const openId = nanoid();

  let createdUserId!: number;
  try {
    await db.transaction(async tx => {
      await reassertGrantorInTx(tx as unknown as AuthorityExecutor, row, input.correlationId);
      await tx.insert(users).values({
        openId,
        email: row.emailNormalized,
        name: input.name,
        passwordHash,
        loginMethod: "email",
        lastSignedIn: now,
      });
      const userRows = await tx.select().from(users).where(eq(users.email, row.emailNormalized)).limit(1);
      createdUserId = userRows[0].id;

      await tx
        .insert(organizationMembers)
        .values({
          organizationId: row.organizationId,
          userId: createdUserId,
          role: row.role,
          invitedBy: row.createdByUserId,
          ativo: true,
        })
        .onDuplicateKeyUpdate({ set: { ativo: true, role: row.role } });

      await tx
        .update(institutionalInvitations)
        .set({ status: "accepted", acceptedAt: now, acceptedByUserId: createdUserId, activeKey: null })
        .where(eq(institutionalInvitations.id, row.id));
    });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      throw new TRPCError({ code: "CONFLICT", message: "E-mail já cadastrado. Faça login e tente aceitar o convite novamente." });
    }
    throw err;
  }

  await logActivity({
    userId: createdUserId,
    organizationId: row.organizationId,
    action: "invitation.accepted",
    entityType: "invitation",
    entityId: row.id,
    correlationId: input.correlationId,
  });

  log.info("invitation_accepted_new_account", { organizationId: row.organizationId, userId: createdUserId, correlationId: input.correlationId });

  return { userId: createdUserId, openId, name: input.name, organizationId: row.organizationId };
}

// ─── acceptExisting (usuário já autenticado) ─────────────────────────────────

export interface AcceptExistingInvitationInput {
  token: string;
  userId: number;
  userEmail: string;
  correlationId?: string;
}

export async function acceptExistingInvitation(input: AcceptExistingInvitationInput): Promise<{ organizationId: number }> {
  if (!isPlausibleOpaqueToken(input.token)) throw new TRPCError({ code: "NOT_FOUND", message: INVITATION_NOT_FOUND });

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Serviço de convites indisponível." });

  const tokenHash = hashOpaqueToken(input.token);
  const rows = await db.select().from(institutionalInvitations).where(eq(institutionalInvitations.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  const now = new Date();

  const eligibility = checkInvitationAcceptEligibility({
    invitation: row ? { status: row.status, expiresAt: row.expiresAt, emailNormalized: row.emailNormalized } : null,
    now,
    acceptingEmail: input.userEmail,
  });
  if (!eligibility.eligible || !row) throw mapAcceptRejection(eligibility.reason!);
  await assertInvitationStillGranted(row, input.userId, input.correlationId);
  // SECURITY-02 — o aceite não sobrescreve o papel de quem JÁ é membro ativo (contornaria owner/último-admin de updateMemberRole).
  const existingMembers = await getMembersOfOrg(row.organizationId);
  if (existingMembers.some((m) => m.userId === input.userId)) {
    throw new TRPCError({ code: "CONFLICT", message: MEMBER_ALREADY_EXISTS });
  }

  await db.transaction(async tx => {
    await reassertGrantorInTx(tx as unknown as AuthorityExecutor, row, input.correlationId);
    await tx
      .insert(organizationMembers)
      .values({
        organizationId: row.organizationId,
        userId: input.userId,
        role: row.role,
        invitedBy: row.createdByUserId,
        ativo: true,
      })
      .onDuplicateKeyUpdate({ set: { ativo: true, role: row.role } });

    await tx
      .update(institutionalInvitations)
      .set({ status: "accepted", acceptedAt: now, acceptedByUserId: input.userId, activeKey: null })
      .where(eq(institutionalInvitations.id, row.id));
  });

  await logActivity({
    userId: input.userId,
    organizationId: row.organizationId,
    action: "invitation.accepted",
    entityType: "invitation",
    entityId: row.id,
    correlationId: input.correlationId,
  });

  log.info("invitation_accepted_existing_account", { organizationId: row.organizationId, userId: input.userId, correlationId: input.correlationId });

  return { organizationId: row.organizationId };
}
