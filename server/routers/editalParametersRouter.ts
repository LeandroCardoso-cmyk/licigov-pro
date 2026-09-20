import { tenantProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

/**
 * Parâmetros do edital — TENANT-SCOPED (correção de IDOR cross-tenant).
 *
 * Antes: `protectedProcedure` + `processId` vindo do cliente sem qualquer verificação de dono/org.
 * Qualquer usuário autenticado podia LER (get) os parâmetros do edital de outra organização
 * (modalidade, formato, critério de julgamento, regime) e SOBRESCREVÊ-LOS (save) enumerando o
 * `processId`, além de injetar activity logs em processo alheio. Agora deriva `organizationId` do
 * contexto do servidor (`tenantProcedure`) e valida que o processo pertence à organização
 * (`getProcessByIdForOrganization`) antes de qualquer leitura/escrita — mesmo guard já usado em
 * downloadRouter/platformsRouter/collaborationRouter. Invariante multi-tenant do PRODUCT_NORTH_STAR.
 */
async function assertProcessInOrg(processId: number, organizationId: number) {
  const process = await db.getProcessByIdForOrganization(processId, organizationId);
  if (!process) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
  }
}

export const editalParametersRouter = router({
  save: tenantProcedure
    .input(z.object({
      processId: z.number(),
      modalidade: z.string().optional(),
      formato: z.enum(["presencial", "eletronico"]).optional(),
      criterioJulgamento: z.string().optional(),
      regimeContratacao: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProcessInOrg(input.processId, ctx.organizationId);
      await db.upsertEditalParameters({
        processId: input.processId,
        modalidade: input.modalidade,
        formato: input.formato,
        criterioJulgamento: input.criterioJulgamento,
        regimeContratacao: input.regimeContratacao,
      });
      await db.createActivityLogForOrganization(
        {
          processId: input.processId,
          userId: ctx.user.id,
          action: "atualizou os parâmetros do edital",
        },
        ctx.organizationId,
      );
      return { success: true };
    }),

  get: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProcessInOrg(input.processId, ctx.organizationId);
      return await db.getEditalParametersByProcess(input.processId);
    }),
});
