/**
 * FASE 5 — Contract Service (Contratos e Instrumentos Contratuais)
 *
 * Orquestra a ENGENHARIA DOCUMENTAL contratual: nascimento do contrato (Processo
 * Licitatório, Contratação Direta, Externo), geração inteligente de minutas
 * (contrato/aditivo/apostilamento/rescisão), aditivos, apostilamentos e ocorrências.
 *
 * REUTILIZA sem duplicar: Document Engine, Institutional Request Engine (→ Parecer
 * Jurídico), Timeline, Multi-Copilot Orchestrator. Kernel só via kernelAccessService.
 * Foco exclusivo em documentação — nunca ERP/financeiro. Degrada sem DB. Determinístico.
 */

import { TRPCError } from "@trpc/server";
import { assertKernelAccess } from "./kernelAccessService";
import { serviceLogger } from "./observabilityService";
import { generateOfficialDocument } from "./documentEngineService";
import { orchestrateMultiCopilot } from "./workspaceOrchestratorService";
import { requestInstitutionalReview, readLegalOpinionForConsumer, type LegalOpinionReadResult } from "./institutionalRequestService";
import { listProcessTimeline, recordProcessEvent } from "../db/procurement";
import { registerExpiration, rescheduleExpiration, releaseRecordExpiration, linkRecordToContract } from "./operationRecordService";
import { getCurrentExpirationDate, getOperationRecordById, listOperationRecordIdsLinkedTo } from "../db/departmentOperation";
import {
  buildPriorAmendmentRow, composeAddendumTerm, DECLARED_OUTSIDE_SYSTEM, LEGACY_RECORD_TYPES_FOR_CONTRACT, mergeLegacyRecordFields,
  validatePriorAmendments, extractProposedEndDate, type LegacyRecordTypeForContract, type PriorAmendmentInput,
} from "../domain/legacyContractContinuity";
import { getRequest as getInstitutionalRequest, listRequestsByReferenceDocument } from "../db/institutionalRequests";
import { validLocalDate } from "../domain/operationRecordSchedule";
import { timelineActor } from "../domain/timelineActor";
import { getProcess } from "../db/procurement";
import { getDirectProcurementWorkspace } from "../db/directProcurement";
import {
  createContractWorkspace, CONTRACT_DOMAIN_COPILOTS, planInstrumentStatusChange, planApostilleAssignment,
  ContractRevisionConflictError, isSameContractRevision, nextContractRevision,
  type ContractWorkspace, type ContractOriginType, type ContractInstrumentKind, type InstrumentStatusChangePlan,
  type ApostilleAssignmentChange,
} from "../domain/contractWorkspace";
import {
  createContractAddendum, advanceAddendum, createContractApostille, createContractOccurrence,
  createContractGeneratedDocument, instrumentIdForCommand,
  type ContractAddendum, type ContractApostille,
  type AddendumType, type AddendumRequestOrigin, type ApostilleKind, type ContractDocumentKind,
} from "../domain/contractInstruments";
import { createAssistedReconstruction, RECONSTRUCTION_DISCLAIMER, type ImportedContractSource } from "../domain/contractReconstruction";
import { getDb } from "../db/connection";
import { createHash } from "crypto";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "./idempotencyService";
import { runTransactionWithDeadlockRetry } from "./transactionDeadlockRetry";
import { computeLineageId } from "../domain/officialDocument";
import { getLatestByLineage } from "../db/officialDocuments";
import {
  buildAddendumTermContent, buildApostilleTermContent, INSTRUMENT_NOT_FOUND, INSTRUMENT_REFERENCE_REQUIRED,
  type AddendumData, type ApostilleData, type PriorAddendumLine,
} from "../domain/instrumentTerms";
import { legalPolicyMarker } from "../domain/legalReviewPolicy";
import { inheritanceDiverges } from "../domain/contractInheritance";
import { resolveSelectedDirectProposal } from "./contractInheritanceService";
import {
  getContractWorkspace, compareAndSetContractWorkspaceStatus, lockContractWorkspaceForInstrument, type ContractWsExecutor,
  nextAddendumSequenceUnderLock, nextApostilleSequenceUnderLock,
  insertContractWsDocument, insertContractAddendum, listContractAddenda, listContractApostilles,
  insertContractApostille, insertContractOccurrence, insertImportedContract, getContractAddendumById, getContractApostilleById,
  findManualContractByNumber, insertNewContractWorkspace, findContractByNormalizedNumber, compareAndSetAddendumFormalized, findAddendumUsingLegalOpinion,
} from "../db/contractWorkspace";
import {
  CONTRACT_ALREADY_EXISTS, CONTRACT_NUMBER_REQUIRED_MESSAGE,
  contractAlreadyExistsMessage, contractNumberTakenText, decideContractCreateOnExisting, normalizeContractNumber,
} from "../domain/contractCreation";

const DOMAIN = "contratos" as const;
const log = serviceLogger("contractService");

/**
 * Colisão de número na criação do contrato AVULSO — nunca sobrescreve silenciosamente. O número é único na organização
 * qualquer que seja a origem (R3/PR-06): `existingOrigin` diz de onde veio o contrato que já tem o número (default
 * "avulso", o caso pré-existente). O router anexa "(id: …)" (convenção pré-existente).
 */
export class ManualContractConflictError extends Error {
  constructor(public readonly existingId: string, contractNumber: string, existingOrigin: ContractOriginType = "avulso") {
    super(contractNumberTakenText({ originType: existingOrigin, contractNumber }));
    this.name = "ManualContractConflictError";
  }
}

/**
 * R3 / PR-06 (SEM-007) — CONFLICT governado da criação sobre número de contrato já existente NA ORGANIZAÇÃO (qualquer
 * origem), para os fluxos Processo, Contratação Direta e Externo. É um TRPCError (code CONFLICT) para chegar ao cliente com a mensagem estável
 * (token `CONTRACT_ALREADY_EXISTS` + "(id: …)") sem exigir mapeamento no router.
 */
export class ContractAlreadyExistsError extends TRPCError {
  readonly existingId: string;
  constructor(existing: ContractWorkspace) {
    super({ code: "CONFLICT", message: contractAlreadyExistsMessage(existing) });
    this.existingId = existing.id;
    this.name = "ContractAlreadyExistsError";
  }
}

/**
 * Número oficial normalizado (`normalizeContractNumber`: só trim das pontas). Vazio ⇒ BAD_REQUEST antes de qualquer
 * escrita (um contrato não nasce sem número; o import tem o fallback "IMPORTADO" antes desta checagem).
 */
function requireContractNumber(raw: string | null | undefined): string {
  const n = normalizeContractNumber(raw);
  if (!n) throw new TRPCError({ code: "BAD_REQUEST", message: CONTRACT_NUMBER_REQUIRED_MESSAGE });
  return n;
}

/**
 * Persiste a CRIAÇÃO de um contrato — INSERT-only, nunca upsert (padrão R3). A chave é a que JÁ existia: a PRIMARY KEY
 * `id` = hash(organização, origem, número normalizado). Mesma chave ⇒ retry idempotente da MESMA criação converge
 * (devolve o existente, `created: false`, sem escrita); qualquer outra coisa (payload diferente, contrato já fora de
 * "minuta") ⇒ `onConflict`. O ESCOPO da unicidade do número entre ORIGENS é decisão humana pendente
 * (CONTRACT_NUMBER_SCOPE, HD-15): enquanto não decidida, o mesmo número em OUTRA origem não é bloqueado (comportamento
 * anterior preservado) — só registrado (`create_contract_number_used_by_other_origin`).
 *  1. leitura pela PK — recusa/converge sem escrever nada;
 *  2. INSERT puro na PK: em corrida exatamente um INSERT vence; o perdedor relê pela PK e passa pela mesma decisão.
 * Não há transação a estender: a criação é um único INSERT atômico; os eventos só são gravados pelo vencedor.
 * Sem DB ⇒ degrada (`created: true`, como antes).
 */
async function persistNewContract(
  ws: ContractWorkspace, onConflict: (existing: ContractWorkspace) => Error, correlationId: string,
): Promise<{ workspace: ContractWorkspace; created: boolean }> {
  const decide = (existing: ContractWorkspace): { workspace: ContractWorkspace; created: boolean } => {
    const meta = { organizationId: ws.organizationId, contractId: existing.id, originType: ws.originType, existingOriginType: existing.originType, actorUserId: ws.createdBy, correlationId };
    if (decideContractCreateOnExisting(existing, ws).kind === "converge") {
      log.info("create_contract_replayed", meta);
      return { workspace: existing, created: false };
    }
    log.warn("create_contract_conflict", { ...meta, reason: CONTRACT_ALREADY_EXISTS });
    throw onConflict(existing);
  };

  const before = await getContractWorkspace(ws.id, ws.organizationId);
  if (before) return decide(before);

  const inserted = await insertNewContractWorkspace(ws);
  if (inserted !== "duplicate") {
    // HD-15 pendente: o mesmo número em OUTRA origem não bloqueia — só observabilidade (sem número/contratado no log).
    const other = inserted === "inserted" ? await findContractByNormalizedNumber(ws.organizationId, ws.contractNumber, ws.id) : null;
    if (other) {
      log.warn("create_contract_number_used_by_other_origin", {
        organizationId: ws.organizationId, contractId: ws.id, originType: ws.originType, otherOriginType: other.originType,
        policy: "CONTRACT_NUMBER_SCOPE_PENDING", correlationId,
      });
    }
    return { workspace: ws, created: true };
  }
  // Perdeu a corrida na PRIMARY KEY: relê pelo id e passa pela mesma decisão.
  const existing = await getContractWorkspace(ws.id, ws.organizationId);
  if (!existing) throw new TRPCError({ code: "CONFLICT", message: `Criação concorrente do contrato; tente novamente (${CONTRACT_ALREADY_EXISTS}).` });
  return decide(existing);
}

export interface Recommendation {
  readonly reasoning: string;
  readonly explainability: string;
  readonly provenance: string;
  readonly confidence: number;
  readonly rejectable: true;
}

async function requireContract(id: string, orgId: number): Promise<ContractWorkspace> {
  const ws = await getContractWorkspace(id, orgId);
  if (!ws) throw new Error("Contrato não encontrado.");
  return ws;
}

// ─── Nascimento do contrato ───────────────────────────────────────────────────

/** FLUXO 1 — a partir do Processo Licitatório (homologado/adjudicado). */
export async function createFromProcurement(params: {
  organizationId: number; processId: string; contractNumber: string; contractor?: string; value?: number; term?: string; correlationId: string;
  /** Ator autenticado (R3/PR-06: retry idempotente só converge para o MESMO ator). */
  createdBy?: number | null;
}): Promise<ContractWorkspace> {
  const process = await getProcess(params.processId, params.organizationId);
  const candidate = createContractWorkspace({
    organizationId: params.organizationId, originType: "processo_licitatorio", originProcess: params.processId,
    contractNumber: requireContractNumber(params.contractNumber), contractor: params.contractor, object: process?.object ?? "",
    value: params.value, term: params.term, correlationId: params.correlationId, createdBy: params.createdBy,
  });
  const { workspace: ws, created } = await persistNewContract(candidate, (e) => new ContractAlreadyExistsError(e), params.correlationId);
  if (!created) return ws;
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "workspace_created", actor: "sistema", summary: `Contrato ${ws.contractNumber} gerado a partir do Processo Licitatório ${params.processId}.`, refId: ws.id, correlationId: params.correlationId });
  return ws;
}

/**
 * FLUXO 2 — a partir da Contratação Direta (ratificada).
 *
 * R9 / SEM-062 — `sourceProposalId` (opcional): a proposta registrada que o HUMANO selecionou/confirmou no assistente
 * (ver `contractInheritanceService`). Só vale com decisão de ratificação VIGENTE no ledger; contratado/valor omitidos
 * assumem os do REGISTRO da proposta (confirmação explícita pela seleção) e valores informados prevalecem (correção
 * humana). A procedência (id da proposta e da decisão, e se houve divergência) fica na timeline do contrato.
 * Refusa ANTES de qualquer escrita. Sem `sourceProposalId` o comportamento é o anterior (contratado/valor só se
 * informados; nada é inferido).
 */
export async function createFromDirectProcurement(params: {
  organizationId: number; directWorkspaceId: string; contractNumber: string; contractor?: string; value?: number; term?: string; correlationId: string;
  /** Ator autenticado (R3/PR-06: retry idempotente só converge para o MESMO ator). */
  createdBy?: number | null;
  /** SEM-062 — id da proposta registrada selecionada pelo humano (proveniência do contratado/valor). */
  sourceProposalId?: string;
}): Promise<ContractWorkspace> {
  const selected = params.sourceProposalId
    ? await resolveSelectedDirectProposal({
      organizationId: params.organizationId, directWorkspaceId: params.directWorkspaceId, proposalId: params.sourceProposalId, correlationId: params.correlationId,
    })
    : null;
  const src = await getDirectProcurementWorkspace(params.directWorkspaceId, params.organizationId);
  const contractor = params.contractor?.trim() ? params.contractor : selected?.candidate.supplierName;
  const value = params.value ?? selected?.candidate.value;
  const candidate = createContractWorkspace({
    organizationId: params.organizationId, originType: "contratacao_direta", originProcess: params.directWorkspaceId,
    contractNumber: requireContractNumber(params.contractNumber), contractor, object: src?.object ?? "",
    value, term: params.term, correlationId: params.correlationId, createdBy: params.createdBy,
  });
  const { workspace: ws, created } = await persistNewContract(candidate, (e) => new ContractAlreadyExistsError(e), params.correlationId);
  if (!created) return ws;
  const provenance = selected
    ? ` Contratado e valor sugeridos pela proposta ${selected.candidate.proposalId} (decisão de ratificação ${selected.decisionId}, rev. ${selected.decisionRevision}) e confirmados por ${timelineActor(params.createdBy)}${inheritanceDiverges(selected.candidate, { contractor: ws.contractor, value: ws.value }) ? " com alteração dos valores sugeridos" : ""}.`
    : "";
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "workspace_created", actor: "sistema", summary: `Contrato ${ws.contractNumber} gerado a partir da Contratação Direta ${params.directWorkspaceId}.${provenance}`, refId: ws.id, correlationId: params.correlationId });
  return ws;
}

/**
 * FLUXO 4 — contrato AVULSO (novo do zero): não deriva de processo licitatório,
 * contratação direta nem de reconstrução de texto. Cobre situações em que é preciso
 * lavrar um contrato que não está vinculado a nenhum processo do sistema. Nasce como
 * MINUTA (revisável), com os dados informados diretamente pelo servidor.
 */
export async function createManualContract(params: {
  organizationId: number; contractNumber: string; contractor?: string; object?: string;
  value?: number; term?: string; manager?: string; inspector?: string; correlationId: string;
  /** Usuário autenticado responsável — nunca "sistema" quando há um ator real (revisão arquitetural). */
  createdBy: number;
}): Promise<ContractWorkspace> {
  // Unicidade institucional do avulso: nunca sobrescreve silenciosamente (ver revisão
  // arquitetural — a idempotência do COMANDO é tratada à parte, no router, via idempotencyKey).
  // R3 / PR-06: INSERT-only; retry idempotente da MESMA criação (mesmo ator + payload, ainda minuta) converge. O número
  // é único na organização qualquer que seja a origem (persistNewContract); a checagem avulso↔avulso pré-existente
  // (findManualContractByNumber, na colação da coluna) é mantida — nunca afrouxada.
  const contractNumber = requireContractNumber(params.contractNumber);
  const candidate = createContractWorkspace({
    organizationId: params.organizationId, originType: "avulso", originProcess: "",
    contractNumber, contractor: params.contractor, object: params.object,
    value: params.value, term: params.term, manager: params.manager, inspector: params.inspector,
    status: "minuta", correlationId: params.correlationId, createdBy: params.createdBy,
  });
  const byNumber = await findManualContractByNumber(params.organizationId, contractNumber);
  if (byNumber && byNumber.id !== candidate.id) throw new ManualContractConflictError(byNumber.id, contractNumber);
  const { workspace: ws, created } = await persistNewContract(
    candidate, (e) => new ManualContractConflictError(e.id, e.contractNumber, e.originType), params.correlationId,
  );
  if (!created) return ws;
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "workspace_created", actor: `user:${params.createdBy}`, summary: `Contrato avulso ${ws.contractNumber} criado do zero (sem processo de origem).`, refId: ws.id, correlationId: params.correlationId });
  return ws;
}

/** Rótulo de procedência do registro legado (informação declarada × importada × verificada). */
export const LEGACY_CONTRACT_DECLARED = "DECLARADO";

/**
 * Registro de contrato VIGENTE de processo anterior (legado) — entrada independente, sem recriar DFD/ETP/TR/Edital.
 *
 * O contrato foi formalizado FORA do sistema; o usuário autenticado DECLARA os dados mínimos para a operação atual
 * (acompanhar e emitir aditivo/apostilamento). Nasce `vigente` com origem `legado`, e a timeline registra a declaração
 * (quem, quando, correlationId) como informação DECLARADA, não verificada. Não é ativação de minuta: nenhum contrato
 * existente muda de estado por aqui. Informado o término da vigência, o vencimento e os alertas entram no Centro de
 * Operações pela regra existente (registerExpiration).
 */
export async function registerInForceLegacyContract(params: {
  organizationId: number; contractNumber: string; contractor: string; object?: string; term: string;
  value?: number; manager?: string; inspector?: string;
  /** Término da vigência (AAAA-MM-DD) — opcional; quando informado, gera vencimento + alertas. */
  endDate?: string;
  /** Referência declarada ao processo/ato de origem (ex.: "Pregão 12/2023") — texto livre, só para a timeline. */
  sourceReference?: string;
  /**
   * Registro operacional (processo/contratação legados ou contrato externo já monitorado) de que o contrato PARTE: objeto e
   * origem são reaproveitados (o que o usuário digitar prevalece), o registro é VINCULADO ao contrato e, se monitorava um
   * vencimento, ele passa para o contrato (sem alertas duplicados). Outro órgão ⇒ NOT_FOUND; já ligado a outro alvo ⇒ CONFLICT.
   */
  legacyRecordId?: string;
  /** Aditivos JÁ formalizados fora do sistema: histórico DECLARADO (continua a numeração; sem termo; sem efeito no contrato). */
  priorAmendments?: readonly PriorAmendmentInput[];
  correlationId: string; createdBy: number;
}): Promise<{
  workspace: ContractWorkspace; created: boolean; provenance: typeof LEGACY_CONTRACT_DECLARED;
  legacyRecord: { id: string; reusedFields: readonly string[]; adoptedExpiration: string | null } | null;
  priorAmendmentsRecorded: number;
}> {
  const contractNumber = requireContractNumber(params.contractNumber);
  const priorIssues = validatePriorAmendments(params.priorAmendments);
  if (priorIssues.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Aditivos anteriores inválidos: ${priorIssues.join("; ")}.` });

  // Registro operacional de origem — leitura e recusas ANTES de qualquer escrita.
  let record: NonNullable<Awaited<ReturnType<typeof getOperationRecordById>>> | null = null;
  if (params.legacyRecordId) {
    record = await getOperationRecordById(params.organizationId, params.legacyRecordId);
    if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Registro de processo anterior não encontrado nesta organização." });
    if (!(LEGACY_RECORD_TYPES_FOR_CONTRACT as readonly string[]).includes(record.recordType)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Este tipo de registro não origina um contrato (use processo/contratação legados ou contrato externo)." });
    }
  }
  const merged = record
    ? mergeLegacyRecordFields({ object: params.object, sourceReference: params.sourceReference }, { recordType: record.recordType as LegacyRecordTypeForContract, number: record.number, object: record.object, modality: record.modality })
    : { object: (params.object ?? "").trim(), sourceReference: (params.sourceReference ?? "").trim(), reused: [] as readonly string[] };
  if (!merged.object) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o objeto do contrato (ou parta de um registro que o contenha)." });

  const candidate = createContractWorkspace({
    organizationId: params.organizationId, originType: "legado", originProcess: "",
    contractNumber, contractor: params.contractor, object: merged.object,
    value: params.value, term: params.term, manager: params.manager, inspector: params.inspector,
    status: "vigente", correlationId: params.correlationId, createdBy: params.createdBy,
  });
  // Registro já ligado: só aceito quando é a RETOMADA deste mesmo contrato (id determinístico); outro alvo ⇒ recusa sem escrita.
  if (record?.referenceId && record.referenceId !== candidate.id) {
    throw new TRPCError({ code: "CONFLICT", message: "Este registro já está vinculado a outro contrato; nada foi gravado." });
  }
  const { workspace: ws, created } = await persistNewContract(candidate, (e) => new ContractAlreadyExistsError(e), params.correlationId);
  // Repetição CONVERGENTE (mesmo ator e mesmos dados) RETOMA os passos que uma tentativa anterior não concluiu — cada passo é
  // idempotente (nada é duplicado): evento de criação, aditivos anteriores, vínculo do registro e vencimento. Antes de qualquer
  // escrita, a retomada recusa o que DIVERGE do já gravado (outro registro de origem, outro término, outro histórico).
  const resumed = !created;
  const at = new Date().toISOString();
  const prior = params.priorAmendments ?? [];
  const priorRows = prior.map((input, i) => buildPriorAmendmentRow({ organizationId: params.organizationId, contractId: ws.id, sequence: i + 1, input, correlationId: params.correlationId, createdAt: at }));
  let missingPrior = priorRows;
  let contractExpiration: string | null = null;
  if (resumed) {
    if (record && record.referenceId !== ws.id) {
      const linked = await listOperationRecordIdsLinkedTo(params.organizationId, "contract_workspace", ws.id);
      if (linked.length > 0) throw new TRPCError({ code: "CONFLICT", message: "Este contrato já foi registrado a partir de outro registro de origem; nada foi gravado." });
    }
    contractExpiration = await getCurrentExpirationDate(params.organizationId, "contrato", ws.id);
    if (contractExpiration && params.endDate && params.endDate !== contractExpiration) {
      throw new TRPCError({ code: "CONFLICT", message: "O contrato já tem outro término de vigência registrado; use o aditivo de prazo para alterá-lo. Nada foi gravado." });
    }
    const existing = await listContractAddenda(ws.id, params.organizationId);
    for (const row of priorRows) {
      const same = existing.find((a) => a.sequence === row.sequence);
      if (!same) continue;
      const identical = same.id === row.id && same.addendumType === row.addendumType && same.justification === row.justification
        && Math.round(same.newValue * 100) === Math.round(row.newValue * 100) && same.newTerm === row.newTerm && same.documentReference === row.documentReference;
      if (!identical) throw new TRPCError({ code: "CONFLICT", message: `O contrato já tem o termo nº ${row.sequence} registrado com outro conteúdo; nada foi gravado.` });
    }
    missingPrior = priorRows.filter((row) => !existing.some((a) => a.sequence === row.sequence));
  }

  const timeline = resumed ? await listProcessTimeline(ws.id, params.organizationId) : [];
  if (!timeline.some((e) => e.eventType === "workspace_created")) {
    const ref = merged.sourceReference ? ` Origem declarada: ${merged.sourceReference.slice(0, 200)}.` : "";
    await recordProcessEvent({
      organizationId: params.organizationId, processId: ws.id, eventType: "workspace_created", actor: `user:${params.createdBy}`,
      summary: `Contrato ${ws.contractNumber} registrado como VIGENTE (processo anterior, formalizado fora do sistema) — informação ${LEGACY_CONTRACT_DECLARED} pelo usuário, não verificada.${ref}`,
      refId: ws.id, correlationId: params.correlationId,
    });
  }
  log.info(resumed ? "legacy_contract_resumed" : "legacy_contract_registered", { organizationId: params.organizationId, contractId: ws.id, actorUserId: params.createdBy, provenance: LEGACY_CONTRACT_DECLARED, correlationId: params.correlationId });

  // Histórico de aditivos anteriores (DECLARADO): linhas finalizadas, origem documento externo, sem termo e sem efeito no contrato.
  // Ids determinísticos (órgão + contrato + sequência): na retomada só se gravam as linhas que faltam (conteúdo já conferido acima).
  for (const row of missingPrior) await insertContractAddendum(row);
  if (missingPrior.length > 0) {
    await recordProcessEvent({
      organizationId: params.organizationId, processId: ws.id, eventType: "change", actor: `user:${params.createdBy}`,
      summary: `${missingPrior.length} aditivo(s) anterior(es) registrado(s) como histórico — ${DECLARED_OUTSIDE_SYSTEM}. O próximo termo continua a numeração (nº ${prior.length + 1}).`,
      refId: ws.id, correlationId: params.correlationId,
    });
  }

  // Vigência: o término informado vence; sem ele, reaproveita o que o registro de origem já monitorava (sem duplicar alertas).
  // Ordem segura: o vencimento do CONTRATO é gravado ANTES de retirar o do registro (falha no meio nunca perde a data).
  let adoptedExpiration: string | null = null;
  let endDate = params.endDate;
  let recordExpiration: string | null = null;
  if (record) {
    const link = await linkRecordToContract({ organizationId: params.organizationId, recordId: record.id, contractId: ws.id, actor: `user:${params.createdBy}`, correlationId: params.correlationId });
    if (link.status === "conflict" || link.status === "not_found") {
      throw new TRPCError({ code: "CONFLICT", message: "O registro de origem mudou durante a operação; recarregue e tente novamente." });
    }
    if (record.recordType === "contrato_externo") {
      recordExpiration = await getCurrentExpirationDate(params.organizationId, "contrato", record.id);
      if (recordExpiration) { adoptedExpiration = recordExpiration; endDate = endDate ?? recordExpiration; }
    }
  }
  if (endDate && contractExpiration === null) {
    await registerExpiration({
      organizationId: params.organizationId, kind: "contrato", referenceId: ws.id, title: `Contrato ${ws.contractNumber}`,
      expirationDate: endDate, actor: `user:${params.createdBy}`, correlationId: params.correlationId,
    });
  }
  if (record && recordExpiration) {
    await releaseRecordExpiration({ organizationId: params.organizationId, recordId: record.id, actor: `user:${params.createdBy}`, correlationId: params.correlationId, toContractId: ws.id });
  }
  return {
    workspace: ws, created, provenance: LEGACY_CONTRACT_DECLARED,
    legacyRecord: record ? { id: record.id, reusedFields: merged.reused, adoptedExpiration } : null, priorAmendmentsRecorded: prior.length,
  };
}

/**
 * FLUXO 3 (obrigatório) — RECONSTRUÇÃO ASSISTIDA de contrato externo (PDF/DOCX →
 * texto). Identifica fornecedor/objeto/prazo/valor/cláusulas e APRESENTA ao servidor
 * para revisão. A reconstrução é assistida (nunca perfeita) e depende da validação
 * do servidor — por isso o workspace nasce como MINUTA, não como contrato vigente.
 */
export async function importExternalContract(params: {
  organizationId: number; source: ImportedContractSource; rawText: string; contractNumber?: string; correlationId: string;
  /** Ator autenticado (R3/PR-06: retry idempotente só converge para o MESMO ator). */
  createdBy?: number | null;
}): Promise<{ workspace: ContractWorkspace; confidence: number; reconstructed: ReturnType<typeof createAssistedReconstruction>["reconstructed"]; assisted: true; disclaimer: string }> {
  const reconstruction = createAssistedReconstruction({ organizationId: params.organizationId, source: params.source, rawText: params.rawText, correlationId: params.correlationId });
  const candidate = createContractWorkspace({
    organizationId: params.organizationId, originType: "externo", originProcess: "",
    contractNumber: requireContractNumber(
      normalizeContractNumber(params.contractNumber) || normalizeContractNumber(reconstruction.reconstructed.contractNumber) || "IMPORTADO",
    ),
    contractor: reconstruction.reconstructed.contractor, object: reconstruction.reconstructed.object, value: reconstruction.reconstructed.value,
    term: reconstruction.reconstructed.term, status: "minuta", correlationId: params.correlationId, createdBy: params.createdBy,
  });
  // R3 / PR-06: um import sobre número já existente na organização (de qualquer origem, inclusive o fallback
  // "IMPORTADO") nunca sobrescreve o existente.
  const { workspace: ws, created } = await persistNewContract(candidate, (e) => new ContractAlreadyExistsError(e), params.correlationId);
  if (!created) {
    return { workspace: ws, confidence: reconstruction.confidence, reconstructed: reconstruction.reconstructed, assisted: true, disclaimer: RECONSTRUCTION_DISCLAIMER };
  }
  await insertImportedContract(reconstruction, ws.id);
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "change", actor: "sistema", summary: `Reconstrução assistida de contrato externo (${params.source}), confiança ${Math.round(reconstruction.confidence * 100)}% — pendente de revisão do servidor.`, refId: reconstruction.id, correlationId: params.correlationId });
  return { workspace: ws, confidence: reconstruction.confidence, reconstructed: reconstruction.reconstructed, assisted: true, disclaimer: RECONSTRUCTION_DISCLAIMER };
}

// ─── Geração inteligente de minutas (Document Engine + copilotos) ─────────────

/**
 * R7 / PR-17 (SEM-024) — carrega o instrumento (aditivo/apostilamento) referenciado, tenant- e contrato-scoped.
 * Sem referência ⇒ PRECONDITION_FAILED; inexistente/de outro contrato ⇒ NOT_FOUND. Nada é gerado sem o instrumento.
 */
async function loadInstrumentForTerm(kind: "aditivo" | "apostilamento", contractId: string, orgId: number, refId: string | undefined):
  Promise<{ kind: "aditivo"; data: AddendumData } | { kind: "apostilamento"; data: ApostilleData }> {
  if (!refId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Informe o ${kind === "aditivo" ? "aditivo" : "apostilamento"} registrado para gerar o termo; nada foi gerado (${INSTRUMENT_REFERENCE_REQUIRED}).` });
  }
  if (kind === "aditivo") {
    const a = (await listContractAddenda(contractId, orgId)).find((x) => x.id === refId);
    if (!a) throw new TRPCError({ code: "NOT_FOUND", message: `Aditivo não encontrado neste contrato (${INSTRUMENT_NOT_FOUND}).` });
    // PROMPT 09 — o termo FORMALIZADO é o registro do que foi assinado: não se gera nova versão depois da formalização
    // (evita divergência entre o termo assinado e o "termo vigente" exibido/exportado).
    if (a.status === "finalizado") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_TERM_FROZEN}: o aditivo ${a.sequence} já foi formalizado; o termo não é regerado.` });
    }
    return { kind, data: a };
  }
  const ap = (await listContractApostilles(contractId, orgId)).find((x) => x.id === refId);
  if (!ap) throw new TRPCError({ code: "NOT_FOUND", message: `Apostilamento não encontrado neste contrato (${INSTRUMENT_NOT_FOUND}).` });
  return { kind, data: ap };
}

/** Gera a minuta (revisável) de um documento contratual usando os copilotos do domínio. */
export async function generateContractDocument(params: {
  organizationId: number; contractId: string; kind: ContractDocumentKind; refId?: string; correlationId: string;
  invoke?: (prompt: string) => Promise<string>;
  /** R7 / PR-17 — quem pediu a geração (autor do documento); ausente ⇒ "sistema" (nunca `multi_copilot`). */
  actorUserId?: number;
}): Promise<{ document: Awaited<ReturnType<typeof insertContractWsDocument>>; officialDocumentId: string; recommendation: Recommendation }> {
  const ws = await requireContract(params.contractId, params.organizationId);
  // R7 / PR-17 (SEM-024) — aditivo/apostilamento só a partir do INSTRUMENTO registrado (fail-closed antes da IA).
  const instrument = params.kind === "aditivo" || params.kind === "apostilamento"
    ? await loadInstrumentForTerm(params.kind, ws.id, params.organizationId, params.refId)
    : null;
  assertKernelAccess(DOMAIN, "document_engine");
  assertKernelAccess(DOMAIN, "institutional_rag");
  assertKernelAccess(DOMAIN, "copilot_infrastructure");

  const orchestration = await orchestrateMultiCopilot({
    organizationId: params.organizationId,
    request: `Elaborar minuta de ${params.kind} para o contrato ${ws.contractNumber} (objeto: "${ws.object}"), com cláusulas obrigatórias e facultativas conforme a Lei 14.133/2021.`,
    copilotTypes: CONTRACT_DOMAIN_COPILOTS,
    correlationId: params.correlationId,
    invoke: params.invoke,
  });

  const contractHeader = { contractNumber: ws.contractNumber, contractor: ws.contractor ?? "", object: ws.object ?? "", term: ws.term ?? "" };
  // Alterações ANTERIORES do mesmo contrato (histórico declarado ou do sistema) entram no termo — nada é inventado.
  const priorAddenda: PriorAddendumLine[] = instrument?.kind === "aditivo"
    ? (await listContractAddenda(ws.id, params.organizationId)).filter((x) => x.sequence < instrument.data.sequence)
      .map((x) => ({ sequence: x.sequence, addendumType: x.addendumType, newTerm: x.newTerm, newValue: x.newValue, requestOrigin: x.requestOrigin }))
    : [];
  const content = instrument?.kind === "aditivo"
    ? buildAddendumTermContent(contractHeader, instrument.data, orchestration.consolidated.suggestions, orchestration.consolidated.legalBasis, priorAddenda)
    : instrument?.kind === "apostilamento"
      ? buildApostilleTermContent(contractHeader, instrument.data, orchestration.consolidated.suggestions)
      : [
        `# ${titleForKind(params.kind)} — ${ws.contractNumber}`,
        `Contratado: ${ws.contractor || "—"} · Objeto: ${ws.object || "—"} · Vigência: ${ws.term || "—"}`,
        "",
        "## Cláusulas",
        ...orchestration.consolidated.suggestions.map((s, i) => `CLÁUSULA ${i + 1}. ${s}`),
        "",
        "## Fundamentação",
        ...orchestration.consolidated.legalBasis.map(l => `- ${l}`),
        "",
        "> Minuta gerada com apoio dos copilotos. Revisão obrigatória — nunca automática.",
      ].join("\n");
  const author = params.actorUserId ? String(params.actorUserId) : "sistema";
  // R9 / SEM-040 — o termo de um instrumento carrega o número do PRÓPRIO instrumento no título (cada instrumento é uma
  // linhagem; sem o nº, "Termo Aditivo — CT-1" apareceria igual para todos os aditivos do contrato).
  const title = instrument
    ? `${titleForKind(params.kind)} nº ${instrument.data.sequence} — ${ws.contractNumber}`
    : `${titleForKind(params.kind)} — ${ws.contractNumber}`;

  // SPRINT 5.3.1 — metadados institucionais auditáveis da minuta.
  const doc = createContractGeneratedDocument({
    organizationId: params.organizationId, contractId: ws.id, kind: params.kind,
    title, content, refId: params.refId,
    metadata: {
      clauseOrigin: instrument ? "instrumento_registrado" : "template_institucional",
      ...(instrument ? { instrumentId: instrument.data.id, instrumentKind: instrument.kind } : {}),
      template: `contrato_${params.kind}`,
      templateVersion: "1.0",
      legalBasis: orchestration.consolidated.legalBasis,
      copilots: orchestration.selectedCopilots,
      appliedRecommendations: orchestration.consolidated.suggestions,
      confidence: orchestration.consolidated.confidence,
      reasoning: orchestration.consolidated.summary,
      explainability: orchestration.consolidated.suggestions.join(" · "),
      provenance: `document_engine+copilotos:${orchestration.selectedCopilots.join(",")}`,
    },
    correlationId: params.correlationId,
  });
  const document = await insertContractWsDocument(doc);
  // RC-3 — documento oficial gerado/versionado pelo pipeline ÚNICO (Document Engine).
  // PROMPT 09 (auditoria P2) — reconfere o congelamento IMEDIATAMENTE antes de gravar: a geração com IA leva segundos e uma
  // formalização pode ter commitado nesse intervalo (a formalização, por sua vez, relê a versão do termo sob o lock).
  if (instrument?.kind === "aditivo") await loadInstrumentForTerm("aditivo", ws.id, params.organizationId, instrument.data.id);
  const official = await generateOfficialDocument({
    organizationId: params.organizationId, businessDomain: "contratos",
    documentType: params.kind === "rescisao" ? "rescisao" : params.kind === "aditivo" ? "aditivo" : params.kind === "apostilamento" ? "apostilamento" : "contrato",
    origin: ws.id, title: doc.title, content, author, correlationId: params.correlationId,
    // R9 / SEM-040 — linhagem PRÓPRIA do instrumento (id do instrumento na identidade da linhagem). Documentos de
    // contrato/rescisão/anexo seguem a linhagem por origem+tipo; versões ANTERIORES de aditivo/apostilamento (linhagem
    // compartilhada por contrato, sem backfill) continuam legíveis — `lineageScope` as distingue nos leitores.
    instrumentId: instrument?.data.id,
    metadata: {
      copilots: orchestration.selectedCopilots, legalBasis: orchestration.consolidated.legalBasis, confidence: orchestration.consolidated.confidence,
      ...(instrument ? {
        instrumentId: instrument.data.id, instrumentKind: instrument.kind, sequence: instrument.data.sequence,
        lineageScope: "instrument", contractNumber: ws.contractNumber,
      } : {}),
      // R8 / PR-20 scaffolding (SEM-084): o sistema não valida limites legais do aditivo sem parecer registrado.
      ...(instrument?.kind === "aditivo" ? { addendumLimitPolicy: legalPolicyMarker("SEM-084_CANONICAL_ADDENDUM_LIMITS") } : {}),
    },
  });
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "recommendation", actor: timelineActor(params.actorUserId), summary: `Minuta de ${params.kind} gerada por IA (rascunho revisável).`, refId: doc.id, correlationId: params.correlationId });

  return {
    document,
    officialDocumentId: official.id,
    recommendation: {
      reasoning: orchestration.consolidated.summary,
      explainability: orchestration.consolidated.suggestions.join(" · "),
      provenance: `copilotos:${orchestration.selectedCopilots.join(",")}`,
      confidence: orchestration.consolidated.confidence,
      rejectable: true,
    },
  };
}

function titleForKind(kind: ContractDocumentKind): string {
  switch (kind) {
    case "contrato": return "Minuta de Contrato";
    case "aditivo": return "Termo Aditivo";
    case "apostilamento": return "Apostilamento";
    case "rescisao": return "Termo de Rescisão";
    case "anexo": return "Anexo";
  }
}

// ─── SEM-025 — instrumento + status do contrato, governados pela máquina de estados ──────────────

/**
 * O contrato mudou de status em paralelo entre a avaliação da máquina e a escrita (compare-and-set não
 * casou) e o novo status ainda ADMITIRIA o instrumento. Nada foi gravado; o cliente pode repetir.
 */
export class ContractStatusConflictError extends Error {
  constructor(public readonly contractId: string, public readonly reason: "status" | "sequence" = "status") {
    super(reason === "sequence"
      ? "Outro instrumento foi registrado para este contrato durante a operação; nada foi gravado. Recarregue e tente novamente."
      : "O status do contrato foi alterado durante a operação; nada foi gravado. Recarregue e tente novamente.");
    this.name = "ContractStatusConflictError";
  }
}

/** ER_DUP_ENTRY (1062) do MySQL/MariaDB, inclusive encapsulado pelo driver/drizzle (`cause`). */
function isDuplicateKeyError(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const x = e as { code?: string; errno?: number; cause?: unknown };
    if (x.code === "ER_DUP_ENTRY" || x.errno === 1062) return true;
    e = x.cause;
  }
  return false;
}

/** Sentinela interna: força o ROLLBACK da transação quando o compare-and-set de status não casa. */
class InstrumentStatusCasMiss extends Error {
  constructor() { super("instrument_status_cas_miss"); this.name = "InstrumentStatusCasMiss"; }
}

/** Instrumento já CONSTRUÍDO com a sequência alocada sob o lock (ver `persistInstrumentWithGovernedStatus`). */
interface InstrumentToPersist<T> {
  readonly result: T;
  readonly refId: string;
  /** Resumo do evento de timeline (a designação de gestor/fiscal, quando houver, é acrescentada com antes → depois). */
  readonly summary: string;
  readonly write: (tx: ContractWsExecutor) => Promise<unknown>;
}

const ASSIGNMENT_LABEL = { manager: "gestor", inspector: "fiscal" } as const;
const quoted = (v: string): string => (v.trim() ? `"${v.length > 80 ? `${v.slice(0, 77)}…` : v}"` : "(não designado)");

/**
 * Persiste o instrumento (aditivo/apostilamento), o status do contrato, a designação de gestor/fiscal (apostilamento
 * `gestor`/`fiscal`) e o evento de timeline numa ÚNICA transação — SEM nenhuma chamada remota (IA, S3, e-mail) sob o
 * lock; a minuta é gerada depois, a partir do instrumento persistido.
 *
 * R9 / SEM-084 — alocação ATÔMICA da sequência. A transação começa TRAVANDO a linha do contrato
 * (`SELECT … FOR UPDATE`, `lockContractWorkspaceForInstrument`); só então lê o status REAL, avalia a máquina de
 * estados, aloca `MAX(sequence)+1` e grava. Instrumentos concorrentes do mesmo contrato se serializam na linha: o
 * segundo espera o commit do primeiro e recebe o número seguinte — nenhum se perde e nenhum vira CONFLICT por
 * disputar o mesmo número. (Antes, `count+1` era calculado FORA da transação: duas criações liam a mesma contagem,
 * derivavam o mesmo id e uma delas era recusada.) O id continua determinístico por (org, contrato, sequência) e o
 * INSERT continua puro (`failOnDuplicate`): qualquer colisão residual vira recusa, nunca fusão de duas solicitações.
 *
 * SEM-025 — a máquina de estados (`planInstrumentStatusChange`) é reavaliada contra o status lido SOB O LOCK
 * (recusa ⇒ ROLLBACK, `ContractStatusTransitionError`). O status só muda por compare-and-set a partir do status
 * avaliado (+ a revisão lida sob o lock): se não casar (impossível sob o lock; defesa), ROLLBACK e a máquina é
 * reavaliada contra o status REAL (`ContractStatusConflictError` se ainda admite). Nunca grava instrumento pela metade.
 *
 * SEM-062 — quando o apostilamento designa gestor/fiscal, o novo nome é gravado em `manager`/`inspector` NA MESMA
 * sentença do CAS e o evento de timeline registra "campo: antes → depois" (o `before` é o lido sob o lock).
 *
 * `expectedUpdatedAt` (opcional): revisão do contrato que o cliente viu; divergente ⇒ `ContractRevisionConflictError`
 * (ROLLBACK, nada gravado). A revisão nova é sempre ESTRITAMENTE posterior à lida sob o lock.
 */
async function persistInstrumentWithGovernedStatus<T>(params: {
  ws: ContractWorkspace;
  instrument: ContractInstrumentKind;
  requiresLegalOpinion?: boolean;
  /** PROMPT 08 / D-2 — registro PREPARATÓRIO: o status do contrato não muda (efeitos só na formalização). */
  deferUntilFormalization?: boolean;
  allocateSequence: (tx: ContractWsExecutor) => Promise<number>;
  build: (c: { sequence: number; plan: InstrumentStatusChangePlan; locked: ContractWorkspace; at: string }) => InstrumentToPersist<T>;
  /** Mudança de designação (gestor/fiscal) avaliada contra o contrato LIDO SOB O LOCK. */
  assignment?: (locked: ContractWorkspace) => ApostilleAssignmentChange | null;
  expectedUpdatedAt?: string;
  actorUserId?: number;
  correlationId: string;
}): Promise<{ result: T; plan: InstrumentStatusChangePlan; sequence: number; assignment: ApostilleAssignmentChange | null }> {
  const { ws } = params;
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível — instrumento contratual não persistido (fail-closed).");
  const opts = { requiresLegalOpinion: params.requiresLegalOpinion, deferUntilFormalization: params.deferUntilFormalization };
  try {
    // SEM084-A — esta é a fronteira DONA da transação: deadlock (1213) ⇒ a transação INTEIRA é repetida (trava,
    // máquina de estados, sequência e revisão recalculadas sob o novo lock); qualquer outro erro segue o tratamento abaixo.
    return await runTransactionWithDeadlockRetry({ label: `contract.${params.instrument}.persist`, organizationId: ws.organizationId, correlationId: params.correlationId }, () => db.transaction(async (tx) => {
      // 1. TRAVA da linha do contrato — primeira instrução da transação (a leitura corrente enxerga o commit anterior).
      const locked = await lockContractWorkspaceForInstrument(ws.id, ws.organizationId, tx);
      if (!locked) throw new Error("Contrato não encontrado.");
      if (params.expectedUpdatedAt && !isSameContractRevision(locked.updatedAt, params.expectedUpdatedAt)) throw new ContractRevisionConflictError();
      // 2. máquina de estados contra o status REAL (sob o lock) — recusa ⇒ rollback sem escrita.
      const plan = planInstrumentStatusChange(locked.status, params.instrument, opts);
      const assignment = params.assignment ? params.assignment(locked) : null;
      // 3. sequência atômica + construção + escrita do instrumento.
      const sequence = await params.allocateSequence(tx);
      const at = nextContractRevision(locked.updatedAt);
      const built = params.build({ sequence, plan, locked, at });
      await built.write(tx);
      // 4. status (+ designação) por compare-and-set a partir do estado lido sob o lock.
      const ok = await compareAndSetContractWorkspaceStatus({
        id: ws.id, orgId: ws.organizationId, fromStatus: plan.from, toStatus: plan.to, updatedAt: at,
        expectedUpdatedAt: locked.updatedAt,
        ...(assignment ? { assignment: { [assignment.field]: assignment.after } } : {}),
      }, tx);
      if (!ok) throw new InstrumentStatusCasMiss();
      // 5. evento de auditoria (um id por evento; ator = o humano que registrou).
      await recordProcessEvent({
        organizationId: ws.organizationId, processId: ws.id, eventType: "change", actor: timelineActor(params.actorUserId),
        summary: assignment
          ? `${built.summary} Designação aplicada ao contrato — ${ASSIGNMENT_LABEL[assignment.field]}: ${quoted(assignment.before)} → ${quoted(assignment.after)}.`
          : built.summary,
        refId: built.refId, correlationId: params.correlationId,
      }, tx);
      return { result: built.result, plan, sequence, assignment };
    })).then((out) => {
      log.info("contract_instrument_sequence_allocated", {
        contractId: ws.id, organizationId: ws.organizationId, instrument: params.instrument, sequence: out.sequence, correlationId: params.correlationId,
      });
      if (out.assignment) {
        log.info("contract_assignment_applied_by_apostille", {
          contractId: ws.id, organizationId: ws.organizationId, field: out.assignment.field, apostilleId: (out.result as { id?: string }).id,
          actorUserId: params.actorUserId ?? null, correlationId: params.correlationId,
        });
      }
      if (out.plan.mode === "deferred_pending_legal_opinion") {
        // Fail-closed observável: instrumento registrado aguardando parecer; status do contrato NÃO efetivado.
        log.info("contract_instrument_status_deferred_pending_legal_opinion", {
          contractId: ws.id, organizationId: ws.organizationId, instrument: params.instrument, status: out.plan.from,
          instrumentStatus: out.plan.instrumentStatus, refId: (out.result as { id?: string }).id, correlationId: params.correlationId,
        });
      }
      return out;
    });
  } catch (e) {
    const duplicate = isDuplicateKeyError(e);
    if (!(e instanceof InstrumentStatusCasMiss) && !duplicate) throw e;
    const fresh = await requireContract(ws.id, ws.organizationId);
    planInstrumentStatusChange(fresh.status, params.instrument); // lança ContractStatusTransitionError se recusado
    throw new ContractStatusConflictError(ws.id, duplicate ? "sequence" : "status");
  }
}

// ─── Aditivos ─────────────────────────────────────────────────────────────────

/**
 * Cria um aditivo e gera sua minuta. Registra a ORIGEM DA SOLICITAÇÃO (Contract
 * Workspace, Institutional Request, Documento Externo ou Solicitação Manual). O
 * Adaptive Recommendation Engine apenas RECOMENDA parecer (valor/quantitativo);
 * o servidor sempre decide — nunca há bloqueio.
 *
 * SEM-025 — o status do contrato passa pela máquina de estados ANTES de qualquer efeito: contrato
 * minuta/encerrado/rescindido/arquivado ⇒ `ContractStatusTransitionError` sem gravar aditivo, minuta, status
 * ou evento. Aditivo + status + evento são atômicos; a minuta é gerada depois, a partir do aditivo já
 * persistido (regerável por `generateDocuments` se a geração falhar). Aditivos sucessivos são admitidos em
 * vigente/aditado/apostilado. Quando o próprio fluxo exige parecer (`requiresLegalOpinion`), o aditivo é
 * registrado `aguardando_parecer` e o status do contrato NÃO é efetivado (fail-closed) — não há, ainda,
 * comando de finalização pós-parecer (dívida registrada em docs/design/CONTRACT_ACTIVATION_TRANSITION.md).
 */
async function createAddendumInstrument(params: {
  organizationId: number; contractId: string; addendumType: AddendumType; justification: string;
  newValue?: number; newTerm?: string; requestOrigin?: AddendumRequestOrigin; correlationId: string; actorUserId?: number;
  /** SEM084-B — id derivado da chave do comando. */
  id: string;
  /** Contrato lido na pré-checagem do comando (a avaliação que vale é a refeita SOB O LOCK). */
  ws: ContractWorkspace;
}): Promise<ContractAddendum> {
  const ws = params.ws;
  // Adaptive Process Engine (regra PRÉ-EXISTENTE, não definida juridicamente aqui — PR-18/PR-20 são donas do
  // insumo jurídico): valor/quantitativo exigem parecer; prazo/qualitativo não.
  const requiresLegalOpinion = params.addendumType === "valor" || params.addendumType === "quantitativo";
  // Máquina de estados PRIMEIRO — recusa antes de qualquer leitura adicional, escrita, IA ou evento. Parecer
  // exigido e ausente ⇒ o status do contrato não é efetivado (fail-closed; `deferred_pending_legal_opinion`).
  // (Pré-checagem barata sobre o contrato lido; a avaliação que vale é a refeita SOB O LOCK da transação.)
  planInstrumentStatusChange(ws.status, "aditivo", { requiresLegalOpinion });
  // R9 / SEM-084 — a sequência NÃO é calculada aqui: é alocada dentro da transação, sob o lock do contrato.
  // Os limites legais de valor/prazo do art. 125 seguem NÃO verificados (J-4, BLOCKED_LEGAL_REVIEW): nada é imposto.
  // PROMPT 08 / D-2 — a CRIAÇÃO é preparatória: registra a minuta (ou aguarda parecer) SEM efeito contratual — status do
  // contrato, vigência, valores e alertas permanecem os vigentes até a formalização legítima (`formalizeAddendum`).
  const { result: updated } = await persistInstrumentWithGovernedStatus({
    ws, instrument: "aditivo", requiresLegalOpinion, deferUntilFormalization: true, actorUserId: params.actorUserId, correlationId: params.correlationId,
    allocateSequence: (tx) => nextAddendumSequenceUnderLock(ws.id, params.organizationId, tx),
    build: ({ sequence, plan, at }) => {
      let addendum = createContractAddendum({
        organizationId: params.organizationId, contractId: ws.id, addendumType: params.addendumType, sequence, id: params.id,
        justification: params.justification, newValue: params.newValue, newTerm: params.newTerm,
        requestOrigin: params.requestOrigin, correlationId: params.correlationId, createdAt: at,
      });
      addendum = advanceAddendum(addendum, "minuta", at);
      const final = requiresLegalOpinion ? advanceAddendum(addendum, "aguardando_parecer", at) : addendum;
      return {
        result: final, refId: final.id,
        summary: `Aditivo ${sequence} (${params.addendumType}) — minuta registrada${requiresLegalOpinion ? "; requer parecer jurídico" : ""}. Sem efeito no contrato (status ${plan.to}, vigência e valores mantidos) até a formalização.`,
        write: (tx) => insertContractAddendum(final, tx, { failOnDuplicate: true }),
      };
    },
  });
  return updated;
}

/** Adaptive Process Engine (regra PRÉ-EXISTENTE): valor/quantitativo exigem parecer; prazo/qualitativo não. */
function addendumRequiresLegalOpinion(type: string): boolean {
  return type === "valor" || type === "quantitativo";
}

// ─── SEM084-B — replay do COMANDO de criação de instrumento ───────────────────
//
// O instrumento (aditivo/apostilamento) é gravado numa transação e o termo é gerado DEPOIS. Se a geração do termo
// falhar (inclusive depois dos retries de deadlock do SEM084-A), o instrumento já existe: repetir o comando NÃO pode
// criar um segundo. Mecanismo (sem migration, infraestrutura existente):
//   - o comando exige uma chave de idempotência (uma por tentativa lógica do usuário);
//   - o idempotencyService cobre replay de comando CONCLUÍDO (mesma chave+payload ⇒ mesmo resultado; payload
//     diferente ⇒ CONFLICT) e comando EM VOO (CONFLICT);
//   - a IDENTIDADE do instrumento é derivada de (órgão, contrato, ator, chave) — a PRIMARY KEY garante um único
//     instrumento por tentativa lógica, inclusive depois que a chave foi marcada `failed`;
//   - uma nova tentativa com a mesma chave reconhece o instrumento já gravado (compara o payload com o REGISTRADO —
//     divergência ⇒ CONFLICT) e só completa o que faltou: o termo é gerado apenas se a linhagem documental PRÓPRIA do
//     instrumento ainda não tiver versão. Nada do instrumento já gravado é alterado.
// Nunca deduplica por texto, número ou heurística.

export const INSTRUMENT_COMMAND_IN_PROGRESS = "INSTRUMENT_COMMAND_IN_PROGRESS";
export const INSTRUMENT_COMMAND_PAYLOAD_MISMATCH = "INSTRUMENT_COMMAND_PAYLOAD_MISMATCH";
export const INSTRUMENT_COMMAND_ACTOR_REQUIRED = "INSTRUMENT_COMMAND_ACTOR_REQUIRED";

function commandPayloadHash(op: string, organizationId: number, contractId: string, payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify({ op, o: organizationId, c: contractId, p: payload })).digest("hex");
}

/** Gera o termo do instrumento SOMENTE se a sua linhagem documental ainda não tiver versão (retomada idempotente). */
async function ensureInstrumentDocument(p: {
  organizationId: number; contractId: string; kind: "aditivo" | "apostilamento"; instrumentId: string; actorUserId?: number; correlationId: string;
}): Promise<{ generated: boolean }> {
  const lineageId = computeLineageId({ tenantId: p.organizationId, businessDomain: "contratos", documentType: p.kind, origin: p.contractId, instrumentId: p.instrumentId });
  if (await getLatestByLineage(lineageId, p.organizationId)) return { generated: false };
  await generateContractDocument({ organizationId: p.organizationId, contractId: p.contractId, kind: p.kind, refId: p.instrumentId, actorUserId: p.actorUserId, correlationId: p.correlationId });
  return { generated: true };
}

async function runInstrumentCommand<I extends { id: string }, R, P>(c: {
  op: string; kind: "aditivo" | "apostilamento"; organizationId: number; contractId: string; actorUserId: number;
  idempotencyKey: string; correlationId: string; payload: Record<string, unknown>;
  findExisting: (id: string) => Promise<I | null>;
  samePayload: (existing: I) => boolean;
  /** Recusas da 1ª gravação (contrato, máquina de estados, designação) — rodam ANTES de qualquer efeito (inclusive a reserva
   *  da chave); devolvem o contrato LIDO, reutilizado pela criação (uma única leitura prévia, como antes do SEM084-B). */
  precheck: () => Promise<P>;
  create: (id: string, pre: P) => Promise<I>;
  /** Efeito derivado IDEMPOTENTE do instrumento (ex.: reagendar a vigência); roda na 1ª gravação E na retomada. */
  settle?: (instrument: I) => Promise<void>;
  result: (instrument: I, flags: { resumed: boolean; documentGenerated: boolean }) => R;
}): Promise<R> {
  // A chave é escopada por (órgão, usuário): sem ator humano identificado não há tentativa lógica rastreável — recusa
  // ANTES de qualquer efeito (o router sempre fornece o usuário autenticado).
  if (!Number.isInteger(c.actorUserId) || c.actorUserId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${INSTRUMENT_COMMAND_ACTOR_REQUIRED}: o registro de ${c.kind} exige o usuário que o solicita; nada foi gravado.` });
  }
  const key = c.idempotencyKey.trim();
  const payloadHash = commandPayloadHash(c.op, c.organizationId, c.contractId, c.payload);
  const id = instrumentIdForCommand(c.kind, { organizationId: c.organizationId, contractId: c.contractId, actorUserId: c.actorUserId, idempotencyKey: key });
  // Leitura (sem efeito): esta tentativa lógica já gravou o instrumento? Se não, as recusas da 1ª gravação valem
  // ANTES de reservar a chave (nada é escrito quando o comando é inválido).
  const preexisting = await c.findExisting(id);
  const pre = preexisting ? null : await c.precheck();
  const check = await checkIdempotency(key, c.actorUserId, c.organizationId, c.op, payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({ code: "CONFLICT", message: `${INSTRUMENT_COMMAND_PAYLOAD_MISMATCH}: esta chave já registrou outro ${c.kind}; nada foi gravado.` });
    }
    log.info("instrument_command_replayed", { op: c.op, organizationId: c.organizationId, contractId: c.contractId, correlationId: c.correlationId });
    return (typeof check.response === "string" ? JSON.parse(check.response) : check.response) as R;
  }
  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: `${INSTRUMENT_COMMAND_IN_PROGRESS}: este ${c.kind} já está sendo registrado por outra requisição com a mesma chave — aguarde.` });
  }
  try {
    // Releitura sob a chave reservada (outra requisição pode ter concluído entre a 1ª leitura e a reserva).
    const existing = preexisting ?? await c.findExisting(id);
    if (existing && !c.samePayload(existing)) {
      throw new TRPCError({ code: "CONFLICT", message: `${INSTRUMENT_COMMAND_PAYLOAD_MISMATCH}: esta chave já registrou outro ${c.kind} com dados diferentes; nada foi gravado.` });
    }
    const instrument = existing ?? await c.create(id, pre ?? await c.precheck());
    if (c.settle) await c.settle(instrument);
    const { generated } = await ensureInstrumentDocument({
      organizationId: c.organizationId, contractId: c.contractId, kind: c.kind, instrumentId: instrument.id, actorUserId: c.actorUserId, correlationId: c.correlationId,
    });
    if (existing) {
      log.info("instrument_command_resumed", { op: c.op, organizationId: c.organizationId, contractId: c.contractId, instrumentId: instrument.id, documentGenerated: generated, correlationId: c.correlationId });
    }
    const out = c.result(instrument, { resumed: !!existing, documentGenerated: generated });
    await saveIdempotencyResult(key, c.actorUserId, c.organizationId, out);
    return out;
  } catch (err) {
    await failIdempotencyKey(key, c.actorUserId, c.organizationId).catch(() => {});
    throw err;
  }
}

/**
 * Cria um aditivo e gera o termo. SEM084-B — comando replay-safe pela chave de idempotência (ver `runInstrumentCommand`).
 */
export async function createAddendum(params: {
  organizationId: number; contractId: string; addendumType: AddendumType; justification: string;
  newValue?: number; newTerm?: string;
  /**
   * Novo término PROPOSTO da vigência (AAAA-MM-DD) — SÓ aditivo de prazo. Entra no texto do termo; o vencimento e os alertas
   * do Centro de Operações só são reagendados na FORMALIZAÇÃO (PROMPT 08 / D-2).
   */
  newEndDate?: string;
  requestOrigin?: AddendumRequestOrigin; correlationId: string; actorUserId: number;
  idempotencyKey: string;
}): Promise<{ addendum: ContractAddendum; requiresLegalOpinion: boolean; resumed: boolean; expiration: null; proposedEndDate: string | null }> {
  // Recusa ANTES de qualquer efeito: data inválida, data em aditivo que não é de prazo, texto longo demais.
  // Auditoria PROMPT 08 (P2): o sufixo "término da vigência em" é RESERVADO ao campo estruturado — digitado no texto livre
  // ele seria lido na formalização como término proposto sem ter passado pela validação de data.
  if (/t[ée]rmino da vig[êe]ncia em/i.test(params.newTerm ?? "")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o novo término no campo \"Novo término da vigência\" (data), não no texto do prazo. Nada foi gravado." });
  }
  const term = composeAddendumTerm({ addendumType: params.addendumType, newTerm: params.newTerm, newEndDate: params.newEndDate });
  if (!term.ok) {
    const msg = term.issue === "END_DATE_ONLY_FOR_TERM_ADDENDUM" ? "O término da vigência só se aplica a aditivo de prazo."
      : term.issue === "END_DATE_INVALID" ? "Término da vigência inválido (use AAAA-MM-DD)." : "Prazo/vigência longo demais (máx. 255 caracteres).";
    throw new TRPCError({ code: "BAD_REQUEST", message: `${msg} Nada foi gravado.` });
  }
  const normalized = {
    addendumType: params.addendumType, justification: params.justification ?? "", newValue: params.newValue ?? 0,
    newTerm: term.newTerm, newEndDate: params.newEndDate ?? "", requestOrigin: params.requestOrigin ?? "contract_workspace",
  };
  return runInstrumentCommand({
    op: "contract.createAddendum", kind: "aditivo", organizationId: params.organizationId, contractId: params.contractId,
    actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, correlationId: params.correlationId, payload: normalized,
    findExisting: (id) => getContractAddendumById(id, params.contractId, params.organizationId),
    samePayload: (a) => a.addendumType === normalized.addendumType && a.justification === normalized.justification
      && Number(a.newValue) === Number(normalized.newValue) && a.newTerm === normalized.newTerm && a.requestOrigin === normalized.requestOrigin,
    precheck: async () => {
      const ws = await requireContract(params.contractId, params.organizationId);
      planInstrumentStatusChange(ws.status, "aditivo", { requiresLegalOpinion: addendumRequiresLegalOpinion(params.addendumType) });
      return ws;
    },
    create: (id, ws) => createAddendumInstrument({ ...params, newTerm: normalized.newTerm, id, ws }),
    // PROMPT 08 / D-2 — sem `settle`: criar/retomar o comando NUNCA move vencimento, alertas ou valores (efeito só na formalização).
    result: (addendum, flags) => ({
      addendum, requiresLegalOpinion: addendumRequiresLegalOpinion(addendum.addendumType), resumed: flags.resumed,
      expiration: null, proposedEndDate: extractProposedEndDate(addendum.newTerm),
    }),
  });
}

// ─── PROMPT 08 / D-2 — FORMALIZAÇÃO do aditivo (único ponto que aplica efeitos) ─────────────────────────────────

export const ADDENDUM_NOT_FORMALIZABLE = "ADDENDUM_NOT_FORMALIZABLE";
export const ADDENDUM_ALREADY_FORMALIZED = "ADDENDUM_ALREADY_FORMALIZED";
export const ADDENDUM_LEGAL_OPINION_UNFAVORABLE = "ADDENDUM_LEGAL_OPINION_UNFAVORABLE";
export const ADDENDUM_LEGAL_OPINION_REQUIRED = "ADDENDUM_LEGAL_OPINION_REQUIRED";
export const ADDENDUM_TERM_REQUIRED = "ADDENDUM_TERM_REQUIRED";
export const ADDENDUM_FORMALIZATION_CONFLICT = "ADDENDUM_FORMALIZATION_CONFLICT";
export const ADDENDUM_LEGAL_OPINION_NOT_BOUND = "ADDENDUM_LEGAL_OPINION_NOT_BOUND";
export const ADDENDUM_LEGAL_OPINION_STALE_TERM = "ADDENDUM_LEGAL_OPINION_STALE_TERM";
export const ADDENDUM_OPINION_RESERVATIONS_UNADDRESSED = "ADDENDUM_OPINION_RESERVATIONS_UNADDRESSED";
export const ADDENDUM_TERM_REDUCTION_UNCONFIRMED = "ADDENDUM_TERM_REDUCTION_UNCONFIRMED";
export const ADDENDUM_END_DATE_BEFORE_SIGNATURE = "ADDENDUM_END_DATE_BEFORE_SIGNATURE";
export const ADDENDUM_TERM_FROZEN = "ADDENDUM_TERM_FROZEN";

const todayLocalIso = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Referência gravada no aditivo: o REGISTRO declarado do instrumento assinado (o sistema não assina nem presume assinatura). */
export function composeFormalizationReference(signedOn: string, reference: string): string {
  return `Formalizado — assinatura em ${signedOn.slice(8, 10)}/${signedOn.slice(5, 7)}/${signedOn.slice(0, 4)}; ${reference.trim()}`.slice(0, 500);
}

/**
 * Registra a FORMALIZAÇÃO de um aditivo (termo assinado fora do sistema — referência DECLARADA, o sistema não verifica
 * assinatura) e aplica os efeitos previstos: status do contrato (`aditado`, pela máquina de estados) e, no aditivo de
 * prazo, o novo término proposto (vencimento + alertas).
 *
 * PROMPT 09 — invariantes:
 *  - ATOMICIDADE: aditivo, status do contrato, evento de auditoria, vencimento e alertas gravados na MESMA transação, sob o
 *    lock do contrato (nunca "aditivo finalizado com vencimento antigo"; duas formalizações do mesmo contrato são serializadas
 *    e a última a commitar define o vencimento, coerente com o status).
 *  - REPLAY/RETOMADA: aditivo já formalizado com a mesma referência ⇒ devolve o estado, SEM reaplicar efeito nenhum (um aditivo
 *    antigo nunca restaura vigência já superada). Outra referência ⇒ CONFLICT.
 *  - PARECER (quando exigido, ou quando informado): parecer governado de Contratos, SOLICITADO PARA ESTE ADITIVO
 *    (`referenceDocumentId`) e para a VERSÃO VIGENTE do termo (referência documental); conclusão favorável, ou com ressalvas
 *    acompanhada do registro de como foram atendidas (declaração de quem formaliza — nunca presumida); não reutilizado por
 *    outro aditivo (checado sob o lock).
 *  - TERMO: a versão do termo formalizada é fixada no evento; a versão não pode mudar entre a leitura e o commit; depois de
 *    formalizado o termo não é regerado (ver `generateContractDocument`).
 *  - VIGÊNCIA: término proposto anterior à assinatura é recusado; anterior ao vencimento vigente (redução de prazo) só com
 *    confirmação explícita — prorrogação (posterior) e manutenção não exigem nada a mais.
 */
export async function formalizeAddendum(params: {
  organizationId: number; contractId: string; addendumId: string; signedOn: string; formalizationReference: string;
  legalOpinionRequestId?: string; reservationsAddressed?: string; termReductionConfirmed?: boolean;
  actorUserId: number; correlationId: string; idempotencyKey: string;
}): Promise<{
  addendum: ContractAddendum; expiration: { previousDate: string | null; newDate: string } | null; replayed: boolean; resumed: boolean;
  termDocument: { id: string; version: number } | null;
}> {
  if (!Number.isInteger(params.actorUserId) || params.actorUserId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${INSTRUMENT_COMMAND_ACTOR_REQUIRED}: a formalização exige o usuário que a registra; nada foi gravado.` });
  }
  const signedOn = params.signedOn.trim();
  const reference = params.formalizationReference.trim();
  if (!validLocalDate(signedOn) || signedOn > todayLocalIso()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Data de assinatura inválida ou futura (use AAAA-MM-DD). Nada foi gravado." });
  }
  if (reference.length < 3 || reference.length > 300) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Informe a referência do termo aditivo assinado (3 a 300 caracteres). Nada foi gravado." });
  }
  const documentReference = composeFormalizationReference(signedOn, reference);
  const legalOpinionRequestId = (params.legalOpinionRequestId ?? "").trim();
  const reservationsAddressed = (params.reservationsAddressed ?? "").trim();
  const termReductionConfirmed = params.termReductionConfirmed === true;
  const key = params.idempotencyKey.trim();
  const op = "contract.formalizeAddendum";
  const payloadHash = commandPayloadHash(op, params.organizationId, params.contractId, {
    addendumId: params.addendumId, documentReference, legalOpinionRequestId, reservationsAddressed, termReductionConfirmed,
  });

  const ws = await requireContract(params.contractId, params.organizationId);
  const current = await getContractAddendumById(params.addendumId, ws.id, params.organizationId);
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Aditivo não encontrado." });

  const check = await checkIdempotency(key, params.actorUserId, params.organizationId, op, payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) throw new TRPCError({ code: "CONFLICT", message: `${INSTRUMENT_COMMAND_PAYLOAD_MISMATCH}: esta chave já registrou outra formalização; nada foi gravado.` });
    return { ...(typeof check.response === "string" ? JSON.parse(check.response) : check.response), replayed: true };
  }
  if (check.status === "processing") throw new TRPCError({ code: "CONFLICT", message: `${INSTRUMENT_COMMAND_IN_PROGRESS}: esta formalização já está em andamento — aguarde.` });

  try {
    const lineageId = computeLineageId({ tenantId: params.organizationId, businessDomain: "contratos", documentType: "aditivo", origin: ws.id, instrumentId: current.id });
    if (current.status === "finalizado") {
      // Retomada/replay de uma formalização já COMMITADA (efeitos aplicados atomicamente com ela): NENHUM efeito é
      // reaplicado — em particular o vencimento, que pode já ter sido movido por um aditivo formalizado depois.
      if (current.documentReference !== documentReference) {
        throw new TRPCError({ code: "CONFLICT", message: `${ADDENDUM_ALREADY_FORMALIZED}: o aditivo ${current.sequence} já foi formalizado (${current.documentReference || "registro anterior"}); nada foi alterado.` });
      }
      // A versão formalizada está fixada no evento FORMALIZADO (trilha); a retomada não a "relê" pela última versão.
      const out = { addendum: current, expiration: null, replayed: false, resumed: true, termDocument: null };
      await saveIdempotencyResult(key, params.actorUserId, params.organizationId, out);
      return out;
    }
    if (current.status !== "minuta" && current.status !== "aguardando_parecer") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_NOT_FORMALIZABLE}: o aditivo está em "${current.status}"; só minuta/aguardando parecer podem ser formalizados.` });
    }
    const term = await getLatestByLineage(lineageId, params.organizationId);
    if (!term) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_TERM_REQUIRED}: gere o termo do aditivo antes de registrar a formalização.` });
    }
    const opinionRequired = addendumRequiresLegalOpinion(current.addendumType);
    if (opinionRequired && !legalOpinionRequestId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_LEGAL_OPINION_REQUIRED}: aditivo de ${current.addendumType} exige parecer jurídico concluído, solicitado para este aditivo, antes da formalização.` });
    }
    let opinionConclusion: string | null = null;
    if (legalOpinionRequestId) {
      const [request, opinion] = await Promise.all([
        getInstitutionalRequest(legalOpinionRequestId, params.organizationId),
        readLegalOpinionForConsumer(legalOpinionRequestId, params.organizationId, "contratos"),
      ]);
      if (!request || request.referenceProcessId !== ws.id || !opinion.response) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_LEGAL_OPINION_REQUIRED}: o parecer informado não é um parecer jurídico governado deste contrato (Parecer Jurídico, procurador designado).` });
      }
      // Vínculo documental: o parecer foi pedido PARA ESTE aditivo (data posterior não basta).
      if (request.referenceDocumentId !== current.id) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_LEGAL_OPINION_NOT_BOUND}: o parecer informado não foi solicitado para o aditivo ${current.sequence}. Solicite parecer sobre este aditivo.` });
      }
      // … e para a VERSÃO do termo que será formalizada.
      // Exatamente UMA referência documental (a fixada na solicitação), e ela é a versão vigente — um parecer nunca "cobre"
      // versões acrescentadas depois (auditoria PROMPT 09, P1).
      if (opinion.documents.length !== 1 || opinion.documents[0].documentId !== term.id || opinion.documents[0].version !== term.version) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_LEGAL_OPINION_STALE_TERM}: o parecer examinou outra versão do termo (atual: v${term.version}). Solicite parecer sobre a versão vigente.` });
      }
      const conclusion = opinion.response.responseStatus;
      if (conclusion === "com_ressalvas") {
        if (reservationsAddressed.length < 10 || reservationsAddressed.length > 1000) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_OPINION_RESERVATIONS_UNADDRESSED}: o parecer tem ressalvas — registre como foram atendidas (10 a 1000 caracteres) para formalizar.` });
        }
      } else if (conclusion !== "favoravel") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_LEGAL_OPINION_UNFAVORABLE}: o parecer jurídico vinculado não é favorável (conclusão: ${conclusion}); a formalização não foi registrada.` });
      }
      opinionConclusion = conclusion;
    }
    const proposedEndDate = current.addendumType === "prazo" ? extractProposedEndDate(current.newTerm) : null;
    if (proposedEndDate && proposedEndDate < signedOn) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${ADDENDUM_END_DATE_BEFORE_SIGNATURE}: o término proposto (${proposedEndDate}) é anterior à assinatura (${signedOn}). Nada foi gravado.` });
    }

    const db = await getDb();
    if (!db) throw new Error("Banco de dados indisponível — formalização não registrada (fail-closed).");
    const result = await runTransactionWithDeadlockRetry({ label: "contract.aditivo.formalize", organizationId: params.organizationId, correlationId: params.correlationId }, () => db.transaction(async (tx) => {
      const locked = await lockContractWorkspaceForInstrument(ws.id, params.organizationId, tx);
      if (!locked) throw new Error("Contrato não encontrado.");
      // A versão do termo não pode ter mudado entre a validação e o commit.
      const termNow = await getLatestByLineage(lineageId, params.organizationId, tx);
      if (!termNow || termNow.id !== term.id || termNow.version !== term.version) {
        throw new TRPCError({ code: "CONFLICT", message: `${ADDENDUM_FORMALIZATION_CONFLICT}: o termo do aditivo mudou durante a formalização. Recarregue e confira a versão.` });
      }
      if (legalOpinionRequestId) {
        const reused = await findAddendumUsingLegalOpinion({ contractId: ws.id, orgId: params.organizationId, legalOpinionRequestId, excludeId: current.id }, tx);
        if (reused) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_LEGAL_OPINION_REQUIRED}: o parecer informado já está vinculado ao aditivo ${reused.sequence}; nada foi gravado.` });
        }
      }
      let previousExpiration: string | null = null;
      if (proposedEndDate) {
        previousExpiration = await getCurrentExpirationDate(params.organizationId, "contrato", ws.id, tx);
        if (previousExpiration && proposedEndDate < previousExpiration && !termReductionConfirmed) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_TERM_REDUCTION_UNCONFIRMED}: o término proposto (${proposedEndDate}) é ANTERIOR ao vencimento vigente (${previousExpiration}). Confirme a redução de prazo para formalizar.` });
        }
      }
      const plan = planInstrumentStatusChange(locked.status, "aditivo");
      const at = nextContractRevision(locked.updatedAt);
      const ok = await compareAndSetAddendumFormalized({
        id: current.id, contractId: ws.id, orgId: params.organizationId, fromStatus: current.status, documentReference, legalOpinionRequestId, updatedAt: at,
      }, tx);
      if (!ok) throw new TRPCError({ code: "CONFLICT", message: `${ADDENDUM_FORMALIZATION_CONFLICT}: o aditivo mudou desde a leitura (outra formalização em andamento ou concluída). Recarregue.` });
      const statusOk = await compareAndSetContractWorkspaceStatus({
        id: ws.id, orgId: params.organizationId, fromStatus: plan.from, toStatus: plan.to, updatedAt: at, expectedUpdatedAt: locked.updatedAt,
      }, tx);
      if (!statusOk) throw new InstrumentStatusCasMiss();
      const reduced = !!(proposedEndDate && previousExpiration && proposedEndDate < previousExpiration);
      const evidence = [
        `termo ${term.id} v${term.version}`,
        legalOpinionRequestId ? `parecer ${legalOpinionRequestId} (conclusão: ${opinionConclusion})` : null,
        opinionConclusion === "com_ressalvas" ? `ressalvas atendidas — DECLARADO por quem formaliza: ${reservationsAddressed}` : null,
        proposedEndDate ? `término ${previousExpiration ?? "não agendado"} → ${proposedEndDate}${reduced ? " (REDUÇÃO de prazo confirmada)" : ""}` : null,
      ].filter(Boolean).join("; ");
      await recordProcessEvent({
        organizationId: params.organizationId, processId: ws.id, eventType: "change", actor: timelineActor(params.actorUserId),
        summary: `Aditivo ${current.sequence} (${current.addendumType}) FORMALIZADO — ${documentReference}. ${evidence}. Efeitos aplicados ao contrato (status ${plan.to}).`.slice(0, 2000),
        refId: current.id, correlationId: params.correlationId,
      }, tx);
      let expiration: { previousDate: string | null; newDate: string } | null = null;
      if (proposedEndDate) {
        const r = await rescheduleExpiration({
          organizationId: params.organizationId, kind: "contrato", referenceId: ws.id, title: `Contrato ${ws.contractNumber}`,
          expirationDate: proposedEndDate, actor: `user:${params.actorUserId}`, correlationId: params.correlationId,
          reason: `aditivo nº ${current.sequence} formalizado`,
        }, tx);
        expiration = { previousDate: r.previousDate, newDate: r.newDate };
      }
      return { addendum: { ...current, status: "finalizado" as const, documentReference, legalOpinionRequestId, updatedAt: at }, expiration };
    }));
    log.info("contract_addendum_formalized", {
      contractId: ws.id, organizationId: params.organizationId, addendumId: current.id, termDocumentId: term.id, termVersion: term.version,
      expirationRescheduled: !!result.expiration, actorUserId: params.actorUserId, correlationId: params.correlationId,
    });
    const out = { ...result, replayed: false, resumed: false, termDocument: { id: term.id, version: term.version } };
    await saveIdempotencyResult(key, params.actorUserId, params.organizationId, out);
    return out;
  } catch (err) {
    await failIdempotencyKey(key, params.actorUserId, params.organizationId).catch(() => {});
    throw err;
  }
}

// ─── Apostilamentos ───────────────────────────────────────────────────────────

/**
 * Cria um apostilamento e gera automaticamente a minuta.
 * SEM-025 — mesma governança do aditivo: máquina de estados antes de qualquer efeito; apostilamento +
 * status + evento atômicos; minuta gerada depois, a partir do apostilamento persistido.
 * R9 / SEM-084 — sequência alocada sob o lock do contrato, na mesma transação (ver `persistInstrumentWithGovernedStatus`).
 * R9 / SEM-062 — apostilamento `gestor`/`fiscal` APLICA a designação em `manager`/`inspector` do contrato, atomicamente
 * com o instrumento, o status, o CAS e o evento (antes → depois); o nome é obrigatório e só no campo do seu tipo.
 * `reajuste`/`legal` NÃO alteram valor/prazo do contrato (limites legais do art. 125: J-4, BLOCKED_LEGAL_REVIEW).
 */
async function createApostilleInstrument(params: {
  organizationId: number; contractId: string; kind: ApostilleKind; description?: string;
  newValue?: number; newManager?: string; newInspector?: string; correlationId: string; actorUserId?: number;
  /** Revisão do contrato que o cliente viu (opcional); divergente ⇒ `ContractRevisionConflictError`, nada gravado. */
  expectedUpdatedAt?: string;
  /** SEM084-B — id derivado da chave do comando. */
  id: string;
  /** Contrato lido na pré-checagem do comando (a avaliação que vale é a refeita SOB O LOCK). */
  ws: ContractWorkspace;
}): Promise<ContractApostille> {
  const ws = params.ws;
  planInstrumentStatusChange(ws.status, "apostilamento"); // recusa antes de qualquer efeito (reavaliada sob o lock)
  const planned = planApostilleAssignment(ws, params.kind, params); // recusa antes de qualquer efeito (nome ausente/campo alheio)
  const newManager = params.kind === "gestor" && planned ? planned.after : "";
  const newInspector = params.kind === "fiscal" && planned ? planned.after : "";
  const { result: apostille } = await persistInstrumentWithGovernedStatus({
    ws, instrument: "apostilamento", actorUserId: params.actorUserId, correlationId: params.correlationId,
    expectedUpdatedAt: params.expectedUpdatedAt,
    allocateSequence: (tx) => nextApostilleSequenceUnderLock(ws.id, params.organizationId, tx),
    assignment: (locked) => planApostilleAssignment(locked, params.kind, params),
    build: ({ sequence, at }) => {
      const created = createContractApostille({
        organizationId: params.organizationId, contractId: ws.id, kind: params.kind, sequence, id: params.id, description: params.description,
        newValue: params.newValue, newManager, newInspector, correlationId: params.correlationId, createdAt: at,
      });
      return {
        result: created, refId: created.id, summary: `Apostilamento ${sequence} (${params.kind}).`,
        write: (tx) => insertContractApostille(created, tx, { failOnDuplicate: true }),
      };
    },
  });
  return apostille;
}

/**
 * Cria um apostilamento e gera o termo. SEM084-B — comando replay-safe pela chave de idempotência (ver `runInstrumentCommand`);
 * a revisão esperada do contrato (`expectedUpdatedAt`) é PRÉ-CONDIÇÃO (CAS) da 1ª gravação, NÃO dado semântico do comando:
 * fica fora do payload idempotente — a identidade do comando é a mesma qualquer que seja o ponto em que a tentativa
 * anterior falhou — e a retomada de um apostilamento já gravado não regrava o contrato nem reaplica o CAS.
 */
export async function createApostille(params: {
  organizationId: number; contractId: string; kind: ApostilleKind; description?: string;
  newValue?: number; newManager?: string; newInspector?: string; correlationId: string; actorUserId: number;
  expectedUpdatedAt?: string;
  idempotencyKey: string;
}): Promise<ContractApostille> {
  const normalized = {
    kind: params.kind, description: params.description ?? "", newValue: params.newValue ?? 0,
    newManager: params.kind === "gestor" ? (params.newManager ?? "").trim() : "",
    newInspector: params.kind === "fiscal" ? (params.newInspector ?? "").trim() : "",
  };
  return runInstrumentCommand({
    op: "contract.createApostille", kind: "apostilamento", organizationId: params.organizationId, contractId: params.contractId,
    actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
    payload: normalized,
    findExisting: (id) => getContractApostilleById(id, params.contractId, params.organizationId),
    samePayload: (a) => a.kind === normalized.kind && a.description === normalized.description && Number(a.newValue) === Number(normalized.newValue)
      && a.newManager === normalized.newManager && a.newInspector === normalized.newInspector,
    precheck: async () => {
      const ws = await requireContract(params.contractId, params.organizationId);
      planInstrumentStatusChange(ws.status, "apostilamento");
      planApostilleAssignment(ws, params.kind, params);
      return ws;
    },
    create: (id, ws) => createApostilleInstrument({ ...params, id, ws }),
    result: (apostille) => apostille,
  });
}

// ─── Ocorrências (registro simples) ───────────────────────────────────────────

export async function registerOccurrence(params: {
  organizationId: number; contractId: string; description: string; occurredOn?: string; attachments?: string[]; notes?: string; correlationId: string;
}): Promise<Awaited<ReturnType<typeof insertContractOccurrence>>> {
  const ws = await requireContract(params.contractId, params.organizationId);
  const occ = createContractOccurrence({
    organizationId: params.organizationId, contractId: ws.id, description: params.description, occurredOn: params.occurredOn,
    attachments: params.attachments, notes: params.notes, correlationId: params.correlationId,
  });
  await insertContractOccurrence(occ);
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "change", actor: "sistema", summary: `Ocorrência registrada: ${params.description}.`, refId: occ.id, correlationId: params.correlationId });
  return occ;
}

// ─── Parecer Jurídico (Institutional Request Engine) ──────────────────────────

/**
 * Solicita parecer jurídico ao Business Domain Parecer Jurídico. NUNCA integra direto.
 * PROMPT 09 — com `addendumId`: o parecer é pedido PARA AQUELE aditivo (`referenceDocumentId` = id do aditivo) e para a
 * versão VIGENTE do termo (referência documental id+versão, resolvida pelo servidor — nunca informada pelo cliente).
 * É esse vínculo que a formalização exige.
 */
export async function requestContractLegalOpinion(params: {
  organizationId: number; contractId: string; requestType: "LEGAL_OPINION_INITIAL" | "LEGAL_OPINION_FINAL";
  requestedBy: number; documents?: Array<{ documentId: string; title?: string; version?: number }>; correlationId: string;
  addendumId?: string;
}): Promise<{ requestId: string }> {
  const ws = await requireContract(params.contractId, params.organizationId);
  let referenceDocumentId: string | undefined;
  let documents = params.documents;
  let title = `Parecer — Contrato ${ws.contractNumber}`;
  let description = `Análise jurídica do contrato "${ws.object}".`;
  if (params.addendumId) {
    const addendum = await getContractAddendumById(params.addendumId, ws.id, params.organizationId);
    if (!addendum) throw new TRPCError({ code: "NOT_FOUND", message: `Aditivo não encontrado neste contrato (${INSTRUMENT_NOT_FOUND}).` });
    if (addendum.status !== "minuta" && addendum.status !== "aguardando_parecer") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_NOT_FORMALIZABLE}: o aditivo ${addendum.sequence} está em "${addendum.status}"; parecer de formalização só para minuta/aguardando parecer.` });
    }
    const lineageId = computeLineageId({ tenantId: params.organizationId, businessDomain: "contratos", documentType: "aditivo", origin: ws.id, instrumentId: addendum.id });
    const term = await getLatestByLineage(lineageId, params.organizationId);
    if (!term) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${ADDENDUM_TERM_REQUIRED}: gere o termo do aditivo antes de solicitar o parecer sobre ele.` });
    referenceDocumentId = addendum.id;
    documents = [{ documentId: term.id, version: term.version, title: term.title }];
    title = `Parecer — Aditivo nº ${addendum.sequence} (${addendum.addendumType}) — Contrato ${ws.contractNumber}`;
    description = `Análise jurídica do aditivo nº ${addendum.sequence} (${addendum.addendumType}) ao contrato "${ws.object}" — termo v${term.version}.`;
  }
  const result = await requestInstitutionalReview({
    organizationId: params.organizationId, sourceDomain: "contratos", destinationDomain: "parecer_juridico",
    requestType: params.requestType, referenceProcessId: ws.id, referenceDocumentId,
    title, description, priority: "alta", requestedBy: params.requestedBy, documents, correlationId: params.correlationId,
  });
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "change", actor: String(params.requestedBy), summary: `Parecer jurídico solicitado (${params.requestType})${referenceDocumentId ? ` para o aditivo ${referenceDocumentId} (${documents?.[0] ? `termo v${documents[0].version}` : ""})` : ""}.`, refId: result.request.id, correlationId: params.correlationId });
  return { requestId: result.request.id };
}

/**
 * PROMPT 09 — pareceres SOLICITADOS PARA um aditivo (seleção na formalização, sem digitar id). Para cada um: conclusão
 * governada (se houver) e se examinou a versão VIGENTE do termo. Somente leitura, escopo do tenant e do contrato.
 */
export async function listAddendumLegalOpinions(params: { organizationId: number; contractId: string; addendumId: string }): Promise<Array<{
  requestId: string; requestedAt: string; status: string; conclusion: string | null; governed: boolean; termVersion: number | null; currentTerm: boolean; eligible: boolean;
}>> {
  const ws = await requireContract(params.contractId, params.organizationId);
  const addendum = await getContractAddendumById(params.addendumId, ws.id, params.organizationId);
  if (!addendum) throw new TRPCError({ code: "NOT_FOUND", message: `Aditivo não encontrado neste contrato (${INSTRUMENT_NOT_FOUND}).` });
  const lineageId = computeLineageId({ tenantId: params.organizationId, businessDomain: "contratos", documentType: "aditivo", origin: ws.id, instrumentId: addendum.id });
  const [requests, term] = await Promise.all([
    listRequestsByReferenceDocument(params.organizationId, "contratos", ws.id, addendum.id),
    getLatestByLineage(lineageId, params.organizationId),
  ]);
  return Promise.all(requests.map(async (r) => {
    const opinion = await readLegalOpinionForConsumer(r.id, params.organizationId, "contratos");
    const ref = opinion.documents.find((d) => term && d.documentId === term.id) ?? opinion.documents[0];
    const currentTerm = !!term && opinion.documents.length === 1 && opinion.documents[0].documentId === term.id && opinion.documents[0].version === term.version;
    const conclusion = opinion.response?.responseStatus ?? null;
    return {
      requestId: r.id, requestedAt: r.createdAt, status: r.status, conclusion, governed: !!opinion.response,
      termVersion: ref?.version ?? null, currentTerm,
      eligible: !!opinion.response && currentTerm && (conclusion === "favoravel" || conclusion === "com_ressalvas"),
    };
  }));
}

/** NEW-007 — só exibe como parecer a resposta com origem governada (Parecer Jurídico, procurador designado) pedida por Contratos. */
export async function getContractLegalOpinion(requestId: string, orgId: number): Promise<LegalOpinionReadResult> {
  return readLegalOpinionForConsumer(requestId, orgId, "contratos");
}

export { listContractAddenda };
