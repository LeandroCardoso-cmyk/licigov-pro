/**
 * RC-3.5 — AI Execution Policy (componente do Cognitive Kernel).
 *
 * Cada tarefa de IA declara SUA política. A decisão de provider acontece SOMENTE
 * aqui (e no Provider Adapter) — nunca dentro dos Business Domains. A política
 * define provider preferido/fallback, exigências cognitivas (grounding, KG,
 * explicabilidade), limites (contexto, custo) e parâmetros do modelo.
 */

/** Provedores conhecidos pela camada de IA (agnóstica). */
export type ProviderName = "gemini" | "claude" | "openai" | "mock";

/** Tarefas de IA suportadas pelo AIExecutionEngine. */
export type AITaskId =
  | "document_generation"
  | "legal_analysis"
  | "classification"
  | "extraction"
  | "summarization"
  | "embedding"
  | "generic";

export interface AIExecutionPolicy {
  readonly task: AITaskId;
  readonly preferredProvider: ProviderName;
  readonly fallbackProvider: ProviderName;
  readonly requiresGrounding: boolean;
  readonly requiresKnowledgeGraph: boolean;
  readonly requiresExplainability: boolean;
  readonly maxContext: number;
  readonly maxCost: number;
  readonly temperature: number;
  readonly model: string;
}

/**
 * Catálogo oficial de políticas por tarefa. Gemini é o provider canônico ativo;
 * Claude/OpenAI ficam preparados como fallback (Future Evolution — não implementados).
 */
export const AI_EXECUTION_POLICIES: Record<AITaskId, AIExecutionPolicy> = {
  document_generation: {
    task: "document_generation", preferredProvider: "gemini", fallbackProvider: "claude",
    requiresGrounding: true, requiresKnowledgeGraph: true, requiresExplainability: true,
    maxContext: 32000, maxCost: 0.5, temperature: 0.2, model: "gemini-2.5-pro",
  },
  legal_analysis: {
    task: "legal_analysis", preferredProvider: "gemini", fallbackProvider: "claude",
    requiresGrounding: true, requiresKnowledgeGraph: true, requiresExplainability: true,
    maxContext: 32000, maxCost: 0.75, temperature: 0.1, model: "gemini-2.5-pro",
  },
  classification: {
    task: "classification", preferredProvider: "gemini", fallbackProvider: "openai",
    requiresGrounding: false, requiresKnowledgeGraph: false, requiresExplainability: true,
    maxContext: 8000, maxCost: 0.1, temperature: 0.0, model: "gemini-2.5-flash",
  },
  extraction: {
    task: "extraction", preferredProvider: "gemini", fallbackProvider: "openai",
    requiresGrounding: false, requiresKnowledgeGraph: false, requiresExplainability: true,
    maxContext: 16000, maxCost: 0.2, temperature: 0.0, model: "gemini-2.5-flash",
  },
  summarization: {
    task: "summarization", preferredProvider: "gemini", fallbackProvider: "claude",
    requiresGrounding: false, requiresKnowledgeGraph: false, requiresExplainability: false,
    maxContext: 16000, maxCost: 0.15, temperature: 0.3, model: "gemini-2.5-flash",
  },
  embedding: {
    task: "embedding", preferredProvider: "gemini", fallbackProvider: "openai",
    requiresGrounding: false, requiresKnowledgeGraph: false, requiresExplainability: false,
    maxContext: 8000, maxCost: 0.05, temperature: 0.0, model: "text-embedding-004",
  },
  generic: {
    task: "generic", preferredProvider: "gemini", fallbackProvider: "claude",
    requiresGrounding: false, requiresKnowledgeGraph: false, requiresExplainability: true,
    maxContext: 16000, maxCost: 0.25, temperature: 0.2, model: "gemini-2.5-pro",
  },
};

/** Retorna a política de uma tarefa (cai em `generic` se desconhecida). */
export function getExecutionPolicy(task: AITaskId): AIExecutionPolicy {
  return AI_EXECUTION_POLICIES[task] ?? AI_EXECUTION_POLICIES.generic;
}

export const ALL_AI_TASKS: AITaskId[] = Object.keys(AI_EXECUTION_POLICIES) as AITaskId[];
