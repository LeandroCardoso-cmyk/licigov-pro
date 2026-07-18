/**
 * RC-4.0 — Cognitive Task (fundação cognitiva do Cognitive Kernel).
 *
 * Formaliza o conceito de TAREFA COGNITIVA. Os Business Domains não conversam mais
 * com componentes de IA: apenas solicitam uma Cognitive Task ao AIExecutionEngine.
 * Cada tarefa declara EXPLICITAMENTE seu contexto cognitivo (grounding/RAG/KG/leis/
 * documentos), criticidade, domínios permitidos, copiloto recomendado, política de
 * execução (provider/modelo/fallback) e se exige Structured Output.
 *
 * Determinístico e puro (IDs sha-256). Nada implícito — tudo declarado.
 */

import { createHash } from "crypto";
import type { BusinessDomainCode } from "./businessDomain";
import type { CopilotType } from "./institutionalCopilot";
import type { ProviderName } from "../_core/ai/executionPolicy";
import { AI_CONFIG } from "../config/ai";

/** Catálogo oficial de tarefas cognitivas do LiciGov Pro. */
export type CognitiveTaskId =
  | "GENERATE_DOCUMENT"
  | "REVIEW_DOCUMENT"
  | "LEGAL_ANALYSIS"
  | "LEGAL_REASONING"
  | "PROCUREMENT_REASONING"
  | "DIRECT_PROCUREMENT_REASONING"
  | "CONTRACT_REASONING"
  | "ITEM_REASONING"
  | "CATMAT_MATCHING"
  | "RISK_ANALYSIS"
  | "COMPLIANCE_CHECK"
  | "WORKFLOW_RECOMMENDATION"
  | "DOCUMENT_IMPROVEMENT";

export type CognitiveCriticality = "baixa" | "media" | "alta" | "critica";

/**
 * Declaração de grounding do copiloto/tarefa. Nada implícito: toda tarefa declara
 * explicitamente do que sua cognição depende (Part 5).
 */
export interface GroundingDeclaration {
  readonly usesGrounding: boolean;
  readonly usesRAG: boolean;
  readonly usesKnowledgeGraph: boolean;
  readonly usesLegislation: boolean;
  readonly usesDocuments: boolean;
  readonly usesInstitutionalContext: boolean;
}

/**
 * Política de execução de uma tarefa cognitiva (decisão de provider/modelo vive AQUI —
 * nunca nos Business Domains). Estruturalmente compatível com AIExecutionPolicy.
 */
export interface CognitiveExecutionPolicy {
  readonly preferredProvider: ProviderName;
  readonly fallbackProvider: ProviderName;
  readonly model: string;
  readonly temperature: number;
  readonly maxContext: number;
  readonly maxCost: number;
  readonly requiresExplainability: boolean;
}

export interface CognitiveTask {
  readonly id: CognitiveTaskId;
  readonly name: string;
  readonly description: string;
  /** Contexto operacional em que a tarefa é usada (para documentação/observabilidade). */
  readonly context: string;
  readonly criticality: CognitiveCriticality;
  /** Business Domains autorizados a solicitar esta tarefa. */
  readonly allowedBusinessDomains: readonly BusinessDomainCode[];
  /** Copiloto institucional recomendado para conduzir a tarefa. */
  readonly recommendedCopilot: CopilotType;
  readonly grounding: GroundingDeclaration;
  /** Explicabilidade é SEMPRE obrigatória na fase cognitiva (Part 8). */
  readonly requiresExplainability: true;
  /** A resposta deve ser Structured Output (nunca texto solto — Part 4). */
  readonly structuredOutput: boolean;
  readonly policy: CognitiveExecutionPolicy;
}

// ─── Políticas base ───────────────────────────────────────────────────────────

const REASONING_POLICY: CognitiveExecutionPolicy = {
  preferredProvider: "gemini", fallbackProvider: "claude", model: AI_CONFIG.model,
  temperature: 0.2, maxContext: 32000, maxCost: 0.5, requiresExplainability: true,
};
const LEGAL_POLICY: CognitiveExecutionPolicy = {
  preferredProvider: "gemini", fallbackProvider: "claude", model: AI_CONFIG.model,
  temperature: 0.1, maxContext: 32000, maxCost: 0.75, requiresExplainability: true,
};
const LIGHT_POLICY: CognitiveExecutionPolicy = {
  preferredProvider: "gemini", fallbackProvider: "openai", model: AI_CONFIG.model,
  temperature: 0.0, maxContext: 12000, maxCost: 0.15, requiresExplainability: true,
};

const FULL_GROUNDING: GroundingDeclaration = {
  usesGrounding: true, usesRAG: true, usesKnowledgeGraph: true,
  usesLegislation: true, usesDocuments: true, usesInstitutionalContext: true,
};
const STRUCTURAL_GROUNDING: GroundingDeclaration = {
  usesGrounding: true, usesRAG: false, usesKnowledgeGraph: true,
  usesLegislation: false, usesDocuments: true, usesInstitutionalContext: true,
};
const LIGHT_GROUNDING: GroundingDeclaration = {
  usesGrounding: false, usesRAG: false, usesKnowledgeGraph: true,
  usesLegislation: false, usesDocuments: false, usesInstitutionalContext: true,
};

const CORE: BusinessDomainCode[] = ["processo_licitatorio", "contratacao_direta", "parecer_juridico", "contratos"];

// ─── Registro oficial das 13 tarefas cognitivas ───────────────────────────────

export const COGNITIVE_TASKS: Record<CognitiveTaskId, CognitiveTask> = {
  GENERATE_DOCUMENT: {
    id: "GENERATE_DOCUMENT", name: "Geração de Documento", description: "Estrutura o conteúdo de um documento oficial (o binário é do Document Engine).",
    context: "Elaboração documental supervisionada.", criticality: "alta", allowedBusinessDomains: CORE,
    recommendedCopilot: "agente_contratacao", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: REASONING_POLICY,
  },
  REVIEW_DOCUMENT: {
    id: "REVIEW_DOCUMENT", name: "Revisão de Documento", description: "Revisa um documento, apontando lacunas, riscos e melhorias.",
    context: "Revisão documental supervisionada.", criticality: "alta", allowedBusinessDomains: CORE,
    recommendedCopilot: "agente_contratacao", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: REASONING_POLICY,
  },
  LEGAL_ANALYSIS: {
    id: "LEGAL_ANALYSIS", name: "Análise Jurídica", description: "Analisa uma questão sob a ótica da Lei 14.133/2021 e correlatas.",
    context: "Apoio à análise jurídica supervisionada.", criticality: "critica", allowedBusinessDomains: ["parecer_juridico"],
    recommendedCopilot: "juridico", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: LEGAL_POLICY,
  },
  LEGAL_REASONING: {
    id: "LEGAL_REASONING", name: "Raciocínio Jurídico", description: "Constrói raciocínio jurídico fundamentado (sem emitir parecer definitivo).",
    context: "Fundamentação jurídica supervisionada.", criticality: "critica", allowedBusinessDomains: ["parecer_juridico"],
    recommendedCopilot: "juridico", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: LEGAL_POLICY,
  },
  PROCUREMENT_REASONING: {
    id: "PROCUREMENT_REASONING", name: "Raciocínio de Licitação", description: "Apoia o raciocínio do fluxo DFD → ETP → TR → Edital.",
    context: "Processo licitatório supervisionado.", criticality: "alta", allowedBusinessDomains: ["processo_licitatorio"],
    recommendedCopilot: "planejamento", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: REASONING_POLICY,
  },
  DIRECT_PROCUREMENT_REASONING: {
    id: "DIRECT_PROCUREMENT_REASONING", name: "Raciocínio de Contratação Direta", description: "Apoia dispensa/inexigibilidade e enquadramento legal.",
    context: "Contratação direta supervisionada.", criticality: "alta", allowedBusinessDomains: ["contratacao_direta"],
    recommendedCopilot: "agente_contratacao", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: REASONING_POLICY,
  },
  CONTRACT_REASONING: {
    id: "CONTRACT_REASONING", name: "Raciocínio de Contratos", description: "Apoia gestão contratual, aditivos, prorrogações e fiscalização.",
    context: "Gestão contratual supervisionada.", criticality: "alta", allowedBusinessDomains: ["contratos"],
    recommendedCopilot: "contratos", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: REASONING_POLICY,
  },
  ITEM_REASONING: {
    id: "ITEM_REASONING", name: "Raciocínio de Itens", description: "Apoia a estruturação de itens do TR (especificações, unidades).",
    context: "Elaboração de itens do TR.", criticality: "media", allowedBusinessDomains: ["processo_licitatorio"],
    recommendedCopilot: "tr_intelligence", grounding: STRUCTURAL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: LIGHT_POLICY,
  },
  CATMAT_MATCHING: {
    id: "CATMAT_MATCHING", name: "Correspondência CATMAT/CATSER", description: "Sugere correspondência de itens a códigos CATMAT/CATSER.",
    context: "Padronização de catálogo.", criticality: "media", allowedBusinessDomains: ["processo_licitatorio"],
    recommendedCopilot: "tr_intelligence", grounding: LIGHT_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: LIGHT_POLICY,
  },
  RISK_ANALYSIS: {
    id: "RISK_ANALYSIS", name: "Análise de Riscos", description: "Identifica e classifica riscos do processo/contrato.",
    context: "Gestão de riscos supervisionada.", criticality: "alta", allowedBusinessDomains: CORE,
    recommendedCopilot: "controle_interno", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: REASONING_POLICY,
  },
  COMPLIANCE_CHECK: {
    id: "COMPLIANCE_CHECK", name: "Verificação de Conformidade", description: "Verifica conformidade legal/procedimental de um artefato.",
    context: "Compliance supervisionado.", criticality: "alta", allowedBusinessDomains: CORE,
    recommendedCopilot: "controle_interno", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: REASONING_POLICY,
  },
  WORKFLOW_RECOMMENDATION: {
    id: "WORKFLOW_RECOMMENDATION", name: "Recomendação de Fluxo", description: "Recomenda próximos passos operacionais do processo.",
    context: "Centro de Operações — recomendação de fluxo.", criticality: "media", allowedBusinessDomains: [...CORE, "gestao_departamento"],
    recommendedCopilot: "planejamento", grounding: STRUCTURAL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: LIGHT_POLICY,
  },
  DOCUMENT_IMPROVEMENT: {
    id: "DOCUMENT_IMPROVEMENT", name: "Melhoria de Documento", description: "Sugere melhorias pontuais em um documento existente.",
    context: "Aprimoramento documental supervisionado.", criticality: "media", allowedBusinessDomains: CORE,
    recommendedCopilot: "agente_contratacao", grounding: FULL_GROUNDING, requiresExplainability: true, structuredOutput: true, policy: REASONING_POLICY,
  },
};

export const ALL_COGNITIVE_TASK_IDS: CognitiveTaskId[] = Object.keys(COGNITIVE_TASKS) as CognitiveTaskId[];

export function isCognitiveTask(id: string): id is CognitiveTaskId {
  return id in COGNITIVE_TASKS;
}

export function getCognitiveTask(id: CognitiveTaskId): CognitiveTask {
  return COGNITIVE_TASKS[id];
}

/** true se o domínio pode solicitar a tarefa (autorização cognitiva). */
export function isBusinessDomainAllowed(id: CognitiveTaskId, domain: BusinessDomainCode): boolean {
  return COGNITIVE_TASKS[id].allowedBusinessDomains.includes(domain);
}

/** Identidade determinística de uma definição de tarefa (registro/observabilidade). */
export function cognitiveTaskFingerprint(id: CognitiveTaskId): string {
  return createHash("sha256").update(`ctask:${id}`).digest("hex").slice(0, 20);
}
