/**
 * SPRINT 5.X.X — Adaptive Recommendation Service
 *
 * Camada de serviço do Adaptive Recommendation Engine. Expõe recomendações a
 * TODOS os Business Domains, sempre via kernelAccessService (explainability +
 * institutional_rag). O sistema apenas recomenda — a decisão é do servidor.
 * Determinístico, multi-tenant. Emissão estruturada para observabilidade.
 */

import { assertKernelAccess } from "./kernelAccessService";
import {
  recommendStep, acceptRecommendation, declineRecommendation,
  type RecommendationContext, type StepRecommendation, type StepDecision,
} from "../domain/adaptiveRecommendationEngine";
import type { BusinessDomainCode } from "../domain/businessDomain";

/** Gera uma recomendação orientadora (nunca decisão) para uma etapa do domínio. */
export function recommend(params: {
  organizationId: number;
  domain: BusinessDomainCode;
  correlationId: string;
  context: RecommendationContext;
}): StepRecommendation {
  // Acesso ao Kernel exclusivamente pela porta oficial.
  assertKernelAccess(params.domain, "explainability");
  assertKernelAccess(params.domain, "institutional_rag");
  const recommendation = recommendStep(params.context);
  console.info(JSON.stringify({
    metric: "adaptive_recommendation",
    organizationId: params.organizationId,
    correlationId: params.correlationId,
    domain: params.domain,
    step: recommendation.step,
    recommended: recommendation.recommended,
    confidence: recommendation.confidence,
  }));
  return recommendation;
}

/** Registra a escolha do servidor (aceitar/recusar). Nunca bloqueia o fluxo. */
export function decide(params: {
  organizationId: number;
  domain: BusinessDomainCode;
  correlationId: string;
  recommendation: StepRecommendation;
  accept: boolean;
  justification?: string;
}): StepDecision {
  const decision = params.accept
    ? acceptRecommendation(params.recommendation)
    : declineRecommendation(params.recommendation, params.justification ?? "");
  console.info(JSON.stringify({
    metric: "adaptive_recommendation_decision",
    organizationId: params.organizationId,
    correlationId: params.correlationId,
    domain: params.domain,
    step: decision.step,
    decision: decision.decision,
  }));
  return decision;
}
