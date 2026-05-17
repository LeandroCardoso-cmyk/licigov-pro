import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import {
  suggestModality,
  suggestRisks,
  suggestClauses,
  suggestTechnicalRequirements,
  suggestLegalBasis,
  improveText,
} from "../services/ai/suggestions";
import type { ProcessContext } from "../services/ai/promptBuilder";

async function buildContext(processId: number, userId: number): Promise<ProcessContext> {
  const process = await db.getProcessById(processId);
  if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });

  const docs = await db.getDocumentsByProcess(processId);
  const get = (type: string) => docs.find((d) => d.type === type)?.content ?? null;

  return {
    name: process.name,
    object: process.object || "",
    estimatedValue: process.estimatedValue || 0,
    modality: process.modality,
    category: process.category,
    dfdContent: get("dfd"),
    etpContent: get("etp"),
    trContent: get("tr"),
    editalContent: get("edital"),
    contratoContent: get("contrato"),
  };
}

export const aiAssistantRouter = router({
  suggestModality: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const context = await buildContext(input.processId, ctx.user.id);
      const suggestion = await suggestModality(context);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: "solicitou sugestão de modalidade ao assistente de IA",
      });
      return { suggestion };
    }),

  suggestRisks: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const context = await buildContext(input.processId, ctx.user.id);
      const suggestion = await suggestRisks(context);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: "solicitou análise de riscos ao assistente de IA",
      });
      return { suggestion };
    }),

  suggestClauses: protectedProcedure
    .input(z.object({ processId: z.number(), clauseType: z.string().min(3).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const context = await buildContext(input.processId, ctx.user.id);
      const suggestion = await suggestClauses(context, input.clauseType);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `solicitou sugestão de cláusula "${input.clauseType}" ao assistente de IA`,
      });
      return { suggestion };
    }),

  suggestTechnicalRequirements: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const context = await buildContext(input.processId, ctx.user.id);
      const suggestion = await suggestTechnicalRequirements(context);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: "solicitou sugestão de exigências técnicas ao assistente de IA",
      });
      return { suggestion };
    }),

  suggestLegalBasis: protectedProcedure
    .input(z.object({ processId: z.number(), question: z.string().min(10).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const context = await buildContext(input.processId, ctx.user.id);
      const suggestion = await suggestLegalBasis(context, input.question);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: "solicitou fundamentação jurídica ao assistente de IA",
      });
      return { suggestion };
    }),

  improveText: protectedProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.string(),
      textSnippet: z.string().min(20).max(3000),
    }))
    .mutation(async ({ ctx, input }) => {
      const context = await buildContext(input.processId, ctx.user.id);
      const suggestion = await improveText(context, input.docType, input.textSnippet);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `solicitou melhoria de texto (${input.docType.toUpperCase()}) ao assistente de IA`,
      });
      return { suggestion };
    }),
});
