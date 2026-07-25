/**
 * PR A.1 — Onboarding de tenants pelo admin de plataforma. Cria a organização e emite o convite
 * de `owner` para o primeiro administrador — reaproveita `invitationService.createInvitation`
 * (mesma máquina de estados, mesmo template de e-mail, mesma auditoria).
 *
 * Idempotência: a MESMA entrada (nome+cnpj para um slug já existente) retorna o resumo existente
 * em vez de duplicar; uma entrada DIFERENTE colidindo com um slug existente é um conflito real.
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { organizations } from "../../drizzle/schema";
import { getOrganizationBySlug } from "../db/organizations";
import { createInvitation } from "./invitationService";
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

export interface OnboardTenantResult {
  organizationId: number;
  organizationName: string;
  slug: string;
  invitationId: number;
  /** true quando a mesma entrada já tinha sido processada antes (idempotência) — nenhum convite novo foi criado desta vez. */
  alreadyExisted: boolean;
}

export async function onboardTenant(input: OnboardTenantInput): Promise<OnboardTenantResult> {
  const existing = await getOrganizationBySlug(input.slug);
  if (existing) {
    const sameEntry = existing.nome === input.nome && (existing.cnpj ?? null) === (input.cnpj ?? null);
    if (sameEntry) {
      return { organizationId: existing.id, organizationName: existing.nome, slug: existing.slug, invitationId: 0, alreadyExisted: true };
    }
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

  const invitation = await createInvitation({
    organizationId,
    email: input.firstAdminEmail,
    role: "owner",
    invitedName: input.firstAdminName,
    createdByUserId: input.actorUserId,
    correlationId: input.correlationId,
  });

  await logActivity({
    userId: input.actorUserId,
    organizationId,
    action: "tenant.onboarded",
    entityType: "organization",
    entityId: organizationId,
    correlationId: input.correlationId,
    details: { slug: input.slug, firstAdminEmail: input.firstAdminEmail },
  });

  log.info("tenant_onboarded", { organizationId, slug: input.slug, correlationId: input.correlationId });

  return { organizationId, organizationName: input.nome, slug: input.slug, invitationId: invitation.id, alreadyExisted: false };
}
