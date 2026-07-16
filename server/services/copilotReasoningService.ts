/**
 * Sprint 4.9 — Copilot Reasoning Service · RC-4.1 (ativação cognitiva).
 *
 * Reasoning especializado de um copiloto. O copiloto é apenas ESPECIALISTA DE DOMÍNIO:
 * monta contexto (RAG + KG), seleciona grounding, indica documentos/legislação e prepara
 * o payload. Ele NÃO executa provider nem monta o prompt final — solicita uma Cognitive
 * Task ao AIExecutionEngine (única porta cognitiva), que usa o Prompt Builder tipado,
 * seleciona o provider (Mock nesta fase) e valida a CognitiveResponse.
 *
 * O ponto de injeção `invoke` permanece para testes/legado (allowlist). Governança:
 * nenhuma decisão; toda saída exige revisão humana.
 */

import { executeCognitiveTask } from "./aiExecutionEngine";
import type { CopilotType } from "../domain/institutionalCopilot";
import { getCopilotDefinition } from "../domain/institutionalCopilot";
import type { CognitiveTaskId } from "../domain/cognitiveTask";
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
  /** Ponto de injeção do pipeline oficial (default: AIExecutionEngine). Facilita replay/testes. */
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

/**
 * Mapeia cada copiloto especialista → a Cognitive Task que o AIExecutionEngine executa.
 * O copiloto define O QUE precisa; a Task carrega policy/grounding/prompt builder.
 */
const COPILOT_TASK: Record<CopilotType, CognitiveTaskId> = {
  agente_contratacao: "GENERATE_DOCUMENT",
  pregoeiro: "PROCUREMENT_REASONING",
  planejamento: "PROCUREMENT_REASONING",
  tr_intelligence: "ITEM_REASONING",
  juridico: "LEGAL_REASONING",
  pesquisa_precos: "PROCUREMENT_REASONING",
  contratos: "CONTRACT_REASONING",
  controle_interno: "COMPLIANCE_CHECK",
};

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

  // Reasoning: o copiloto prepara o contexto aterrado; o Engine faz a cognição.
  const prompt = buildGroundedPrompt(copilotType, context);
  let reasoningText = "";
  try {
    if (input.invoke) {
      // Ponto de injeção (testes/legado allowlist): usa o prompt aterrado diretamente.
      reasoningText = await input.invoke(prompt);
    } else {
      // Ativação cognitiva (RC-4.1): default roteia pelo AIExecutionEngine.
      // O copiloto entrega contexto/grounding/documentos/legislação; o Prompt Builder
      // tipado do Engine monta o prompt final e o Provider Adapter usa o Mock Provider.
      const exec = await executeCognitiveTask({
        task: COPILOT_TASK[copilotType],
        tenantId: organizationId,
        userId: "system",
        correlationId,
        query,
        groundingBlock: renderContextBlock(context),
        documentRefs: context.evidences.map(e => e.id),
        lawRefs: context.legalRefs.map(r => `${r.lawRef} art. ${r.article}`),
      });
      reasoningText = exec.response.content;
    }
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
