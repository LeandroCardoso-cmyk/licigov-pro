/**
 * PR A.1 — Onboarding de tenants pelo admin de plataforma. Cria a organização e emite o convite
 * de `owner` para o primeiro administrador — reaproveita `invitationService.createInvitation`
 * (mesma máquina de estados, mesmo template de e-mail, mesma auditoria).
 *
 * Idempotência: a MESMA entrada (nome+cnpj para um slug já existente) nunca duplica órgão nem convite; uma entrada DIFERENTE
 * colidindo com um slug existente é um conflito real.
 *
 * LR-01 (LICIGOV-LAUNCH-READY) — antes, uma falha entre o INSERT do órgão (autocommit) e o convite deixava o órgão sem convite, e
 * todo retry devolvia `alreadyExisted: true, invitationId: 0` sem recuperação. Agora o retry da mesma entrada inspeciona o estado:
 * órgão com vínculos ⇒ nada é concedido; convite pendente válido ⇒ devolvido; órgão órfão (nunca teve vínculo) ⇒ evidência e
 * convite reemitidos, auditados (`tenant.onboarding_recovered`).
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { and, desc, eq, ne } from "drizzle-orm";
import { emailOutbox, institutionalInvitations, organizationMembers, organizations } from "../../drizzle/schema";
import { getOrganizationBySlug } from "../db/organizations";
import { createInvitation, tenantOnboardingEvidenceHolds } from "./invitationService";
import { effectiveInvitationStatus, normalizeInvitationEmail } from "../domain/invitations";
import { logActivity } from "./activityLogService";
import { serviceLogger } from "./observabilityService";
import { TENANT_ALREADY_EXISTS } from "../domain/authErrors";

const log = serviceLogger("TenantOnboardingService");

function isDuplicateEntryError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ER_DUP_ENTRY";
}

export type OrgEsfera = "federal" | "estadual" | "municipal" | "outro";

export interface OnboardTenantInput {
  nome: string;
  slug: string;
  cnpj?: string;
  esfera: OrgEsfera;
  uf?: string;
  municipio?: string;
  firstAdminName: string;
  firstAdminEmail: string;
  actorUserId: number;
  correlationId?: string;
}

export type OnboardTenantState =
  /** Órgão novo: organização + evidência + convite `owner` criados nesta chamada. */
  | "created"
  /** Retry de órgão já implantado e ainda aguardando o 1º administrador: o convite pendente válido é devolvido (nada novo). */
  | "pending_invitation"
  /** Retry de órgão órfão (sem nenhum vínculo e sem convite utilizável): evidência + convite reemitidos (LR-01). */
  | "recovered"
  /** Órgão com vínculo(s) já existentes: nenhum `owner` novo é concedido pelo onboarding. */
  | "has_members";

export interface OnboardTenantResult {
  organizationId: number;
  organizationName: string;
  slug: string;
  /** Convite `owner` utilizável resultante (0 quando o órgão já tem vínculos e nada foi concedido). */
  invitationId: number;
  /** true quando a mesma entrada já tinha sido processada antes (idempotência). */
  alreadyExisted: boolean;
  state: OnboardTenantState;
}

const TENANT_ONBOARDING_INCOMPLETE =
  "A organização foi registrada, mas o convite do primeiro administrador não pôde ser concluído. Repita a operação com os mesmos dados para recuperar a implantação.";

/**
 * Grava a EVIDÊNCIA do bootstrap (`tenant.onboarded` para órgão+e-mail) ANTES do convite e confirma que ela é legível — o aceite
 * exige essa evidência; um convite emitido sem ela seria recusado no aceite ("convite morto"). `logActivity` engole erros, por
 * isso a confirmação é feita por leitura. Falha ⇒ erro explícito; o retry com a mesma entrada recupera (estado `recovered`).
 */
async function recordBootstrapEvidence(input: OnboardTenantInput, organizationId: number, recovered: boolean): Promise<void> {
  await logActivity({
    userId: input.actorUserId,
    organizationId,
    action: "tenant.onboarded",
    entityType: "organization",
    entityId: organizationId,
    correlationId: input.correlationId,
    details: { slug: input.slug, firstAdminEmail: input.firstAdminEmail, ...(recovered ? { recovered: true } : {}) },
  });
  const holds = await tenantOnboardingEvidenceHolds({ organizationId, grantorUserId: input.actorUserId, email: input.firstAdminEmail });
  if (!holds) {
    log.error("tenant_onboarding_evidence_missing", { organizationId, correlationId: input.correlationId });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: TENANT_ONBOARDING_INCOMPLETE });
  }
}

async function issueOwnerInvitation(input: OnboardTenantInput, organizationId: number) {
  try {
    return await createInvitation({
      organizationId,
      email: input.firstAdminEmail,
      role: "owner",
      invitedName: input.firstAdminName,
      createdByUserId: input.actorUserId,
      correlationId: input.correlationId,
      // SECURITY-02 — bootstrap da PRIMEIRA autoridade de um órgão sem membros: única concessão permitida ao admin de plataforma.
      bootstrap: "tenant_onboarding",
    });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") throw err; // autoconvite/órgão com membros: recusa legítima, propaga.
    log.error("tenant_onboarding_invitation_failed", { organizationId, correlationId: input.correlationId, error: err instanceof Error ? err.message : String(err) });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: TENANT_ONBOARDING_INCOMPLETE, cause: err instanceof Error ? err : undefined });
  }
}

/**
 * LR-01 — estado de implantação de um órgão existente, lido sem escrita:
 *  - `anyMembership`: QUALQUER vínculo (ativo ou não) — órgão que já teve titular nunca é re-bootstrapado pelo onboarding;
 *  - `acceptedInvitation`: algum convite já aceito;
 *  - `usablePending`: convite `owner` pendente e não expirado PARA ESTE e-mail, com evidência válida e e-mail não falho em definitivo.
 */
async function inspectExistingTenant(organizationId: number, email: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Serviço de onboarding indisponível." });
  const anyMembership = (await db.select({ id: organizationMembers.id }).from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId)).limit(1)).length > 0;
  const acceptedInvitation = (await db.select({ id: institutionalInvitations.id }).from(institutionalInvitations)
    .where(and(eq(institutionalInvitations.organizationId, organizationId), eq(institutionalInvitations.status, "accepted"))).limit(1)).length > 0;
  const emailNormalized = normalizeInvitationEmail(email);
  const pending = await db.select().from(institutionalInvitations)
    .where(and(
      eq(institutionalInvitations.organizationId, organizationId),
      eq(institutionalInvitations.emailNormalized, emailNormalized),
      eq(institutionalInvitations.role, "owner"),
      eq(institutionalInvitations.status, "pending"),
    ))
    .orderBy(desc(institutionalInvitations.id))
    .limit(1);
  let usablePending: { id: number } | null = null;
  const row = pending[0];
  if (row && effectiveInvitationStatus(row.status, row.expiresAt, new Date()) === "pending" && row.createdByUserId != null) {
    const evidence = await tenantOnboardingEvidenceHolds({ organizationId, grantorUserId: row.createdByUserId, email: emailNormalized });
    const outbox = await db.select({ status: emailOutbox.status }).from(emailOutbox)
      .where(eq(emailOutbox.idempotencyKey, `invitation:${row.tokenHash}`)).limit(1);
    const emailDead = outbox[0]?.status === "permanent_failure" || outbox[0]?.status === "cancelled" || outbox.length === 0;
    if (evidence && !emailDead) usablePending = { id: row.id };
  }
  return { anyMembership, acceptedInvitation, usablePending, emailNormalized };
}

/** LR-01 — retry com a MESMA entrada (slug+nome+cnpj = evidência da implantação) sobre um órgão já gravado. Só admin de plataforma chega aqui. */
async function resumeExistingTenant(
  input: OnboardTenantInput, existing: { id: number; nome: string; slug: string },
): Promise<OnboardTenantResult> {
  const base = { organizationId: existing.id, organizationName: existing.nome, slug: existing.slug, alreadyExisted: true } as const;
  const state = await inspectExistingTenant(existing.id, input.firstAdminEmail);
  if (state.anyMembership || state.acceptedInvitation) {
    return { ...base, invitationId: 0, state: "has_members" };
  }
  if (state.usablePending) {
    return { ...base, invitationId: state.usablePending.id, state: "pending_invitation" };
  }

  // Órgão ÓRFÃO: nunca teve vínculo e não há convite utilizável (falha intermediária, evidência ausente ou e-mail falho em definitivo).
  await recordBootstrapEvidence(input, existing.id, true);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Serviço de onboarding indisponível." });
  // Um único 1º titular em disputa: convites `owner` pendentes para OUTROS e-mails deste órgão são supersedidos (o do mesmo e-mail é
  // supersedido atomicamente por createInvitation).
  await db.update(institutionalInvitations)
    .set({ status: "superseded", activeKey: null })
    .where(and(
      eq(institutionalInvitations.organizationId, existing.id),
      eq(institutionalInvitations.role, "owner"),
      eq(institutionalInvitations.status, "pending"),
      ne(institutionalInvitations.emailNormalized, state.emailNormalized),
    ));
  const invitation = await issueOwnerInvitation(input, existing.id);
  await logActivity({
    userId: input.actorUserId,
    organizationId: existing.id,
    action: "tenant.onboarding_recovered",
    entityType: "organization",
    entityId: existing.id,
    correlationId: input.correlationId,
    details: { slug: input.slug, invitationId: invitation.id },
  });
  log.warn("tenant_onboarding_recovered", { organizationId: existing.id, invitationId: invitation.id, correlationId: input.correlationId });
  return { ...base, invitationId: invitation.id, state: "recovered" };
}

export async function onboardTenant(input: OnboardTenantInput): Promise<OnboardTenantResult> {
  const existing = await getOrganizationBySlug(input.slug);
  if (existing) {
    const sameEntry = existing.nome === input.nome && (existing.cnpj ?? null) === (input.cnpj ?? null);
    if (sameEntry) return resumeExistingTenant(input, existing);
    throw new TRPCError({ code: "CONFLICT", message: TENANT_ALREADY_EXISTS });
  }

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Serviço de onboarding indisponível." });

  let organizationId!: number;
  try {
    const [result] = await db.insert(organizations).values({
      nome: input.nome,
      slug: input.slug,
      cnpj: input.cnpj ?? null,
      esfera: input.esfera,
      uf: input.uf ?? null,
      municipio: input.municipio ?? null,
      ativo: true,
    });
    organizationId = (result as { insertId: number }).insertId;
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      throw new TRPCError({ code: "CONFLICT", message: TENANT_ALREADY_EXISTS });
    }
    throw err;
  }

  // LR-01 — evidência ANTES do convite: qualquer falha daqui em diante deixa um órgão órfão RECUPERÁVEL pelo retry da mesma entrada.
  await recordBootstrapEvidence(input, organizationId, false);
  const invitation = await issueOwnerInvitation(input, organizationId);

  log.info("tenant_onboarded", { organizationId, slug: input.slug, correlationId: input.correlationId });

  return { organizationId, organizationName: input.nome, slug: input.slug, invitationId: invitation.id, alreadyExisted: false, state: "created" };
}
