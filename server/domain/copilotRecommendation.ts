/**
 * Sprint 4.9 — Copilot Recommendation
 *
 * Recomendação fundamentada emitida por um copiloto. Toda recomendação é
 * editável, revisável e validada por humano — nunca uma decisão. Inclui riscos,
 * alternativas, fundamentação legal e nível de confiança. Determinística.
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export type RecommendationKind =
  | "orientacao"
  | "revisao"
  | "sugestao_melhoria"
  | "alerta_risco"
  | "fundamentacao"
  | "estruturacao";

export interface RecommendationRisk {
  readonly description: string;
  readonly severity: "baixo" | "medio" | "alto" | "critico";
  readonly mitigation: string;
}

export interface RecommendationAlternative {
  readonly description: string;
  readonly rationale: string;
}

export interface CopilotRecommendation {
  readonly id: string;
  readonly organizationId: number;
  readonly sessionId: string;
  readonly copilotType: CopilotType;
  readonly kind: RecommendationKind;
  readonly summary: string;
  readonly suggestions: readonly string[];
  readonly risks: readonly RecommendationRisk[];
  readonly alternatives: readonly RecommendationAlternative[];
  readonly justification: string;
  readonly legalBasis: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly confidence: number;
  /** Sempre verdadeiro: toda recomendação exige revisão humana. */
  readonly requiresHumanReview: boolean;
  readonly reviewNotice: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export const MANDATORY_REVIEW_NOTICE =
  "Esta recomendação é um apoio técnico gerado por IA. Deve ser revisada e validada por servidor competente antes de qualquer uso. Não constitui decisão nem parecer definitivo.";

export function createCopilotRecommendation(params: {
  organizationId: number;
  sessionId: string;
  copilotType: CopilotType;
  kind: RecommendationKind;
  summary: string;
  suggestions?: string[];
  risks?: RecommendationRisk[];
  alternatives?: RecommendationAlternative[];
  justification?: string;
  legalBasis?: string[];
  evidenceIds?: string[];
  confidence?: number;
  correlationId?: string;
  createdAt?: string;
}): CopilotRecommendation {
  const id = createHash("sha256")
    .update(`crec:${params.organizationId}:${params.sessionId}:${params.kind}:${params.summary}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    copilotType: params.copilotType,
    kind: params.kind,
    summary: params.summary,
    suggestions: params.suggestions ?? [],
    risks: params.risks ?? [],
    alternatives: params.alternatives ?? [],
    justification: params.justification ?? "",
    legalBasis: params.legalBasis ?? [],
    evidenceIds: params.evidenceIds ?? [],
    confidence: params.confidence ?? 0.5,
    requiresHumanReview: true,
    reviewNotice: MANDATORY_REVIEW_NOTICE,
    correlationId: params.correlationId ?? "",
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Nível de risco agregado de uma recomendação (máximo dos riscos listados). */
export function aggregateRiskLevel(rec: CopilotRecommendation): "nenhum" | "baixo" | "medio" | "alto" | "critico" {
  const rank: Record<RecommendationRisk["severity"], number> = { baixo: 1, medio: 2, alto: 3, critico: 4 };
  let max = 0;
  for (const r of rec.risks) max = Math.max(max, rank[r.severity]);
  return (["nenhum", "baixo", "medio", "alto", "critico"] as const)[max];
}
