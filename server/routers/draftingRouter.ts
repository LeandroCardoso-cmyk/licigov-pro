import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { runDocumentDrafting, getDraftHistory, replayDrafting } from "../services/documentDraftingEngine";
import { generateClauseRecommendations } from "../services/clauseRecommendationService";
import { runStructuredGeneration } from "../services/structuredGenerationService";
import { getReasoningHistory } from "../services/legalReasoningEngine";

export const draftingRouter = router({
  generateDraft: tenantProcedure
    .input(z.object({
      sessionId:      z.string(),
      documentType:   z.string(),
      variableValues: z.record(z.string()),
      templateId:     z.string().optional(),
      legalFramework: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      runDocumentDrafting({
        organizationId: ctx.organizationId,
        sessionId:      input.sessionId,
        documentType:   input.documentType,
        variableValues: input.variableValues,
        templateId:     input.templateId,
        legalFramework: input.legalFramework,
      })
    ),

  recommendClauses: tenantProcedure
    .input(z.object({
      sessionId:      z.string(),
      clauses:        z.array(z.object({
        id:           z.string(),
        content:      z.string(),
        legalBasis:   z.string().optional(),
        clauseType:   z.string().optional(),
      })),
      documentType:   z.string().optional(),
      legalFramework: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      generateClauseRecommendations({
        organizationId: ctx.organizationId,
        sessionId:      input.sessionId,
        clauses:        input.clauses,
        documentType:   input.documentType,
        legalFramework: input.legalFramework,
      })
    ),

  compareClauses: tenantProcedure
    .input(z.object({
      sessionId: z.string(),
      clauses:   z.array(z.object({
        id:      z.string(),
        content: z.string(),
      })),
    }))
    .mutation(({ ctx, input }) => {
      const { checkClauseCompatibility } = require("../domain/clauseIntelligence");
      if (input.clauses.length < 2) return { results: [], message: "Mínimo 2 cláusulas para comparação" };
      const results = [];
      for (let i = 0; i < input.clauses.length; i++) {
        for (let j = i + 1; j < input.clauses.length; j++) {
          results.push(checkClauseCompatibility(
            input.clauses[i].id,
            input.clauses[j].id,
            input.clauses[i].content,
            input.clauses[j].content,
            ctx.organizationId,
          ));
        }
      }
      return { results, message: `${results.length} pares comparados` };
    }),

  inspectReasoning: tenantProcedure
    .input(z.object({
      sessionId: z.string(),
      documentType:   z.string().optional(),
      legalBasisRefs: z.array(z.string()).optional(),
      variableValues: z.record(z.string()).optional(),
    }))
    .mutation(({ ctx, input }) =>
      runStructuredGeneration({
        organizationId: ctx.organizationId,
        sessionId:      input.sessionId,
        documentType:   input.documentType ?? "geral",
        variableValues: input.variableValues ?? {},
        legalBasisRefs: input.legalBasisRefs ?? ["Lei 14133/2021"],
      })
    ),
});
