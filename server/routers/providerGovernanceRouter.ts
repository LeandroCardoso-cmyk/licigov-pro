import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { addPolicy, enforcePolicy, getActivePolicies, checkRequiresApproval } from "../services/providerPolicyService";
import { getUsageSummary, checkQuota } from "../services/providerCostService";
import { getExecutionLineage, getProviderMetrics } from "../services/providerObservabilityService";
import { getFailoverHistory } from "../services/providerFailoverService";
import { getReplayHistory } from "../services/providerReplayService";

export const providerGovernanceRouter = router({
  createPolicy: tenantProcedure
    .input(z.object({ policyName: z.string(), allowedProviders: z.array(z.string()).optional(), blockedModels: z.array(z.string()).optional(), maxTokensPerExecution: z.number().optional(), maxCostPerExecution: z.number().optional(), dailyCostLimit: z.number().optional(), approvalThreshold: z.number().optional(), requiresHumanApproval: z.boolean().optional(), restrictedCapabilities: z.array(z.string()).optional() }))
    .mutation(({ input, ctx }) => addPolicy({ organizationId: ctx.organizationId, ...input })),

  enforcePolicy: tenantProcedure
    .input(z.object({ providerType: z.string(), model: z.string(), estimatedTokens: z.number(), estimatedCost: z.number(), capability: z.string() }))
    .mutation(({ input, ctx }) => enforcePolicy(ctx.organizationId, input)),

  getActivePolicies: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getActivePolicies(ctx.organizationId)),

  getQuotaUsage: tenantProcedure
    .input(z.object({ dailyLimit: z.number().optional() }))
    .query(({ input, ctx }) => ({ summary: getUsageSummary(ctx.organizationId), quota: checkQuota(ctx.organizationId, input.dailyLimit ?? 100) })),

  getProviderLineage: tenantProcedure
    .input(z.object({ correlationId: z.string() }))
    .query(({ input, ctx }) => getExecutionLineage(ctx.organizationId, input.correlationId)),

  getFallbackHistory: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getFailoverHistory(ctx.organizationId)),

  getProviderMetrics: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getProviderMetrics(ctx.organizationId)),
});
