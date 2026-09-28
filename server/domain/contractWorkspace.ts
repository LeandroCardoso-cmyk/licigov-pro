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
  // SEM-023 — fora da minuta, campos econômicos/de identidade só mudam por instrumento (recusa antes de qualquer efeito).
  assertContractFieldsEditable(ws, patch);
  return { ...ws, ...pickEditableContractFields(patch), updatedAt: at ?? new Date().toISOString() };
}

export function isContractTerminal(ws: ContractWorkspace): boolean {
  return STATUS_TRANSITIONS[ws.status].length === 0;
}

// ─── SEM-023 — contrato fora da minuta só muda termos econômicos por instrumento ──────────────────

/** Único status em que o contrato ainda é rascunho (todos os fluxos de nascimento criam `minuta`). */
export const CONTRACT_DRAFT_STATUS = "minuta" as const satisfies ContractStatus;

/** Tokens estáveis (não traduzir; usados por testes e pelo cliente). */
export const CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT = "CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT";
export const CONTRACT_REVISION_CONFLICT = "CONTRACT_REVISION_CONFLICT";

/**
 * Campos econômicos/de identidade do contrato. Fora de `minuta` só mudam por INSTRUMENTO — o próprio
 * domínio já modela o caminho: aditivo de `valor`/`prazo`/`quantitativo`/`qualitativo` (`newValue`,
 * `newTerm`) e apostilamento de `reajuste` (`newValue`). `contractor` (contratado) e `contractNumber`
 * são a identidade do contrato; `object` só muda por aditivo qualitativo.
 */
export const CONTRACT_INSTRUMENT_GOVERNED_FIELDS = ["contractNumber", "contractor", "object", "value", "term"] as const;

/** Campos descritivos/operacionais — editáveis em qualquer status (sempre com CAS de revisão). */
export const CONTRACT_FREELY_EDITABLE_FIELDS = ["manager", "inspector"] as const;

export type ContractGovernedField = (typeof CONTRACT_INSTRUMENT_GOVERNED_FIELDS)[number];
export type ContractEditableField = ContractGovernedField | (typeof CONTRACT_FREELY_EDITABLE_FIELDS)[number];
export type ContractFieldPatch = Partial<Pick<ContractWorkspace, ContractEditableField>>;

const CONTRACT_EDITABLE_FIELDS: readonly ContractEditableField[] = [...CONTRACT_INSTRUMENT_GOVERNED_FIELDS, ...CONTRACT_FREELY_EDITABLE_FIELDS];

/** Recusa: tentativa de alterar campo econômico/de identidade de contrato que não está em minuta. */
export class ContractEconomicFieldsRequireInstrumentError extends Error {
  readonly code = CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT;
  constructor(public readonly status: ContractStatus, public readonly fields: readonly ContractGovernedField[]) {
    super(
      `Contrato em status "${status}" não admite alteração direta de ${fields.join(", ")}. ` +
      "Após a minuta, valor, contratado, objeto, vigência e número mudam somente por instrumento " +
      `(Termo Aditivo ou Apostilamento) — ${CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT}.`,
    );
    this.name = "ContractEconomicFieldsRequireInstrumentError";
  }
}

/** Recusa: a revisão que o cliente carregou não é mais a revisão persistida (outro salvamento venceu). */
export class ContractRevisionConflictError extends Error {
  readonly code = CONTRACT_REVISION_CONFLICT;
  constructor() {
    super(
      "O contrato foi alterado por outra pessoa ou aba depois que você o abriu. Recarregue o contrato " +
      `e refaça a edição — nada foi gravado (${CONTRACT_REVISION_CONFLICT}).`,
    );
    this.name = "ContractRevisionConflictError";
  }
}

/** Mantém somente os campos editáveis conhecidos (whitelist — nada de status, ids ou datas via patch). */
export function pickEditableContractFields(patch: Record<string, unknown>): ContractFieldPatch {
  const out: Record<string, unknown> = {};
  for (const k of CONTRACT_EDITABLE_FIELDS) if (patch[k] !== undefined) out[k] = patch[k];
  return out as ContractFieldPatch;
}

function sameFieldValue(field: ContractGovernedField, current: unknown, next: unknown): boolean {
  // `value` é DECIMAL(15,2): compara em centavos (o formulário reenvia o valor carregado).
  if (field === "value") return Math.round(Number(current) * 100) === Math.round(Number(next) * 100);
  return String(current ?? "") === String(next ?? "");
}

/**
 * Campos econômicos/de identidade que o patch REALMENTE altera (valor reenviado igual ao persistido não é
 * alteração — o editor envia o formulário inteiro).
 */
export function governedFieldChanges(ws: ContractWorkspace, patch: Record<string, unknown>): ContractGovernedField[] {
  return CONTRACT_INSTRUMENT_GOVERNED_FIELDS.filter(f => patch[f] !== undefined && !sameFieldValue(f, ws[f], patch[f]));
}

/** Lança `ContractEconomicFieldsRequireInstrumentError` se o patch alterar campo governado fora da minuta. */
export function assertContractFieldsEditable(ws: ContractWorkspace, patch: Record<string, unknown>): void {
  if (ws.status === CONTRACT_DRAFT_STATUS) return;
  const changed = governedFieldChanges(ws, patch);
  if (changed.length > 0) throw new ContractEconomicFieldsRequireInstrumentError(ws.status, changed);
}

/** A revisão do contrato é o `updatedAt` persistido (DATETIME(3)); compara por instante, não por texto. */
export function isSameContractRevision(a: string, b: string): boolean {
  const ta = Date.parse(a); const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

/**
 * Próxima revisão: sempre ESTRITAMENTE posterior à revisão esperada (mesmo com dois salvamentos no mesmo
 * milissegundo ou relógio atrasado), para que um CAS perdedor nunca case com a revisão nova.
 */
export function nextContractRevision(expectedUpdatedAt: string, now: Date = new Date()): string {
  const floor = Date.parse(expectedUpdatedAt) + 1;
  return new Date(Math.max(now.getTime(), Number.isFinite(floor) ? floor : 0)).toISOString();
}
