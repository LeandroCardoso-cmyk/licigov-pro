/**
 * Sprint 4.9 — Copilot Evaluation Service
 *
 * Avalia a qualidade de uma recomendação: confiança, aderência à política,
 * cobertura de fundamentação e feedback do usuário. Puro e determinístico.
 */

import { aggregateRiskLevel, type CopilotRecommendation } from "../domain/copilotRecommendation";
import type { PolicyEvaluation } from "../domain/copilotPolicy";

export interface CopilotEvaluation {
  readonly recommendationId: string;
  readonly qualityScore: number;
  readonly confidence: number;
  readonly policyAdherent: boolean;
  readonly requiresApproval: boolean;
  readonly groundingCoverage: number;
  readonly riskLevel: string;
  readonly verdict: "aprovavel" | "revisar" | "insuficiente";
  readonly notes: string[];
}

export type UserFeedback = "util" | "parcial" | "inutil";

/**
 * Avalia a recomendação combinando confiança, fundamentação (evidências + base
 * legal) e conformidade com a política. Não decide — sinaliza para o servidor.
 */
export function evaluateRecommendation(
  recommendation: CopilotRecommendation,
  policyEval: PolicyEvaluation,
): CopilotEvaluation {
  const notes: string[] = [];

  // Cobertura de fundamentação: evidências + base legal presentes.
  const hasEvidence = recommendation.evidenceIds.length > 0;
  const hasLegal = recommendation.legalBasis.length > 0;
  const groundingCoverage =
    (hasEvidence ? 0.6 : 0) + (hasLegal ? 0.4 : 0);
  if (!hasEvidence) notes.push("Sem evidências institucionais.");
  if (!hasLegal) notes.push("Sem base legal explícita.");

  // Qualidade: média ponderada de confiança e cobertura.
  const qualityScore = Math.max(0, Math.min(1, recommendation.confidence * 0.6 + groundingCoverage * 0.4));

  const riskLevel = aggregateRiskLevel(recommendation);
  if (riskLevel === "alto" || riskLevel === "critico") {
    notes.push(`Risco agregado ${riskLevel} — aprovação humana obrigatória.`);
  }
  if (!policyEval.allowed) {
    notes.push("Recomendação viola a política do copiloto.");
  }

  let verdict: CopilotEvaluation["verdict"];
  if (!policyEval.allowed || qualityScore < 0.35) verdict = "insuficiente";
  else if (policyEval.requiresApproval || qualityScore < 0.6) verdict = "revisar";
  else verdict = "aprovavel";

  return {
    recommendationId: recommendation.id,
    qualityScore,
    confidence: recommendation.confidence,
    policyAdherent: policyEval.allowed,
    requiresApproval: policyEval.requiresApproval,
    groundingCoverage,
    riskLevel,
    verdict,
    notes,
  };
}

/** Ajusta o score de qualidade com base no feedback do usuário (loop de melhoria). */
export function applyUserFeedback(evaluation: CopilotEvaluation, feedback: UserFeedback): CopilotEvaluation {
  const delta = feedback === "util" ? 0.1 : feedback === "inutil" ? -0.2 : 0;
  return {
    ...evaluation,
    qualityScore: Math.max(0, Math.min(1, evaluation.qualityScore + delta)),
    notes: [...evaluation.notes, `Feedback do usuário: ${feedback}.`],
  };
}
