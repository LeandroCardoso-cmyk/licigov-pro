/**
 * RC-4.0 — Cognitive Response (modelo único de resposta cognitiva).
 *
 * Nenhum copiloto pode devolver "texto solto": toda saída de IA é uma CognitiveResponse
 * estruturada, com conteúdo, reasoning, confidence, fontes, leis, jurisprudência,
 * documentos utilizados, recomendações, alternativas, riscos, limitações, telemetria
 * (tokens/tempo/provider/modelo) e replayHash.
 *
 * Toda resposta carrega Explainability obrigatória (Part 8) e é supervisionada por humano.
 */

import { createHash } from "crypto";
import type { CognitiveTaskId } from "./cognitiveTask";

/** Explicabilidade obrigatória: por que respondeu, o que usou, o que descartou. */
export interface CognitiveExplainability {
  readonly whyAnswered: string;
  readonly documentsUsed: readonly string[];
  readonly lawsUsed: readonly string[];
  readonly discardedRecommendations: readonly string[];
  readonly confidence: number;
  readonly limitations: readonly string[];
}

export interface CognitiveResponse {
  readonly task: CognitiveTaskId;
  readonly content: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly sources: readonly string[];
  readonly laws: readonly string[];
  readonly jurisprudence: readonly string[];
  readonly documentsUsed: readonly string[];
  readonly recommendations: readonly string[];
  readonly alternatives: readonly string[];
  readonly risks: readonly string[];
  readonly limitations: readonly string[];
  readonly explainability: CognitiveExplainability;
  readonly tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
  readonly latencyMs: number;
  readonly provider: string;
  readonly model: string;
  readonly replayHash: string;
  /** Governança: toda saída de IA exige revisão humana. */
  readonly requiresHumanReview: true;
}

export function createCognitiveResponse(params: Omit<CognitiveResponse, "requiresHumanReview">): CognitiveResponse {
  return { ...params, requiresHumanReview: true };
}

export interface CognitiveResponseValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Valida que a resposta NÃO é texto solto: precisa de conteúdo, reasoning, confidence
 * no intervalo [0,1], explicabilidade preenchida e replayHash. Structured Output.
 */
export function validateCognitiveResponse(res: CognitiveResponse): CognitiveResponseValidation {
  const errors: string[] = [];
  if (!res.content || res.content.trim().length === 0) errors.push("content vazio");
  if (!res.reasoning || res.reasoning.trim().length === 0) errors.push("reasoning ausente");
  if (typeof res.confidence !== "number" || res.confidence < 0 || res.confidence > 1) errors.push("confidence fora de [0,1]");
  if (!res.replayHash || res.replayHash.length !== 32) errors.push("replayHash inválido");
  if (!res.explainability || !res.explainability.whyAnswered) errors.push("explainability ausente");
  if (res.requiresHumanReview !== true) errors.push("requiresHumanReview deve ser true");
  return { valid: errors.length === 0, errors };
}

/** Hash determinístico da resposta (task + conteúdo determinístico). */
export function responseReplayHash(task: CognitiveTaskId, content: string, provider: string, model: string): string {
  return createHash("sha256").update(JSON.stringify({ task, content, provider, model })).digest("hex").slice(0, 32);
}
