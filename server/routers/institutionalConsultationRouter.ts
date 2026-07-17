/**
 * RC-5.1 — "Tirar Dúvidas" (Institutional Consultation) · Router (tRPC).
 *
 * Expõe o Business Domain de consulta institucional. Multi-tenant via `tenantProcedure`
 * (isolamento por organização em TODA operação). O histórico vem do repository (banco = fonte de
 * verdade), não de memória. Delega a lógica ao service, que executa EXCLUSIVAMENTE pelo fluxo
 * institucional (ContextPackage + AIExecutionEngine). Sem caminhos alternativos.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import {
  answerConsultation, listTenantHistory, listUserHistory, getConsultationForTenant, getConsultationSources,
} from "../services/institutionalConsultationService";
import { INITIAL_CONSULTATION_SUGGESTIONS, CONSULTATION_DOMAIN_NAME } from "../domain/institutionalConsultation";

const pageInput = z.object({ limit: z.number().min(1).max(100).optional(), offset: z.number().min(0).optional() }).optional();

export const institutionalConsultationRouter = router({
  /** Sugestões iniciais de consulta (a página não parece um chat comum). */
  suggestions: tenantProcedure.query(() => ({
    domain: CONSULTATION_DOMAIN_NAME,
    suggestions: INITIAL_CONSULTATION_SUGGESTIONS,
  })),

  /** Envia uma dúvida e recebe uma resposta fundamentada, explicável e auditável (persistida). */
  ask: tenantProcedure
    .input(z.object({ question: z.string().min(3, "Digite sua dúvida.").max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      try {
        const answer = await answerConsultation({
          organizationId: orgId, userId: ctx.user.id, question: input.question, correlationId: ctx.correlationId,
        });
        return { answer };
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha na consulta." });
      }
    }),

  /** Histórico do tenant (auditoria durável) — paginado, ordenado por data, isolado por organização. */
  history: tenantProcedure
    .input(pageInput)
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const entries = await listTenantHistory(orgId, { limit: input?.limit ?? 50, offset: input?.offset ?? 0 });
      return { entries, total: entries.length };
    }),

  /** Histórico do usuário atual (isolado por organização). */
  myHistory: tenantProcedure
    .input(pageInput)
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const entries = await listUserHistory(orgId, ctx.user.id, { limit: input?.limit ?? 50, offset: input?.offset ?? 0 });
      return { entries, total: entries.length };
    }),

  /** Recupera uma consulta específica (valida o tenant; id de outro tenant → NOT_FOUND). */
  get: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const consultation = await getConsultationForTenant(orgId, input.id);
      if (!consultation) throw new TRPCError({ code: "NOT_FOUND", message: "Consulta não encontrada." });
      const sources = await getConsultationSources(orgId, input.id);
      return { consultation, sources };
    }),

  /** Recupera as fontes/evidências de uma consulta (isolado por organização). */
  sources: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const sources = await getConsultationSources(orgId, input.id);
      return { sources };
    }),
});
