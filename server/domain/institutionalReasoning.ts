/**
 * RC-4.2 — Institutional Reasoning Framework.
 *
 * Separa CONHECIMENTO → RACIOCÍNIO → RESPOSTA. Antes de qualquer resposta, o
 * AIExecutionEngine constrói um InstitutionalReasoningPlan: um plano DECLARATIVO de
 * raciocínio (12 etapas), com objetivo, contexto, leis, documentos, restrições, riscos,
 * alternativas e regras aplicáveis. NENHUMA decisão — apenas planejamento do raciocínio.
 *
 * Determinístico e replay-safe (IDs/replayHash via sha256 sobre insumos lógicos).
 */

import { createHash } from "crypto";
import type { CognitiveTaskId } from "./cognitiveTask";
import type { BusinessDomainCode } from "./businessDomain";
import { getRulesForTask, type InstitutionalRule } from "./institutionalRules";

/** Etapas oficiais e DECLARATIVAS do raciocínio institucional. */
export type ReasoningStepId =
  | "entender_solicitacao"
  | "identificar_business_domain"
  | "identificar_etapa_processo"
  | "identificar_legislacao"
  | "identificar_documentos"
  | "identificar_riscos"
  | "identificar_inconsistencias"
  | "levantar_alternativas"
  | "construir_recomendacao"
  | "construir_justificativa"
  | "gerar_explainability"
  | "gerar_structured_response";

export interface ReasoningStep {
  readonly id: ReasoningStepId;
  readonly order: number;
  readonly name: string;
  readonly description: string;
}

/** As 12 etapas padrão, na ordem oficial. Declarativas — sem execução. */
export const STANDARD_REASONING_STEPS: readonly ReasoningStep[] = [
  { id: "entender_solicitacao", order: 1, name: "Entender a solicitação", description: "Compreender o objetivo do pedido." },
  { id: "identificar_business_domain", order: 2, name: "Identificar o Business Domain", description: "Reconhecer o domínio institucional." },
  { id: "identificar_etapa_processo", order: 3, name: "Identificar a etapa do processo", description: "Situar a etapa do fluxo." },
  { id: "identificar_legislacao", order: 4, name: "Identificar legislação relevante", description: "Selecionar a base legal aplicável." },
  { id: "identificar_documentos", order: 5, name: "Identificar documentos necessários", description: "Levantar documentos pertinentes." },
  { id: "identificar_riscos", order: 6, name: "Identificar riscos", description: "Mapear riscos do processo." },
  { id: "identificar_inconsistencias", order: 7, name: "Identificar inconsistências", description: "Detectar lacunas e conflitos." },
  { id: "levantar_alternativas", order: 8, name: "Levantar alternativas possíveis", description: "Enumerar caminhos possíveis." },
  { id: "construir_recomendacao", order: 9, name: "Construir recomendação", description: "Formular a recomendação (supervisionada)." },
  { id: "construir_justificativa", order: 10, name: "Construir justificativa", description: "Fundamentar a recomendação." },
  { id: "gerar_explainability", order: 11, name: "Gerar Explainability", description: "Explicitar o porquê e o que foi usado/descartado." },
  { id: "gerar_structured_response", order: 12, name: "Gerar Structured Response", description: "Consolidar a resposta estruturada." },
];

export interface InstitutionalReasoningPlan {
  readonly id: string;
  readonly task: CognitiveTaskId;
  readonly objective: string;
  readonly context: string;
  readonly steps: readonly ReasoningStep[];
  readonly laws: readonly string[];
  readonly documents: readonly string[];
  readonly constraints: readonly string[];
  readonly risks: readonly string[];
  readonly alternatives: readonly string[];
  /** IDs das regras institucionais aplicáveis (declarativo). */
  readonly rules: readonly string[];
  readonly correlationId: string;
  /** Hash determinístico do plano (insumos lógicos — replay-safe). */
  readonly replayHash: string;
}

export interface BuildReasoningPlanParams {
  task: CognitiveTaskId;
  objective: string;
  correlationId: string;
  businessDomain?: BusinessDomainCode;
  stage?: string;
  laws?: readonly string[];
  documents?: readonly string[];
  criticality?: string;
}

/** Alternativas operacionais estruturais (não jurídicas) — determinísticas. */
const STRUCTURAL_ALTERNATIVES: readonly string[] = [
  "Prosseguir conforme o planejamento",
  "Revisar com o setor requisitante",
  "Solicitar complementação de informações",
];
/** Riscos estruturais genéricos (não jurídicos) — determinísticos. */
const STRUCTURAL_RISKS: readonly string[] = [
  "Risco de conformidade procedimental",
  "Risco de prazo",
  "Risco de fundamentação insuficiente",
];

function planReplayHash(params: BuildReasoningPlanParams, ruleIds: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({
      task: params.task, objective: params.objective, domain: params.businessDomain ?? "",
      stage: params.stage ?? "", laws: [...(params.laws ?? [])].sort(), rules: [...ruleIds].sort(),
    }))
    .digest("hex").slice(0, 32);
}

/**
 * Constrói o plano de raciocínio institucional. Declarativo e determinístico:
 * mesmos insumos lógicos → mesmo plano (mesmo replayHash). Nenhuma decisão.
 */
export function buildReasoningPlan(params: BuildReasoningPlanParams): InstitutionalReasoningPlan {
  const rules: InstitutionalRule[] = getRulesForTask(params.task, params.businessDomain);
  const ruleIds = rules.map(r => r.id);
  const replayHash = planReplayHash(params, ruleIds);
  const id = createHash("sha256").update(`plan:${params.correlationId}:${replayHash}`).digest("hex").slice(0, 20);

  const constraints: string[] = [
    `Criticidade: ${params.criticality ?? "media"}`,
    "IA supervisionada — servidor sempre decide",
    ...rules.map(r => `${r.statement} (${r.category})`),
  ];

  return {
    id, task: params.task, objective: params.objective,
    context: `Domínio: ${params.businessDomain ?? "n/d"}; etapa: ${params.stage ?? "n/d"}.`,
    steps: STANDARD_REASONING_STEPS,
    laws: [...(params.laws ?? [])],
    documents: [...(params.documents ?? [])],
    constraints,
    risks: STRUCTURAL_RISKS,
    alternatives: STRUCTURAL_ALTERNATIVES,
    rules: ruleIds,
    correlationId: params.correlationId,
    replayHash,
  };
}

/** A alternativa "recomendada" (primeira) e as "descartadas" (demais) — com motivo estrutural. */
export function splitAlternatives(plan: InstitutionalReasoningPlan): { recommended: string; discarded: Array<{ alternative: string; reason: string }> } {
  const [first, ...rest] = plan.alternatives;
  return {
    recommended: first ?? "",
    discarded: rest.map(a => ({ alternative: a, reason: "Alternativa considerada, não priorizada nesta fase (raciocínio determinístico/mock)." })),
  };
}
