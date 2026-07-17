/**
 * RC-5.1 — "Tirar Dúvidas" (Institutional Consultation) · Router (tRPC).
 *
 * Expõe o Business Domain de consulta institucional. Multi-tenant via `tenantProcedure`
 * (isolamento por organização). Delega toda a lógica ao service, que executa EXCLUSIVAMENTE
 * pelo fluxo institucional (ContextPackage + AIExecutionEngine). Sem caminhos alternativos.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import { answerConsultation } from "../services/institutionalConsultationService";
import { getConsultationHistory } from "../services/institutionalConsultationObservabilityService";
import { INITIAL_CONSULTATION_SUGGESTIONS, CONSULTATION_DOMAIN_NAME } from "../domain/institutionalConsultation";

export const institutionalConsultationRouter = router({
  /** Sugestões iniciais de consulta (a página não parece um chat comum). */
  suggestions: tenantProcedure.query(() => ({
    domain: CONSULTATION_DOMAIN_NAME,
    suggestions: INITIAL_CONSULTATION_SUGGESTIONS,
  })),

  /** Envia uma dúvida e recebe uma resposta fundamentada, explicável e auditável. */
  ask: tenantProcedure
    .input(z.object({ question: z.string().min(3, "Digite sua dúvida.").max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      try {
        const answer = await answerConsultation({
          organizationId: orgId,
          userId: ctx.user.id,
          question: input.question,
          correlationId: ctx.correlationId,
        });
        return { answer };
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha na consulta." });
      }
    }),

  /** Histórico de consultas do tenant (auditoria) — isolado por organização. */
  history: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const entries = getConsultationHistory(orgId, input?.limit ?? 50);
      return { entries, total: entries.length };
    }),
});
