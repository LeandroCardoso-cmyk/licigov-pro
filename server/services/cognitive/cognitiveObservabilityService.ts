/**
 * RC-4.0 — Cognitive Observability (infraestrutura, não dashboard).
 * RC-4.2.1 — persistência: além do cache em memória, persiste (recuperável por
 * correlationId) via Observability Repository. Nunca depende apenas de Map em memória.
 *
 * Toda execução cognitiva emite logs estruturados: execução, reasoning, provider,
 * grounding, RAG, Knowledge Graph, latência, uso de tokens e validação de Structured
 * Output. Determinístico e multi-tenant.
 */

import type { AIExecutionContext } from "../../domain/aiExecutionContext";
import { structuredDataSize, responseShapeHash, type CognitiveResponse, type CognitiveResponseValidation, type CognitiveResponseType } from "../../domain/cognitiveResponse";
import type { CognitiveTaskId } from "../../domain/cognitiveTask";
import { splitAlternatives, type InstitutionalReasoningPlan } from "../../domain/institutionalReasoning";
import { persistObservability, recoverObservabilityRow } from "./observabilityRepository";

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

  // Persistência (recuperável por correlationId) — nunca depende só do Map. Fire-and-forget
  // seguro: degrada sem DB e jamais quebra o pipeline cognitivo.
  void persistObservability(obs, {
    tenantId: context.request.tenantId, replayHash: context.replayHash, provider: context.outcome.provider,
    executionStatus: validation.valid ? "completed" : "invalid",
  });

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

/** Recuperação rápida (cache em memória do processo). */
export function getCognitiveObservability(correlationId: string): CognitiveObservability | null {
  return _byCorrelation.get(correlationId) ?? null;
}

/**
 * Recuperação COMPLETA por correlationId: memória primeiro; se ausente (ex.: após
 * restart / outra instância), recupera do repositório persistente.
 */
export async function recoverCognitiveObservability(correlationId: string): Promise<CognitiveObservability | null> {
  const cached = _byCorrelation.get(correlationId);
  if (cached) return cached;
  const row = await recoverObservabilityRow(correlationId);
  return row && row.payload ? (row.payload as CognitiveObservability) : null;
}
