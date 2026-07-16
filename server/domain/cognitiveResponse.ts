/**
 * RC-4.0.1 — Cognitive Response (contrato UNIVERSAL da IA).
 *
 * Contrato cognitivo definitivo. Nenhum copiloto devolve "texto solto": toda saída de
 * IA é uma CognitiveResponse estruturada. O contrato NÃO pressupõe texto — pode carregar
 * qualquer payload estruturado (objeto, lista, matriz, árvore, grafo, comparação, matching,
 * classificação, análise) via `structuredData` (opcional, nullable), mantendo o campo
 * textual `content` por compatibilidade.
 *
 * Explainability e replayHash são obrigatórios. Governança: revisão humana obrigatória.
 */

import { createHash } from "crypto";
import type { CognitiveTaskId } from "./cognitiveTask";

/** Versão do contrato cognitivo (observabilidade/evolução). */
export const COGNITIVE_RESPONSE_CONTRACT_VERSION = "cognitive-response/1.1";

/** Tipos de resposta que o contrato suporta — nunca presume texto. */
export type CognitiveResponseType =
  | "text" | "object" | "list" | "matrix" | "tree" | "graph"
  | "comparison" | "matching" | "classification" | "analysis";

/** Explicabilidade obrigatória: por que respondeu, o que usou, o que descartou. */
export interface CognitiveExplainability {
  readonly whyAnswered: string;
  readonly documentsUsed: readonly string[];
  readonly lawsUsed: readonly string[];
  readonly discardedRecommendations: readonly string[];
  readonly confidence: number;
  readonly limitations: readonly string[];
  // RC-4.2 — Institutional Reasoning (opcionais para compatibilidade):
  /** Regras institucionais aplicadas no raciocínio. */
  readonly rulesApplied?: readonly string[];
  /** Alternativas consideradas no plano de raciocínio. */
  readonly alternativesConsidered?: readonly string[];
  /** Alternativas descartadas + motivo (nada implícito). */
  readonly discardedAlternatives?: readonly { readonly alternative: string; readonly reason: string }[];
}

export interface CognitiveResponse {
  readonly contractVersion: string;
  readonly task: CognitiveTaskId;
  readonly responseType: CognitiveResponseType;
  /** Representação textual (sempre presente; pode ser resumo). Compatibilidade. */
  readonly content: string;
  /** Payload estruturado — OPCIONAL e nullable. Qualquer forma (objeto/lista/matriz/…). */
  readonly structuredData?: unknown;
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

export function createCognitiveResponse(
  params: Omit<CognitiveResponse, "requiresHumanReview" | "contractVersion"> & { contractVersion?: string },
): CognitiveResponse {
  return {
    contractVersion: params.contractVersion ?? COGNITIVE_RESPONSE_CONTRACT_VERSION,
    ...params,
    requiresHumanReview: true,
  };
}

export interface CognitiveResponseValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Explainability Contract (RC-4.0.1): toda resposta válida contém obrigatoriamente
 * reasoning, confidence ∈ [0,1], sources, limitations, requiresHumanReview e replayHash,
 * além de explicabilidade preenchida e um payload (content OU structuredData). Structured
 * Output — nunca texto solto. Falha explícita quando qualquer campo obrigatório falta.
 */
export function validateCognitiveResponse(res: CognitiveResponse): CognitiveResponseValidation {
  const errors: string[] = [];
  const hasPayload = (typeof res.content === "string" && res.content.trim().length > 0)
    || (res.structuredData !== undefined && res.structuredData !== null);
  if (!hasPayload) errors.push("payload ausente (content e structuredData vazios)");
  if (!res.reasoning || res.reasoning.trim().length === 0) errors.push("reasoning ausente");
  if (typeof res.confidence !== "number" || res.confidence < 0 || res.confidence > 1) errors.push("confidence fora de [0,1]");
  if (!Array.isArray(res.sources)) errors.push("sources ausente");
  if (!Array.isArray(res.limitations)) errors.push("limitations ausente");
  if (!res.replayHash || res.replayHash.length !== 32) errors.push("replayHash inválido");
  if (!res.explainability || !res.explainability.whyAnswered) errors.push("explainability ausente");
  if (res.requiresHumanReview !== true) errors.push("requiresHumanReview deve ser true");
  return { valid: errors.length === 0, errors };
}

/** Erro explícito quando uma resposta inválida tenta sair do Engine. */
export class InvalidCognitiveResponse extends Error {
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`CognitiveResponse inválida: ${errors.join("; ")}`);
    this.name = "InvalidCognitiveResponse";
    this.errors = errors;
  }
}

/** Tamanho serializado do structuredData (0 quando ausente) — para observabilidade. */
export function structuredDataSize(data: unknown): number {
  if (data === undefined || data === null) return 0;
  try { return JSON.stringify(data).length; } catch { return 0; }
}

/** Hash determinístico da forma da resposta (para observabilidade — NÃO é o replayHash oficial). */
export function responseShapeHash(res: Pick<CognitiveResponse, "task" | "responseType">, dataSize: number): string {
  return createHash("sha256").update(JSON.stringify({ task: res.task, type: res.responseType, size: dataSize })).digest("hex").slice(0, 16);
}
