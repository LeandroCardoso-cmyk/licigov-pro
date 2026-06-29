import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { runAgentExecution, getExecutionHistory, replayExecution } from "../services/agentExecutionEngine";
import { planExecution, getPlanHistory } from "../services/agentPlanningService";
import { simulateTasks, getSimulationHistory } from "../services/taskSimulationService";
import { verifySafety, buildSafetyReport } from "../services/agentSafetyService";
import { computeExecutionHealth, getExecutionTraces } from "../services/executionObservabilityService";

export const agentExecutionRouter = router({
  createExecution: tenantProcedure
    .input(z.object({
      sessionId: z.string(),
      agentType: z.string(),
      stages: z.array(z.object({ name: z.string(), input: z.record(z.string(), z.unknown()).default({}), estimatedMs: z.number().optional() })),
    }))
    .mutation(({ input, ctx }) => runAgentExecution({ organizationId: ctx.organizationId, ...input })),

  executePlan: tenantProcedure
    .input(z.object({
      sessionId: z.string(),
      planName: z.string(),
      goal: z.object({ description: z.string(), successCriteria: z.array(z.string()).default([]), priority: z.enum(["critical","high","medium","low"]).default("medium") }),
      rawTasks: z.array(z.object({ name: z.string(), type: z.string(), description: z.string(), priority: z.enum(["critical","high","medium","low"]).default("medium"), dependsOn: z.array(z.string()).optional(), parallelizable: z.boolean().optional(), estimatedMs: z.number().optional() })),
    }))
    .mutation(({ input, ctx }) => planExecution({ organizationId: ctx.organizationId, ...input })),

  simulateExecution: tenantProcedure
    .input(z.object({
      sessionId: z.string(),
      tasks: z.array(z.object({ name: z.string(), type: z.string(), input: z.record(z.string(), z.unknown()).default({}), estimatedMs: z.number().optional() })),
      simulationType: z.enum(["dry_run","full_preview","rollback_preview","impact_estimation"]).default("dry_run"),
    }))
    .mutation(({ input, ctx }) => simulateTasks({ organizationId: ctx.organizationId, ...input })),

  replayExecution: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input, ctx }) => {
      const history = getExecutionHistory(ctx.organizationId, input.sessionId);
      const last = history[history.length - 1];
      if (!last) throw new Error("No execution found for this session");
      return replayExecution(last);
    }),

  rollbackExecution: tenantProcedure
    .input(z.object({ sessionId: z.string(), reason: z.string() }))
    .mutation(({ input, ctx }) => {
      const history = getExecutionHistory(ctx.organizationId, input.sessionId);
      const last = history[history.length - 1];
      if (!last) throw new Error("No execution found");
      return { rolledBack: true, executionId: last.execution.id, reason: input.reason };
    }),

  inspectExecution: tenantProcedure
    .input(z.object({ sessionId: z.string().optional() }))
    .query(({ input, ctx }) => getExecutionHistory(ctx.organizationId, input.sessionId)),

  inspectSafety: tenantProcedure
    .input(z.object({ sessionId: z.string(), actionType: z.string(), confidenceScore: z.number().default(0.85) }))
    .query(({ input, ctx }) => verifySafety({ organizationId: ctx.organizationId, sessionId: input.sessionId, actionType: input.actionType, input: {}, confidenceScore: input.confidenceScore })),

  inspectPlan: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getPlanHistory(ctx.organizationId)),

  inspectReplay: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input, ctx }) => getSimulationHistory(ctx.organizationId)),

  inspectObservability: tenantProcedure
    .input(z.object({ sessionId: z.string().optional() }))
    .query(({ input, ctx }) => computeExecutionHealth(ctx.organizationId, input.sessionId)),
});
