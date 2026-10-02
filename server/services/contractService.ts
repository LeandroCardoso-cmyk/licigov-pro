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
import { requestInstitutionalReview } from "./institutionalRequestService";
import { getResponseForRequest, listDocumentReferences } from "../db/institutionalRequests";
import { recordProcessEvent } from "../db/procurement";
import { getProcess } from "../db/procurement";
import { getDirectProcurementWorkspace } from "../db/directProcurement";
import {
  createContractWorkspace, CONTRACT_DOMAIN_COPILOTS, planInstrumentStatusChange,
  type ContractWorkspace, type ContractOriginType, type ContractInstrumentKind, type InstrumentStatusChangePlan,
} from "../domain/contractWorkspace";
import {
  createContractAddendum, advanceAddendum, createContractApostille, createContractOccurrence,
  createContractGeneratedDocument,
  type AddendumType, type AddendumRequestOrigin, type ApostilleKind, type ContractDocumentKind,
} from "../domain/contractInstruments";
import { createAssistedReconstruction, RECONSTRUCTION_DISCLAIMER, type ImportedContractSource } from "../domain/contractReconstruction";
import { getDb } from "../db/connection";
import {
  buildAddendumTermContent, buildApostilleTermContent, INSTRUMENT_NOT_FOUND, INSTRUMENT_REFERENCE_REQUIRED,
  type AddendumData, type ApostilleData,
} from "../domain/instrumentTerms";
import { legalPolicyMarker } from "../domain/legalReviewPolicy";
import {
  getContractWorkspace, compareAndSetContractWorkspaceStatus, type ContractWsExecutor,
  insertContractWsDocument, insertContractAddendum, countContractAddenda, listContractAddenda, listContractApostilles,
  insertContractApostille, countContractApostilles, insertContractOccurrence, insertImportedContract,
  findManualContractByNumber, insertNewContractWorkspace, findContractByNormalizedNumber,
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
 * Persiste a CRIAÇÃO de um contrato — INSERT-only, nunca upsert (padrão R3). A chave institucional é (organização,
 * número normalizado), QUALQUER QUE SEJA A ORIGEM (decisão do responsável). Número já existente na organização ⇒ retry
 * idempotente da MESMA criação converge (devolve o existente, `created: false`, sem escrita); qualquer outra coisa —
 * inclusive o mesmo número vindo de outra origem, ou o contrato já fora de "minuta" — ⇒ `onConflict`.
 *  1. checagem no servidor (leitura) do número na organização — recusa/converge sem escrever nada;
 *  2. INSERT puro; a garantia no BANCO é UNIQUE(organization_id, normalized_number) (0310) + a PRIMARY KEY: em corrida
 *     (inclusive entre origens diferentes) exatamente um INSERT vence; o perdedor relê e passa pela mesma decisão.
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

  const before = await findContractByNormalizedNumber(ws.organizationId, ws.contractNumber);
  if (before) return decide(before);

  const inserted = await insertNewContractWorkspace(ws);
  if (inserted !== "duplicate") return { workspace: ws, created: true };
  // Perdeu a corrida (UNIQUE do número na organização ou PRIMARY KEY): relê pelo número; se a colisão foi só de PK
  // (linha cujo número foi editado depois da criação), relê pelo id.
  const existing = (await findContractByNormalizedNumber(ws.organizationId, ws.contractNumber))
    ?? (await getContractWorkspace(ws.id, ws.organizationId));
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

/** FLUXO 2 — a partir da Contratação Direta (ratificada). */
export async function createFromDirectProcurement(params: {
  organizationId: number; directWorkspaceId: string; contractNumber: string; contractor?: string; value?: number; term?: string; correlationId: string;
  /** Ator autenticado (R3/PR-06: retry idempotente só converge para o MESMO ator). */
  createdBy?: number | null;
}): Promise<ContractWorkspace> {
  const src = await getDirectProcurementWorkspace(params.directWorkspaceId, params.organizationId);
  const candidate = createContractWorkspace({
    organizationId: params.organizationId, originType: "contratacao_direta", originProcess: params.directWorkspaceId,
    contractNumber: requireContractNumber(params.contractNumber), contractor: params.contractor, object: src?.object ?? "",
    value: params.value, term: params.term, correlationId: params.correlationId, createdBy: params.createdBy,
  });
  const { workspace: ws, created } = await persistNewContract(candidate, (e) => new ContractAlreadyExistsError(e), params.correlationId);
  if (!created) return ws;
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
  const content = instrument?.kind === "aditivo"
    ? buildAddendumTermContent(contractHeader, instrument.data, orchestration.consolidated.suggestions, orchestration.consolidated.legalBasis)
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

  // SPRINT 5.3.1 — metadados institucionais auditáveis da minuta.
  const doc = createContractGeneratedDocument({
    organizationId: params.organizationId, contractId: ws.id, kind: params.kind,
    title: `${titleForKind(params.kind)} — ${ws.contractNumber}`, content, refId: params.refId,
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
  const official = await generateOfficialDocument({
    organizationId: params.organizationId, businessDomain: "contratos",
    documentType: params.kind === "rescisao" ? "rescisao" : params.kind === "aditivo" ? "aditivo" : params.kind === "apostilamento" ? "apostilamento" : "contrato",
    origin: ws.id, title: doc.title, content, author, correlationId: params.correlationId,
    metadata: {
      copilots: orchestration.selectedCopilots, legalBasis: orchestration.consolidated.legalBasis, confidence: orchestration.consolidated.confidence,
      ...(instrument ? { instrumentId: instrument.data.id, instrumentKind: instrument.kind, contractNumber: ws.contractNumber } : {}),
      // R8 / PR-20 scaffolding (SEM-084): o sistema não valida limites legais do aditivo sem parecer registrado.
      ...(instrument?.kind === "aditivo" ? { addendumLimitPolicy: legalPolicyMarker("SEM-084_CANONICAL_ADDENDUM_LIMITS") } : {}),
    },
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

/**
 * Persiste o instrumento (aditivo/apostilamento), o status do contrato e o evento de timeline numa ÚNICA
 * transação, APÓS a máquina de estados ter aprovado a mudança (`planInstrumentStatusChange`, avaliada
 * pelo caller antes de qualquer efeito). O status só muda por compare-and-set a partir do status que a
 * máquina avaliou (`plan.from`). Se o contrato mudou em paralelo (ex.: rescindido durante a operação), o
 * CAS não casa ⇒ ROLLBACK (nenhuma linha do instrumento, nenhum status, nenhum evento) e a máquina é
 * reavaliada contra o status REAL: recusa ⇒ `ContractStatusTransitionError`; ainda admissível ⇒
 * `ContractStatusConflictError`. Nunca grava instrumento pela metade.
 * Instrumentos sucessivos concorrentes (mesma sequência ⇒ mesmo id determinístico): o INSERT é puro
 * (`failOnDuplicate`), o segundo recebe ER_DUP_ENTRY ⇒ ROLLBACK ⇒ `ContractStatusConflictError("sequence")`
 * — nunca funde duas solicitações numa linha híbrida.
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
    const duplicate = isDuplicateKeyError(e);
    if (!(e instanceof InstrumentStatusCasMiss) && !duplicate) throw e;
    const fresh = await requireContract(ws.id, ws.organizationId);
    planInstrumentStatusChange(fresh.status, params.instrument); // lança ContractStatusTransitionError se recusado
    throw new ContractStatusConflictError(ws.id, duplicate ? "sequence" : "status");
  }
  if (plan.mode === "deferred_pending_legal_opinion") {
    // Fail-closed observável: instrumento registrado aguardando parecer; status do contrato NÃO efetivado.
    log.info("contract_instrument_status_deferred_pending_legal_opinion", {
      contractId: ws.id, organizationId: ws.organizationId, instrument: params.instrument, status: plan.from,
      instrumentStatus: plan.instrumentStatus, refId: params.event.refId, correlationId: params.event.correlationId,
    });
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
export async function createAddendum(params: {
  organizationId: number; contractId: string; addendumType: AddendumType; justification: string;
  newValue?: number; newTerm?: string; requestOrigin?: AddendumRequestOrigin; correlationId: string; actorUserId?: number;
}): Promise<{ addendum: Awaited<ReturnType<typeof insertContractAddendum>>; requiresLegalOpinion: boolean }> {
  const ws = await requireContract(params.contractId, params.organizationId);
  // Adaptive Process Engine (regra PRÉ-EXISTENTE, não definida juridicamente aqui — PR-18/PR-20 são donas do
  // insumo jurídico): valor/quantitativo exigem parecer; prazo/qualitativo não.
  const requiresLegalOpinion = params.addendumType === "valor" || params.addendumType === "quantitativo";
  // Máquina de estados PRIMEIRO — recusa antes de qualquer leitura adicional, escrita, IA ou evento. Parecer
  // exigido e ausente ⇒ o status do contrato não é efetivado (fail-closed; `deferred_pending_legal_opinion`).
  const plan = planInstrumentStatusChange(ws.status, "aditivo", { requiresLegalOpinion });
  const sequence = (await countContractAddenda(ws.id, params.organizationId)) + 1;
  let addendum = createContractAddendum({
    organizationId: params.organizationId, contractId: ws.id, addendumType: params.addendumType, sequence,
    justification: params.justification, newValue: params.newValue, newTerm: params.newTerm,
    requestOrigin: params.requestOrigin, correlationId: params.correlationId,
  });
  addendum = advanceAddendum(addendum, "minuta");
  const updated = advanceAddendum(addendum, requiresLegalOpinion ? "aguardando_parecer" : "finalizado");
  await persistInstrumentWithGovernedStatus({
    ws, plan, instrument: "aditivo", at: updated.updatedAt,
    write: (tx) => insertContractAddendum(updated, tx, { failOnDuplicate: true }),
    event: { summary: `Aditivo ${sequence} (${params.addendumType}) — ${requiresLegalOpinion ? `requer parecer; status do contrato mantido (${plan.to}) até o parecer` : "finalizado"}.`, refId: updated.id, correlationId: params.correlationId },
  });
  await generateContractDocument({ organizationId: params.organizationId, contractId: ws.id, kind: "aditivo", refId: updated.id, actorUserId: params.actorUserId, correlationId: params.correlationId });
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
  newValue?: number; newManager?: string; newInspector?: string; correlationId: string; actorUserId?: number;
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
    write: (tx) => insertContractApostille(apostille, tx, { failOnDuplicate: true }),
    event: { summary: `Apostilamento ${sequence} (${params.kind}).`, refId: apostille.id, correlationId: params.correlationId },
  });
  await generateContractDocument({ organizationId: params.organizationId, contractId: ws.id, kind: "apostilamento", refId: apostille.id, actorUserId: params.actorUserId, correlationId: params.correlationId });
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
