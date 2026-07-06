/**
 * Sprint 5.0.1 — Adaptive Process Engine (componente oficial do Kernel)
 *
 * Monta dinamicamente o fluxo de cada Business Domain. Cada domínio DEFINE suas
 * etapas, documentos, exceções, obrigatoriedades, aprovações e copilotos
 * predominantes; o Kernel EXECUTA (assembla e valida) o fluxo. Determinístico.
 *
 * Esta sprint apenas fornece a estrutura — os fluxos concretos vêm nas Sprints 5.1-5.5.
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
