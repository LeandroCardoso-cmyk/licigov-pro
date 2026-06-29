import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { executeChain, replayExecution, getExecutionHistory } from "../services/promptOrchestratorService";
import { createTemplate, renderTemplate, getTemplatesByKey, approveTemplate } from "../services/promptTemplateService";
import { createPromptChain, createPromptStage, buildExecutionPlan } from "../domain/promptOrchestration";
import { createWindow } from "../domain/contextAssembly";
import { assembleContext as assembleContextDomain } from "../domain/contextAssembly";

export const promptOrchestrationRouter = router({
  execute: tenantProcedure
    .input(z.object({
      sessionId: z.string(),
      chainId:   z.string(),
      variables: z.record(z.string(), z.string()),
      maxTokens: z.number().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const stage = createPromptStage({
        name:             "default",
        stageType:        "instruction",
        templateId:       input.chainId,
        inputVariables:   Object.keys(input.variables),
        outputSchema:     { result: "string" },
        maxTokens:        input.maxTokens ?? 1024,
        timeoutMs:        30000,
        retryCount:       3,
        fallbackStrategy: "retry",
        dependsOn:        [],
        guardrails:       [],
      });
      const chain = createPromptChain(ctx.organizationId, {
        name:           input.chainId,
        stages:         [stage],
        transitions:    [],
        maxTotalTokens: input.maxTokens ?? 4096,
      });
      const assembly = assembleContextDomain(ctx.organizationId, [], input.maxTokens ?? 4096);
      return executeChain({
        organizationId:  ctx.organizationId,
        sessionId:       input.sessionId,
        chainId:         input.chainId,
        chain,
        contextAssembly: assembly,
        variables:       input.variables,
        maxTokens:       input.maxTokens ?? 4096,
      });
    }),

  replay: tenantProcedure
    .input(z.object({
      sessionId:    z.string(),
      newVariables: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const history = getExecutionHistory(ctx.organizationId, input.sessionId);
      const last = history[history.length - 1];
      if (!last) throw new Error("Nenhuma execução encontrada para replay");
      return replayExecution(last, input.newVariables);
    }),

  trace: tenantProcedure
    .input(z.object({ sessionId: z.string(), executionIndex: z.number().optional() }))
    .query(({ ctx, input }) => {
      const history = getExecutionHistory(ctx.organizationId, input.sessionId);
      const idx = input.executionIndex ?? history.length - 1;
      return history[idx] ?? null;
    }),

  explain: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => {
      const history = getExecutionHistory(ctx.organizationId, input.sessionId);
      const last = history[history.length - 1];
      if (!last) return null;
      return {
        sessionId:       last.sessionId,
        chainId:         last.chainId,
        stageCount:      last.stageExecutions.length,
        completedStages: last.stageExecutions.filter(s => s.status === "completed").length,
        fallbackStages:  last.stageExecutions.filter(s => s.fallbackUsed).length,
        replayKey:       last.replayKey,
        correlationId:   last.correlationId,
        totalTokens:     last.totalTokensUsed,
        totalMs:         last.totalDurationMs,
      };
    }),

  listExecutions: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) =>
      getExecutionHistory(ctx.organizationId, input.sessionId)
    ),

  getTemplate: tenantProcedure
    .input(z.object({ templateKey: z.string() }))
    .query(({ ctx, input }) =>
      getTemplatesByKey(ctx.organizationId, input.templateKey)
    ),
});
