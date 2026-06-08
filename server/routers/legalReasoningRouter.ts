import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { runLegalReasoning, getReasoningHistory, replayReasoning } from "../services/legalReasoningEngine";
import { runLegalValidation } from "../services/legalValidationService";
import { correlateJurisprudence } from "../services/jurisprudenceCorrelationService";

export const legalReasoningRouter = router({
  analyze: tenantProcedure
    .input(z.object({
      sessionId:       z.string(),
      documentContent: z.string(),
      legalBasisRefs:  z.array(z.string()).optional(),
      contextFragments: z.array(z.string()).optional(),
      complianceRules: z.array(z.object({
        ruleId:     z.string(),
        ruleName:   z.string(),
        legalBasis: z.string(),
        expression: z.string(),
      })).optional(),
    }))
    .mutation(({ ctx, input }) =>
      runLegalReasoning({
        organizationId:   ctx.organizationId,
        sessionId:        input.sessionId,
        documentContent:  input.documentContent,
        legalBasisRefs:   input.legalBasisRefs ?? ["Lei 14133/2021"],
        contextFragments: input.contextFragments,
        complianceRules:  input.complianceRules,
      })
    ),

  validate: tenantProcedure
    .input(z.object({
      sessionId:   z.string(),
      targetType:  z.string(),
      targetId:    z.string(),
      content:     z.string(),
      customRules: z.array(z.object({
        name:        z.string(),
        description: z.string(),
        category:    z.enum(["compliance", "completeness", "consistency", "legal_basis", "format", "risk"]),
        severity:    z.enum(["error", "warning", "info"]),
        legalBasis:  z.string(),
        expression:  z.string(),
      })).optional(),
    }))
    .mutation(({ ctx, input }) =>
      runLegalValidation({
        organizationId: ctx.organizationId,
        sessionId:      input.sessionId,
        targetType:     input.targetType,
        targetId:       input.targetId,
        content:        input.content,
        customRules:    input.customRules,
      })
    ),

  explain: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => {
      const history = getReasoningHistory(ctx.organizationId, input.sessionId);
      const last = history[history.length - 1];
      if (!last) return null;
      return {
        traceId:         last.trace.id,
        premiseCount:    last.trace.premises.length,
        inferenceCount:  last.trace.inferences.length,
        riskCount:       last.trace.risks.length,
        contradictions:  last.trace.contradictions.length,
        complianceScore: last.complianceScore,
        riskScore:       last.riskScore,
        explainability:  last.explainability,
        replayKey:       last.replayKey,
      };
    }),

  listRisks: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => {
      const history = getReasoningHistory(ctx.organizationId, input.sessionId);
      const last = history[history.length - 1];
      return last?.topRisks ?? [];
    }),

  correlateJurisprudence: tenantProcedure
    .input(z.object({
      sessionId:       z.string(),
      documentContent: z.string(),
      legalBasisRefs:  z.array(z.string()).optional(),
      keywords:        z.array(z.string()).optional(),
    }))
    .mutation(({ ctx, input }) =>
      correlateJurisprudence({
        organizationId:  ctx.organizationId,
        sessionId:       input.sessionId,
        documentContent: input.documentContent,
        legalBasisRefs:  input.legalBasisRefs ?? ["Lei 14133/2021"],
        keywords:        input.keywords,
      })
    ),

  replayDraft: tenantProcedure
    .input(z.object({
      sessionId:   z.string(),
      newContent:  z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const history = getReasoningHistory(ctx.organizationId, input.sessionId);
      const last = history[history.length - 1];
      if (!last) throw new Error("Nenhuma análise encontrada para replay");
      return replayReasoning(last, input.newContent);
    }),

  getComplianceReport: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => {
      const history = getReasoningHistory(ctx.organizationId, input.sessionId);
      return history.map(h => ({
        replayKey:       h.replayKey,
        complianceScore: h.complianceScore,
        riskScore:       h.riskScore,
        checkedAt:       h.trace.createdAt,
        checksCount:     h.trace.complianceChecks.length,
        risksCount:      h.trace.risks.length,
      }));
    }),

  previewDraft: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => {
      const history = getReasoningHistory(ctx.organizationId, input.sessionId);
      const last = history[history.length - 1];
      return last ? {
        topRecommendations: last.topRecommendations,
        explainability:     last.explainability,
        premiseCount:       last.trace.premises.length,
      } : null;
    }),
});
