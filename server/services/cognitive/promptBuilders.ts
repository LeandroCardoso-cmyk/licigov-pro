/**
 * RC-4.0 — Prompt Builders tipados (um por Cognitive Task).
 *
 * Substitui prompts concatenados à mão nos serviços. Cada tarefa cognitiva possui
 * um builder tipado que monta o prompt a partir de peças declaradas (papel, objetivo,
 * grounding, saída estruturada). NENHUM serviço monta prompt manualmente — sempre via
 * o builder da tarefa.
 *
 * IMPORTANTE (RC-4.0): builders são ESTRUTURAIS — não contêm conteúdo jurídico nem
 * conectam provider. O texto jurídico e a inferência real são fases futuras.
 */

import type { CognitiveTaskId, CognitiveTask, GroundingDeclaration } from "../../domain/cognitiveTask";
import { getCognitiveTask } from "../../domain/cognitiveTask";
import { getCopilotDefinition } from "../../domain/institutionalCopilot";

export interface PromptBuilderInput {
  /** Consulta/objetivo do usuário (o serviço passa dados estruturados, nunca prompt cru). */
  readonly query: string;
  /** Bloco de contexto institucional já aterrado (grounding), opcional nesta fase. */
  readonly groundingBlock?: string;
  /** Referências de documentos/leis disponíveis (identificadores, não conteúdo). */
  readonly documentRefs?: readonly string[];
  readonly lawRefs?: readonly string[];
}

export interface BuiltPrompt {
  readonly task: CognitiveTaskId;
  readonly system: string;
  readonly user: string;
  readonly sections: readonly string[];
  /** Declaração de grounding efetivamente montada no prompt. */
  readonly grounding: GroundingDeclaration;
}

export interface PromptBuilder {
  readonly task: CognitiveTaskId;
  build(input: PromptBuilderInput): BuiltPrompt;
}

function groundingSection(g: GroundingDeclaration, input: PromptBuilderInput): string[] {
  const s: string[] = [];
  if (g.usesInstitutionalContext) s.push(`[CONTEXTO INSTITUCIONAL]\n${input.groundingBlock ?? "(a ser aterrado)"}`);
  if (g.usesDocuments) s.push(`[DOCUMENTOS]\n${(input.documentRefs ?? []).join(", ") || "(nenhum informado)"}`);
  if (g.usesLegislation) s.push(`[LEGISLAÇÃO]\n${(input.lawRefs ?? []).join(", ") || "(a recuperar via RAG)"}`);
  if (g.usesKnowledgeGraph) s.push(`[KNOWLEDGE GRAPH]\n(consulta de relações institucionais)`);
  if (g.usesRAG) s.push(`[RAG]\n(recuperação aumentada da base institucional)`);
  return s;
}

/** Constrói um builder estrutural padrão a partir da definição da tarefa. */
function structuralBuilder(taskId: CognitiveTaskId): PromptBuilder {
  return {
    task: taskId,
    build(input: PromptBuilderInput): BuiltPrompt {
      const task: CognitiveTask = getCognitiveTask(taskId);
      const copilot = getCopilotDefinition(task.recommendedCopilot);
      const system = [
        `Você é o ${copilot.name}, no papel de apoio institucional supervisionado.`,
        `Tarefa cognitiva: ${task.name} (${task.id}) — ${task.description}`,
        `Você NÃO decide, NÃO assina e NÃO homologa. Toda saída é revisada por servidor competente.`,
        `Baseie-se EXCLUSIVAMENTE no contexto aterrado. Se faltar fundamento, declare a limitação.`,
      ].join("\n");
      const sections = groundingSection(task.grounding, input);
      const outputHint = task.structuredOutput
        ? `Responda em SAÍDA ESTRUTURADA (conteúdo, reasoning, confidence, fontes, recomendações, riscos, limitações).`
        : `Responda de forma objetiva.`;
      const user = [
        `[OBJETIVO]\n${input.query}`,
        ...sections,
        `[SAÍDA]\n${outputHint}`,
      ].join("\n\n");
      return { task: taskId, system, user, sections, grounding: task.grounding };
    },
  };
}

/** Registro oficial: cada Cognitive Task possui seu Prompt Builder tipado. */
export const COGNITIVE_PROMPT_BUILDERS: Record<CognitiveTaskId, PromptBuilder> = {
  GENERATE_DOCUMENT: structuralBuilder("GENERATE_DOCUMENT"),
  REVIEW_DOCUMENT: structuralBuilder("REVIEW_DOCUMENT"),
  LEGAL_ANALYSIS: structuralBuilder("LEGAL_ANALYSIS"),
  LEGAL_REASONING: structuralBuilder("LEGAL_REASONING"),
  PROCUREMENT_REASONING: structuralBuilder("PROCUREMENT_REASONING"),
  DIRECT_PROCUREMENT_REASONING: structuralBuilder("DIRECT_PROCUREMENT_REASONING"),
  CONTRACT_REASONING: structuralBuilder("CONTRACT_REASONING"),
  ITEM_REASONING: structuralBuilder("ITEM_REASONING"),
  CATMAT_MATCHING: structuralBuilder("CATMAT_MATCHING"),
  RISK_ANALYSIS: structuralBuilder("RISK_ANALYSIS"),
  COMPLIANCE_CHECK: structuralBuilder("COMPLIANCE_CHECK"),
  WORKFLOW_RECOMMENDATION: structuralBuilder("WORKFLOW_RECOMMENDATION"),
  DOCUMENT_IMPROVEMENT: structuralBuilder("DOCUMENT_IMPROVEMENT"),
};

export function getPromptBuilder(taskId: CognitiveTaskId): PromptBuilder {
  return COGNITIVE_PROMPT_BUILDERS[taskId];
}
