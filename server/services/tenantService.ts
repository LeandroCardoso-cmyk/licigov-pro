import type { Request } from "express";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db/connection";
import { organizationMembers } from "../../drizzle/schema";
import type { OrganizationMember } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export type TenantResolution = {
  organizationId: number;
  membership: OrganizationMember;
};

/**
 * Resolve o organizationId para um usuário dado um request HTTP.
 *
 * Prioridade:
 * 1. Header X-Organization-Id (usuário com múltiplos memberships)
 * 2. Único membership ativo do usuário
 * 3. Fallback: org padrão id=1 se usuário tem membership nela
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
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.ativo, true),
    ));

  if (allMemberships.length === 0) {
    // Usuário sem membership: atribuir à org padrão (fallback zero-gap)
    return {
      organizationId: 1,
      membership: buildDefaultMembership(userId, 1),
    };
  }

  // Header explícito do cliente (usuário com múltiplos memberships)
  const orgIdHeader = req.headers["x-organization-id"];
  if (orgIdHeader) {
    const requestedOrgId = parseInt(orgIdHeader as string, 10);
    const membership = allMemberships.find(m => m.organizationId === requestedOrgId);
    if (!membership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem acesso à organização solicitada.",
      });
    }
    return { organizationId: requestedOrgId, membership };
  }

  // Único membership → auto-selecionar
  if (allMemberships.length === 1) {
    const m = allMemberships[0];
    return { organizationId: m.organizationId, membership: m };
  }

  // Múltiplos memberships sem header → exigir seleção explícita
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Você tem acesso a múltiplas organizações. Informe X-Organization-Id.",
  });
}

/**
 * Obtém o membership de um usuário em uma organização específica.
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
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.ativo, true),
    ))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Membership virtual para usuários sem registro formal (zero-gap compatibility).
 * Usado durante a fase de backfill antes de todos os dados terem organizationId preenchido.
 */
function buildDefaultMembership(userId: number, organizationId: number): OrganizationMember {
  return {
    id: 0,
    organizationId,
    userId,
    role: "operator",
    invitedBy: null,
    ativo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
