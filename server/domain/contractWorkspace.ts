/**
 * FASE 5 — Business Domain: Contratos e Instrumentos Contratuais
 *
 * ContractWorkspace centraliza a ENGENHARIA DOCUMENTAL de um contrato — não a
 * execução financeira nem a fiscalização. Foco exclusivo: geração inteligente de
 * documentos contratuais (contrato, aditivos, apostilamentos, rescisões).
 *
 * NÃO substitui ERP. Nunca controla pagamentos, empenhos, orçamento ou patrimônio.
 * Determinístico, multi-tenant, replay-safe. Kernel só via kernelAccessService.
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

/** Como o contrato nasceu (três origens possíveis). */
export type ContractOriginType = "processo_licitatorio" | "contratacao_direta" | "externo" | "avulso";

export type ContractStatus =
  | "minuta"
  | "vigente"
  | "aditado"
  | "apostilado"
  | "encerrado"
  | "rescindido"
  | "arquivado";

/** Copilotos do domínio (supervisionados — nunca decidem). */
export const CONTRACT_DOMAIN_COPILOTS: CopilotType[] = ["juridico", "contratos", "agente_contratacao"];

export interface ContractWorkspace {
  readonly id: string;
  readonly organizationId: number;
  readonly originType: ContractOriginType;
  /** Id do processo/contratação de origem (vazio quando externo). */
  readonly originProcess: string;
  readonly contractNumber: string;
  readonly contractor: string;
  readonly object: string;
  readonly value: number;
  readonly term: string;
  readonly status: ContractStatus;
  /** Gestor e fiscal NÃO são obrigatórios. */
  readonly manager: string;
  readonly inspector: string;
  readonly activeCopilots: readonly CopilotType[];
  readonly correlationId: string;
  /** Usuário responsável pela criação (0286). NULL em workspaces anteriores à coluna
   *  (os 3 fluxos pré-existentes — processo, contratação direta, externo — não passam
   *  esse dado hoje; fora do escopo desta correção, ver plano de descontinuação legado). */
  readonly createdBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const STATUS_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  minuta: ["vigente", "arquivado", "rescindido"],
  vigente: ["aditado", "apostilado", "encerrado", "rescindido", "arquivado"],
  aditado: ["vigente", "apostilado", "encerrado", "rescindido", "arquivado"],
  apostilado: ["vigente", "aditado", "encerrado", "rescindido", "arquivado"],
  encerrado: ["arquivado"],
  rescindido: ["arquivado"],
  arquivado: [],
};

export function createContractWorkspace(params: {
  organizationId: number;
  originType: ContractOriginType;
  originProcess?: string;
  contractNumber: string;
  contractor?: string;
  object?: string;
  value?: number;
  term?: string;
  manager?: string;
  inspector?: string;
  status?: ContractStatus;
  correlationId: string;
  createdBy?: number | null;
  createdAt?: string;
}): ContractWorkspace {
  const id = createHash("sha256")
    .update(`ctw:${params.organizationId}:${params.originType}:${params.contractNumber}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    organizationId: params.organizationId,
    originType: params.originType,
    originProcess: params.originProcess ?? "",
    contractNumber: params.contractNumber,
    contractor: params.contractor ?? "",
    object: params.object ?? "",
    value: params.value ?? 0,
    term: params.term ?? "",
    status: params.status ?? "minuta",
    manager: params.manager ?? "",
    inspector: params.inspector ?? "",
    activeCopilots: CONTRACT_DOMAIN_COPILOTS,
    correlationId: params.correlationId,
    createdBy: params.createdBy ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function canContractTransition(from: ContractStatus, to: ContractStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function transitionContractStatus(ws: ContractWorkspace, to: ContractStatus, at?: string): ContractWorkspace {
  if (!canContractTransition(ws.status, to)) {
    throw new Error(`Transição de contrato inválida: ${ws.status} → ${to}`);
  }
  return { ...ws, status: to, updatedAt: at ?? new Date().toISOString() };
}

/** Atualiza campos editáveis do contrato (sempre supervisionado). */
export function updateContractFields(
  ws: ContractWorkspace,
  patch: Partial<Pick<ContractWorkspace, "contractor" | "object" | "value" | "term" | "manager" | "inspector" | "contractNumber">>,
  at?: string,
): ContractWorkspace {
  return { ...ws, ...patch, updatedAt: at ?? new Date().toISOString() };
}

export function isContractTerminal(ws: ContractWorkspace): boolean {
  return STATUS_TRANSITIONS[ws.status].length === 0;
}
