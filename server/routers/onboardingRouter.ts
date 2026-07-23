/**
 * Sprint 3.4 — Onboarding Router.
 *
 * tRPC procedures para onboarding institucional de novas organizacoes piloto.
 */

import { tenantProcedure, orgRoleProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getGlobalTemplates, getTemplateByCategory, validateTemplate } from "../domain/operationalTemplates";
import { grantDepartmentPermission, grantWorkflowPermission, getDepartmentPermissions, getWorkflowPermissions } from "../services/advancedPermissionService";
import { createEnvironment, getEnvironments, checkEnvironmentHealth } from "../services/environmentManagementService";
import { getMembership } from "../services/tenantService";

/**
 * RC-SEC-PR-A (RBAC-004) — Onboarding endurecido.
 * organizationId e grantedBy vêm SEMPRE do contexto autenticado (nunca do input).
 * Concessão de permissão exige papel admin na organização (orgRoleProcedure).
 * Escopo "global" é exclusivo de admin de plataforma. Sem autoelevação.
 */
export const onboardingRouter = router({
  getTemplates: tenantProcedure
    .query(() => {
      return getGlobalTemplates();
    }),

  getTemplateByCategory: tenantProcedure
    .input(z.object({
      category:       z.enum([
        "aquisicao_comum", "medicamentos", "combustivel",
        "material_expediente", "servicos_terceirizados",
        "obras", "manutencao", "ti", "alimentacao_escolar", "saude",
      ]),
    }))
    .query(({ input }) => {
      return getTemplateByCategory(input.category);
    }),

  setupEnvironment: orgRoleProcedure("admin")
    .input(z.object({
      name:           z.string().min(1),
      type:           z.enum(["development", "staging", "production"]),
    }))
    .mutation(({ input, ctx }) => {
      return createEnvironment({
        organizationId: ctx.organizationId!,
        name: input.name,
        type: input.type,
        createdBy: ctx.user!.id,
      });
    }),

  getEnvironments: tenantProcedure
    .query(({ ctx }) => {
      return getEnvironments(ctx.organizationId!);
    }),

  checkEnvironmentHealth: tenantProcedure
    .input(z.object({ envId: z.string() }))
    .query(({ input, ctx }) => {
      return checkEnvironmentHealth(input.envId, ctx.organizationId!);
    }),

  grantDepartmentPermission: orgRoleProcedure("admin")
    .input(z.object({
      userId:         z.number(),
      department:     z.string().min(1),
      resource:       z.enum(["processo", "item_tr", "template", "relatorio", "configuracao", "usuario", "auditoria"]),
      actions:        z.array(z.enum(["create", "read", "update", "delete", "approve", "reject", "export", "assign", "escalate"])),
      scope:          z.enum(["own", "department", "organization", "global"]),
      expiresAt:      z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Escopo global é exclusivo de admin de plataforma (nunca admin de órgão).
      if (input.scope === "global" && ctx.user!.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores de plataforma podem conceder escopo global.",
        });
      }
      // Ninguém concede permissão a si mesmo (evita autoelevação horizontal).
      if (input.userId === ctx.user!.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Não é permitido conceder permissão a si próprio.",
        });
      }
      // O alvo deve ser membro ativo da MESMA organização do contexto — impede
      // conceder permissão para usuário de outro tenant ou inexistente. Cross-tenant
      // e alvo inexistente produzem o MESMO NOT_FOUND (não revela existência).
      const targetMembership = await getMembership(input.userId, ctx.organizationId!);
      if (!targetMembership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Usuário-alvo não encontrado na organização.",
        });
      }
      return grantDepartmentPermission({
        organizationId: ctx.organizationId!,
        userId:         input.userId,
        department:     input.department,
        resource:       input.resource,
        actions:        input.actions,
        scope:          input.scope,
        grantedBy:      ctx.user!.id,
        expiresAt:      input.expiresAt,
      });
    }),

  getUserPermissions: tenantProcedure
    .input(z.object({ userId: z.number() }))
    .query(({ input, ctx }) => {
      return {
        department: getDepartmentPermissions(ctx.organizationId!, input.userId),
        workflow:   getWorkflowPermissions(ctx.organizationId!, input.userId),
      };
    }),
});
