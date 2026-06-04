/**
 * Sprint 3.4 — Onboarding Router.
 *
 * tRPC procedures para onboarding institucional de novas organizacoes piloto.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getGlobalTemplates, getTemplateByCategory, validateTemplate } from "../domain/operationalTemplates";
import { grantDepartmentPermission, grantWorkflowPermission, getDepartmentPermissions, getWorkflowPermissions } from "../services/advancedPermissionService";
import { createEnvironment, getEnvironments, checkEnvironmentHealth } from "../services/environmentManagementService";

export const onboardingRouter = router({
  getTemplates: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(() => {
      return getGlobalTemplates();
    }),

  getTemplateByCategory: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      category:       z.enum([
        "aquisicao_comum", "medicamentos", "combustivel",
        "material_expediente", "servicos_terceirizados",
        "obras", "manutencao", "ti", "alimentacao_escolar", "saude",
      ]),
    }))
    .query(({ input }) => {
      return getTemplateByCategory(input.category);
    }),

  setupEnvironment: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      name:           z.string().min(1),
      type:           z.enum(["development", "staging", "production"]),
      createdBy:      z.number(),
    }))
    .mutation(({ input }) => {
      return createEnvironment(input);
    }),

  getEnvironments: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input }) => {
      return getEnvironments(input.organizationId);
    }),

  checkEnvironmentHealth: protectedProcedure
    .input(z.object({ organizationId: z.number(), envId: z.string() }))
    .query(({ input }) => {
      return checkEnvironmentHealth(input.envId, input.organizationId);
    }),

  grantDepartmentPermission: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      userId:         z.number(),
      department:     z.string().min(1),
      resource:       z.enum(["processo", "item_tr", "template", "relatorio", "configuracao", "usuario", "auditoria"]),
      actions:        z.array(z.enum(["create", "read", "update", "delete", "approve", "reject", "export", "assign", "escalate"])),
      scope:          z.enum(["own", "department", "organization", "global"]),
      grantedBy:      z.number(),
      expiresAt:      z.string().optional(),
    }))
    .mutation(({ input }) => {
      return grantDepartmentPermission(input);
    }),

  getUserPermissions: protectedProcedure
    .input(z.object({ organizationId: z.number(), userId: z.number() }))
    .query(({ input }) => {
      return {
        department: getDepartmentPermissions(input.organizationId, input.userId),
        workflow:   getWorkflowPermissions(input.organizationId, input.userId),
      };
    }),
});
