/**
 * RC-4.0 — AI Execution Context (contexto cognitivo único).
 *
 * Todo processamento cognitivo gera UM contexto que acompanha a execução inteira,
 * do pedido ao resultado. Reúne quem pediu (tenant/usuário/domínio/workspace/processo/
 * etapa), o que foi pedido (task/prompt), o que foi usado (grounding/documentos/leis/
 * KG/RAG/copiloto) e o resultado (provider/modelo/tempo/tokens/confidence/reasoning/
 * replayHash/correlationId).
 *
 * O replayHash cobre apenas insumos DETERMINÍSTICOS (não inclui tempo/tokens).
 */

import { createHash } from "crypto";
import type { CognitiveTaskId } from "./cognitiveTask";
import type { BusinessDomainCode } from "./businessDomain";
import type { CopilotType } from "./institutionalCopilot";

/** Insumos determinísticos do pedido cognitivo. */
export interface CognitiveRequest {
  readonly tenantId: number;
  readonly userId: string;
  readonly businessDomain?: BusinessDomainCode;
  readonly workspaceId?: string;
  readonly processId?: string;
  readonly stage?: string;
  readonly task: CognitiveTaskId;
  readonly prompt: string;
  readonly correlationId: string;
}

/** Recursos cognitivos efetivamente utilizados na execução. */
export interface CognitiveGroundingUsage {
  readonly groundingApplied: boolean;
  readonly ragApplied: boolean;
  readonly knowledgeGraphApplied: boolean;
  readonly documentsUsed: readonly string[];
  readonly lawsUsed: readonly string[];
  readonly knowledgeGraphNodes: readonly string[];
  readonly copilot: CopilotType;
}

/** Resultado de execução (preenchido pelo engine). */
export interface CognitiveOutcome {
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
  readonly confidence: number;
  readonly reasoning: string;
}

export interface AIExecutionContext {
  readonly id: string;
  readonly request: CognitiveRequest;
  readonly grounding: CognitiveGroundingUsage;
  readonly outcome: CognitiveOutcome;
  readonly replayHash: string;
  readonly createdAt: string;
}

/**
 * RC-4.0.1 — Replay Hash OFICIAL (semântica consolidada).
 *
 * Representa EXCLUSIVAMENTE a execução lógica: Task, Context (tenant/domínio/workspace/
 * processo/etapa), Grounding, Policy (provider/modelo) e Prompt. NUNCA inclui conteúdo
 * produzido, tempo, latência, tokens ou saída do LLM. Assim, o replay identifica a mesma
 * execução lógica independentemente da resposta textual/estruturada.
 */
export function officialReplayHash(params: {
  request: CognitiveRequest;
  provider: string;
  model: string;
  grounding: Pick<CognitiveGroundingUsage, "groundingApplied" | "ragApplied" | "knowledgeGraphApplied">;
}): string {
  const { request, provider, model, grounding } = params;
  return createHash("sha256")
    .update(JSON.stringify({
      tenant: request.tenantId, task: request.task, domain: request.businessDomain ?? "",
      workspace: request.workspaceId ?? "", process: request.processId ?? "", stage: request.stage ?? "",
      prompt: request.prompt, provider, model,
      grounding: grounding.groundingApplied, rag: grounding.ragApplied, kg: grounding.knowledgeGraphApplied,
    }))
    .digest("hex").slice(0, 32);
}

/** @deprecated Use officialReplayHash — mantido para compatibilidade (insumos, sem grounding). */
export function contextReplayHash(request: CognitiveRequest, provider: string, model: string): string {
  return officialReplayHash({ request, provider, model, grounding: { groundingApplied: false, ragApplied: false, knowledgeGraphApplied: false } });
}

export function createExecutionContext(params: {
  request: CognitiveRequest;
  grounding: CognitiveGroundingUsage;
  outcome: CognitiveOutcome;
  createdAt?: string;
}): AIExecutionContext {
  const replayHash = officialReplayHash({
    request: params.request, provider: params.outcome.provider, model: params.outcome.model, grounding: params.grounding,
  });
  const id = createHash("sha256")
    .update(`ctx:${params.request.tenantId}:${params.request.correlationId}:${replayHash}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    request: params.request,
    grounding: params.grounding,
    outcome: params.outcome,
    replayHash,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}
