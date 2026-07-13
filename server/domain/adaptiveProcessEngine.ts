/**
 * Sprint 5.0.1 — Adaptive Process Engine (componente oficial do Kernel)
 * Sprint 5.X.X — Consolidação: filosofia de RECOMENDAÇÃO (nunca de decisão).
 *
 * Monta a estrutura do fluxo de cada Business Domain (etapas, documentos, copilotos
 * predominantes). IMPORTANTE: nesta consolidação, o Engine NÃO decide nem obriga —
 * a etapa marcada como `mandatory` é tratada apenas como fortemente RECOMENDADA. A
 * decisão de percorrer ou pular qualquer etapa é SEMPRE do servidor. As recomendações
 * orientadoras (fundamentação, base legal, confiança, alternativas) são produzidas
 * pelo Adaptive Recommendation Engine (server/domain/adaptiveRecommendationEngine.ts).
 * Determinístico.
 */

import { createHash } from "crypto";
import type { BusinessDomainCode } from "./businessDomain";
import type { CopilotType } from "./institutionalCopilot";

export interface ProcessStepDefinition {
  readonly key: string;
  readonly name: string;
  readonly documents: readonly string[];
  readonly mandatory: boolean;
  readonly requiresApproval: boolean;
  readonly predominantCopilot: CopilotType | null;
  readonly exceptions: readonly string[];
}

export interface ProcessDefinition {
  readonly businessDomainCode: BusinessDomainCode;
  readonly workflowKey: string;
  readonly steps: readonly ProcessStepDefinition[];
}

export interface AssembledProcess {
  readonly id: string;
  readonly businessDomainCode: BusinessDomainCode;
  readonly workflowKey: string;
  readonly orderedSteps: readonly ProcessStepDefinition[];
  readonly mandatorySteps: readonly string[];
  readonly approvalSteps: readonly string[];
  readonly predominantCopilots: readonly CopilotType[];
  readonly signature: string;
}

/**
 * Assembla um fluxo a partir da definição de um domínio. Determinístico: mesma
 * definição → mesma assinatura. O Kernel valida obrigatoriedades e aprovações.
 */
export function assembleProcess(def: ProcessDefinition): AssembledProcess {
  const orderedSteps = [...def.steps];
  const mandatorySteps = orderedSteps.filter(s => s.mandatory).map(s => s.key);
  const approvalSteps = orderedSteps.filter(s => s.requiresApproval).map(s => s.key);
  const predominantCopilots = [
    ...new Set(orderedSteps.map(s => s.predominantCopilot).filter((c): c is CopilotType => c !== null)),
  ];
  const signature = createHash("sha256")
    .update(`ape:${def.businessDomainCode}:${def.workflowKey}:${orderedSteps.map(s => s.key).join(">")}`)
    .digest("hex").slice(0, 20);
  const id = createHash("sha256")
    .update(`apeid:${def.businessDomainCode}:${def.workflowKey}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    businessDomainCode: def.businessDomainCode,
    workflowKey: def.workflowKey,
    orderedSteps,
    mandatorySteps,
    approvalSteps,
    predominantCopilots,
    signature,
  };
}

/**
 * Converte as etapas de um fluxo em RECOMENDAÇÕES não vinculantes. Nenhuma etapa é
 * obrigatória: `mandatory` vira "fortemente recomendada" e o servidor sempre pode
 * seguir sem ela (o Engine nunca bloqueia). Determinístico.
 */
export function recommendSteps(def: ProcessDefinition): Array<{ key: string; name: string; recommended: boolean; stronglyRecommended: boolean; canSkip: true }> {
  return def.steps.map(s => ({
    key: s.key,
    name: s.name,
    recommended: true,
    stronglyRecommended: s.mandatory,
    canSkip: true,
  }));
}

/** Valida a definição de um fluxo (chaves únicas, ao menos uma etapa). */
export function validateProcessDefinition(def: ProcessDefinition): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (def.steps.length === 0) violations.push("O fluxo deve possuir ao menos uma etapa.");
  const keys = new Set<string>();
  for (const step of def.steps) {
    if (keys.has(step.key)) violations.push(`Etapa duplicada: ${step.key}.`);
    keys.add(step.key);
  }
  return { valid: violations.length === 0, violations };
}
