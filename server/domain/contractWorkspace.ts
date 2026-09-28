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
  // Fail-closed: status desconhecido (linha legada/corrompida) não tem transição alguma.
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Token estável da recusa de transição de status do contrato (não traduzir; usado por testes/cliente). */
export const CONTRACT_STATUS_TRANSITION_INVALID = "CONTRACT_STATUS_TRANSITION_INVALID";

/**
 * Transição de status recusada pela máquina de estados do contrato. A mensagem é a MESMA que a máquina
 * sempre emitiu ("Transição de contrato inválida: de → para"), então callers que já tratavam `Error`
 * (ex.: `contractWorkspace.updateContract` → BAD_REQUEST) mantêm o comportamento.
 */
export class ContractStatusTransitionError extends Error {
  readonly code = CONTRACT_STATUS_TRANSITION_INVALID;
  constructor(public readonly from: ContractStatus, public readonly to: ContractStatus) {
    super(`Transição de contrato inválida: ${from} → ${to}`);
    this.name = "ContractStatusTransitionError";
  }
}

export function transitionContractStatus(ws: ContractWorkspace, to: ContractStatus, at?: string): ContractWorkspace {
  if (!canContractTransition(ws.status, to)) {
    throw new ContractStatusTransitionError(ws.status, to);
  }
  return { ...ws, status: to, updatedAt: at ?? new Date().toISOString() };
}

// ─── SEM-025 — status do contrato imprimido por instrumento (aditivo/apostilamento) ──────────────

/** Instrumentos que imprimem status no contrato e o status que cada um imprime (comportamento existente). */
export const INSTRUMENT_CONTRACT_STATUS = { aditivo: "aditado", apostilamento: "apostilado" } as const satisfies Record<string, ContractStatus>;
export type ContractInstrumentKind = keyof typeof INSTRUMENT_CONTRACT_STATUS;

/**
 * Como o status do contrato muda ao registrar um instrumento:
 *  - `machine`   — transição DEFINIDA em `STATUS_TRANSITIONS` (ex.: vigente → aditado);
 *  - `unchanged` — o contrato já está no status do instrumento (ex.: 2º aditivo em contrato `aditado`).
 *                  Não é transição: mesma convenção de `contractWorkspace.updateContract` (status igual ⇒
 *                  a máquina não é consultada);
 *  - `minuta_pending_human_decision` — contrato em `minuta`. A máquina NÃO lista minuta → aditado/apostilado,
 *                  mas o produto não oferece hoje nenhum caminho de UI para levar o contrato a `vigente`
 *                  (todos os fluxos nascem `minuta`); recusar aqui tornaria Aditivos/Apostilamentos
 *                  inutilizáveis. O comportamento de hoje é MANTIDO, de forma explícita e auditável, até
 *                  decisão humana (PR-08, questão aberta) — nunca reabre estado encerrado.
 * Qualquer outro caso (encerrado, rescindido, arquivado — nenhum admite aditado/apostilado na máquina)
 * é RECUSADO com `ContractStatusTransitionError`, antes de qualquer efeito.
 */
export type InstrumentStatusChangeMode = "machine" | "unchanged" | "minuta_pending_human_decision";

export interface InstrumentStatusChangePlan {
  readonly from: ContractStatus;
  readonly to: ContractStatus;
  readonly mode: InstrumentStatusChangeMode;
}

export function planInstrumentStatusChange(from: ContractStatus, instrument: ContractInstrumentKind): InstrumentStatusChangePlan {
  const to: ContractStatus = INSTRUMENT_CONTRACT_STATUS[instrument];
  if (from === to) return { from, to, mode: "unchanged" };
  if (canContractTransition(from, to)) return { from, to, mode: "machine" };
  if (from === "minuta") return { from, to, mode: "minuta_pending_human_decision" };
  throw new ContractStatusTransitionError(from, to);
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
