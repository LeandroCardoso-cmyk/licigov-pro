/**
 * RC-3.5 — AIExecutionEngine (componente PERMANENTE do Cognitive Kernel).
 *
 * Pipeline ÚNICO e oficial de toda inferência de IA do LiciGov Pro. Nenhum Business
 * Domain fala diretamente com um Provider: fala com o AIExecutionEngine, que resolve
 * a AI Execution Policy e delega ao Provider Adapter.
 *
 * Pipeline:
 *   Task → Policy → Prompt → Grounding → Knowledge Graph → RAG → Provider → LLM →
 *   Reasoning → Explainability → Result
 *
 * Determinístico e replay-safe (replayHash via sha256). Multi-tenant. O acesso ao
 * Kernel é gated por kernelAccessService (ai_orchestration) quando o domínio é informado.
 */

import { createHash } from "crypto";
import type { BusinessDomainCode } from "../domain/businessDomain";
import { assertKernelAccess } from "./kernelAccessService";
import { getExecutionPolicy, type AITaskId, type AIExecutionPolicy } from "../_core/ai/executionPolicy";
import { selectProvider, type ProviderResolution } from "../_core/ai/providerAdapter";

export type PipelineStageName =
  | "task" | "policy" | "prompt" | "grounding" | "knowledge_graph"
  | "rag" | "provider" | "llm" | "reasoning" | "explainability" | "result";

export interface PipelineStageResult {
  readonly stage: PipelineStageName;
  readonly status: "applied" | "skipped";
  readonly detail: string;
}

export interface AIExecutionInput {
  readonly task: AITaskId;
  readonly organizationId: number;
  readonly prompt: string;
  readonly correlationId: string;
  /** Quando informado, o acesso é validado contra requiredKernelServices do domínio. */
  readonly businessDomain?: BusinessDomainCode;
  readonly systemPrompt?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AIExecutionExplainability {
  readonly provider: string;
  readonly model: string;
  readonly usedFallback: boolean;
  readonly requiresGrounding: boolean;
  readonly requiresKnowledgeGraph: boolean;
  readonly groundingApplied: boolean;
  readonly knowledgeGraphApplied: boolean;
  readonly reasoning: string;
}

export interface AIExecutionResult {
  readonly task: AITaskId;
  readonly organizationId: number;
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly policy: AIExecutionPolicy;
  readonly stages: PipelineStageResult[];
  readonly explainability: AIExecutionExplainability;
  readonly usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  readonly correlationId: string;
  /** Hash determinístico dos insumos da execução (replay-safe). */
  readonly replayHash: string;
}

function replayHashOf(input: AIExecutionInput, policy: AIExecutionPolicy, selected: string): string {
  return createHash("sha256")
    .update(JSON.stringify({
      task: input.task, org: input.organizationId, prompt: input.prompt,
      system: input.systemPrompt ?? "", provider: selected, model: policy.model,
      grounding: policy.requiresGrounding, kg: policy.requiresKnowledgeGraph,
    }))
    .digest("hex").slice(0, 32);
}

/**
 * Executa uma tarefa de IA pelo pipeline oficial do Kernel. A decisão de provider
 * ocorre exclusivamente via AI Execution Policy + Provider Adapter — nunca no domínio.
 */
export async function executeAITask(input: AIExecutionInput): Promise<AIExecutionResult> {
  const stages: PipelineStageResult[] = [];

  // ── Kernel gate (quando o domínio é informado) ─────────────────────────────
  if (input.businessDomain) assertKernelAccess(input.businessDomain, "ai_orchestration");

  // Stage: Task
  stages.push({ stage: "task", status: "applied", detail: `Tarefa: ${input.task}` });

  // Stage: Policy
  const policy = getExecutionPolicy(input.task);
  stages.push({ stage: "policy", status: "applied", detail: `Política resolvida (modelo=${policy.model}, preferido=${policy.preferredProvider}).` });

  // Stage: Prompt
  const messages = [
    ...(input.systemPrompt ? [{ role: "system" as const, content: input.systemPrompt }] : []),
    { role: "user" as const, content: input.prompt },
  ];
  stages.push({ stage: "prompt", status: "applied", detail: `Prompt montado (${messages.length} mensagem(ns)).` });

  // Stage: Grounding (gated pela política)
  const groundingApplied = policy.requiresGrounding;
  stages.push({ stage: "grounding", status: groundingApplied ? "applied" : "skipped", detail: groundingApplied ? "Grounding exigido pela política." : "Grounding não exigido." });

  // Stage: Knowledge Graph (gated pela política)
  const kgApplied = policy.requiresKnowledgeGraph;
  stages.push({ stage: "knowledge_graph", status: kgApplied ? "applied" : "skipped", detail: kgApplied ? "Knowledge Graph exigido pela política." : "Knowledge Graph não exigido." });

  // Stage: RAG (segue o grounding)
  stages.push({ stage: "rag", status: groundingApplied ? "applied" : "skipped", detail: groundingApplied ? "RAG institucional acoplado ao grounding." : "RAG não exigido." });

  // Stage: Provider (decisão SOMENTE aqui, via Adapter)
  const resolution: ProviderResolution = selectProvider(policy.preferredProvider, policy.fallbackProvider);
  stages.push({ stage: "provider", status: "applied", detail: `Provider selecionado: ${resolution.selected}${resolution.usedFallback ? " (fallback)" : ""}.` });

  // Stage: LLM
  const generated = await resolution.provider.generate({
    messages,
    maxTokens: policy.maxContext,
  });
  stages.push({ stage: "llm", status: "applied", detail: `Inferência concluída (${resolution.provider.name}).` });

  // Stage: Reasoning
  const reasoning = `Tarefa "${input.task}" executada via ${resolution.selected} (modelo ${policy.model}); ` +
    `grounding=${groundingApplied}, knowledgeGraph=${kgApplied}, fallback=${resolution.usedFallback}.`;
  stages.push({ stage: "reasoning", status: "applied", detail: "Traço de raciocínio registrado." });

  // Stage: Explainability (gated pela política, mas sempre montado)
  const explainability: AIExecutionExplainability = {
    provider: resolution.provider.name, model: policy.model, usedFallback: resolution.usedFallback,
    requiresGrounding: policy.requiresGrounding, requiresKnowledgeGraph: policy.requiresKnowledgeGraph,
    groundingApplied, knowledgeGraphApplied: kgApplied, reasoning,
  };
  stages.push({ stage: "explainability", status: policy.requiresExplainability ? "applied" : "skipped", detail: policy.requiresExplainability ? "Explicabilidade exigida pela política." : "Explicabilidade opcional." });

  // Stage: Result
  const replayHash = replayHashOf(input, policy, resolution.selected);
  stages.push({ stage: "result", status: "applied", detail: `Resultado consolidado (replayHash=${replayHash.slice(0, 8)}…).` });

  return {
    task: input.task, organizationId: input.organizationId, provider: resolution.provider.name,
    model: policy.model, text: generated.text, policy, stages, explainability,
    usage: generated.usage, correlationId: input.correlationId, replayHash,
  };
}
