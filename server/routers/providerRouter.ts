import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { registerProvider, listProviders, getAvailableProviders } from "../services/providerRegistryService";
import { executeInference, replayExecution, getExecutionHistory } from "../services/providerExecutionService";
import { selectProviderForOrg, routeWithFallback } from "../services/providerRoutingService";
import { getProviderHealth, getProviderMetrics } from "../services/providerObservabilityService";
import { getUsageSummary, checkQuota } from "../services/providerCostService";

export const providerRouter = router({
  registerProvider: tenantProcedure
    .input(z.object({ providerType: z.enum(["openai","claude","gemini","mock"]), providerName: z.string(), priority: z.number().optional(), supportedCapabilities: z.array(z.string()).optional() }))
    .mutation(({ input, ctx }) => registerProvider({ organizationId: ctx.organizationId, ...input })),

  listProviders: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => listProviders(ctx.organizationId)),

  executeInference: tenantProcedure
    .input(z.object({ workflowId: z.string(), model: z.string(), prompt: z.string(), executionType: z.enum(["inference","embedding","classification","completion"]).optional(), correlationId: z.string().optional(), capability: z.string().optional() }))
    .mutation(({ input, ctx }) => executeInference({ organizationId: ctx.organizationId, ...input })),

  replayExecution: tenantProcedure
    .input(z.object({ originalExecutionId: z.string() }))
    .mutation(({ input, ctx }) => replayExecution(ctx.organizationId, input.originalExecutionId)),

  getProviderHealth: tenantProcedure
    .input(z.object({ providerId: z.string() }))
    .query(({ input, ctx }) => getProviderHealth(ctx.organizationId, input.providerId)),

  getCostAnalytics: tenantProcedure
    .input(z.object({ dailyLimit: z.number().optional() }))
    .query(({ input, ctx }) => ({ summary: getUsageSummary(ctx.organizationId), quota: checkQuota(ctx.organizationId, input.dailyLimit ?? 100) })),

  getRoutingPolicies: tenantProcedure
    .input(z.object({ capability: z.string().optional() }))
    .query(({ input, ctx }) => routeWithFallback(ctx.organizationId, input.capability)),

  simulateFailover: tenantProcedure
    .input(z.object({ excludeProviderId: z.string().optional() }))
    .query(({ input, ctx }) => routeWithFallback(ctx.organizationId).filter(p => p.id !== input.excludeProviderId)),

  getExecutionTrace: tenantProcedure
    .input(z.object({ executionId: z.string().optional() }))
    .query(({ input, ctx }) => { const history = getExecutionHistory(ctx.organizationId); return input.executionId ? history.filter(e => e.id === input.executionId) : history; }),

  validateProvider: tenantProcedure
    .input(z.object({ providerType: z.enum(["openai","claude","gemini","mock"]) }))
    .query(({ input, ctx }) => { const providers = listProviders(ctx.organizationId); const p = providers.find(pp => (pp as any).providerType === input.providerType); return { valid: !!p, provider: p ?? null }; }),
});
