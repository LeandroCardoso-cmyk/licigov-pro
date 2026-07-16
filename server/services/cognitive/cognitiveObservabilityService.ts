/**
 * RC-4.0 — Cognitive Observability (infraestrutura, não dashboard).
 *
 * Toda execução cognitiva emite logs estruturados: execução, reasoning, provider,
 * grounding, RAG, Knowledge Graph, latência, uso de tokens e validação de Structured
 * Output. Determinístico e multi-tenant; mantém um registro em memória por
 * correlationId (para replay/testes) além de emitir log estruturado.
 */

import type { AIExecutionContext } from "../../domain/aiExecutionContext";
import { structuredDataSize, responseShapeHash, type CognitiveResponse, type CognitiveResponseValidation, type CognitiveResponseType } from "../../domain/cognitiveResponse";
import type { CognitiveTaskId } from "../../domain/cognitiveTask";
import { splitAlternatives, type InstitutionalReasoningPlan } from "../../domain/institutionalReasoning";

export interface CognitiveObservability {
  readonly correlationId: string;
  readonly task: CognitiveTaskId;
  readonly executionLog: string;
  readonly reasoningLog: string;
  readonly providerLog: string;
  readonly groundingLog: string;
  readonly ragLog: string;
  readonly knowledgeGraphLog: string;
  readonly latencyMs: number;
  readonly tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  readonly structuredOutputValid: boolean;
  readonly structuredOutputErrors: readonly string[];
  // RC-4.0.1 — contrato universal
  readonly responseType: CognitiveResponseType;
  readonly structuredDataPresent: boolean;
  readonly structuredDataSize: number;
  readonly responseShapeHash: string;
  readonly contractVersion: string;
  // RC-4.2 — Institutional Reasoning
  readonly reasoningPlanId: string;
  readonly reasoningPlanHash: string;
  readonly appliedRules: readonly string[];
  readonly alternativePaths: readonly string[];
  readonly discardedPaths: readonly string[];
  readonly knowledgeSources: readonly string[];
  readonly groundingUsed: boolean;
}

const _byCorrelation = new Map<string, CognitiveObservability>();

/**
 * Constrói e registra a observabilidade de uma execução cognitiva a partir do
 * contexto, da resposta e da validação de Structured Output.
 */
export function recordCognitiveObservability(params: {
  context: AIExecutionContext;
  response: CognitiveResponse;
  validation: CognitiveResponseValidation;
  reasoningPlan?: InstitutionalReasoningPlan;
}): CognitiveObservability {
  const { context, response, validation, reasoningPlan } = params;
  const g = context.grounding;
  const dataSize = structuredDataSize(response.structuredData);
  const alt = reasoningPlan ? splitAlternatives(reasoningPlan) : { recommended: "", discarded: [] };

  const obs: CognitiveObservability = {
    correlationId: context.request.correlationId,
    task: context.request.task,
    executionLog: `task=${context.request.task} tenant=${context.request.tenantId} ctx=${context.id} replay=${context.replayHash.slice(0, 8)}`,
    reasoningLog: context.outcome.reasoning,
    providerLog: `provider=${context.outcome.provider} model=${context.outcome.model}`,
    groundingLog: `grounding=${g.groundingApplied} docs=${g.documentsUsed.length} laws=${g.lawsUsed.length} copilot=${g.copilot}`,
    ragLog: `rag=${g.ragApplied}`,
    knowledgeGraphLog: `kg=${g.knowledgeGraphApplied} nodes=${g.knowledgeGraphNodes.length}`,
    latencyMs: context.outcome.latencyMs,
    tokenUsage: response.tokens,
    structuredOutputValid: validation.valid,
    structuredOutputErrors: validation.errors,
    responseType: response.responseType,
    structuredDataPresent: response.structuredData !== undefined && response.structuredData !== null,
    structuredDataSize: dataSize,
    responseShapeHash: responseShapeHash(response, dataSize),
    contractVersion: response.contractVersion,
    reasoningPlanId: reasoningPlan?.id ?? "",
    reasoningPlanHash: reasoningPlan?.replayHash ?? "",
    appliedRules: reasoningPlan?.rules ?? [],
    alternativePaths: reasoningPlan?.alternatives ?? [],
    discardedPaths: alt.discarded.map(d => d.alternative),
    knowledgeSources: [...g.documentsUsed, ...g.lawsUsed],
    groundingUsed: g.groundingApplied,
  };

  _byCorrelation.set(context.request.correlationId, obs);
  // Emissão estruturada (infraestrutura). Nunca lança.
  try {
    console.info("[cognitive-observability]", JSON.stringify({
      correlationId: obs.correlationId, task: obs.task, provider: context.outcome.provider,
      responseType: obs.responseType, structuredData: obs.structuredDataPresent, contract: obs.contractVersion,
      latencyMs: obs.latencyMs, tokens: obs.tokenUsage.totalTokens, structuredOutputValid: obs.structuredOutputValid,
    }));
  } catch { /* noop */ }

  return obs;
}

export function getCognitiveObservability(correlationId: string): CognitiveObservability | null {
  return _byCorrelation.get(correlationId) ?? null;
}
