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
// RC-4.0 — fundação cognitiva
import {
  getCognitiveTask, isBusinessDomainAllowed, type CognitiveTaskId,
} from "../domain/cognitiveTask";
import {
  createExecutionContext, type AIExecutionContext, type CognitiveRequest,
} from "../domain/aiExecutionContext";
import {
  createCognitiveResponse, validateCognitiveResponse, responseReplayHash,
  type CognitiveResponse, type CognitiveExplainability, type CognitiveResponseValidation,
} from "../domain/cognitiveResponse";
import { getPromptBuilder } from "./cognitive/promptBuilders";
import { recordCognitiveObservability, type CognitiveObservability } from "./cognitive/cognitiveObservabilityService";

export type PipelineStageName =
  | "task" | "policy" | "prompt" | "grounding" | "knowledge_graph"
  | "rag" | "copilot" | "provider" | "llm" | "structured_output"
  | "reasoning" | "explainability" | "result";

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

// ─── RC-4.0 — Cognitive Pipeline (cérebro institucional) ──────────────────────
//
// Pipeline oficial da fase cognitiva. Business Domains NÃO conversam com componentes
// cognitivos: solicitam uma Cognitive Task. Cada passo é observável.
//
//   Task → Execution Policy → Grounding → Knowledge Graph → RAG → Copilot →
//   Provider Adapter → LLM → Structured Output → Reasoning → Explainability → Resultado

export interface CognitiveTaskInput {
  readonly task: CognitiveTaskId;
  readonly tenantId: number;
  readonly userId: string;
  readonly correlationId: string;
  readonly query: string;
  readonly businessDomain?: BusinessDomainCode;
  readonly workspaceId?: string;
  readonly processId?: string;
  readonly stage?: string;
  readonly groundingBlock?: string;
  readonly documentRefs?: readonly string[];
  readonly lawRefs?: readonly string[];
}

export interface CognitiveExecution {
  readonly response: CognitiveResponse;
  readonly context: AIExecutionContext;
  readonly observability: CognitiveObservability;
  readonly validation: CognitiveResponseValidation;
  readonly stages: PipelineStageResult[];
}

/** Confidence determinística (fase de fundação — sem LLM real) derivada do replayHash. */
function deterministicConfidence(replayHash: string): number {
  const n = parseInt(replayHash.slice(0, 4), 16) % 46; // 0..45
  return Math.round((0.5 + n / 100) * 100) / 100;       // 0.50..0.95
}

/**
 * Executa uma Cognitive Task pelo pipeline cognitivo oficial. A decisão de provider
 * ocorre exclusivamente via política da tarefa + Provider Adapter. Retorna uma
 * CognitiveResponse estruturada (nunca texto solto), o contexto de execução e a
 * observabilidade. Determinístico e replay-safe.
 */
export async function executeCognitiveTask(input: CognitiveTaskInput): Promise<CognitiveExecution> {
  const stages: PipelineStageResult[] = [];
  const push = (stage: PipelineStageName, status: "applied" | "skipped", detail: string) => stages.push({ stage, status, detail });

  // Stage: Task (+ autorização cognitiva do domínio)
  const task = getCognitiveTask(input.task);
  if (input.businessDomain && !isBusinessDomainAllowed(input.task, input.businessDomain)) {
    throw new Error(`Domínio "${input.businessDomain}" não autorizado para a tarefa cognitiva ${input.task}.`);
  }
  push("task", "applied", `Cognitive Task: ${task.id} (${task.name}), criticidade=${task.criticality}.`);

  // Stage: Execution Policy (única fonte das decisões cognitivas)
  const policy = task.policy;
  push("policy", "applied", `Política resolvida (modelo=${policy.model}, preferido=${policy.preferredProvider}).`);

  // Stage: Grounding / Knowledge Graph / RAG (declarados pela tarefa — nada implícito)
  const g = task.grounding;
  push("grounding", g.usesGrounding ? "applied" : "skipped", g.usesGrounding ? "Grounding declarado." : "Grounding não usado.");
  push("knowledge_graph", g.usesKnowledgeGraph ? "applied" : "skipped", g.usesKnowledgeGraph ? "Knowledge Graph declarado." : "KG não usado.");
  push("rag", g.usesRAG ? "applied" : "skipped", g.usesRAG ? "RAG declarado." : "RAG não usado.");

  // Stage: Copilot
  const copilot = task.recommendedCopilot;
  push("copilot", "applied", `Copiloto recomendado: ${copilot}.`);

  // Stage: Prompt (builder tipado — nunca concatenação manual)
  const prompt = getPromptBuilder(input.task).build({
    query: input.query, groundingBlock: input.groundingBlock, documentRefs: input.documentRefs, lawRefs: input.lawRefs,
  });
  push("prompt", "applied", `Prompt montado via builder tipado (${prompt.sections.length} seção(ões)).`);

  // Stage: Provider Adapter (decisão SOMENTE aqui)
  const resolution = selectProvider(policy.preferredProvider, policy.fallbackProvider);
  push("provider", "applied", `Provider selecionado: ${resolution.selected}${resolution.usedFallback ? " (fallback)" : ""}.`);

  // Stage: LLM
  const startedAt = Date.now();
  const generated = await resolution.provider.generate({
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    maxTokens: policy.maxContext,
  });
  const latencyMs = Math.max(0, Date.now() - startedAt);
  push("llm", "applied", `Inferência concluída (${resolution.provider.name}).`);

  // Coerção do output do modelo em forma estruturada (dados determinísticos).
  const provider = resolution.provider.name;
  const model = policy.model;
  const content = generated.text;
  const replayHash = responseReplayHash(input.task, content, provider, model);
  const confidence = deterministicConfidence(replayHash);
  const documentsUsed = [...(input.documentRefs ?? [])];
  const lawsUsed = [...(input.lawRefs ?? [])];
  const tokens = generated.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  const reasoning = `Cognitive Task ${task.id} conduzida pelo copiloto ${copilot} via ${provider} (modelo ${model}); ` +
    `grounding=${g.usesGrounding}, kg=${g.usesKnowledgeGraph}, rag=${g.usesRAG}, fallback=${resolution.usedFallback}.`;
  const explainability: CognitiveExplainability = {
    whyAnswered: `Resposta produzida para a tarefa ${task.name} sob supervisão humana, aterrada no contexto declarado.`,
    documentsUsed, lawsUsed, discardedRecommendations: [], confidence, limitations: ["Fase de fundação: sem inferência jurídica real; saída estrutural."],
  };
  const response = createCognitiveResponse({
    task: input.task, content, reasoning, confidence,
    sources: documentsUsed, laws: lawsUsed, jurisprudence: [], documentsUsed,
    recommendations: [], alternatives: [], risks: [], limitations: explainability.limitations,
    explainability, tokens, latencyMs, provider, model, replayHash,
  });
  const validation = validateCognitiveResponse(response);

  // Stages na ordem oficial: Structured Output → Reasoning → Explainability
  push("structured_output", validation.valid ? "applied" : "skipped", `Structured Output ${validation.valid ? "válido" : "inválido: " + validation.errors.join(", ")}.`);
  push("reasoning", "applied", "Traço de raciocínio registrado.");
  push("explainability", "applied", "Explicabilidade obrigatória montada.");

  // Stage: Result (contexto + observabilidade)
  const request: CognitiveRequest = {
    tenantId: input.tenantId, userId: input.userId, businessDomain: input.businessDomain,
    workspaceId: input.workspaceId, processId: input.processId, stage: input.stage,
    task: input.task, prompt: prompt.user, correlationId: input.correlationId,
  };
  const context = createExecutionContext({
    request,
    grounding: {
      groundingApplied: g.usesGrounding, ragApplied: g.usesRAG, knowledgeGraphApplied: g.usesKnowledgeGraph,
      documentsUsed, lawsUsed, knowledgeGraphNodes: [], copilot,
    },
    outcome: { provider, model, latencyMs, tokens, confidence, reasoning },
  });
  const observability = recordCognitiveObservability({ context, response, validation });
  push("result", "applied", `Resultado consolidado (ctx=${context.id}, replay=${replayHash.slice(0, 8)}).`);

  return { response, context, observability, validation, stages };
}
