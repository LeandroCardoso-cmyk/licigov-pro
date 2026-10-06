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
import {
  planDirectPriceImport, computeDirectPriceImportPayloadHash, computeDirectPriceImportContentHash, deriveDirectPriceImportId,
} from "../domain/directPriceImport";
import {
  PRICE_REFERENCE_METHODS, PRICE_METHOD_LABELS, PRICE_RESEARCH_REQUIRED, PRICE_RESEARCH_AMBIGUOUS, PRICE_RESEARCH_NOT_FOUND,
  PRICE_RESEARCH_INTEGRITY, PRICE_RESEARCH_INCONSISTENT, PRICE_METHOD_REQUIRED, PRICE_REFERENCE_DIVERGES, PRICE_LINEAGE_NOT_ALLOWED,
  summarizePriceResearch, proposalMatchesServerValue, buildResearchLineage, encodeLineage, isLineageToken, describeLineage,
  type PriceReferenceMethod, type PriceResearchSummary, type PriceLineage,
} from "../domain/directPriceReference";
import { recordProcessEvent } from "../db/procurement";
import { timelineActor } from "../domain/timelineActor";
import { getDb } from "../db/connection";
import {
  lockDirectWorkspaceForImport, findDirectPriceImport, insertDirectPriceImportTx, listDirectPriceImports, listDirectPriceImportItems,
} from "../db/directPriceImport";
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
  getContractJustification, getPriceJustification, listLinkedContractsForDirect,
  getRequiredDocument, updateRequiredDocumentStatus, recordRequiredDocumentAttachment, type RequiredDocumentRow,
} from "../db/directProcurement";
import { createHash } from "crypto";
import { discardEvidenceFile, storeEvidenceFile } from "./evidenceStorageService";
import { isAllowedTaskAttachmentMime, sanitizeAttachmentFileName, validateTaskAttachment } from "../domain/taskAttachmentPolicy";
import {
  REQUIRED_DOCUMENT_MESSAGES, planRequiredDocumentStatusChange, requiredDocumentStorageKey, checklistPublicationGate,
  CHECKLIST_NOT_CONFIGURED,
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

/** Pesquisa governada (PR-04A) verificada e resumida pelo servidor — fonte do valor de referência. */
export interface GovernedPriceResearch {
  readonly researchId: string;
  readonly contentHash: string;
  readonly importedAt: string;
  readonly importSource: string;
  readonly quoteCount: number;
  readonly summary: ReturnType<typeof summarizePriceResearch>;
}

/**
 * R9 / SEM-042 — pesquisas de preço GOVERNADAS do workspace (tenant-scoped), cada uma VERIFICADA: o contentHash é
 * recomputado das cotações persistidas e o id tem de ser o derivado dele (`deriveDirectPriceImportId`) — linhas
 * legadas ou alteradas não passam. `integrityFailed` lista ids que existem mas não verificam (recusa explícita).
 */
async function loadGovernedPriceResearches(workspaceId: string, organizationId: number): Promise<{ verified: GovernedPriceResearch[]; integrityFailed: string[] }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível — pesquisa de preços não verificada (nada salvo)." });
  const imports = await listDirectPriceImports(db, organizationId, workspaceId);
  const verified: GovernedPriceResearch[] = [];
  const integrityFailed: string[] = [];
  for (const imp of imports) {
    const items = await listDirectPriceImportItems(db, imp.importId, organizationId);
    const contentHash = computeDirectPriceImportContentHash(items);
    const governed = deriveDirectPriceImportId(organizationId, workspaceId, contentHash) === imp.importId && items.length === imp.itemCount;
    if (!governed) { integrityFailed.push(imp.importId); continue; }
    verified.push({ researchId: imp.importId, contentHash, importedAt: imp.createdAt, importSource: imp.source, quoteCount: items.length, summary: summarizePriceResearch(items) });
  }
  return { verified, integrityFailed };
}

/** Leitura para o formulário: pesquisas verificadas + estatísticas CALCULADAS PELO SERVIDOR (nada vem do cliente). */
export async function listPriceResearchesForJustification(workspaceId: string, organizationId: number): Promise<Array<{
  researchId: string; contentHash: string; importedAt: string; importSource: string; quoteCount: number;
  consistent: boolean; inconsistencyDetail: string | null; itemCount: number; minQuotesPerItem: number;
  values: PriceResearchSummary["values"] | null;
}>> {
  const { verified } = await loadGovernedPriceResearches(workspaceId, organizationId);
  return verified.map((r) => r.summary.ok
    ? { researchId: r.researchId, contentHash: r.contentHash, importedAt: r.importedAt, importSource: r.importSource, quoteCount: r.quoteCount, consistent: true, inconsistencyDetail: null, itemCount: r.summary.summary.itemCount, minQuotesPerItem: r.summary.summary.minQuotesPerItem, values: r.summary.summary.values }
    : { researchId: r.researchId, contentHash: r.contentHash, importedAt: r.importedAt, importSource: r.importSource, quoteCount: r.quoteCount, consistent: false, inconsistencyDetail: r.summary.detail, itemCount: 0, minQuotesPerItem: 0, values: null });
}

const refuse = (code: "BAD_REQUEST" | "PRECONDITION_FAILED" | "NOT_FOUND", message: string, token: string): never => {
  throw new TRPCError({ code, message: `${message} Nada foi gravado (${token}).` });
};

/**
 * R9 / SEM-042 — justificativa do PREÇO com LINHAGEM. Contrato:
 *   - source "pesquisa": o valor de referência é CALCULADO PELO SERVIDOR a partir das cotações da importação governada
 *     (PR-04A) pelo método ESCOLHIDO pela pessoa (sem método padrão); o valor do cliente é só uma PROPOSTA — se divergir
 *     do valor do servidor ⇒ recusa. Registra a linhagem (id da pesquisa, contentHash, versão do hash, nº de cotações,
 *     método, valor calculado). Sem pesquisa / ambígua / adulterada / inconsistente ⇒ recusa (zero escritas);
 *   - source "manual"/"documento": o valor é DECLARADO pela pessoa e registrado como tal (sem pesquisa vinculada; o
 *     sistema não o verifica). `researchId`/`method` não se aplicam;
 *   - nenhuma "confiança"/"Baseado na Pesquisa…" fixa: só fatos verificáveis. Sem IA neste caminho.
 * Toda recusa ocorre ANTES de qualquer escrita; escrita = justificativa + documento oficial + evento (ator humano).
 */
export async function generatePriceJustification(params: {
  workspaceId: string;
  organizationId: number;
  source: "pesquisa" | "manual" | "documento";
  justification?: string;
  /** Proposta do cliente. Para "pesquisa" é só comparada com o valor do servidor; para os demais é o valor DECLARADO. */
  referenceValue?: number;
  researchId?: string;
  /** Método escolhido pela pessoa (obrigatório para "pesquisa"). */
  method?: PriceReferenceMethod;
  documentReferences?: string[];
  correlationId: string;
  /** R5 / PR-11 — aceite humano explícito do registro oficial. */
  confirmOfficial?: boolean;
  actorUserId?: number;
}): Promise<{ priceJustification: Awaited<ReturnType<typeof upsertPriceJustification>>; lineage: PriceLineage }> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  assertKernelAccess(DOMAIN, "institutional_rag");
  // R5 / PR-11 (SEM-022) — formulário vazio nunca sobrescreve nem emite documento oficial.
  if ((params.justification ?? "").trim().length < MIN_JUSTIFICATION_CHARS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Informe a fundamentação (mín. ${MIN_JUSTIFICATION_CHARS} caracteres); nada foi gravado (${JUSTIFICATION_FIELDS_REQUIRED}).` });
  }
  if (params.source !== "pesquisa" && !(Number(params.referenceValue) > 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Informe um valor de referência maior que zero; nada foi gravado (${JUSTIFICATION_FIELDS_REQUIRED}).` });
  }
  if (params.confirmOfficial !== true) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Confirme explicitamente que esta é a justificativa de preço institucional antes de registrá-la; nada foi gravado (${HUMAN_ACCEPTANCE_REQUIRED}).` });
  }
  // A linhagem só é emitida pelo servidor: o cliente não pode forjar o token reservado nas referências documentais.
  if ((params.documentReferences ?? []).some(isLineageToken)) {
    return refuse("BAD_REQUEST", "Referência documental inválida (prefixo reservado ao sistema).", PRICE_LINEAGE_NOT_ALLOWED);
  }
  if (params.source !== "pesquisa" && (params.researchId || params.method)) {
    return refuse("BAD_REQUEST", "Pesquisa e método só se aplicam à justificativa baseada em pesquisa de preços.", PRICE_LINEAGE_NOT_ALLOWED);
  }

  let lineage: PriceLineage;
  let referenceValue: number;
  let researchId = "";
  if (params.source === "pesquisa") {
    if (!params.method || !PRICE_REFERENCE_METHODS.includes(params.method)) {
      return refuse("BAD_REQUEST", `Escolha o método de cálculo do valor de referência (${PRICE_REFERENCE_METHODS.map((m) => PRICE_METHOD_LABELS[m]).join(", ")}); o sistema não define um método padrão.`, PRICE_METHOD_REQUIRED);
    }
    const { verified, integrityFailed } = await loadGovernedPriceResearches(ws.id, params.organizationId);
    let research: GovernedPriceResearch | undefined;
    if (params.researchId) {
      research = verified.find((r) => r.researchId === params.researchId);
      if (!research) {
        if (integrityFailed.includes(params.researchId)) return refuse("PRECONDITION_FAILED", "A pesquisa de preços informada não confere com as cotações persistidas (integridade).", PRICE_RESEARCH_INTEGRITY);
        return refuse("NOT_FOUND", "Pesquisa de preços não encontrada neste processo.", PRICE_RESEARCH_NOT_FOUND);
      }
    } else if (verified.length === 0) {
      return refuse("PRECONDITION_FAILED", "Importe a pesquisa de preços deste processo antes de justificar o preço por pesquisa.", PRICE_RESEARCH_REQUIRED);
    } else if (verified.length > 1) {
      return refuse("PRECONDITION_FAILED", "Há mais de uma pesquisa de preços neste processo; informe qual delas fundamenta o preço.", PRICE_RESEARCH_AMBIGUOUS);
    } else {
      research = verified[0];
    }
    if (!research.summary.ok) {
      return refuse("PRECONDITION_FAILED", `A pesquisa de preços não permite calcular um valor (${research.summary.detail}).`, PRICE_RESEARCH_INCONSISTENT);
    }
    const serverValue = research.summary.summary.values[params.method];
    const proposed = params.referenceValue === undefined || params.referenceValue === null ? null : Number(params.referenceValue);
    if (proposed !== null && !proposalMatchesServerValue(proposed, serverValue)) {
      return refuse("PRECONDITION_FAILED", `O valor informado (R$ ${proposed.toFixed(2)}) difere do valor calculado pelo sistema a partir da pesquisa (${PRICE_METHOD_LABELS[params.method]}: R$ ${serverValue.toFixed(2)}). Para um valor diferente, registre-o como justificativa manual.`, PRICE_REFERENCE_DIVERGES);
    }
    lineage = buildResearchLineage({
      researchId: research.researchId, contentHash: research.contentHash, importedAt: research.importedAt, importSource: research.importSource,
      summary: research.summary.summary, method: params.method, proposedValue: proposed,
    });
    referenceValue = serverValue;
    researchId = research.researchId;
  } else {
    referenceValue = Number(params.referenceValue);
    lineage = { kind: "declarado", declaredValue: referenceValue, declaredByUserId: params.actorUserId ?? null };
  }

  const draft = createPriceJustification({
    organizationId: params.organizationId, workspaceId: ws.id, source: params.source,
    justification: params.justification, referenceValue, researchId,
    documentReferences: [encodeLineage(lineage), ...(params.documentReferences ?? [])], correlationId: params.correlationId,
  });
  const priceJustification = await upsertPriceJustification(draft);

  // V1 — projeta a justificativa de PREÇO no Document Engine (pipeline ÚNICO), fiel aos dados
  // EFETIVAMENTE persistidos (fonte, valor de referência, linhagem, texto). Não cria decisão jurídica autônoma
  // nem inventa informação ausente — apenas materializa o que foi registrado.
  const sourceLabel = draft.source === "pesquisa" ? "Pesquisa de Preços"
    : draft.source === "documento" ? "Documento de referência" : "Registro do servidor";
  await generateOfficialDocument({
    organizationId: params.organizationId, businessDomain: DOMAIN, documentType: "justificativa_preco",
    origin: ws.id, title: `Justificativa de Preço — ${ws.processNumber}`,
    content: `# Justificativa de Preço\nProcesso: ${ws.processNumber} · Objeto: ${ws.object}\nFonte: ${sourceLabel}\nValor de referência: R$ ${draft.referenceValue.toFixed(2)}\n\n## Origem do valor\n${describeLineage(lineage)}\n\n## Fundamentação\n${draft.justification || "—"}\n\n> Documento gerado a partir dos dados persistidos. Revisão obrigatória pelo servidor competente.`,
    author: params.actorUserId ? String(params.actorUserId) : "sistema", correlationId: params.correlationId,
    metadata: {
      source: draft.source, referenceValue: draft.referenceValue, researchId: researchId || null, acceptedBy: params.actorUserId ?? null,
      lineage: lineage.kind === "pesquisa"
        ? { kind: lineage.kind, contentHash: lineage.contentHash, hashVersion: lineage.hashVersion, quoteCount: lineage.quoteCount, method: lineage.method, computedValue: lineage.computedValue }
        : { kind: lineage.kind },
    },
  });

  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "change",
    actor: timelineActor(params.actorUserId), summary: `Justificativa do preço registrada (${params.source}). ${describeLineage(lineage)}`, refId: draft.id, correlationId: params.correlationId,
  });
  return { priceJustification, lineage };
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

export const CONTRACT_EXTRACT_NO_CONTRACT = "CONTRACT_EXTRACT_NO_CONTRACT";
export const CONTRACT_EXTRACT_AMBIGUOUS = "CONTRACT_EXTRACT_AMBIGUOUS";

export interface GeneratedPublicationsResult {
  readonly publications: Array<{ id: string; kind: string; title: string }>;
  /** "generated" = extrato gerado a partir de contrato REGISTRADO; "not_requested" = nenhum extrato foi gerado nem afirmado. */
  readonly contractExtract: "generated" | "not_requested";
}

/**
 * Gera as publicações conforme modalidade e procedimento. Reutiliza Document Engine.
 *
 * R9 / SEM-064 — o EXTRATO DE CONTRATO não é mais gerado por padrão: antes saía sempre, com texto genérico, mesmo sem
 * contrato (extrato de um contrato que não existe). Agora só com `includeContractExtract` E exatamente um contrato
 * REGISTRADO vinculado a esta contratação direta (origem `contratacao_direta`, fora de "minuta"/"arquivado", com número);
 * o conteúdo vem dos dados do contrato. Sem contrato ⇒ PRECONDITION_FAILED `CONTRACT_EXTRACT_NO_CONTRACT`; mais de um ⇒
 * `CONTRACT_EXTRACT_AMBIGUOUS` — antes de QUALQUER escrita. A publicação do aviso/ratificação não depende do contrato.
 */
export async function generatePublications(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
  /** Pede o extrato do contrato vinculado (opt-in; nunca implícito). */
  includeContractExtract?: boolean;
  /** Humano que publica (ator da timeline). */
  actorUserId?: number;
}): Promise<GeneratedPublicationsResult> {
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

  // NEW-029 — FAIL-CLOSED: o checklist configurado de documentos obrigatórios precisa estar VALIDADO (com evidência
  // real) antes de publicar. O `pending` do workspace deixou de ser só informativo.
  const checklist = checklistPublicationGate(await listRequiredDocuments(ws.id, params.organizationId), ws.id);
  if (!checklist.ok) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: checklist.code === CHECKLIST_NOT_CONFIGURED
        ? `Publicação bloqueada: o checklist de documentos obrigatórios ainda não foi configurado para este processo (${CHECKLIST_NOT_CONFIGURED}).`
        : `Publicação bloqueada: documentos obrigatórios sem validação — ${checklist.pending.join("; ")} (${checklist.code}).`,
    });
  }

  // R9 / SEM-064 — extrato só de contrato REGISTRADO (decidido ANTES de qualquer escrita).
  let contract: Awaited<ReturnType<typeof listLinkedContractsForDirect>>[number] | null = null;
  if (params.includeContractExtract) {
    const eligible = (await listLinkedContractsForDirect(params.organizationId, ws.id)).filter((c) => c.status !== "minuta" && c.contractNumber.trim() !== "");
    if (eligible.length === 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Extrato bloqueado: não há contrato registrado (fora de minuta) vinculado a esta contratação direta; nada foi gerado (${CONTRACT_EXTRACT_NO_CONTRACT}).` });
    }
    if (eligible.length > 1) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Extrato bloqueado: há mais de um contrato vinculado a esta contratação direta; nada foi gerado (${CONTRACT_EXTRACT_AMBIGUOUS}).` });
    }
    contract = eligible[0];
  }

  const kinds: PublicationKind[] = ["aviso", "ratificacao"];
  if (contract) kinds.push("extrato_contrato");
  if (procedure?.procedureType === "presencial") kinds.push("instrucoes", "cronograma");

  // A Ratificação materializa a DECISÃO REAL persistida (autoridade responsável, decisão, justificativa
  // e evidências) + referências às justificativas de contratação e de preço já registradas.
  const contractJustification = await getContractJustification(ws.id, params.organizationId);
  const priceJustification = await getPriceJustification(ws.id, params.organizationId);

  const out: Array<{ id: string; kind: string; title: string }> = [];
  const contents: string[] = [];
  for (const kind of kinds) {
    const genericContent = `# ${titleForKind(kind)}\nProcesso: ${ws.processNumber} · Modalidade: ${ws.procurementType} · Fundamento: ${ws.legalBasis || "—"}\nProcedimento: ${procedure?.procedureType ?? "indefinido"}${procedure?.platform ? ` · Plataforma: ${procedure.platform}` : ""}\n\n> Documento gerado a partir do fluxo. Revisão obrigatória pelo servidor competente.`;
    const content = kind === "ratificacao"
      ? buildRatificationContent(ws, ratification, contractJustification, priceJustification)
      : kind === "extrato_contrato" && contract
        ? buildContractExtractContent(ws, contract)
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
      metadata: { kind, modality: ws.procurementType, ...(kind === "extrato_contrato" && contract ? { contractId: contract.id } : {}) },
    });
    out.push({ id: pub.id, kind, title: pub.title });
    contents.push(`${kind}:${content}`);
  }
  // Evento SINGLETON por (decisão corrente + conteúdo publicado): o replay idêntico não duplica o evento; conteúdo
  // novo (ex.: nova revisão da ratificação) gera outro. Ator = o humano que publicou (nunca "sistema" quando há ator).
  const publishKey = createHash("sha256").update(`${ratification.id}\n${contents.join("\n")}`).digest("hex").slice(0, 32);
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "decision",
    actor: timelineActor(params.actorUserId), summary: `Publicações geradas: ${out.map(o => o.kind).join(", ")}.${contract ? " Extrato de contrato gerado a partir do contrato registrado." : " Extrato de contrato não gerado (não solicitado)."}`,
    refId: ws.id, correlationId: params.correlationId, idempotencyKey: `publish:${publishKey}`,
  });
  return { publications: out, contractExtract: contract ? "generated" : "not_requested" };
}

/** Extrato a partir dos dados do contrato REGISTRADO (nunca texto genérico; ausências aparecem como "—"). */
function buildContractExtractContent(
  ws: { processNumber: string; procurementType: string; legalBasis: string | null },
  c: { id: string; contractNumber: string; contractor: string; object: string; value: number; term: string; status: string },
): string {
  return [
    `# Extrato de Contrato`,
    `Contrato nº ${c.contractNumber} · Origem: Contratação Direta ${ws.processNumber} (${ws.procurementType}) · Fundamento: ${ws.legalBasis || "—"}`,
    `Contratado: ${c.contractor || "—"}`,
    `Objeto: ${c.object || "—"}`,
    `Valor: R$ ${c.value.toFixed(2)} · Prazo/vigência: ${c.term || "—"} · Situação no sistema: ${c.status}`,
    ``,
    `> Gerado a partir do contrato registrado (id ${c.id}). Revisão obrigatória pelo servidor competente.`,
  ].join("\n");
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
