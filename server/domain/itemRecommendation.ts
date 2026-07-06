/**
 * Sprint 5.1 — Item Recommendation & Risk
 *
 * Toda recomendação possui reasoning, explainability, provenance, confidence e
 * possibilidade de rejeição. Nada bloqueia o servidor — sempre explica. Riscos
 * são identificados (direcionamento, baixa competitividade, preço fora da curva),
 * nunca ocultados. Determinístico.
 */

import { createHash } from "crypto";

export type RecommendationType =
  | "catmat"
  | "especificacao"
  | "preco"
  | "competitividade"
  | "padronizacao"
  | "juridico";

export interface ItemRecommendation {
  readonly id: string;
  readonly itemId: string;
  readonly organizationId: number;
  readonly type: RecommendationType;
  readonly summary: string;
  readonly reasoning: string;
  readonly explainability: string;
  readonly provenance: string;
  readonly confidence: number;
  readonly rejectable: boolean;
  readonly accepted: boolean | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createItemRecommendation(params: {
  itemId: string;
  organizationId: number;
  type: RecommendationType;
  summary: string;
  reasoning: string;
  explainability?: string;
  provenance?: string;
  confidence?: number;
  correlationId: string;
  createdAt?: string;
}): ItemRecommendation {
  const id = createHash("sha256")
    .update(`irec:${params.organizationId}:${params.itemId}:${params.type}:${params.summary}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    itemId: params.itemId,
    organizationId: params.organizationId,
    type: params.type,
    summary: params.summary,
    reasoning: params.reasoning,
    explainability: params.explainability ?? "",
    provenance: params.provenance ?? "kernel",
    confidence: params.confidence ?? 0.5,
    rejectable: true,
    accepted: null,
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

export function acceptRecommendation(rec: ItemRecommendation): ItemRecommendation {
  return { ...rec, accepted: true };
}

export function rejectRecommendation(rec: ItemRecommendation): ItemRecommendation {
  return { ...rec, accepted: false };
}

// ─── Riscos do item ─────────────────────────────────────────────────────────

export type ItemRiskType =
  | "direcionamento"
  | "baixa_competitividade"
  | "catmat_inadequado"
  | "especificacao_excessiva"
  | "especificacao_insuficiente"
  | "preco_fora_da_curva"
  | "inconsistencia";

export type RiskSeverity = "baixo" | "medio" | "alto" | "critico";

export interface ItemRisk {
  readonly id: string;
  readonly itemId: string;
  readonly organizationId: number;
  readonly type: ItemRiskType;
  readonly severity: RiskSeverity;
  readonly description: string;
  readonly explanation: string;
  readonly blocking: false;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createItemRisk(params: {
  itemId: string;
  organizationId: number;
  type: ItemRiskType;
  severity?: RiskSeverity;
  description: string;
  explanation?: string;
  correlationId: string;
  createdAt?: string;
}): ItemRisk {
  const id = createHash("sha256")
    .update(`irisk:${params.organizationId}:${params.itemId}:${params.type}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    itemId: params.itemId,
    organizationId: params.organizationId,
    type: params.type,
    severity: params.severity ?? "medio",
    description: params.description,
    explanation: params.explanation ?? "",
    blocking: false, // alertas NUNCA bloqueiam — sempre explicam
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Detecta preço fora da curva (fornecedor cujo valor desvia > 50% da média).
 * Determinístico. Não bloqueia — apenas sinaliza.
 */
export function detectPriceOutlier(values: readonly number[]): { outlier: boolean; average: number } {
  const valid = values.filter(v => v > 0);
  if (valid.length < 2) return { outlier: false, average: valid[0] ?? 0 };
  const average = valid.reduce((a, b) => a + b, 0) / valid.length;
  const outlier = valid.some(v => Math.abs(v - average) / average > 0.5);
  return { outlier, average };
}
