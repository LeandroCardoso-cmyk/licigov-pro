/**
 * Sprint 4.9 — Copilot Policy
 *
 * Limites operacionais e permissões de um copiloto. Garante que copilotos jamais
 * ultrapassem seu escopo (nunca decidem, nunca emitem parecer definitivo) e que
 * recomendações de alto risco exijam aprovação humana. Puro e determinístico.
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export interface CopilotPolicy {
  readonly id: string;
  readonly organizationId: number;
  readonly copilotType: CopilotType;
  readonly name: string;
  readonly allowedActions: readonly string[];
  readonly forbiddenActions: readonly string[];
  /** Confiança mínima para emitir recomendação sem escalonamento. */
  readonly minConfidence: number;
  /** Sempre exige revisão humana (governança padrão). */
  readonly requiresHumanApproval: boolean;
  /** Exige aprovação obrigatória quando risco agregado ≥ este nível. */
  readonly approvalRiskThreshold: "baixo" | "medio" | "alto" | "critico";
  readonly active: boolean;
  readonly version: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface PolicyEvaluation {
  readonly allowed: boolean;
  readonly requiresApproval: boolean;
  readonly violations: string[];
}

export function createCopilotPolicy(params: {
  organizationId: number;
  copilotType: CopilotType;
  name: string;
  allowedActions: string[];
  forbiddenActions: string[];
  minConfidence?: number;
  approvalRiskThreshold?: "baixo" | "medio" | "alto" | "critico";
  correlationId?: string;
  createdAt?: string;
}): CopilotPolicy {
  const id = createHash("sha256")
    .update(`cpol:${params.organizationId}:${params.copilotType}:${params.name}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    copilotType: params.copilotType,
    name: params.name,
    allowedActions: params.allowedActions,
    forbiddenActions: params.forbiddenActions,
    minConfidence: params.minConfidence ?? 0.4,
    requiresHumanApproval: true,
    approvalRiskThreshold: params.approvalRiskThreshold ?? "alto",
    active: true,
    version: 1,
    correlationId: params.correlationId ?? "",
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

const RISK_RANK: Record<"nenhum" | "baixo" | "medio" | "alto" | "critico", number> = {
  nenhum: 0, baixo: 1, medio: 2, alto: 3, critico: 4,
};

/**
 * Avalia se uma ação/recomendação respeita a política. Ações proibidas são
 * sempre bloqueadas; risco ≥ threshold ou confiança < mínima exigem aprovação.
 */
export function evaluatePolicy(
  policy: CopilotPolicy,
  params: {
    action: string;
    confidence: number;
    riskLevel: "nenhum" | "baixo" | "medio" | "alto" | "critico";
  },
): PolicyEvaluation {
  const violations: string[] = [];

  if (policy.forbiddenActions.includes(params.action)) {
    violations.push(`Ação "${params.action}" é proibida para o copiloto ${policy.copilotType}.`);
  }
  const allowed = violations.length === 0 &&
    (policy.allowedActions.length === 0 || policy.allowedActions.includes(params.action));

  if (!allowed && violations.length === 0) {
    violations.push(`Ação "${params.action}" não está na lista de ações permitidas.`);
  }

  const riskTriggersApproval =
    RISK_RANK[params.riskLevel] >= RISK_RANK[policy.approvalRiskThreshold];
  const lowConfidence = params.confidence < policy.minConfidence;
  const requiresApproval =
    policy.requiresHumanApproval || riskTriggersApproval || lowConfidence;

  return {
    allowed: violations.length === 0,
    requiresApproval,
    violations,
  };
}
