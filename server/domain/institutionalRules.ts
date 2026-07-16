/**
 * RC-4.2 — Institutional Rules (repositório oficial de regras institucionais).
 *
 * Regras DECLARATIVAS que estruturam o raciocínio institucional. NÃO contêm conteúdo
 * jurídico — apenas a estrutura (enunciado curto + a que tarefas/domínios se aplicam).
 * O raciocínio real e o texto jurídico são fases futuras. Puro e determinístico.
 */

import type { BusinessDomainCode } from "./businessDomain";
import type { CognitiveTaskId } from "./cognitiveTask";

export type InstitutionalRuleCategory =
  | "obrigatorio" | "condicional" | "dispensavel" | "exige_justificativa" | "exige_registro";

export interface InstitutionalRule {
  readonly id: string;
  /** Enunciado curto e declarativo (estrutura, não conteúdo jurídico). */
  readonly statement: string;
  readonly category: InstitutionalRuleCategory;
  readonly appliesToDomains: readonly BusinessDomainCode[];
  readonly appliesToTasks: readonly CognitiveTaskId[];
}

/** Registro oficial de regras institucionais (estrutural). */
export const INSTITUTIONAL_RULES: Record<string, InstitutionalRule> = {
  etp_dispensavel: {
    id: "etp_dispensavel", statement: "ETP pode ser dispensado", category: "dispensavel",
    appliesToDomains: ["processo_licitatorio"], appliesToTasks: ["PROCUREMENT_REASONING", "GENERATE_DOCUMENT"],
  },
  tr_obrigatorio: {
    id: "tr_obrigatorio", statement: "TR obrigatório", category: "obrigatorio",
    appliesToDomains: ["processo_licitatorio"], appliesToTasks: ["PROCUREMENT_REASONING", "ITEM_REASONING", "GENERATE_DOCUMENT"],
  },
  parecer_obrigatorio: {
    id: "parecer_obrigatorio", statement: "Parecer obrigatório", category: "obrigatorio",
    appliesToDomains: ["parecer_juridico"], appliesToTasks: ["LEGAL_ANALYSIS", "LEGAL_REASONING"],
  },
  aditivo_exige_justificativa: {
    id: "aditivo_exige_justificativa", statement: "Aditivo exige justificativa", category: "exige_justificativa",
    appliesToDomains: ["contratos"], appliesToTasks: ["CONTRACT_REASONING"],
  },
  dispensa_exige_justificativa: {
    id: "dispensa_exige_justificativa", statement: "Dispensa exige justificativa", category: "exige_justificativa",
    appliesToDomains: ["contratacao_direta"], appliesToTasks: ["DIRECT_PROCUREMENT_REASONING"],
  },
  ratificacao_exige_registro: {
    id: "ratificacao_exige_registro", statement: "Ratificação exige registro", category: "exige_registro",
    appliesToDomains: ["contratacao_direta"], appliesToTasks: ["DIRECT_PROCUREMENT_REASONING"],
  },
  risco_exige_mitigacao: {
    id: "risco_exige_mitigacao", statement: "Risco identificado exige plano de mitigação", category: "condicional",
    appliesToDomains: ["processo_licitatorio", "contratacao_direta", "contratos", "parecer_juridico"],
    appliesToTasks: ["RISK_ANALYSIS", "COMPLIANCE_CHECK"],
  },
  conformidade_exige_registro: {
    id: "conformidade_exige_registro", statement: "Verificação de conformidade exige registro", category: "exige_registro",
    appliesToDomains: ["processo_licitatorio", "contratacao_direta", "contratos", "parecer_juridico"],
    appliesToTasks: ["COMPLIANCE_CHECK"],
  },
};

export const ALL_INSTITUTIONAL_RULE_IDS: string[] = Object.keys(INSTITUTIONAL_RULES);

export function getInstitutionalRule(id: string): InstitutionalRule | null {
  return INSTITUTIONAL_RULES[id] ?? null;
}

/**
 * Resolve as regras aplicáveis a uma tarefa (e, opcionalmente, a um domínio).
 * Determinístico (ordem estável por id). Nenhuma decisão — apenas seleção declarativa.
 */
export function getRulesForTask(task: CognitiveTaskId, domain?: BusinessDomainCode): InstitutionalRule[] {
  return ALL_INSTITUTIONAL_RULE_IDS
    .map(id => INSTITUTIONAL_RULES[id])
    .filter(r => r.appliesToTasks.includes(task) || (domain ? r.appliesToDomains.includes(domain) : false))
    .sort((a, b) => a.id.localeCompare(b.id));
}
