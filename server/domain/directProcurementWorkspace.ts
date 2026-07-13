/**
 * FASE 5 — Business Domain: Contratação Direta
 *
 * DirectProcurementWorkspace conduz INTEGRALMENTE um processo de Dispensa ou
 * Inexigibilidade — do início até o contrato/instrumento equivalente. Cada etapa
 * é um ESTADO; o Adaptive Process Engine decide quais etapas são obrigatórias
 * (DFD opcional, pesquisa/propostas/parecer condicionais). Nunca fluxo fixo.
 *
 * Reutiliza integralmente a infraestrutura do Kernel (Price Research, Institutional
 * Request Engine, Parecer Jurídico). Determinístico, multi-tenant, replay-safe.
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export type DirectProcurementType = "dispensa" | "inexigibilidade";
export type DirectProcedureType = "eletronico" | "presencial" | "indefinido";

/** Como o servidor deseja iniciar (DFD é sempre opcional). */
export type DirectStartOption =
  | "criar_dfd"
  | "importar_dfd"
  | "importar_pdf"
  | "importar_memorando"
  | "importar_oficio"
  | "sem_dfd";

export type DirectProcurementStage =
  | "NEW"
  | "DFD"
  | "LEGAL_BASIS"
  | "NEED_CHARACTERIZATION"
  | "PRICE_RESEARCH"
  | "PROCEDURE"
  | "PROPOSAL_COLLECTION"
  | "CONTRACT_JUSTIFICATION"
  | "PRICE_JUSTIFICATION"
  | "REQUIRED_DOCUMENTS"
  | "LEGAL_OPINION"
  | "RATIFICATION"
  | "PUBLICATION"
  | "CONTRACT"
  | "ARCHIVED";

export type DirectProcurementStatus = "rascunho" | "em_andamento" | "aguardando_parecer" | "ratificado" | "publicado" | "concluido" | "arquivado";

/** Ordem canônica das etapas. */
export const DIRECT_STAGE_ORDER: DirectProcurementStage[] = [
  "NEW", "DFD", "LEGAL_BASIS", "NEED_CHARACTERIZATION", "PRICE_RESEARCH", "PROCEDURE",
  "PROPOSAL_COLLECTION", "CONTRACT_JUSTIFICATION", "PRICE_JUSTIFICATION", "REQUIRED_DOCUMENTS",
  "LEGAL_OPINION", "RATIFICATION", "PUBLICATION", "CONTRACT", "ARCHIVED",
];

/** Copilotos do domínio (coordenados apenas pelo Multi-Copilot Orchestrator). */
export const DIRECT_DOMAIN_COPILOTS: CopilotType[] = ["agente_contratacao", "juridico", "pesquisa_precos"];

/** Etapas condicionais controladas pelo Adaptive Process Engine. */
export interface AdaptiveFlags {
  readonly usesDFD: boolean;
  readonly requiresPriceResearch: boolean;
  readonly requiresProposalCollection: boolean;
  readonly requiresLegalOpinion: boolean;
}

export interface DirectProcurementWorkspace {
  readonly id: string;
  readonly organizationId: number;
  readonly processNumber: string;
  readonly object: string;
  readonly procurementType: DirectProcurementType;
  readonly procedureType: DirectProcedureType;
  readonly legalBasis: string;
  readonly startOption: DirectStartOption;
  readonly currentStage: DirectProcurementStage;
  readonly status: DirectProcurementStatus;
  readonly responsibleUser: number;
  readonly participants: readonly number[];
  readonly activeCopilots: readonly CopilotType[];
  readonly flags: AdaptiveFlags;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Flags padrão por modalidade (Adaptive Process Engine — nunca fluxo fixo). */
export function defaultFlags(type: DirectProcurementType, startOption: DirectStartOption): AdaptiveFlags {
  return {
    usesDFD: startOption !== "sem_dfd",
    // Dispensa por valor exige pesquisa; inexigibilidade (inviabilidade de competição) em regra não.
    requiresPriceResearch: type === "dispensa",
    requiresProposalCollection: type === "dispensa",
    requiresLegalOpinion: true,
  };
}

export function createDirectProcurementWorkspace(params: {
  organizationId: number;
  processNumber: string;
  object: string;
  procurementType: DirectProcurementType;
  startOption: DirectStartOption;
  responsibleUser: number;
  participants?: number[];
  legalBasis?: string;
  flags?: Partial<AdaptiveFlags>;
  correlationId: string;
  createdAt?: string;
}): DirectProcurementWorkspace {
  const id = createHash("sha256")
    .update(`dpw:${params.organizationId}:${params.processNumber}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  const flags = { ...defaultFlags(params.procurementType, params.startOption), ...params.flags };
  // Sem DFD, o fluxo começa direto na definição do Fundamento Legal.
  const currentStage: DirectProcurementStage = flags.usesDFD ? "NEW" : "LEGAL_BASIS";
  return {
    id,
    organizationId: params.organizationId,
    processNumber: params.processNumber,
    object: params.object,
    procurementType: params.procurementType,
    procedureType: "indefinido",
    legalBasis: params.legalBasis ?? "",
    startOption: params.startOption,
    currentStage,
    status: "rascunho",
    responsibleUser: params.responsibleUser,
    participants: params.participants ?? [params.responsibleUser],
    activeCopilots: DIRECT_DOMAIN_COPILOTS,
    flags,
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Uma etapa deve ser pulada quando é condicional e o Adaptive Engine a desativa. */
export function isStageSkipped(stage: DirectProcurementStage, flags: AdaptiveFlags): boolean {
  if (stage === "DFD") return !flags.usesDFD;
  if (stage === "PRICE_RESEARCH") return !flags.requiresPriceResearch;
  if (stage === "PROPOSAL_COLLECTION") return !flags.requiresProposalCollection;
  if (stage === "LEGAL_OPINION") return !flags.requiresLegalOpinion;
  return false;
}

/** Próxima etapa obrigatória, pulando as condicionais desativadas. */
export function nextDirectStage(ws: DirectProcurementWorkspace): DirectProcurementStage {
  const idx = DIRECT_STAGE_ORDER.indexOf(ws.currentStage);
  for (let i = idx + 1; i < DIRECT_STAGE_ORDER.length; i++) {
    const candidate = DIRECT_STAGE_ORDER[i];
    if (!isStageSkipped(candidate, ws.flags)) return candidate;
  }
  return ws.currentStage;
}

function statusForStage(stage: DirectProcurementStage): DirectProcurementStatus {
  switch (stage) {
    case "LEGAL_OPINION": return "aguardando_parecer";
    case "RATIFICATION": return "ratificado";
    case "PUBLICATION": return "publicado";
    case "CONTRACT": return "concluido";
    case "ARCHIVED": return "arquivado";
    case "NEW": return "rascunho";
    default: return "em_andamento";
  }
}

/** Avança para a próxima etapa obrigatória (Adaptive Process Engine). */
export function advanceDirectStage(ws: DirectProcurementWorkspace, at?: string): DirectProcurementWorkspace {
  const next = nextDirectStage(ws);
  return { ...ws, currentStage: next, status: statusForStage(next), updatedAt: at ?? new Date().toISOString() };
}

/** Define explicitamente uma etapa (permite editar/retomar — nunca bloqueia). */
export function setDirectStage(ws: DirectProcurementWorkspace, stage: DirectProcurementStage, at?: string): DirectProcurementWorkspace {
  return { ...ws, currentStage: stage, status: statusForStage(stage), updatedAt: at ?? new Date().toISOString() };
}

export function setProcedureType(ws: DirectProcurementWorkspace, procedureType: DirectProcedureType, at?: string): DirectProcurementWorkspace {
  return { ...ws, procedureType, updatedAt: at ?? new Date().toISOString() };
}

export function setLegalBasis(ws: DirectProcurementWorkspace, legalBasis: string, at?: string): DirectProcurementWorkspace {
  return { ...ws, legalBasis, updatedAt: at ?? new Date().toISOString() };
}

export function configureFlags(ws: DirectProcurementWorkspace, flags: Partial<AdaptiveFlags>, at?: string): DirectProcurementWorkspace {
  return { ...ws, flags: { ...ws.flags, ...flags }, updatedAt: at ?? new Date().toISOString() };
}

export function usesDFD(ws: DirectProcurementWorkspace): boolean {
  return ws.flags.usesDFD;
}
