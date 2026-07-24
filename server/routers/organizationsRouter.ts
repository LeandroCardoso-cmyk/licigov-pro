import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, orgRoleProcedure, adminProcedure } from "../_core/trpc";
import {
  getOrganizationById,
  getMembersOfOrg,
  getAllMembersOfOrg,
  addMemberToOrg,
  updateMemberRole,
  removeMemberFromOrg,
  getUserOrganizations,
  updateOrganization,
  createOrganization,
  countActiveAdmins,
  setMemberAtivo,
} from "../db/organizations";
import { getUserByEmail } from "../db";
import { logFromCtx, type TrpcAuditCtx } from "../services/activityLogService";
import { LAST_TENANT_ADMIN, MEMBER_NOT_FOUND } from "../domain/authErrors";

/**
 * PR A.1 — Proteção "último admin": rebaixar/desativar/remover um membro com papel admin NÃO
 * pode deixar a organização sem nenhum admin/owner ATIVO. `owner` já é protegido separadamente
 * (nunca pode ser alterado/removido por esta API) — este guard cobre o caso de `admin`.
 */
async function assertNotLastActiveAdmin(organizationId: number, targetRole: string): Promise<void> {
  if (targetRole !== "admin") return; // owner já bloqueado antes de chegar aqui; demais papéis não contam
  const activeAdmins = await countActiveAdmins(organizationId);
  if (activeAdmins <= 1) {
    throw new TRPCError({
      code: "CONFLICT",
      message: LAST_TENANT_ADMIN,
    });
  }
}

export const organizationsRouter = router({
  // ─── Listar organizações do usuário autenticado ──────────────────────────

  listMine: tenantProcedure.query(async ({ ctx }) => {
    const orgs = await getUserOrganizations(ctx.user.id);
    return orgs;
  }),

  // ─── Obter organização atual (do contexto tenant) ────────────────────────

  getCurrent: tenantProcedure.query(async ({ ctx }) => {
    const org = await getOrganizationById(ctx.organizationId);
    if (!org) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organização não encontrada." });
    }
    return { org, role: ctx.orgMembership!.role };
  }),

  // ─── Atualizar dados da organização (admin/owner) ────────────────────────

  update: orgRoleProcedure("admin").input(
    z.object({
      nome: z.string().min(3).max(255).optional(),
      cnpj: z.string().regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/).optional(),
      esfera: z.enum(["federal", "estadual", "municipal", "outro"]).optional(),
      uf: z.string().length(2).optional(),
      municipio: z.string().max(100).optional(),
    }),
  ).mutation(async ({ ctx, input }) => {
    await updateOrganization(ctx.organizationId!, input);

    await logFromCtx(ctx as TrpcAuditCtx, null, "org.updated", {
      entityType: "Organization",
      entityId: ctx.organizationId!,
      details: input,
    });

    return { success: true };
  }),

  // ─── Listar membros da organização ───────────────────────────────────────

  listMembers: orgRoleProcedure("operator").query(async ({ ctx }) => {
    const members = await getMembersOfOrg(ctx.organizationId!);
    return members;
  }),

  // ─── Convidar membro (por email) ─────────────────────────────────────────

  inviteMember: orgRoleProcedure("admin").input(
    z.object({
      email: z.string().email(),
      role: z.enum(["admin", "manager", "operator", "viewer"]),
    }),
  ).mutation(async ({ ctx, input }) => {
    const targetUser = await getUserByEmail(input.email);
    if (!targetUser) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Usuário não encontrado. O usuário precisa ter uma conta no LiciGov Pro.",
      });
    }

    // Verificar se já é membro
    const existingMembers = await getMembersOfOrg(ctx.organizationId!);
    const alreadyMember = existingMembers.some(m => m.userId === targetUser.id);
    if (alreadyMember) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Este usuário já é membro desta organização.",
      });
    }

    await addMemberToOrg({
      organizationId: ctx.organizationId!,
      userId: targetUser.id,
      role: input.role,
      invitedBy: ctx.user!.id,
      ativo: true,
    });

    await logFromCtx(ctx as TrpcAuditCtx, null, "org.member_invited", {
      entityType: "OrganizationMember",
      entityId: targetUser.id,
      details: { email: input.email, role: input.role },
    });

    return { success: true, userId: targetUser.id };
  }),

  // ─── Alterar papel de membro ─────────────────────────────────────────────

  updateMemberRole: orgRoleProcedure("admin").input(
    z.object({
      userId: z.number().int().positive(),
      role: z.enum(["admin", "manager", "operator", "viewer"]),
    }),
  ).mutation(async ({ ctx, input }) => {
    // Owners não podem ser rebaixados via API (apenas via DB/admin plataforma)
    const members = await getMembersOfOrg(ctx.organizationId!);
    const target = members.find(m => m.userId === input.userId);

    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Membro não encontrado." });
    }

    if (target.role === "owner") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "O papel de owner não pode ser alterado por esta API.",
      });
    }

    // PR A.1 — rebaixar o último admin ativo deixaria a organização sem ninguém que possa
    // gerenciar membros/convites. Só se aplica quando o alvo É admin hoje (owner já é bloqueado
    // acima; rebaixar operator/manager/viewer nunca reduz a contagem de admins).
    if (target.role === "admin" && input.role !== "admin") {
      await assertNotLastActiveAdmin(ctx.organizationId!, target.role);
    }

    await updateMemberRole(ctx.organizationId!, input.userId, input.role);

    await logFromCtx(ctx as TrpcAuditCtx, null, "org.member_role_updated", {
      entityType: "OrganizationMember",
      entityId: input.userId,
      details: { newRole: input.role, previousRole: target.role },
    });

    return { success: true };
  }),

  // ─── Remover membro ───────────────────────────────────────────────────────

  removeMember: orgRoleProcedure("admin").input(
    z.object({
      userId: z.number().int().positive(),
    }),
  ).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user!.id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Você não pode remover a si mesmo da organização.",
      });
    }

    const members = await getMembersOfOrg(ctx.organizationId!);
    const target = members.find(m => m.userId === input.userId);

    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Membro não encontrado." });
    }

    if (target.role === "owner") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "O owner não pode ser removido.",
      });
    }

    await assertNotLastActiveAdmin(ctx.organizationId!, target.role);

    await removeMemberFromOrg(ctx.organizationId!, input.userId);

    await logFromCtx(ctx as TrpcAuditCtx, null, "org.member_removed", {
      entityType: "OrganizationMember",
      entityId: input.userId,
    });

    return { success: true };
  }),

  // ─── PR A.1 — Listar TODOS os membros (ativos e inativos), para a tela de gestão ─────────

  listAllMembers: orgRoleProcedure("admin").query(async ({ ctx }) => {
    return await getAllMembersOfOrg(ctx.organizationId!);
  }),

  // ─── PR A.1 — Desativar membro (mesmo efeito de removeMember, nome mais claro p/ a UI) ─────

  deactivateMember: orgRoleProcedure("admin").input(
    z.object({ userId: z.number().int().positive() }),
  ).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user!.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode desativar a si mesmo." });
    }

    const members = await getAllMembersOfOrg(ctx.organizationId!);
    const target = members.find(m => m.userId === input.userId);
    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: MEMBER_NOT_FOUND });
    }
    if (target.role === "owner") {
      throw new TRPCError({ code: "FORBIDDEN", message: "O owner não pode ser desativado." });
    }
    if (!target.ativo) {
      return { success: true }; // idempotente — já estava desativado
    }

    await assertNotLastActiveAdmin(ctx.organizationId!, target.role);

    await setMemberAtivo(ctx.organizationId!, input.userId, false);

    await logFromCtx(ctx as TrpcAuditCtx, null, "member.deactivated", {
      entityType: "OrganizationMember",
      entityId: input.userId,
    });

    return { success: true };
  }),

  // ─── PR A.1 — Reativar membro previamente desativado ────────────────────────

  activateMember: orgRoleProcedure("admin").input(
    z.object({ userId: z.number().int().positive() }),
  ).mutation(async ({ ctx, input }) => {
    const members = await getAllMembersOfOrg(ctx.organizationId!);
    const target = members.find(m => m.userId === input.userId);
    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: MEMBER_NOT_FOUND });
    }
    if (target.ativo) {
      return { success: true }; // idempotente — já estava ativo
    }

    await setMemberAtivo(ctx.organizationId!, input.userId, true);

    await logFromCtx(ctx as TrpcAuditCtx, null, "member.activated", {
      entityType: "OrganizationMember",
      entityId: input.userId,
    });

    return { success: true };
  }),

  // ─── Admin: criar organização ─────────────────────────────────────────────

  adminCreate: adminProcedure.input(
    z.object({
      nome: z.string().min(3).max(255),
      slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
      cnpj: z.string().optional(),
      esfera: z.enum(["federal", "estadual", "municipal", "outro"]).default("municipal"),
      uf: z.string().length(2).optional(),
      municipio: z.string().max(100).optional(),
    }),
  ).mutation(async ({ ctx, input }) => {
    await createOrganization({
      ...input,
      ativo: true,
    });

    console.info(`[Organizations] Admin ${ctx.user.id} criou organização: ${input.nome}`);
    return { success: true };
  }),
});
