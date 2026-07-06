/**
 * Sprint 5.1 — Business Domain: Processo Licitatório
 *
 * ProcurementWorkspace representa TODO o ciclo de planejamento da contratação —
 * não um gerador de documentos. Conduz o servidor desde a demanda até o edital.
 * Cada etapa é um ESTADO com regras próprias. Determinístico, multi-tenant.
 *
 * Todo acesso ao Kernel ocorre via kernelAccessService (regra de arquitetura).
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export type ProcessStage =
  | "NEW_PROCESS"
  | "DFD"
  | "ETP"
  | "PRICE_RESEARCH"
  | "ITEM_WORKSPACE"
  | "TR"
  | "NOTICE"
  | "REVIEW"
  | "ISSUED"
  | "ARCHIVED";

export type ProcessStatus = "rascunho" | "em_andamento" | "em_revisao" | "emitido" | "arquivado";

/** Como o servidor deseja iniciar o processo (nunca obriga DFD). */
export type StartOption =
  | "criar_dfd"
  | "importar_dfd"
  | "importar_oficio"
  | "importar_memorando"
  | "importar_pdf"
  | "iniciar_etp";

export interface ProcurementWorkspace {
  readonly id: string;
  readonly organizationId: number;
  readonly processNumber: string;
  readonly object: string;
  readonly modality: string;
  readonly currentStage: ProcessStage;
  readonly status: ProcessStatus;
  readonly startOption: StartOption;
  readonly responsibleUser: number;
  readonly participants: readonly number[];
  readonly activeCopilots: readonly CopilotType[];
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Ordem canônica das etapas do processo. */
export const STAGE_ORDER: ProcessStage[] = [
  "NEW_PROCESS", "DFD", "ETP", "PRICE_RESEARCH", "ITEM_WORKSPACE",
  "TR", "NOTICE", "REVIEW", "ISSUED", "ARCHIVED",
];

/** Copilotos que participam automaticamente do domínio. */
export const DOMAIN_COPILOTS: CopilotType[] = [
  "planejamento", "tr_intelligence", "pesquisa_precos", "juridico", "agente_contratacao",
];

export function createProcurementWorkspace(params: {
  organizationId: number;
  processNumber: string;
  object: string;
  modality?: string;
  startOption: StartOption;
  responsibleUser: number;
  participants?: number[];
  correlationId: string;
  createdAt?: string;
}): ProcurementWorkspace {
  const id = createHash("sha256")
    .update(`plp:${params.organizationId}:${params.processNumber}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  // Adaptive Process Engine: sem DFD, o fluxo começa direto no ETP.
  const startsAtEtp = params.startOption === "iniciar_etp";
  return {
    id,
    organizationId: params.organizationId,
    processNumber: params.processNumber,
    object: params.object,
    modality: params.modality ?? "",
    currentStage: startsAtEtp ? "ETP" : "NEW_PROCESS",
    status: "rascunho",
    startOption: params.startOption,
    responsibleUser: params.responsibleUser,
    participants: params.participants ?? [params.responsibleUser],
    activeCopilots: DOMAIN_COPILOTS,
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Próxima etapa considerando o Adaptive Process Engine (DFD é opcional). */
export function nextStage(process: ProcurementWorkspace): ProcessStage {
  const idx = STAGE_ORDER.indexOf(process.currentStage);
  let next = idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : process.currentStage;
  // Se o processo não usa DFD e está em NEW_PROCESS, pula direto para ETP.
  if (process.currentStage === "NEW_PROCESS" && process.startOption === "iniciar_etp") {
    next = "ETP";
  }
  return next;
}

export function advanceStage(process: ProcurementWorkspace, at?: string): ProcurementWorkspace {
  const next = nextStage(process);
  const status: ProcessStatus =
    next === "ISSUED" ? "emitido" : next === "ARCHIVED" ? "arquivado" :
    next === "REVIEW" ? "em_revisao" : "em_andamento";
  return { ...process, currentStage: next, status, updatedAt: at ?? new Date().toISOString() };
}

export function setStage(process: ProcurementWorkspace, stage: ProcessStage, at?: string): ProcurementWorkspace {
  return { ...process, currentStage: stage, updatedAt: at ?? new Date().toISOString() };
}

/** Etapas obrigatórias vs opcionais (DFD é opcional). */
export function isStageMandatory(stage: ProcessStage): boolean {
  return stage !== "DFD" && stage !== "ARCHIVED";
}

/** Indica se o DFD faz parte do fluxo escolhido. */
export function usesDFD(process: ProcurementWorkspace): boolean {
  return process.startOption !== "iniciar_etp";
}
