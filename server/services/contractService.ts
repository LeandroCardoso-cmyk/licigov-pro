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

import { assertKernelAccess } from "./kernelAccessService";
import { serviceLogger } from "./observabilityService";
import { generateOfficialDocument } from "./documentEngineService";
import { orchestrateMultiCopilot } from "./workspaceOrchestratorService";
import { requestInstitutionalReview } from "./institutionalRequestService";
import { getResponseForRequest, listDocumentReferences } from "../db/institutionalRequests";
import { recordProcessEvent } from "../db/procurement";
import { getProcess } from "../db/procurement";
import { getDirectProcurementWorkspace } from "../db/directProcurement";
import {
  createContractWorkspace, CONTRACT_DOMAIN_COPILOTS, planInstrumentStatusChange,
  type ContractWorkspace, type ContractInstrumentKind, type InstrumentStatusChangePlan,
} from "../domain/contractWorkspace";
import {
  createContractAddendum, advanceAddendum, createContractApostille, createContractOccurrence,
  createContractGeneratedDocument,
  type AddendumType, type AddendumRequestOrigin, type ApostilleKind, type ContractDocumentKind,
} from "../domain/contractInstruments";
import { createAssistedReconstruction, RECONSTRUCTION_DISCLAIMER, type ImportedContractSource } from "../domain/contractReconstruction";
import { getDb } from "../db/connection";
import {
  insertContractWorkspace, getContractWorkspace, compareAndSetContractWorkspaceStatus, type ContractWsExecutor,
  insertContractWsDocument, insertContractAddendum, countContractAddenda, listContractAddenda,
  insertContractApostille, countContractApostilles, insertContractOccurrence, insertImportedContract,
  findManualContractByNumber,
} from "../db/contractWorkspace";

const DOMAIN = "contratos" as const;
const log = serviceLogger("ContractService");

/** Colisão de número de contrato AVULSO na mesma organização — nunca sobrescreve silenciosamente. */
export class ManualContractConflictError extends Error {
  constructor(public readonly existingId: string, contractNumber: string) {
    super(`Já existe um contrato avulso com o número "${contractNumber}" nesta organização.`);
    this.name = "ManualContractConflictError";
  }
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
}): Promise<ContractWorkspace> {
  const process = await getProcess(params.processId, params.organizationId);
  const ws = createContractWorkspace({
    organizationId: params.organizationId, originType: "processo_licitatorio", originProcess: params.processId,
    contractNumber: params.contractNumber, contractor: params.contractor, object: process?.object ?? "",
    value: params.value, term: params.term, correlationId: params.correlationId,
  });
  await insertContractWorkspace(ws);
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "workspace_created", actor: "sistema", summary: `Contrato ${ws.contractNumber} gerado a partir do Processo Licitatório ${params.processId}.`, refId: ws.id, correlationId: params.correlationId });
  return ws;
}

/** FLUXO 2 — a partir da Contratação Direta (ratificada). */
export async function createFromDirectProcurement(params: {
  organizationId: number; directWorkspaceId: string; contractNumber: string; contractor?: string; value?: number; term?: string; correlationId: string;
}): Promise<ContractWorkspace> {
  const src = await getDirectProcurementWorkspace(params.directWorkspaceId, params.organizationId);
  const ws = createContractWorkspace({
    organizationId: params.organizationId, originType: "contratacao_direta", originProcess: params.directWorkspaceId,
    contractNumber: params.contractNumber, contractor: params.contractor, object: src?.object ?? "",
    value: params.value, term: params.term, correlationId: params.correlationId,
  });
  await insertContractWorkspace(ws);
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "workspace_created", actor: "sistema", summary: `Contrato ${ws.contractNumber} gerado a partir da Contratação Direta ${params.directWorkspaceId}.`, refId: ws.id, correlationId: params.correlationId });
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
  const existing = await findManualContractByNumber(params.organizationId, params.contractNumber);
  if (existing) throw new ManualContractConflictError(existing.id, params.contractNumber);

  const ws = createContractWorkspace({
    organizationId: params.organizationId, originType: "avulso", originProcess: "",
    contractNumber: params.contractNumber, contractor: params.contractor, object: params.object,
    value: params.value, term: params.term, manager: params.manager, inspector: params.inspector,
    status: "minuta", correlationId: params.correlationId, createdBy: params.createdBy,
  });
  await insertContractWorkspace(ws);
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "workspace_created", actor: `user:${params.createdBy}`, summary: `Contrato avulso ${ws.contractNumber} criado do zero (sem processo de origem).`, refId: ws.id, correlationId: params.correlationId });
  return ws;
}

/**
 * FLUXO 3 (obrigatório) — RECONSTRUÇÃO ASSISTIDA de contrato externo (PDF/DOCX →
 * texto). Identifica fornecedor/objeto/prazo/valor/cláusulas e APRESENTA ao servidor
 * para revisão. A reconstrução é assistida (nunca perfeita) e depende da validação
 * do servidor — por isso o workspace nasce como MINUTA, não como contrato vigente.
 */
export async function importExternalContract(params: {
  organizationId: number; source: ImportedContractSource; rawText: string; contractNumber?: string; correlationId: string;
}): Promise<{ workspace: ContractWorkspace; confidence: number; reconstructed: ReturnType<typeof createAssistedReconstruction>["reconstructed"]; assisted: true; disclaimer: string }> {
  const reconstruction = createAssistedReconstruction({ organizationId: params.organizationId, source: params.source, rawText: params.rawText, correlationId: params.correlationId });
  const ws = createContractWorkspace({
    organizationId: params.organizationId, originType: "externo", originProcess: "",
    contractNumber: params.contractNumber || reconstruction.reconstructed.contractNumber || "IMPORTADO",
    contractor: reconstruction.reconstructed.contractor, object: reconstruction.reconstructed.object, value: reconstruction.reconstructed.value,
    term: reconstruction.reconstructed.term, status: "minuta", correlationId: params.correlationId,
  });
  await insertContractWorkspace(ws);
  await insertImportedContract(reconstruction, ws.id);
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "change", actor: "sistema", summary: `Reconstrução assistida de contrato externo (${params.source}), confiança ${Math.round(reconstruction.confidence * 100)}% — pendente de revisão do servidor.`, refId: reconstruction.id, correlationId: params.correlationId });
  return { workspace: ws, confidence: reconstruction.confidence, reconstructed: reconstruction.reconstructed, assisted: true, disclaimer: RECONSTRUCTION_DISCLAIMER };
}

// ─── Geração inteligente de minutas (Document Engine + copilotos) ─────────────

/** Gera a minuta (revisável) de um documento contratual usando os copilotos do domínio. */
export async function generateContractDocument(params: {
  organizationId: number; contractId: string; kind: ContractDocumentKind; refId?: string; correlationId: string;
  invoke?: (prompt: string) => Promise<string>;
}): Promise<{ document: Awaited<ReturnType<typeof insertContractWsDocument>>; officialDocumentId: string; recommendation: Recommendation }> {
  const ws = await requireContract(params.contractId, params.organizationId);
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

  const content = [
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

  // SPRINT 5.3.1 — metadados institucionais auditáveis da minuta.
  const doc = createContractGeneratedDocument({
    organizationId: params.organizationId, contractId: ws.id, kind: params.kind,
    title: `${titleForKind(params.kind)} — ${ws.contractNumber}`, content, refId: params.refId,
    metadata: {
      clauseOrigin: "template_institucional",
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
  const official = await generateOfficialDocument({
    organizationId: params.organizationId, businessDomain: "contratos",
    documentType: params.kind === "rescisao" ? "rescisao" : params.kind === "aditivo" ? "aditivo" : params.kind === "apostilamento" ? "apostilamento" : "contrato",
    origin: ws.id, title: doc.title, content, author: "multi_copilot", correlationId: params.correlationId,
    metadata: { copilots: orchestration.selectedCopilots, legalBasis: orchestration.consolidated.legalBasis, confidence: orchestration.consolidated.confidence },
  });
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "recommendation", actor: "multi_copilot", summary: `Minuta de ${params.kind} gerada (rascunho revisável).`, refId: doc.id, correlationId: params.correlationId });

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
  constructor(public readonly contractId: string) {
    super("O status do contrato foi alterado durante a operação; nada foi gravado. Recarregue e tente novamente.");
    this.name = "ContractStatusConflictError";
  }
}

/** Sentinela interna: força o ROLLBACK da transação quando o compare-and-set de status não casa. */
class InstrumentStatusCasMiss extends Error {
  constructor() { super("instrument_status_cas_miss"); this.name = "InstrumentStatusCasMiss"; }
}

/**
 * Persiste o instrumento (aditivo/apostilamento), o status do contrato e o evento de timeline numa ÚNICA
 * transação, APÓS a máquina de estados ter aprovado a mudança (`planInstrumentStatusChange`, avaliada
 * pelo caller antes de qualquer efeito). O status só muda por compare-and-set a partir do status que a
 * máquina avaliou (`plan.from`). Se o contrato mudou em paralelo (ex.: rescindido durante a operação), o
 * CAS não casa ⇒ ROLLBACK (nenhuma linha do instrumento, nenhum status, nenhum evento) e a máquina é
 * reavaliada contra o status REAL: recusa ⇒ `ContractStatusTransitionError`; ainda admissível ⇒
 * `ContractStatusConflictError`. Nunca grava instrumento pela metade.
 */
async function persistInstrumentWithGovernedStatus(params: {
  ws: ContractWorkspace;
  plan: InstrumentStatusChangePlan;
  instrument: ContractInstrumentKind;
  at: string;
  write: (tx: ContractWsExecutor) => Promise<unknown>;
  event: { summary: string; refId: string; correlationId: string };
}): Promise<void> {
  const { ws, plan } = params;
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível — instrumento contratual não persistido (fail-closed).");
  if (plan.mode === "minuta_pending_human_decision") {
    // Comportamento pré-existente MANTIDO (minuta → aditado/apostilado não está na máquina, mas não há
    // caminho de UI para `vigente`) — observável até a decisão humana registrada na PR-08.
    log.warn("contract_instrument_status_from_minuta", {
      contractId: ws.id, organizationId: ws.organizationId, instrument: params.instrument, to: plan.to,
      correlationId: params.event.correlationId,
    });
  }
  try {
    await db.transaction(async (tx) => {
      await params.write(tx);
      const ok = await compareAndSetContractWorkspaceStatus({
        id: ws.id, orgId: ws.organizationId, fromStatus: plan.from, toStatus: plan.to, updatedAt: params.at,
      }, tx);
      if (!ok) throw new InstrumentStatusCasMiss();
      await recordProcessEvent({
        organizationId: ws.organizationId, processId: ws.id, eventType: "change", actor: "sistema",
        summary: params.event.summary, refId: params.event.refId, correlationId: params.event.correlationId,
      }, tx);
    });
  } catch (e) {
    if (!(e instanceof InstrumentStatusCasMiss)) throw e;
    const fresh = await requireContract(ws.id, ws.organizationId);
    planInstrumentStatusChange(fresh.status, params.instrument); // lança ContractStatusTransitionError se recusado
    throw new ContractStatusConflictError(ws.id);
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
 * encerrado/rescindido/arquivado ⇒ `ContractStatusTransitionError` sem gravar aditivo, minuta, status
 * ou evento. Aditivo + status + evento são atômicos; a minuta é gerada depois, a partir do aditivo já
 * persistido (regerável por `generateDocuments` se a geração falhar).
 */
export async function createAddendum(params: {
  organizationId: number; contractId: string; addendumType: AddendumType; justification: string;
  newValue?: number; newTerm?: string; requestOrigin?: AddendumRequestOrigin; correlationId: string;
}): Promise<{ addendum: Awaited<ReturnType<typeof insertContractAddendum>>; requiresLegalOpinion: boolean }> {
  const ws = await requireContract(params.contractId, params.organizationId);
  // Máquina de estados PRIMEIRO — recusa antes de qualquer leitura adicional, escrita, IA ou evento.
  const plan = planInstrumentStatusChange(ws.status, "aditivo");
  const sequence = (await countContractAddenda(ws.id, params.organizationId)) + 1;
  let addendum = createContractAddendum({
    organizationId: params.organizationId, contractId: ws.id, addendumType: params.addendumType, sequence,
    justification: params.justification, newValue: params.newValue, newTerm: params.newTerm,
    requestOrigin: params.requestOrigin, correlationId: params.correlationId,
  });
  addendum = advanceAddendum(addendum, "minuta");

  // Adaptive Process Engine: valor/quantitativo exigem parecer; prazo/qualitativo não.
  const requiresLegalOpinion = params.addendumType === "valor" || params.addendumType === "quantitativo";
  const updated = advanceAddendum(addendum, requiresLegalOpinion ? "aguardando_parecer" : "finalizado");
  await persistInstrumentWithGovernedStatus({
    ws, plan, instrument: "aditivo", at: updated.updatedAt,
    write: (tx) => insertContractAddendum(updated, tx),
    event: { summary: `Aditivo ${sequence} (${params.addendumType}) — ${requiresLegalOpinion ? "requer parecer" : "finalizado"}.`, refId: updated.id, correlationId: params.correlationId },
  });
  await generateContractDocument({ organizationId: params.organizationId, contractId: ws.id, kind: "aditivo", refId: updated.id, correlationId: params.correlationId });
  return { addendum: updated, requiresLegalOpinion };
}

// ─── Apostilamentos ───────────────────────────────────────────────────────────

/**
 * Cria um apostilamento e gera automaticamente a minuta.
 * SEM-025 — mesma governança do aditivo: máquina de estados antes de qualquer efeito; apostilamento +
 * status + evento atômicos; minuta gerada depois, a partir do apostilamento persistido.
 */
export async function createApostille(params: {
  organizationId: number; contractId: string; kind: ApostilleKind; description?: string;
  newValue?: number; newManager?: string; newInspector?: string; correlationId: string;
}): Promise<Awaited<ReturnType<typeof insertContractApostille>>> {
  const ws = await requireContract(params.contractId, params.organizationId);
  const plan = planInstrumentStatusChange(ws.status, "apostilamento");
  const sequence = (await countContractApostilles(ws.id, params.organizationId)) + 1;
  const apostille = createContractApostille({
    organizationId: params.organizationId, contractId: ws.id, kind: params.kind, sequence, description: params.description,
    newValue: params.newValue, newManager: params.newManager, newInspector: params.newInspector, correlationId: params.correlationId,
  });
  await persistInstrumentWithGovernedStatus({
    ws, plan, instrument: "apostilamento", at: apostille.createdAt,
    write: (tx) => insertContractApostille(apostille, tx),
    event: { summary: `Apostilamento ${sequence} (${params.kind}).`, refId: apostille.id, correlationId: params.correlationId },
  });
  await generateContractDocument({ organizationId: params.organizationId, contractId: ws.id, kind: "apostilamento", refId: apostille.id, correlationId: params.correlationId });
  return apostille;
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

/** Solicita parecer jurídico ao Business Domain Parecer Jurídico. NUNCA integra direto. */
export async function requestContractLegalOpinion(params: {
  organizationId: number; contractId: string; requestType: "LEGAL_OPINION_INITIAL" | "LEGAL_OPINION_FINAL";
  requestedBy: number; documents?: Array<{ documentId: string; title?: string; version?: number }>; correlationId: string;
}): Promise<{ requestId: string }> {
  const ws = await requireContract(params.contractId, params.organizationId);
  const result = await requestInstitutionalReview({
    organizationId: params.organizationId, sourceDomain: "contratos", destinationDomain: "parecer_juridico",
    requestType: params.requestType, referenceProcessId: ws.id,
    title: `Parecer — Contrato ${ws.contractNumber}`, description: `Análise jurídica do contrato "${ws.object}".`,
    priority: "alta", requestedBy: params.requestedBy, documents: params.documents, correlationId: params.correlationId,
  });
  await recordProcessEvent({ organizationId: params.organizationId, processId: ws.id, eventType: "change", actor: String(params.requestedBy), summary: `Parecer jurídico solicitado (${params.requestType}).`, refId: result.request.id, correlationId: params.correlationId });
  return { requestId: result.request.id };
}

export async function getContractLegalOpinion(requestId: string, orgId: number): Promise<{ response: Awaited<ReturnType<typeof getResponseForRequest>>; documents: Awaited<ReturnType<typeof listDocumentReferences>> }> {
  const [response, documents] = await Promise.all([getResponseForRequest(requestId, orgId), listDocumentReferences(requestId, orgId)]);
  return { response, documents };
}

export { listContractAddenda };
