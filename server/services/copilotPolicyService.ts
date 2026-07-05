/**
 * Sprint 4.9 — Copilot Policy Service
 *
 * Aplica limites operacionais, permissões e supervisão. Deriva a política padrão
 * de cada copiloto a partir de sua definição e avalia se uma recomendação pode
 * ser emitida sem escalonamento. Puro e determinístico.
 */

import type { CopilotType } from "../domain/institutionalCopilot";
import { getCopilotDefinition } from "../domain/institutionalCopilot";
import {
  createCopilotPolicy,
  evaluatePolicy,
  type CopilotPolicy,
  type PolicyEvaluation,
} from "../domain/copilotPolicy";
import { aggregateRiskLevel, type CopilotRecommendation } from "../domain/copilotRecommendation";

/** Constrói a política padrão de um copiloto a partir de sua definição. */
export function defaultPolicyFor(
  organizationId: number,
  copilotType: CopilotType,
  correlationId = "",
): CopilotPolicy {
  const def = getCopilotDefinition(copilotType);
  return createCopilotPolicy({
    organizationId,
    copilotType,
    name: `Política padrão — ${def.name}`,
    allowedActions: [...def.capabilities, "emit_recommendation"],
    forbiddenActions: [...def.forbiddenActions],
    approvalRiskThreshold: "alto",
    correlationId,
  });
}

/**
 * Avalia se uma recomendação respeita a política do copiloto. Determina se pode
 * ser emitida e se exige aprovação humana obrigatória (governança).
 */
export function enforceRecommendationPolicy(
  policy: CopilotPolicy,
  recommendation: CopilotRecommendation,
): PolicyEvaluation {
  return evaluatePolicy(policy, {
    action: "emit_recommendation",
    confidence: recommendation.confidence,
    riskLevel: aggregateRiskLevel(recommendation),
  });
}

/** Verifica diretamente se uma ação é permitida para o copiloto. */
export function isActionAllowed(
  organizationId: number,
  copilotType: CopilotType,
  action: string,
): boolean {
  const policy = defaultPolicyFor(organizationId, copilotType);
  return evaluatePolicy(policy, { action, confidence: 1, riskLevel: "nenhum" }).allowed;
}
