import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";

export const editalParametersRouter = router({
  save: protectedProcedure
    .input(z.object({
      processId: z.number(),
      modalidade: z.string().optional(),
      formato: z.enum(["presencial", "eletronico"]).optional(),
      criterioJulgamento: z.string().optional(),
      regimeContratacao: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.upsertEditalParameters({
        processId: input.processId,
        modalidade: input.modalidade,
        formato: input.formato,
        criterioJulgamento: input.criterioJulgamento,
        regimeContratacao: input.regimeContratacao,
      });
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: "atualizou os parâmetros do edital",
      });
      return { success: true };
    }),

  get: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ input }) => {
      return await db.getEditalParametersByProcess(input.processId);
    }),
});
