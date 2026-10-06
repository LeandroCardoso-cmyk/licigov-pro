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
 * Como o status do contrato muda ao registrar um instrumento (decisão do responsável pelo produto, PR-08 rev. 2):
 *  - `machine`   — transição DEFINIDA em `STATUS_TRANSITIONS` (ex.: vigente → aditado; apostilado → aditado);
 *  - `unchanged` — o contrato já está no status do instrumento (ex.: 2º aditivo em contrato `aditado`).
 *                  Não é transição: mesma convenção de `contractWorkspace.updateContract` (status igual ⇒
 *                  a máquina não é consultada). Instrumentos SUCESSIVOS são histórico/filhos do contrato:
 *                  `aditado`/`apostilado` nunca bloqueiam um novo aditivo/apostilamento;
 *  - `deferred_pending_legal_opinion` — o instrumento é ADMISSÍVEL no status atual (um dos dois casos acima),
 *                  mas o próprio fluxo declarou que ele exige parecer jurídico (`requiresLegalOpinion`) e o
 *                  parecer ainda não existe. Fail-closed: o instrumento é registrado aguardando parecer e o
 *                  status do contrato NÃO muda (`to === from`). A efetivação posterior depende do comando de
 *                  finalização do instrumento, que ainda não existe (PR-18/PR-20 — ver
 *                  docs/design/CONTRACT_ACTIVATION_TRANSITION.md).
 * Qualquer outro caso é RECUSADO com `ContractStatusTransitionError`, antes de qualquer efeito:
 *  - `minuta` — contrato ainda não formalizado. A máquina NÃO lista minuta → aditado/apostilado e não há exceção:
 *               aditivo/apostilamento só existem sobre contrato formalizado (a ativação minuta → vigente é uma
 *               transição institucional explícita, proposta em docs/design/CONTRACT_ACTIVATION_TRANSITION.md);
 *  - encerrado, rescindido, arquivado — nenhum admite aditado/apostilado na máquina; nunca reabrem.
 */
export type InstrumentStatusChangeMode = "machine" | "unchanged" | "deferred_pending_legal_opinion";

export interface InstrumentStatusChangePlan {
  readonly from: ContractStatus;
  /** Status que o contrato terá ao final da operação (igual a `from` em `unchanged` e `deferred_pending_legal_opinion`). */
  readonly to: ContractStatus;
  /** Status que o instrumento imprime no contrato quando efetivado (`aditado`/`apostilado`). */
  readonly instrumentStatus: ContractStatus;
  readonly mode: InstrumentStatusChangeMode;
}

export function planInstrumentStatusChange(
  from: ContractStatus,
  instrument: ContractInstrumentKind,
  opts: { readonly requiresLegalOpinion?: boolean } = {},
): InstrumentStatusChangePlan {
  const instrumentStatus: ContractStatus = INSTRUMENT_CONTRACT_STATUS[instrument];
  const admissible = from === instrumentStatus || canContractTransition(from, instrumentStatus);
  if (!admissible) throw new ContractStatusTransitionError(from, instrumentStatus);
  if (opts.requiresLegalOpinion === true) return { from, to: from, instrumentStatus, mode: "deferred_pending_legal_opinion" };
  if (from === instrumentStatus) return { from, to: from, instrumentStatus, mode: "unchanged" };
  return { from, to: instrumentStatus, instrumentStatus, mode: "machine" };
}

// ─── SEM-062 — gestor/fiscal designados POR INSTRUMENTO (apostilamento `gestor`/`fiscal`) ───────────────────────

/** Token estável (não traduzir): o apostilamento de gestor/fiscal não traz exatamente o campo que o seu tipo designa. */
export const CONTRACT_APOSTILLE_ASSIGNMENT_INVALID = "CONTRACT_APOSTILLE_ASSIGNMENT_INVALID";

/** Mudança de designação que o apostilamento aplica ao contrato (antes → depois, para a trilha de auditoria). */
export interface ApostilleAssignmentChange {
  readonly field: ContractAssignmentField;
  readonly before: string;
  readonly after: string;
}

/** Recusa (antes de qualquer efeito): apostilamento `gestor`/`fiscal` sem o novo nome, ou com campo que não é do seu tipo. */
export class ContractApostilleAssignmentInvalidError extends Error {
  readonly code = CONTRACT_APOSTILLE_ASSIGNMENT_INVALID;
  constructor(public readonly kind: string, public readonly reason: "value_required" | "field_mismatch") {
    super(reason === "value_required"
      ? `O apostilamento de ${kind} precisa informar o novo ${kind === "gestor" ? "gestor" : "fiscal"} do contrato; nada foi gravado (${CONTRACT_APOSTILLE_ASSIGNMENT_INVALID}).`
      : `Gestor/fiscal só podem ser informados no apostilamento do respectivo tipo (gestor ⇒ novo gestor; fiscal ⇒ novo fiscal); o tipo "${kind}" não designa o campo informado. Nada foi gravado (${CONTRACT_APOSTILLE_ASSIGNMENT_INVALID}).`);
    this.name = "ContractApostilleAssignmentInvalidError";
  }
}

/**
 * SEM-062 — o que um apostilamento muda em `manager`/`inspector` do contrato. Puro e determinístico:
 *  - `gestor` ⇒ `manager` recebe `newManager` (trim); `fiscal` ⇒ `inspector` recebe `newInspector` (trim);
 *  - o nome é OBRIGATÓRIO (vazio ⇒ `ContractApostilleAssignmentInvalidError`); nunca se "limpa" um cargo por omissão;
 *  - `newManager`/`newInspector` informados em outro tipo de apostilamento (ou o campo do OUTRO tipo) são recusados:
 *    o termo gerado diria que houve troca que o contrato não sofreu;
 *  - `reajuste`/`legal` sem esses campos ⇒ `null` (o apostilamento não designa ninguém).
 * `before` vem do contrato lido SOB O LOCK da transação do instrumento.
 */
export function planApostilleAssignment(
  current: Pick<ContractWorkspace, "manager" | "inspector">,
  kind: string,
  input: { readonly newManager?: string | null; readonly newInspector?: string | null },
): ApostilleAssignmentChange | null {
  const manager = (input.newManager ?? "").trim();
  const inspector = (input.newInspector ?? "").trim();
  if (kind === "gestor") {
    if (inspector) throw new ContractApostilleAssignmentInvalidError(kind, "field_mismatch");
    if (!manager) throw new ContractApostilleAssignmentInvalidError(kind, "value_required");
    return { field: "manager", before: current.manager, after: manager };
  }
  if (kind === "fiscal") {
    if (manager) throw new ContractApostilleAssignmentInvalidError(kind, "field_mismatch");
    if (!inspector) throw new ContractApostilleAssignmentInvalidError(kind, "value_required");
    return { field: "inspector", before: current.inspector, after: inspector };
  }
  if (manager || inspector) throw new ContractApostilleAssignmentInvalidError(kind, "field_mismatch");
  return null;
}

/** Atualiza campos editáveis do contrato (sempre supervisionado). */
export function updateContractFields(
  ws: ContractWorkspace,
  patch: Partial<Pick<ContractWorkspace, "contractor" | "object" | "value" | "term" | "manager" | "inspector" | "contractNumber">>,
  at?: string,
): ContractWorkspace {
  // SEM-023 — fora da minuta, nenhum campo muda por esta edição genérica: econômicos/de identidade só por
  // instrumento; gestor/fiscal só por ação própria de designação (recusa antes de qualquer efeito).
  assertContractFieldsEditable(ws, patch);
  return { ...ws, ...pickEditableContractFields(patch), updatedAt: at ?? new Date().toISOString() };
}

export function isContractTerminal(ws: ContractWorkspace): boolean {
  return STATUS_TRANSITIONS[ws.status].length === 0;
}

// ─── SEM-023 — fora da minuta a edição genérica não altera campos (instrumento / ação governada) ────

/** Único status em que o contrato ainda é rascunho (todos os fluxos de nascimento criam `minuta`). */
export const CONTRACT_DRAFT_STATUS = "minuta" as const satisfies ContractStatus;

/** Tokens estáveis (não traduzir; usados por testes e pelo cliente). */
export const CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT = "CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT";
export const CONTRACT_REVISION_CONFLICT = "CONTRACT_REVISION_CONFLICT";
export const CONTRACT_ASSIGNMENT_REQUIRES_GOVERNED_ACTION = "CONTRACT_ASSIGNMENT_REQUIRES_GOVERNED_ACTION";

/**
 * Campos econômicos/de identidade do contrato. Fora de `minuta` só mudam por INSTRUMENTO — o próprio
 * domínio já modela o caminho: aditivo de `valor`/`prazo`/`quantitativo`/`qualitativo` (`newValue`,
 * `newTerm`) e apostilamento de `reajuste` (`newValue`). `contractor` (contratado) e `contractNumber`
 * são a identidade do contrato; `object` só muda por aditivo qualitativo.
 */
export const CONTRACT_INSTRUMENT_GOVERNED_FIELDS = ["contractNumber", "contractor", "object", "value", "term"] as const;

/**
 * Designações do contrato (gestor e fiscal). Editáveis pela edição genérica SOMENTE na minuta (decisão do
 * responsável pelo produto, PR-12 rev. 2). Fora dela a recusa é fail-closed com token próprio
 * (`CONTRACT_ASSIGNMENT_REQUIRES_GOVERNED_ACTION`), e não o token de instrumento, porque:
 *  - gestor/fiscal não são termo econômico do contrato — apontar "Termo Aditivo" seria orientação errada;
 *  - R9 / SEM-062: a troca pós-formalização de gestor/fiscal é feita pelo APOSTILAMENTO `gestor`/`fiscal`
 *    (`createApostille`), que aplica o novo nome em `manager`/`inspector` atomicamente com o instrumento, a máquina
 *    de estados, o CAS e o evento de auditoria (antes → depois) — `planApostilleAssignment`. Nunca pelo editor
 *    genérico `updateContract`.
 *
 * Ato de designação com motivo/ato de referência próprios (além do apostilamento) segue como capacidade futura.
 */
export const CONTRACT_ASSIGNMENT_FIELDS = ["manager", "inspector"] as const;

export type ContractGovernedField = (typeof CONTRACT_INSTRUMENT_GOVERNED_FIELDS)[number];
export type ContractAssignmentField = (typeof CONTRACT_ASSIGNMENT_FIELDS)[number];
export type ContractEditableField = ContractGovernedField | ContractAssignmentField;
export type ContractFieldPatch = Partial<Pick<ContractWorkspace, ContractEditableField>>;

/**
 * Tudo o que a edição genérica aceita — e, por consequência das duas listas acima, fora da minuta NENHUM
 * campo muda por `updateContract` (só o reenvio idêntico do formulário, que não é alteração). A troca de
 * `status` pela máquina de estados (`transitionContractStatus`) é independente destas listas e não mudou.
 */
export const CONTRACT_EDITABLE_FIELDS: readonly ContractEditableField[] = [...CONTRACT_INSTRUMENT_GOVERNED_FIELDS, ...CONTRACT_ASSIGNMENT_FIELDS];

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

/** Recusa: tentativa de trocar gestor/fiscal pela edição genérica de contrato que não está em minuta. */
export class ContractAssignmentRequiresGovernedActionError extends Error {
  readonly code = CONTRACT_ASSIGNMENT_REQUIRES_GOVERNED_ACTION;
  constructor(public readonly status: ContractStatus, public readonly fields: readonly ContractAssignmentField[]) {
    super(
      `Contrato em status "${status}" não admite troca direta de gestor/fiscal (${fields.join(", ")}). ` +
      "Após a minuta, a designação ou substituição de gestor e fiscal é feita pelo Apostilamento de gestor/fiscal, " +
      `que registra o ato e atualiza o contrato — nada foi gravado (${CONTRACT_ASSIGNMENT_REQUIRES_GOVERNED_ACTION}).`,
    );
    this.name = "ContractAssignmentRequiresGovernedActionError";
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

function sameFieldValue(field: ContractEditableField, current: unknown, next: unknown): boolean {
  // `value` é DECIMAL(15,2): compara em centavos (o formulário reenvia o valor carregado).
  if (field === "value") return Math.round(Number(current) * 100) === Math.round(Number(next) * 100);
  return String(current ?? "") === String(next ?? "");
}

function changedFields<F extends ContractEditableField>(fields: readonly F[], ws: ContractWorkspace, patch: Record<string, unknown>): F[] {
  return fields.filter(f => patch[f] !== undefined && !sameFieldValue(f, ws[f], patch[f]));
}

/**
 * Campos econômicos/de identidade que o patch REALMENTE altera (valor reenviado igual ao persistido não é
 * alteração — o editor envia o formulário inteiro).
 */
export function governedFieldChanges(ws: ContractWorkspace, patch: Record<string, unknown>): ContractGovernedField[] {
  return changedFields(CONTRACT_INSTRUMENT_GOVERNED_FIELDS, ws, patch);
}

/** Gestor/fiscal que o patch REALMENTE altera (reenvio do nome persistido não é alteração). */
export function assignmentFieldChanges(ws: ContractWorkspace, patch: Record<string, unknown>): ContractAssignmentField[] {
  return changedFields(CONTRACT_ASSIGNMENT_FIELDS, ws, patch);
}

/**
 * Fora da minuta, recusa (fail-closed) qualquer alteração real feita pela edição genérica:
 *  - campo econômico/de identidade ⇒ `ContractEconomicFieldsRequireInstrumentError` (tem precedência: se o
 *    patch mexe nos dois grupos, a orientação de instrumento vem primeiro);
 *  - gestor/fiscal ⇒ `ContractAssignmentRequiresGovernedActionError`.
 * Reenvio do valor persistido não é alteração e passa.
 */
export function assertContractFieldsEditable(ws: ContractWorkspace, patch: Record<string, unknown>): void {
  if (ws.status === CONTRACT_DRAFT_STATUS) return;
  const changed = governedFieldChanges(ws, patch);
  if (changed.length > 0) throw new ContractEconomicFieldsRequireInstrumentError(ws.status, changed);
  const assignments = assignmentFieldChanges(ws, patch);
  if (assignments.length > 0) throw new ContractAssignmentRequiresGovernedActionError(ws.status, assignments);
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
