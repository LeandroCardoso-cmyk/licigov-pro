/**
 * Sprint 5.0.1 — Module Licensing Router (operational).
 *
 * Ativação, bloqueio, validação e consulta de módulos licenciados por organização.
 * tenantProcedure, multi-tenant, determinístico.
 *
 * SEC-04 (LICIGOV-LAUNCH-READY) — licenciamento é ato COMERCIAL da plataforma, não decisão do órgão: as mutações
 * (`activateModule`/`deactivateModule`) exigem administrador de plataforma com tenant EXPLÍCITO (X-Organization-Id,
 * acesso auditado fail-closed pelo `resolveTenant`). Antes, qualquer membro (inclusive viewer) autolicenciava o próprio
 * órgão — plano, validade e features — contornando o gate `isModuleLicensed`. Consultas seguem no escopo do tenant.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import { structuredLog } from "../services/observabilityService";
import { ALL_BUSINESS_DOMAIN_CODES, type BusinessDomainCode } from "../domain/businessDomain";
import {
  activateModule,
  deactivateModule,
  listOrganizationModules,
  validateLicense,
} from "../services/moduleLicensingService";
import { listFlags } from "../services/moduleFeatureFlagService";

const DOMAIN_CODES = ALL_BUSINESS_DOMAIN_CODES as [BusinessDomainCode, ...BusinessDomainCode[]];
const PLANS = ["trial", "basic", "professional", "enterprise"] as const;

/** Mutação de licença: só administrador de plataforma (tenant explícito e auditado). Recusa logada; sem bypass por papel no órgão. */
const platformLicensingProcedure = tenantProcedure.use(async opts => {
  const { ctx, next, path } = opts;
  if (ctx.user.role === "admin" && ctx.platformAdminAccess === true) return next();
  structuredLog({
    level: "warn", service: "rbac", operation: "module_licensing_denied",
    procedure: path, userRole: ctx.orgMembership?.role ?? null,
    userId: ctx.user.id, organizationId: ctx.organizationId ?? undefined, correlationId: ctx.correlationId,
  });
  throw new TRPCError({ code: "FORBIDDEN", message: "O licenciamento de módulos é gerido pela administração da plataforma." });
});

export const moduleLicensingRouter = router({
  listModules: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      const modules = await listOrganizationModules(orgId);
      return { modules, total: modules.length };
    }),

  activateModule: platformLicensingProcedure
    .input(z.object({
      code: z.enum(DOMAIN_CODES),
      plan: z.enum(PLANS).optional(),
      expirationDate: z.string().optional(),
      licensedFeatures: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const { module, missingDependencies } = await activateModule({
        organizationId: orgId,
        businessDomainCode: input.code,
        plan: input.plan,
        activationDate: new Date().toISOString(),
        expirationDate: input.expirationDate ?? null,
        licensedFeatures: input.licensedFeatures,
        correlationId: ctx.correlationId,
      });
      return { module, missingDependencies, warning: missingDependencies.length > 0 ? `Dependências não licenciadas: ${missingDependencies.join(", ")}` : null };
    }),

  deactivateModule: platformLicensingProcedure
    .input(z.object({ code: z.enum(DOMAIN_CODES) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await deactivateModule(orgId, input.code);
      return { success: true, code: input.code, active: false };
    }),

  listFeatures: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      const features = await listFlags(orgId);
      return { features, total: features.length };
    }),

  validateLicense: tenantProcedure
    .input(z.object({ code: z.enum(DOMAIN_CODES) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const validation = await validateLicense(orgId, input.code, new Date().toISOString());
      return validation;
    }),

  getOrganizationModules: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      const modules = await listOrganizationModules(orgId);
      return { organizationId: orgId, modules };
    }),
});
