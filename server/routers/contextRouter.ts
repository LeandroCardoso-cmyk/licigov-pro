import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { assembleContextService, getAssemblySnapshots, compareAssemblies } from "../services/contextAssemblyService";
import { rankFragments } from "../services/contextRankingService";
import { compressContext } from "../services/semanticCompressionService";
import { computeContextHealth, getSessionMetrics } from "../services/contextObservabilityService";
import { createFragment } from "../domain/contextAssembly";

export const contextRouter = router({
  assemble: tenantProcedure
    .input(z.object({
      sessionId:      z.string(),
      workflowId:     z.string().optional(),
      legalRefs:      z.array(z.string()).optional(),
      documentRefs:   z.array(z.string()).optional(),
      userContext:    z.string().optional(),
      maxTokens:      z.number().optional(),
    }))
    .mutation(({ ctx, input }) =>
      assembleContextService({
        organizationId: ctx.organizationId,
        sessionId:      input.sessionId,
        workflowId:     input.workflowId,
        legalRefs:      input.legalRefs,
        documentRefs:   input.documentRefs,
        userContext:    input.userContext,
        maxTokens:      input.maxTokens,
      })
    ),

  rank: tenantProcedure
    .input(z.object({
      sessionId:        z.string(),
      workflowStage:    z.string(),
      role:             z.string(),
      legalWeight:      z.number().min(0).max(1),
      recencyWeight:    z.number().min(0).max(1),
      confidenceWeight: z.number().min(0).max(1),
    }))
    .query(({ ctx, input }) => {
      const snapshots = getAssemblySnapshots(ctx.organizationId);
      const latest = snapshots[snapshots.length - 1];
      if (!latest) return { rankedFragments: [], totalFragments: 0, processingMs: 0, replayKey: "", organizationId: ctx.organizationId };
      return rankFragments({
        organizationId:   ctx.organizationId,
        fragments:        latest.assembly.orderedFragments,
        workflowStage:    input.workflowStage,
        role:             input.role,
        legalWeight:      input.legalWeight,
        recencyWeight:    input.recencyWeight,
        confidenceWeight: input.confidenceWeight,
      });
    }),

  preview: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => {
      const snapshots = getAssemblySnapshots(ctx.organizationId);
      return snapshots.filter(s => {
        const key = s.assembly.replayKey;
        return key.includes(input.sessionId.slice(0, 4));
      });
    }),

  compress: tenantProcedure
    .input(z.object({
      sessionId:        z.string(),
      targetTokens:     z.number(),
      preservePriority: z.array(z.enum(["critical", "high", "medium", "low", "background"])).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const snapshots = getAssemblySnapshots(ctx.organizationId);
      const latest = snapshots[snapshots.length - 1];
      if (!latest) return null;
      return compressContext({
        organizationId:   ctx.organizationId,
        fragments:        latest.assembly.orderedFragments,
        targetTokens:     input.targetTokens,
        preservePriority: (input.preservePriority ?? ["critical"]) as Array<"critical" | "high" | "medium" | "low" | "background">,
      });
    }),

  inspect: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => {
      const metrics = getSessionMetrics(ctx.organizationId, input.sessionId);
      return computeContextHealth(ctx.organizationId, input.sessionId, metrics);
    }),
});
