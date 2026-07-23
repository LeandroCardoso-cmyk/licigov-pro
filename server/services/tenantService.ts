import type { Request } from "express";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { organizationMembers } from "../../drizzle/schema";
import type { OrganizationMember } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("TenantService");

export type TenantResolution = {
  organizationId: number;
  membership: OrganizationMember;
};

/**
 * Código de erro estável para usuário autenticado sem vínculo organizacional.
 * O cliente pode mapeá-lo para orientar sobre convite/vinculação administrativa.
 */
export const NO_ORGANIZATION_MEMBERSHIP = "NO_ORGANIZATION_MEMBERSHIP";

/**
 * Resolve o organizationId para um usuário dado um request HTTP.
 *
 * Prioridade:
 * 1. Header X-Organization-Id (usuário com múltiplos memberships)
 * 2. Único membership ativo → auto-selecionar
 *
 * RC-SEC-PR-A (SEC-017): removido o fallback inseguro para a organização 1.
 * Um usuário sem membership NÃO ingressa automaticamente em nenhuma organização —
 * recebe erro estável FORBIDDEN/NO_ORGANIZATION_MEMBERSHIP (fail-closed). Isso
 * impede que contas recém-registradas ou sem vínculo operem como membro da org 1.
 */
export async function resolveTenantForUser(
  userId: number,
  req: Request,
): Promise<TenantResolution> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
  }

  const allMemberships = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.ativo, true)));

  if (allMemberships.length === 0) {
    log.warn("tenant_denied_no_membership", { userId });
    throw new TRPCError({
      code: "FORBIDDEN",
      message: NO_ORGANIZATION_MEMBERSHIP,
    });
  }

  const orgIdHeader = req.headers["x-organization-id"];
  if (orgIdHeader) {
    const requestedOrgId = parseInt(orgIdHeader as string, 10);
    const membership = allMemberships.find(m => m.organizationId === requestedOrgId);
    if (!membership) {
      log.warn("tenant_forbidden_no_membership_for_org", { userId, requestedOrgId });
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem acesso à organização solicitada.",
      });
    }
    log.debug("tenant_resolved_via_header", { userId, organizationId: requestedOrgId });
    return { organizationId: requestedOrgId, membership };
  }

  if (allMemberships.length === 1) {
    const m = allMemberships[0];
    log.debug("tenant_resolved_single_membership", { userId, organizationId: m.organizationId });
    return { organizationId: m.organizationId, membership: m };
  }

  log.warn("tenant_multiple_orgs_no_header", { userId, count: allMemberships.length });
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Você tem acesso a múltiplas organizações. Informe X-Organization-Id.",
  });
}

/**
 * Obtém o membership ativo de um usuário em uma organização específica.
 */
export async function getMembership(
  userId: number,
  organizationId: number,
): Promise<OrganizationMember | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.ativo, true),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
