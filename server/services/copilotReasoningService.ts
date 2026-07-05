/**
 * Sprint 4.9 — Copilot Reasoning Service
 *
 * Reasoning especializado de um copiloto. Monta contexto fundamentado (RAG + KG),
 * constrói um prompt aterrado (NUNCA prompt cru), roteia a inferência pelo
 * pipeline oficial (server/_core/llm.ts) e produz recomendação + decision trace.
 *
 * Governança: nenhuma decisão; toda saída exige revisão humana. Sem provider
 * configurado, opera em modo grounding-only (determinístico), sem chamadas de rede.
 */

import { ENV } from "../_core/env";
import { generateText } from "../_core/llm";
import type { CopilotType } from "../domain/institutionalCopilot";
import { getCopilotDefinition } from "../domain/institutionalCopilot";
import {
  createCopilotDecisionTrace,
  appendTraceStep,
  type CopilotDecisionTrace,
} from "../domain/copilotDecisionTrace";
import type { CopilotRecommendation } from "../domain/copilotRecommendation";
import { buildCopilotContext, renderContextBlock, type CopilotContext } from "./copilotContextEngineService";
import { buildRecommendation } from "./copilotRecommendationService";

export interface ReasoningInput {
  organizationId: number;
  copilotType: CopilotType;
  sessionId: string;
  reasoningId: string;
  query: string;
  correlationId: string;
  /** Ponto de injeção do pipeline oficial (default: generateText). Facilita replay/testes. */
  invoke?: (prompt: string) => Promise<string>;
}

export interface ReasoningResult {
  readonly context: CopilotContext;
  readonly recommendation: CopilotRecommendation;
  readonly trace: CopilotDecisionTrace;
  readonly groundingOnly: boolean;
}

/**
 * Constrói o prompt aterrado do copiloto. Sempre inclui: papel especializado,
 * contexto institucional recuperado, e aviso de revisão obrigatória. Nunca cru.
 */
export function buildGroundedPrompt(copilotType: CopilotType, context: CopilotContext): string {
  const def = getCopilotDefinition(copilotType);
  return [
    `Você é o ${def.name}, especialista institucional em ${def.domain} no âmbito da Lei 14.133/2021.`,
    `Sua função é APOIAR o servidor público: orientar, estruturar, sugerir, explicar e identificar riscos.`,
    `Você NÃO toma decisões, NÃO assina documentos e NÃO emite parecer/decisão definitiva.`,
    `Baseie-se EXCLUSIVAMENTE no contexto institucional abaixo. Se faltar fundamento, declare a limitação.`,
    "",
    renderContextBlock(context),
    "",
    `Produza uma orientação fundamentada, com sugestões, riscos e base legal. Toda saída será revisada por servidor competente.`,
  ].join("\n");
}

/** Invocação padrão via pipeline oficial. Sem chave de provider → grounding-only. */
async function defaultInvoke(prompt: string): Promise<string> {
  if (!ENV.geminiApiKey || ENV.geminiApiKey.trim().length === 0) {
    return "";
  }
  return generateText(prompt);
}

export async function runCopilotReasoning(input: ReasoningInput): Promise<ReasoningResult> {
  const { organizationId, copilotType, sessionId, reasoningId, query, correlationId } = input;

  let trace = createCopilotDecisionTrace({ organizationId, sessionId, reasoningId, correlationId });
  trace = appendTraceStep(trace, {
    type: "copilot_selection", summary: `Copiloto ${copilotType} selecionado.`,
    inputRef: query.slice(0, 40), outputRef: copilotType, evidenceCount: 0,
  });

  // Contexto (RAG + KG)
  const context = await buildCopilotContext({ organizationId, copilotType, query, correlationId });
  trace = appendTraceStep(trace, {
    type: "context_assembly", summary: `Contexto montado com ${context.evidences.length} evidência(s).`,
    inputRef: query.slice(0, 40), outputRef: context.id, evidenceCount: context.evidences.length,
  });
  trace = appendTraceStep(trace, {
    type: "knowledge_graph", summary: `${context.graphNodeIds.length} nó(s) do grafo.`,
    inputRef: query.slice(0, 40), outputRef: context.graphNodeIds.join(",").slice(0, 40), evidenceCount: context.graphNodeIds.length,
  });
  trace = appendTraceStep(trace, {
    type: "institutional_rag", summary: `${context.legalRefs.length} referência(s) legal(is).`,
    inputRef: query.slice(0, 40), outputRef: `refs:${context.legalRefs.length}`, evidenceCount: context.legalRefs.length,
  });

  // Reasoning via pipeline oficial (aterrado). Degrada para grounding-only.
  const prompt = buildGroundedPrompt(copilotType, context);
  const invoke = input.invoke ?? defaultInvoke;
  let reasoningText = "";
  try {
    reasoningText = await invoke(prompt);
  } catch {
    reasoningText = "";
  }
  const groundingOnly = reasoningText.trim().length === 0;
  trace = appendTraceStep(trace, {
    type: "reasoning", summary: groundingOnly ? "Modo grounding-only (sem provider)." : "Reasoning via provider.",
    inputRef: context.id, outputRef: groundingOnly ? "grounding_only" : "provider", evidenceCount: context.evidences.length,
  });

  // Recomendação fundamentada
  const recommendation = buildRecommendation({
    organizationId, sessionId, copilotType, context,
    reasoningText, correlationId,
  });
  trace = appendTraceStep(trace, {
    type: "recommendation", summary: `Recomendação ${recommendation.kind} (confiança ${recommendation.confidence.toFixed(2)}).`,
    inputRef: context.id, outputRef: recommendation.id, evidenceCount: recommendation.evidenceIds.length,
  });
  trace = appendTraceStep(trace, {
    type: "explainability", summary: "Cadeia de reasoning registrada para auditabilidade.",
    inputRef: recommendation.id, outputRef: trace.id, evidenceCount: 0,
  });

  return { context, recommendation, trace, groundingOnly };
}
