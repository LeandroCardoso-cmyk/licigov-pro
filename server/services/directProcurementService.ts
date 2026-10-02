/**
 * FASE 5 — Direct Procurement Service (Contratação Direta)
 *
 * Orquestra o ciclo de Dispensa/Inexigibilidade. REUTILIZA integralmente:
 * Price Research Workspace, Institutional Request Engine (→ Parecer Jurídico),
 * Timeline Engine, Multi-Copilot Orchestrator e Document Engine — nunca duplica
 * infraestrutura. Todo acesso ao Kernel via kernelAccessService. Degrada sem DB.
 *
 * Toda recomendação carrega reasoning, explainability, provenance, confidence e
 * pode ser rejeitada. Nenhuma funcionalidade de Future Evolution é implementada.
 */

import { TRPCError } from "@trpc/server";
import { getCurrentDecision } from "../db/institutionalDecisions";
import type { InstitutionalDecision } from "../domain/institutionalDecision";
import { assertKernelAccess } from "./kernelAccessService";
import { generateOfficialDocument } from "./documentEngineService";
import { orchestrateMultiCopilot } from "./workspaceOrchestratorService";
import { requestInstitutionalReview } from "./institutionalRequestService";
import { getResponseForRequest, listDocumentReferences } from "../db/institutionalRequests";
import type { PriceResearchSource } from "../domain/priceResearch";
import { planDirectPriceImport, computeDirectPriceImportPayloadHash } from "../domain/directPriceImport";
import { recordProcessEvent } from "../db/procurement";
import { timelineActor } from "../domain/timelineActor";
import { getDb } from "../db/connection";
import { lockDirectWorkspaceForImport, findDirectPriceImport, insertDirectPriceImportTx } from "../db/directPriceImport";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "./idempotencyService";
import {
  DIRECT_DOMAIN_COPILOTS,
  type DirectProcurementWorkspace,
} from "../domain/directProcurementWorkspace";
import {
  createContractJustification, createPriceJustification,
  createGeneratedPublication, baseRequiredDocuments, createRequiredDocument,
  type PublicationKind,
} from "../domain/directProcurementJustifications";
import {
  getDirectProcurementWorkspace, upsertContractJustification, upsertPriceJustification,
  insertGeneratedPublication, insertRequiredDocument, listRequiredDocuments, getDirectProcedure,
  getContractJustification, getPriceJustification,
  getRequiredDocument, updateRequiredDocumentStatus, recordRequiredDocumentAttachment, type RequiredDocumentRow,
} from "../db/directProcurement";
import { createHash } from "crypto";
import { discardEvidenceFile, storeEvidenceFile } from "./evidenceStorageService";
import { isAllowedTaskAttachmentMime, sanitizeAttachmentFileName, validateTaskAttachment } from "../domain/taskAttachmentPolicy";
import {
  REQUIRED_DOCUMENT_MESSAGES, planRequiredDocumentStatusChange, requiredDocumentStorageKey,
  type RequiredDocumentStatus,
} from "../domain/requiredDocumentEvidence";

const DOMAIN = "contratacao_direta" as const;

export interface Recommendation {
  readonly reasoning: string;
  readonly explainability: string;
  readonly provenance: string;
  readonly confidence: number;
  readonly rejectable: true;
}

async function requireWorkspace(id: string, orgId: number): Promise<DirectProcurementWorkspace> {
  const ws = await getDirectProcurementWorkspace(id, orgId);
  if (!ws) throw new Error("Processo de contratação direta não encontrado.");
  return ws;
}

// ─── Pesquisa de Preços (REUTILIZA o Price Research Workspace) ─────────────────

/** Operação registrada na idempotência (escopo do hash de payload). */
export const DIRECT_PRICE_IMPORT_OP = "directProcurement.importPriceResearch";

export interface DirectPriceImportResult {
  /** Mantido por compatibilidade com o cliente (= importId). */
  readonly researchId: string;
  readonly importId: string;
  readonly itemCount: number;
  readonly contentHash: string;
  readonly source: string;
  /** true ⇒ o MESMO conteúdo já havia sido importado neste workspace: convergiu, nada foi escrito. */
  readonly deduplicated: boolean;
  /** true ⇒ resposta da idempotência (mesma chave + mesmo payload), sem reexecução. */
  readonly replayed: boolean;
}

function isDuplicateEntry(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && typeof e === "object" && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return true;
  }
  return false;
}

function reviveImport(raw: unknown): Omit<DirectPriceImportResult, "replayed"> {
  const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as Omit<DirectPriceImportResult, "replayed">;
  return { researchId: v.researchId, importId: v.importId, itemCount: v.itemCount, contentHash: v.contentHash, source: v.source, deduplicated: v.deduplicated };
}

/**
 * R2 / PR-04A — LEG-014 / FCC-01 — Importação GOVERNADA de pesquisa de preços na Contratação Direta.
 *
 * Contrato:
 *   - identidade EXPLÍCITA por importação (importId = f(org, workspace, contentHash)); cotações com ids
 *     escopados à importação — nunca reaproveita/sobrescreve a pesquisa ou as cotações de outra importação;
 *   - idempotência (reuso de checkIdempotency/saveIdempotencyResult/failIdempotencyKey): mesma chave +
 *     mesmo payload ⇒ converge (mesmo resultado persistido, `replayed`); mesma chave + payload diferente ⇒
 *     CONFLICT; chave em processamento ⇒ CONFLICT;
 *   - dedup governada: mesmo conteúdo (contentHash) sob NOVA chave ⇒ converge para a importação existente
 *     (`deduplicated: true`), sem escrita nem evento; conteúdo diferente ⇒ coexiste;
 *   - transação LOCAL e determinística (lock do workspace + pesquisa + cotações + evento de timeline +
 *     conclusão da chave). Nada de IA, rede, storage, e-mail ou webhook;
 *   - linhagem: fonte, importId, contentHash, correlationId e ator (evento `process_timeline` com
 *     actor = usuário autenticado, refId = importId; chave de idempotência por (org, usuário));
 *   - tenant fail-closed: workspace revalidado por (id, org) sob lock; ausente ⇒ NOT_FOUND neutro;
 *   - FAIL-CLOSED sem DB (escrita autoritativa — nunca sucesso simulado).
 */
export async function importDirectPriceResearch(params: {
  workspaceId: string;
  organizationId: number;
  source: PriceResearchSource;
  text: string;
  idempotencyKey: string;
  actorUserId: number;
  correlationId: string;
}): Promise<DirectPriceImportResult> {
  const plan = planDirectPriceImport({
    workspaceId: params.workspaceId, organizationId: params.organizationId, source: params.source,
    text: params.text, correlationId: params.correlationId,
  });
  if (plan.items.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhuma cotação reconhecida no conteúdo informado (use: descrição;qtd;un;valor[;fornecedor])." });
  }
  const payloadHash = computeDirectPriceImportPayloadHash({
    operation: DIRECT_PRICE_IMPORT_OP, organizationId: params.organizationId, workspaceId: params.workspaceId,
    source: params.source, contentHash: plan.contentHash,
  });

  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível — importação recusada (nada salvo)." });
  }

  const check = await checkIdempotency(params.idempotencyKey, params.actorUserId, params.organizationId, DIRECT_PRICE_IMPORT_OP, payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({ code: "CONFLICT", message: "Idempotency-Key reutilizada com conteúdo diferente — importação recusada." });
    }
    return { ...reviveImport(check.response), replayed: true };
  }
  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "Uma importação idêntica já está em processamento para esta chave — aguarde a conclusão." });
  }

  const key = { key: params.idempotencyKey, user: params.actorUserId, org: params.organizationId };
  const dedupResult = (existing: { importId: string; itemCount: number; source: string }): Omit<DirectPriceImportResult, "replayed"> => ({
    researchId: existing.importId, importId: existing.importId, itemCount: existing.itemCount,
    contentHash: plan.contentHash, source: existing.source, deduplicated: true,
  });

  const runTx = async (): Promise<Omit<DirectPriceImportResult, "replayed">> => {
    let result!: Omit<DirectPriceImportResult, "replayed">;
    await db.transaction(async (tx) => {
      if (!(await lockDirectWorkspaceForImport(tx, params.workspaceId, params.organizationId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Processo de contratação direta não encontrado nesta organização." });
      }
      const existing = await findDirectPriceImport(tx, plan.importId, params.organizationId, params.workspaceId);
      if (existing) {
        // Dedup governada: mesmo conteúdo já importado — converge, sem escrita/evento (nada mudou).
        result = dedupResult(existing);
      } else {
        await insertDirectPriceImportTx(tx, plan.research, plan.items);
        await recordProcessEvent({
          organizationId: params.organizationId, processId: params.workspaceId, eventType: "change",
          actor: String(params.actorUserId),
          summary: `Pesquisa de preços importada (${params.source}): ${plan.items.length} cotação(ões). importId=${plan.importId} contentHash=${plan.contentHash}`,
          refId: plan.importId, correlationId: params.correlationId.slice(0, 64),
          // evento SINGLETON por importação (id derivado do importId — nunca duplica)
          idempotencyKey: `direct_price_import:${plan.importId}`,
        }, tx);
        result = {
          researchId: plan.importId, importId: plan.importId, itemCount: plan.items.length,
          contentHash: plan.contentHash, source: params.source, deduplicated: false,
        };
      }
      await saveIdempotencyResult(key.key, key.user, key.org, result, tx);
    });
    return result;
  };

  try {
    try {
      return { ...(await runTx()), replayed: false };
    } catch (err) {
      // Corrida estrutural (mesmo conteúdo, outra chave, commit simultâneo): a PK recusou o 2º INSERT e a
      // transação fez rollback. Reexecuta UMA vez: agora a importação existe ⇒ converge (dedup).
      if (!isDuplicateEntry(err)) throw err;
      return { ...(await runTx()), replayed: false };
    }
  } catch (err) {
    await failIdempotencyKey(key.key, key.user, key.org).catch(() => {});
    throw err;
  }
}

// ─── Justificativa da Contratação (copilotos = SUGESTÃO; registro = aceite humano) ─────

/** R5 / PR-11 (SEM-021) — texto mínimo exigido nos campos centrais do registro. */
const MIN_JUSTIFICATION_CHARS = 10;
export const JUSTIFICATION_FIELDS_REQUIRED = "JUSTIFICATION_FIELDS_REQUIRED";
export const HUMAN_ACCEPTANCE_REQUIRED = "HUMAN_APPROVAL_REQUIRED";

export interface ContractJustificationSuggestion {
  readonly need: string; readonly publicInterest: string; readonly motivation: string;
  readonly legalFoundation: string; readonly benefits: string; readonly alternatives: string;
}

/**
 * R5 / PR-11 (SEM-021) — os copilotos produzem SÓ uma SUGESTÃO: nada é persistido como justificativa e nenhum
 * documento oficial é gerado aqui (antes: upsert sobre a justificativa existente + documento oficial com autor
 * "multi_copilot", sem aceite). A timeline registra apenas que uma sugestão foi gerada (sem conteúdo).
 */
export async function generateContractJustification(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
  /** R9 / SEM-076 — quem pediu a sugestão (ator da timeline). */
  actorUserId?: number;
  invoke?: (prompt: string) => Promise<string>;
}): Promise<{ suggestion: ContractJustificationSuggestion; justification: Awaited<ReturnType<typeof getContractJustification>>; recommendation: Recommendation }> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  assertKernelAccess(DOMAIN, "institutional_rag");
  assertKernelAccess(DOMAIN, "copilot_infrastructure");

  const orchestration = await orchestrateMultiCopilot({
    organizationId: params.organizationId,
    request: `Elaborar justificativa de contratação direta (${ws.procurementType}) para "${ws.object}", com fundamento ${ws.legalBasis || "a definir"} (Lei 14.133/2021).`,
    copilotTypes: DIRECT_DOMAIN_COPILOTS,
    correlationId: params.correlationId,
    invoke: params.invoke,
  });

  // Sugestão apenas com o que os copilotos produziram — nenhum texto padrão é inventado como se fosse análise.
  const suggestion: ContractJustificationSuggestion = {
    need: orchestration.consolidated.summary,
    publicInterest: "",
    motivation: orchestration.consolidated.suggestions.join(" "),
    legalFoundation: orchestration.consolidated.legalBasis.join("; "),
    benefits: orchestration.consolidated.suggestions.slice(0, 2).join(" "),
    alternatives: "",
  };
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "recommendation",
    actor: timelineActor(params.actorUserId), summary: "Sugestão de justificativa gerada pelos copilotos (não aceita; nada foi registrado).", refId: ws.id, correlationId: params.correlationId,
  });
  return {
    suggestion,
    justification: await getContractJustification(ws.id, params.organizationId),
    recommendation: {
      reasoning: orchestration.consolidated.summary,
      explainability: orchestration.consolidated.suggestions.join(" · "),
      provenance: `copilotos:${orchestration.selectedCopilots.join(",")}`,
      confidence: orchestration.consolidated.confidence,
      rejectable: true,
    },
  };
}

/**
 * R5 / PR-11 (SEM-021) — ACEITE HUMANO: a pessoa revisa (sugestão ou texto próprio) e registra a justificativa. Só
 * então a justificativa é persistida e o documento oficial é gerado, com o autor humano. Campos centrais em branco ⇒
 * recusa antes de qualquer escrita (salvar vazio nunca sobrescreve).
 */
export async function acceptContractJustification(params: {
  workspaceId: string;
  organizationId: number;
  actorUserId: number;
  fields: ContractJustificationSuggestion;
  basedOnSuggestion: boolean;
  correlationId: string;
}): Promise<{ justification: Awaited<ReturnType<typeof upsertContractJustification>> }> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  const f = Object.fromEntries(Object.entries(params.fields).map(([k, v]) => [k, String(v ?? "").trim()])) as unknown as ContractJustificationSuggestion;
  const missing = (["need", "motivation", "legalFoundation"] as const).filter((k) => f[k].length < MIN_JUSTIFICATION_CHARS);
  if (missing.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Preencha necessidade, motivação e fundamento (mín. ${MIN_JUSTIFICATION_CHARS} caracteres cada) antes de registrar; nada foi gravado (${JUSTIFICATION_FIELDS_REQUIRED}).` });
  }
  const draft = createContractJustification({
    organizationId: params.organizationId, workspaceId: ws.id, ...f, correlationId: params.correlationId,
  });
  const justification = await upsertContractJustification(draft);
  await generateOfficialDocument({
    organizationId: params.organizationId, businessDomain: DOMAIN, documentType: "justificativa_contratacao",
    origin: ws.id, title: `Justificativa da Contratação — ${ws.processNumber}`,
    content: `# Justificativa da Contratação\n\n## Necessidade\n${f.need}\n\n## Interesse público\n${f.publicInterest || "—"}\n\n## Motivação\n${f.motivation}\n\n## Fundamento\n${f.legalFoundation}\n\n## Benefícios\n${f.benefits || "—"}\n\n## Alternativas\n${f.alternatives || "—"}`,
    author: String(params.actorUserId), correlationId: params.correlationId,
    metadata: { acceptedBy: params.actorUserId, basedOnSuggestion: params.basedOnSuggestion },
  });
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "decision",
    actor: String(params.actorUserId), summary: `Justificativa da contratação registrada pelo servidor${params.basedOnSuggestion ? " (a partir de sugestão revisada)" : ""}.`, refId: draft.id, correlationId: params.correlationId,
  });
  return { justification };
}

// ─── Justificativa do Preço ───────────────────────────────────────────────────

export async function generatePriceJustification(params: {
  workspaceId: string;
  organizationId: number;
  source: "pesquisa" | "manual" | "documento";
  justification?: string;
  referenceValue?: number;
  researchId?: string;
  documentReferences?: string[];
  correlationId: string;
  /** R5 / PR-11 — aceite humano explícito do registro oficial. */
  confirmOfficial?: boolean;
  actorUserId?: number;
}): Promise<{ priceJustification: Awaited<ReturnType<typeof upsertPriceJustification>>; recommendation: Recommendation }> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  assertKernelAccess(DOMAIN, "institutional_rag");
  // R5 / PR-11 (SEM-022) — formulário vazio nunca sobrescreve nem emite documento oficial.
  if ((params.justification ?? "").trim().length < MIN_JUSTIFICATION_CHARS || !(Number(params.referenceValue) > 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Informe a fundamentação (mín. ${MIN_JUSTIFICATION_CHARS} caracteres) e um valor de referência maior que zero; nada foi gravado (${JUSTIFICATION_FIELDS_REQUIRED}).` });
  }
  if (params.confirmOfficial !== true) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Confirme explicitamente que esta é a justificativa de preço institucional antes de registrá-la; nada foi gravado (${HUMAN_ACCEPTANCE_REQUIRED}).` });
  }

  const draft = createPriceJustification({
    organizationId: params.organizationId, workspaceId: ws.id, source: params.source,
    justification: params.justification, referenceValue: params.referenceValue, researchId: params.researchId,
    documentReferences: params.documentReferences, correlationId: params.correlationId,
  });
  const priceJustification = await upsertPriceJustification(draft);

  // V1 — projeta a justificativa de PREÇO no Document Engine (pipeline ÚNICO), fiel aos dados
  // EFETIVAMENTE persistidos (fonte, valor de referência, texto). Não cria decisão jurídica autônoma
  // nem inventa informação ausente — apenas materializa o que o servidor registrou.
  const sourceLabel = draft.source === "pesquisa" ? "Pesquisa de Preços"
    : draft.source === "documento" ? "Documento de referência" : "Registro do servidor";
  await generateOfficialDocument({
    organizationId: params.organizationId, businessDomain: DOMAIN, documentType: "justificativa_preco",
    origin: ws.id, title: `Justificativa de Preço — ${ws.processNumber}`,
    content: `# Justificativa de Preço\nProcesso: ${ws.processNumber} · Objeto: ${ws.object}\nFonte: ${sourceLabel}\nValor de referência: R$ ${draft.referenceValue.toFixed(2)}\n\n## Fundamentação\n${draft.justification || "—"}\n\n> Documento gerado a partir dos dados persistidos. Revisão obrigatória pelo servidor competente.`,
    author: params.actorUserId ? String(params.actorUserId) : "sistema", correlationId: params.correlationId,
    metadata: { source: draft.source, referenceValue: draft.referenceValue, researchId: draft.researchId || null, acceptedBy: params.actorUserId ?? null },
  });

  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "change",
    actor: params.actorUserId ? String(params.actorUserId) : "sistema", summary: `Justificativa do preço registrada (${params.source}).`, refId: draft.id, correlationId: params.correlationId,
  });
  return {
    priceJustification,
    recommendation: {
      reasoning: `Preço fundamentado por ${params.source}.`,
      explainability: params.source === "pesquisa" ? "Baseado na Pesquisa de Preços do processo." : "Justificativa registrada pelo servidor.",
      provenance: params.source === "pesquisa" ? `price_research:${params.researchId ?? ""}` : "manual",
      confidence: params.source === "pesquisa" ? 0.85 : 0.6,
      rejectable: true,
    },
  };
}

// ─── Documentação Obrigatória (checklist dinâmico) ────────────────────────────

/** Semeia o checklist dinâmico conforme modalidade/fundamento (idempotente). */
export async function seedRequiredDocuments(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
}): Promise<RequiredDocumentRow[]> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  const existing = await listRequiredDocuments(ws.id, params.organizationId);
  if (existing.length > 0) return existing;
  const names = baseRequiredDocuments(ws.procurementType);
  let index = 0;
  for (const name of names) {
    const doc = createRequiredDocument({ organizationId: params.organizationId, workspaceId: ws.id, name, index: index++, correlationId: params.correlationId });
    await insertRequiredDocument(doc);
  }
  return listRequiredDocuments(ws.id, params.organizationId);
}

/**
 * R7 / PR-16 (SEM-020) — muda o status de um item do checklist SEM upload. "anexado" só via
 * `attachRequiredDocument` (upload real); "validado" exige evidência real (chave emitida pelo servidor + hash).
 * A referência nunca vem do cliente.
 */
export async function setRequiredDocumentStatus(params: {
  workspaceId: string; organizationId: number; documentId: string; status: RequiredDocumentStatus; actorUserId: number; correlationId: string;
}): Promise<RequiredDocumentRow[]> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  const doc = await getRequiredDocument(params.documentId, ws.id, params.organizationId);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento do checklist não encontrado neste processo." });
  const plan = planRequiredDocumentStatusChange(doc, ws.id, params.status);
  if (!plan.ok) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${REQUIRED_DOCUMENT_MESSAGES[plan.code]} (${plan.code})` });
  }
  await updateRequiredDocumentStatus(doc.id, ws.id, params.organizationId, plan.next, params.actorUserId);
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "change", actor: String(params.actorUserId),
    summary: `Documento obrigatório "${doc.name}" ${plan.next === "validado" ? "validado" : "pendenciado"}.`, refId: doc.id, correlationId: params.correlationId,
  });
  return listRequiredDocuments(ws.id, params.organizationId);
}

/**
 * R7 / PR-16 (SEM-020) — ANEXAR = upload REAL: valida MIME/magic-bytes/tamanho (mesma política dos anexos de tarefa),
 * grava no S3 com chave `contratacao_direta/{workspace}/{ts}-{arquivo}`, registra SHA-256/tamanho/MIME/autor. Falha de
 * persistência ⇒ compensação (remove o objeto). Cross-tenant/workspace ⇒ NOT_FOUND antes de qualquer upload.
 */
export async function attachRequiredDocument(params: {
  workspaceId: string; organizationId: number; documentId: string; fileName: string; mimeType: string; content: Buffer;
  actorUserId: number; correlationId: string;
}): Promise<{ document: RequiredDocumentRow; contentHash: string }> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  const doc = await getRequiredDocument(params.documentId, ws.id, params.organizationId);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento do checklist não encontrado neste processo." });
  if (!isAllowedTaskAttachmentMime(params.mimeType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Tipo de arquivo não permitido." });
  const validation = validateTaskAttachment(params.content, params.mimeType);
  if (!validation.valid) throw new TRPCError({ code: "BAD_REQUEST", message: validation.reason ?? "Arquivo inválido." });

  const contentHash = createHash("sha256").update(params.content).digest("hex");
  const key = requiredDocumentStorageKey(ws.id, sanitizeAttachmentFileName(params.fileName), Date.now());
  const stored = await storeEvidenceFile({ key, content: params.content, mimeType: params.mimeType });
  try {
    await recordRequiredDocumentAttachment({
      id: doc.id, workspaceId: ws.id, organizationId: params.organizationId, storageKey: stored.key, contentHash,
      sizeBytes: params.content.length, mimeType: params.mimeType, actorUserId: params.actorUserId,
    });
  } catch (e) {
    await discardEvidenceFile(stored.key);
    throw e;
  }
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "change", actor: String(params.actorUserId),
    summary: `Documento obrigatório "${doc.name}" anexado (sha256 ${contentHash.slice(0, 12)}…, ${params.content.length} bytes).`, refId: doc.id, correlationId: params.correlationId,
  });
  const document = await getRequiredDocument(doc.id, ws.id, params.organizationId);
  return { document: document!, contentHash };
}

// ─── Parecer Jurídico (REUTILIZA o Institutional Request Engine) ──────────────

/**
 * Solicita o parecer jurídico ao Business Domain Parecer Jurídico via Institutional
 * Request Engine (LEGAL_OPINION_INITIAL). NUNCA gera parecer neste módulo.
 */
export async function requestLegalOpinion(params: {
  workspaceId: string;
  organizationId: number;
  requestedBy: number;
  documents?: Array<{ documentId: string; title?: string; version?: number }>;
  correlationId: string;
}): Promise<{ requestId: string }> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  const result = await requestInstitutionalReview({
    organizationId: params.organizationId,
    sourceDomain: "contratacao_direta",
    destinationDomain: "parecer_juridico",
    requestType: "LEGAL_OPINION_INITIAL",
    referenceProcessId: ws.id,
    title: `Parecer jurídico — Contratação Direta ${ws.processNumber}`,
    description: `Análise jurídica da ${ws.procurementType} referente a "${ws.object}".`,
    priority: "alta",
    requestedBy: params.requestedBy,
    documents: params.documents,
    correlationId: params.correlationId,
  });
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "change",
    actor: String(params.requestedBy), summary: "Parecer jurídico solicitado ao domínio Parecer Jurídico.", refId: result.request.id, correlationId: params.correlationId,
  });
  return { requestId: result.request.id };
}

/**
 * Disponibiliza automaticamente o parecer retornado (sem upload/download): lê a
 * resposta institucional e as referências documentais associadas à solicitação.
 */
export async function getLegalOpinionResult(requestId: string, orgId: number): Promise<{ response: Awaited<ReturnType<typeof getResponseForRequest>>; documents: Awaited<ReturnType<typeof listDocumentReferences>> }> {
  const [response, documents] = await Promise.all([
    getResponseForRequest(requestId, orgId),
    listDocumentReferences(requestId, orgId),
  ]);
  return { response, documents };
}

// ─── Publicação (Document Engine) ─────────────────────────────────────────────

/** Gera as publicações conforme modalidade e procedimento. Reutiliza Document Engine. */
export async function generatePublications(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
}): Promise<Array<{ id: string; kind: string; title: string }>> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  assertKernelAccess(DOMAIN, "document_engine");
  const procedure = await getDirectProcedure(ws.id, params.organizationId);

  // V1 hardening — FAIL-CLOSED antes de publicar a Ratificação: exige decisão HUMANA real
  // `ratificado` persistida. Sem ratificação, ou com `nao_ratificado`, nunca se materializa um
  // `official_documents.documentType = ratificacao` (o Termo de Ratificação é ato institucional,
  // jamais texto de preenchimento). O caller não avança para PUBLICATION porque este erro propaga.
  // R4 / PR-07 — a decisão que vale é a CORRENTE do ledger append-only (0312), com autoridade declarada, data e
  // referência do ato. Linhas legadas de `ratifications` (pré-0312, sem esses dados) são histórico e NÃO bastam
  // para publicar (fail-closed: nada é fabricado a partir delas).
  const ratification = await getCurrentDecision(null, params.organizationId, "direct_procurement.ratification", ws.id);
  if (!ratification) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Publicação bloqueada: a decisão de ratificação ainda não foi registrada com a autoridade declarada, a data e a referência do ato.",
    });
  }
  if (ratification.outcome !== "ratificado") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Publicação bloqueada: a decisão registrada é "${ratification.outcome}". Somente uma ratificação "ratificado" permite publicar.`,
    });
  }

  const kinds: PublicationKind[] = ["aviso", "ratificacao", "extrato_contrato"];
  if (procedure?.procedureType === "presencial") kinds.push("instrucoes", "cronograma");

  // A Ratificação materializa a DECISÃO REAL persistida (autoridade responsável, decisão, justificativa
  // e evidências) + referências às justificativas de contratação e de preço já registradas.
  const contractJustification = await getContractJustification(ws.id, params.organizationId);
  const priceJustification = await getPriceJustification(ws.id, params.organizationId);

  const out: Array<{ id: string; kind: string; title: string }> = [];
  for (const kind of kinds) {
    const genericContent = `# ${titleForKind(kind)}\nProcesso: ${ws.processNumber} · Modalidade: ${ws.procurementType} · Fundamento: ${ws.legalBasis || "—"}\nProcedimento: ${procedure?.procedureType ?? "indefinido"}${procedure?.platform ? ` · Plataforma: ${procedure.platform}` : ""}\n\n> Documento gerado a partir do fluxo. Revisão obrigatória pelo servidor competente.`;
    const content = kind === "ratificacao"
      ? buildRatificationContent(ws, ratification, contractJustification, priceJustification)
      : genericContent;
    const pub = createGeneratedPublication({
      organizationId: params.organizationId, workspaceId: ws.id, kind,
      title: `${titleForKind(kind)} — ${ws.processNumber}`,
      content,
      correlationId: params.correlationId,
    });
    await insertGeneratedPublication(pub);
    // RC-3 — publicação oficial pelo pipeline ÚNICO (Document Engine).
    const officialType = kind === "ratificacao" ? "ratificacao" : kind === "extrato_contrato" ? "extrato_contrato" : "aviso";
    await generateOfficialDocument({
      organizationId: params.organizationId, businessDomain: DOMAIN, documentType: officialType,
      origin: ws.id, title: pub.title, content: pub.content, author: "sistema", correlationId: params.correlationId,
      metadata: { kind, modality: ws.procurementType },
    });
    out.push({ id: pub.id, kind, title: pub.title });
  }
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "decision",
    actor: "sistema", summary: `Publicações geradas: ${out.map(o => o.kind).join(", ")}.`, refId: ws.id, correlationId: params.correlationId,
  });
  return out;
}

/**
 * Materializa o Termo de Ratificação a partir da DECISÃO e justificativas REAIS persistidas pelo
 * servidor (nunca texto genérico quando há decisão registrada). Não cria decisão jurídica autônoma
 * nem inventa informação ausente: quando algo ainda não foi registrado, sinaliza a pendência.
 */
function buildRatificationContent(
  ws: { processNumber: string; procurementType: string; legalBasis: string | null; object: string },
  ratification: InstitutionalDecision | null,
  contractJustification: { need: string; legalFoundation: string } | null,
  priceJustification: { source: string; referenceValue: number; justification: string } | null,
): string {
  const lines: string[] = [
    `# Termo de Ratificação`,
    `Processo: ${ws.processNumber} · Modalidade: ${ws.procurementType} · Fundamento: ${ws.legalBasis || "—"}`,
    `Objeto: ${ws.object}`,
    ``,
  ];
  if (ratification) {
    lines.push(
      `## Decisão`,
      `Autoridade (declarada no registro): ${ratification.decidedByName} — ${ratification.decidedByRole}`,
      `Decisão: ${ratification.outcome}`,
      `Data do ato: ${ratification.decidedAt} · Referência: ${ratification.basisReference}`,
      `Registrada por (usuário id): ${ratification.recordedByUserId} · Revisão: ${ratification.revision}`,
      `> A competência da autoridade declarada não é validada pelo sistema (política jurídica pendente).`,
      ``,
      `## Justificativa da Ratificação`,
      ratification.reason || "—",
    );
    if (ratification.evidence.length > 0) {
      lines.push(``, `## Evidências`, ...ratification.evidence.map(e => `- ${e}`));
    }
  } else {
    lines.push(`> Ratificação ainda não registrada pela autoridade competente.`);
  }
  if (contractJustification) {
    lines.push(``, `## Fundamentação da Contratação`, `Necessidade: ${contractJustification.need}`, `Fundamento legal: ${contractJustification.legalFoundation}`);
  }
  if (priceJustification) {
    lines.push(``, `## Justificativa de Preço`, `Fonte: ${priceJustification.source} · Valor de referência: R$ ${priceJustification.referenceValue.toFixed(2)}`, priceJustification.justification || "—");
  }
  lines.push(``, `> Documento gerado a partir dos dados persistidos. Revisão obrigatória pelo servidor competente.`);
  return lines.join("\n");
}

function titleForKind(kind: PublicationKind): string {
  switch (kind) {
    case "aviso": return "Aviso de Contratação Direta";
    case "ratificacao": return "Termo de Ratificação";
    case "extrato_contrato": return "Extrato de Contrato";
    case "instrucoes": return "Instruções aos Interessados";
    case "cronograma": return "Cronograma";
  }
}
