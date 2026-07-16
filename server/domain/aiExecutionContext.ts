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

/** Hash determinístico do contexto (insumos estáveis — nunca tempo/tokens). */
export function contextReplayHash(request: CognitiveRequest, provider: string, model: string): string {
  return createHash("sha256")
    .update(JSON.stringify({
      tenant: request.tenantId, task: request.task, domain: request.businessDomain ?? "",
      workspace: request.workspaceId ?? "", process: request.processId ?? "", stage: request.stage ?? "",
      prompt: request.prompt, provider, model,
    }))
    .digest("hex").slice(0, 32);
}

export function createExecutionContext(params: {
  request: CognitiveRequest;
  grounding: CognitiveGroundingUsage;
  outcome: CognitiveOutcome;
  createdAt?: string;
}): AIExecutionContext {
  const replayHash = contextReplayHash(params.request, params.outcome.provider, params.outcome.model);
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
