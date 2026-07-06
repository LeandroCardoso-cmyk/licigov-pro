/**
 * Sprint 5.0.1 — Business Domain Router (operational).
 *
 * Catálogo de domínios, portal (Home), lançamento de Workspaces próprios por
 * domínio, status e dependências. tenantProcedure, multi-tenant, determinístico.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import {
  ALL_BUSINESS_DOMAIN_CODES,
  type BusinessDomainCode,
} from "../domain/businessDomain";
import { listDomains, getDomain, getDomainDependencies } from "../services/businessDomainRegistryService";
import { createOrLaunchWorkspace, loadDomainWorkspace } from "../services/domainWorkspaceService";
import { buildPortal } from "../services/domainNavigationService";
import { isModuleLicensed } from "../services/moduleLicensingService";
import { listKernelServicesForDomain } from "../services/kernelAccessService";

const DOMAIN_CODES = ALL_BUSINESS_DOMAIN_CODES as [BusinessDomainCode, ...BusinessDomainCode[]];

export const businessDomainRouter = router({
  listDomains: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      const portal = await buildPortal(orgId, new Date().toISOString());
      return { domains: listDomains(), portal: portal.entries, visible: portal.visible };
    }),

  getDomain: tenantProcedure
    .input(z.object({ code: z.enum(DOMAIN_CODES) }))
    .query(async ({ input }) => {
      const domain = getDomain(input.code);
      return { domain, kernelServices: listKernelServicesForDomain(input.code) };
    }),

  createWorkspace: tenantProcedure
    .input(z.object({ code: z.enum(DOMAIN_CODES), currentWorkflow: z.string().optional(), permissions: z.array(z.string()).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await createOrLaunchWorkspace({
        organizationId: orgId,
        businessDomainCode: input.code,
        currentWorkflow: input.currentWorkflow,
        permissions: input.permissions,
        correlationId: ctx.correlationId,
      });
      return { workspace };
    }),

  launchWorkspace: tenantProcedure
    .input(z.object({ code: z.enum(DOMAIN_CODES) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      // Lança (cria se necessário) o workspace próprio do domínio.
      const workspace = await createOrLaunchWorkspace({
        organizationId: orgId,
        businessDomainCode: input.code,
        correlationId: ctx.correlationId,
      });
      const existing = await loadDomainWorkspace(orgId, input.code);
      return { workspace, existing };
    }),

  getDomainStatus: tenantProcedure
    .input(z.object({ code: z.enum(DOMAIN_CODES) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const licensed = await isModuleLicensed(orgId, input.code, new Date().toISOString());
      const workspace = await loadDomainWorkspace(orgId, input.code);
      return { code: input.code, licensed, hasWorkspace: workspace !== null };
    }),

  getDependencies: tenantProcedure
    .input(z.object({ code: z.enum(DOMAIN_CODES) }))
    .query(async ({ input }) => {
      return { dependencies: getDomainDependencies(input.code) };
    }),
});
