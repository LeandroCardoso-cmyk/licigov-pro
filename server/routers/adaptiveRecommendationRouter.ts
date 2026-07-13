/**
 * SPRINT 5.X.X — Adaptive Recommendation Router (operacional, reutilizável).
 *
 * Endpoint único usado por TODOS os Business Domains para obter recomendações
 * orientadoras (nunca decisões) e registrar a escolha do servidor. O sistema
 * apenas recomenda; o servidor sempre decide e nunca é bloqueado. tenantProcedure.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { recommend, decide } from "../services/adaptiveRecommendationService";
import { recommendStep, type RecommendableStep } from "../domain/adaptiveRecommendationEngine";
import type { BusinessDomainCode } from "../domain/businessDomain";

const DOMAINS = ["processo_licitatorio", "contratacao_direta", "contratos", "parecer_juridico", "gestao_departamento"] as const;
const STEPS = ["dfd", "etp", "pesquisa_precos", "tr", "edital", "parecer_juridico", "aditivo", "apostilamento", "publicacao", "proposta"] as const;

export const adaptiveRecommendationRouter = router({
  /** Recomenda uma etapa com fundamentação, base legal, confiança e alternativas. */
  recommend: tenantProcedure
    .input(z.object({
      domain: z.enum(DOMAINS),
      step: z.enum(STEPS),
      objeto: z.string().optional(),
      modalidade: z.string().optional(),
      valor: z.number().optional(),
      variant: z.string().optional(),
    }))
    .query(({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const recommendation = recommend({
        organizationId: orgId, domain: input.domain as BusinessDomainCode, correlationId: ctx.correlationId,
        context: { step: input.step as RecommendableStep, objeto: input.objeto, modalidade: input.modalidade, valor: input.valor, variant: input.variant },
      });
      return { recommendation };
    }),

  /** Registra a escolha do servidor (aceitar/recusar). Nunca bloqueia o fluxo. */
  decide: tenantProcedure
    .input(z.object({
      domain: z.enum(DOMAINS),
      step: z.enum(STEPS),
      accept: z.boolean(),
      justification: z.string().optional(),
      objeto: z.string().optional(),
      modalidade: z.string().optional(),
      valor: z.number().optional(),
      variant: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const recommendation = recommendStep({ step: input.step as RecommendableStep, objeto: input.objeto, modalidade: input.modalidade, valor: input.valor, variant: input.variant });
      const decision = decide({
        organizationId: orgId, domain: input.domain as BusinessDomainCode, correlationId: ctx.correlationId,
        recommendation, accept: input.accept, justification: input.justification,
      });
      return { decision };
    }),
});
