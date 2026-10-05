/**
 * Sprint 5.1 — Procurement Process Service
 *
 * Orquestra o ciclo do Processo Licitatório e a GERAÇÃO de documentos (ETP, TR,
 * Edital) como consequência do fluxo — nunca o contrário. Toda inferência usa o
 * Kernel (RAG + copilotos) exclusivamente via kernelAccessService. Documentos são
 * rascunhos fundamentados que o servidor REVISA. Degrada graciosamente sem DB.
 */

import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { assertKernelAccess } from "./kernelAccessService";
import { generateOfficialDocument } from "./documentEngineService";
import { generateStructuredAuthoring, generateEditalAuthoring } from "./authoring/structuredAuthoringService";
import { resolveEditalSources } from "./authoring/editalContext";
import { resolveDocumentAuthoringContext, storedSourcesDigest, type CanonicalItemsState } from "./authoring/authoringContext";
import { compareSources, SOURCE_LABELS, type SourceKey } from "../domain/sourceDigests";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "./idempotencyService";
import {
  buildDFDDraft,
  createGeneratedDocument,
  defaultPresencialJustification,
  draftContentHash,
  validateEdital,
  type GeneratedDocument,
  type DocumentKind,
  type EditalModality,
  type EditalForm,
  type EditalPlatform,
} from "../domain/generatedDocument";
import { computeLineageId } from "../domain/officialDocument";
import { getDb } from "../db/connection";
import {
  recordProcessEvent, listProcessEventsByRef, listIntelligentItems, applyDraftContentMutationTx,
  getGeneratedDocumentByKind, getLatestDraftEdit, type ProcurementExecutor, type DraftEditOperation,
  type DraftExpectedState,
} from "../db/procurement";
import { timelineActor } from "../domain/timelineActor";
// PR-09 (SEM-014/SEM-009) — preservação do estado humano na regeneração + parâmetros do Edital persistidos.
import {
  classifyDraftHumanState, humanEditRefusalMessage, persistedEditalParameters, resolveEditalParameters,
  describeEditalParameters, sameEditalParameters, overlayEditalProposal, normalizeEditalText,
  officialRegenerationBlock, officialRegenerationRefusalMessage,
  type DraftHumanState, type EditalParameters,
} from "../domain/draftRegeneration";
// R5 (decisão do owner) — autoridade oficial EXISTENTE (ledger imutável da emissão governada C.4B.1).
import { getLatestOfficialPromotion, type PromotionExecutor } from "../db/officialDocumentPromotions";
// V1 PRE-PILOT CLOSURE — Fase A1: linkage de proveniência cognitiva → artefato (transacional).
import { linkProvenanceArtifact, listProvenanceByCorrelation, type ProvenanceExecutor } from "../db/cognitiveProvenance";
// Contexto Canônico da Contratação — DFD como 1º consumidor (prefill, estado por campo, reconciliação, IA).
import { serviceLogger } from "./observabilityService";
import { resolveProcurementContext, recordContextAssertions } from "./canonicalContextService";
import { generateDFDJustificationText, DFD_JUSTIFICATION_PROMPT_VERSION } from "./authoring/dfdJustificationAuthoring";
import type { NewFactAssertion } from "../db/procurementContext";
import type { ProcurementCanonicalContext } from "../domain/canonicalProcurementContext";
import { canonicalDigest } from "../domain/canonicalJson";
import {
  buildDFDPrefill, renderDFDContent, prefillMarkers, writeMarkers, readMarkers, isAssistMarker,
  computeDFDFieldStates, reconcileDFDField, applyReviewedJustification, extractDFDAssertions, summarizeFieldStates,
  parseDFD, fieldHash, linkDFDRows, unlinkedDFDRows, refreshRowLineage, DFD_FIELD_LABELS, DFD_PREFILL_VERSION,
  type DFDFieldView, type DFDFieldState, type DFDPrefill,
} from "../domain/dfdPrefill";

import {
  classifyJustificationOrigin, JUSTIFICATION_ORIGIN_LABELS, normalizeSuggestionExecutionId, suggestionTextHash,
  suggestionEventSummary, parseSuggestionEventHash, acceptanceLedgerReason, type JustificationOrigin,
} from "../domain/dfdJustificationSuggestion";

const DOMAIN = "processo_licitatorio" as const;
const log = serviceLogger("ProcurementProcessService");

// ─── C.4A — Replay-safe generation contract ───────────────────────────────────
// Toda geração documental canônica é idempotente por (org, user, idempotencyKey). O commit documental
// (generated_document + official_document + timeline + evento de processo + marcação da idempotency key
// como COMPLETED) ocorre numa ÚNICA transação → rollback = nada persistido; e é IMPOSSÍVEL o cenário
// "official commitado + idempotency failed". A cognição (rede/modelo) roda SEMPRE FORA da transação.
const GENERATE_OP = "procurement.document.generate";

/**
 * Assinatura determinística de UM item aprovado — apenas campos do domínio atual
 * (`listIntelligentItems`) que podem influenciar a geração do ETP/TR. NÃO existe CATSER no
 * domínio de itens inteligentes hoje (só CATMAT), então não é fabricado aqui.
 */
export type ApprovedItemSignature = {
  id: string;
  description?: string;
  quantity?: number;
  unit?: string;
  averagePrice?: number;
  suggestedCATMAT?: string | null;
  status?: string;
};

/**
 * Snapshot determinístico e ORDENADO dos itens aprovados: não hasheia só IDs, mas os campos
 * relevantes (descrição, quantidade, unidade, preço médio, CATMAT sugerido, status). Ordena por
 * id para independer da ordem de leitura. Assim, alterar um campo relevante de um item muda o
 * payloadHash (→ CONFLICT quando aplicável), enquanto a mera reordenação dos mesmos itens não muda.
 */
function approvedItemsSignature(items: ApprovedItemSignature[]): Array<Record<string, unknown>> {
  return items
    .map((i) => ({
      id: i.id,
      d: (i.description ?? "").trim(),
      q: i.quantity ?? null,
      u: (i.unit ?? "").trim(),
      pr: i.averagePrice ?? null,
      cm: i.suggestedCATMAT ?? null,
      st: i.status ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Hash determinístico do payload lógico (sem correlationId/timestamps/aleatórios). Coleções ordenadas. */
export function generatePayloadHash(p: {
  organizationId: number; processId: string; kind: DocumentKind; object: string;
  approvedItems?: ApprovedItemSignature[]; modality?: string; form?: string; platform?: string | null;
  /** P0 Edital — digest das FONTES reaproveitadas (DFD/ETP/TR/itens/parâmetros): mudança de fonte muda o
   *  payload (retry técnico com as MESMAS fontes replaya; fonte alterada sob a mesma chave → CONFLICT). */
  sourcesDigest?: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      op: GENERATE_OP,
      o: p.organizationId,
      p: p.processId,
      k: p.kind,
      obj: (p.object ?? "").trim(),
      items: approvedItemsSignature(p.approvedItems ?? []),
      m: p.modality ?? null,
      f: p.form ?? null,
      pl: p.platform ?? null,
      src: p.sourcesDigest ?? null,
    }))
    .digest("hex");
}

/**
 * C.4A — Correspondência de LINHAGEM determinística (pura, testável, SEM nova coluna neste fase).
 * Formaliza o mapeamento (org + processId + kind) → identidade do generated_document → identidade
 * de linhagem do official_document. Reutiliza EXATAMENTE as mesmas primitivas do pipeline
 * (createGeneratedDocument para o id do rascunho; computeLineageId para a linhagem oficial) — não
 * há segunda fórmula que possa divergir. A reconciliação física é C.4B; aqui apenas o contrato.
 */
export function canonicalDocumentIdentity(p: {
  organizationId: number; processId: string; kind: DocumentKind;
}): { generatedId: string; lineageId: string } {
  const generatedId = createGeneratedDocument({
    organizationId: p.organizationId, processId: p.processId, kind: p.kind,
    title: "", correlationId: "identity", // id NÃO depende de title/correlationId — só de (org, processId, kind)
  }).id;
  const lineageId = computeLineageId({
    tenantId: p.organizationId, businessDomain: DOMAIN, documentType: p.kind, origin: p.processId,
  });
  return { generatedId, lineageId };
}

/**
 * Executa uma operação de geração documental de forma replay-safe. `produce` roda a parte cognitiva/
 * determinística FORA da transação e devolve `{ persist, response }`; `persist(tx)` grava todos os
 * efeitos documentais na transação; `saveIdempotencyResult` marca a chave COMPLETED na MESMA transação.
 * Replay (mesma chave+payload) → resposta cacheada, sem reexecutar cognição/persistência.
 */
async function runReplaySafeGeneration<T>(
  ctx: { organizationId: number; actorUserId: number; idempotencyKey: string; payloadHash: string },
  reviveCached: (raw: unknown) => T,
  // C.4B.3A — `persist` retorna o SNAPSHOT CANÔNICO persistido (usado como resposta E cache da
  // idempotência, na MESMA transação). `response` é apenas o fallback de degradação sem DB.
  produce: () => Promise<{ persist: (tx: ProcurementExecutor) => Promise<T>; response: T }>,
): Promise<{ result: T; replayed: boolean }> {
  const check = await checkIdempotency(ctx.idempotencyKey, ctx.actorUserId, ctx.organizationId, GENERATE_OP, ctx.payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({ code: "CONFLICT", message: "Idempotency-Key reutilizada com payload diferente — geração recusada." });
    }
    return { result: reviveCached(check.response), replayed: true };
  }
  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "Geração idêntica já está em processamento para esta chave — aguarde a conclusão." });
  }
  // status "new" ou "failed": executa (cognição fora da transação; persistência atômica dentro).
  try {
    const { persist, response } = await produce();
    const db = await getDb();
    if (!db) return { result: response, replayed: false }; // sem DB: degrada sem persistir (nem idempotência)
    let result: T = response;
    await db.transaction(async (tx) => {
      result = await persist(tx); // snapshot canônico persistido
      await saveIdempotencyResult(ctx.idempotencyKey, ctx.actorUserId, ctx.organizationId, result, tx);
    });
    return { result, replayed: false };
  } catch (err) {
    await failIdempotencyKey(ctx.idempotencyKey, ctx.actorUserId, ctx.organizationId);
    throw err;
  }
}

/** Normaliza a resposta cacheada da idempotência: objeto no MySQL 8 (JSON nativo), string no MariaDB
 *  (JSON = LONGTEXT). Garante que o replay reproduza o snapshot canônico em ambos. */
function reviveIdempotent<T>(raw: unknown): T {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
}

// ─── Contexto Canônico → DFD ─────────────────────────────────────────────────────────────

const DFD_BASE_SOURCE = "estrutura:art_12_par_1_lei_14133";

/** Marcadores que indicam conteúdo que NÃO foi posto pelo sistema (edição humana, importação, IA). */
function dfdHasNonSystemContent(sources: readonly string[]): boolean {
  return sources.some((s) => s === "edicao_manual" || s === "edicao_humana" || s === "origem:import" || s.startsWith("ai:"));
}

/** DFD aprovado nunca é alterado silenciosamente (nem por prefill, reconciliação, IA ou regeneração). */
function assertDFDMutable(doc: { status: string } | null): void {
  if (doc && doc.status === "aprovado") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DFD_APPROVED: o DFD aprovado não pode ser alterado por esta operação.",
    });
  }
}

/**
 * Resolve o contexto de forma TOLERANTE para os fluxos históricos (criar/salvar DFD): indisponibilidade
 * do contexto NUNCA bloqueia o DFD — degrada para o comportamento anterior (template só com o objeto).
 * Ações que DEPENDEM do contexto (reconciliar, IA) usam a resolução estrita.
 */
async function resolveContextSoft(p: { organizationId: number; processId: string; correlationId: string }): Promise<ProcurementCanonicalContext | null> {
  try {
    return await resolveProcurementContext(p);
  } catch (err) {
    log.warn("canonical_context_unavailable", {
      organizationId: p.organizationId, processId: p.processId, correlationId: p.correlationId,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    });
    return null;
  }
}

function withContextMarkers(sources: readonly string[], ctx: ProcurementCanonicalContext): string[] {
  const mk = readMarkers(sources);
  mk.contextDigest = ctx.digest.slice(0, 16);
  mk.contextVersion = ctx.version;
  return writeMarkers(sources, mk);
}

/**
 * "Criar DFD do zero": estrutura um RASCUNHO editável do DFD (art. 12, §1º) e persiste como documento
 * canônico (kind "dfd", status "rascunho"). Contexto Canônico: o MESMO template é PRÉ-PREENCHIDO
 * deterministicamente com o que o processo já sabe (unidade, responsável, itens e quantidades previstas,
 * planejamento, estimativa derivada) — sem IA para fatos; a origem de cada campo fica nos marcadores
 * `sources` (ctx/ctxdigest/ctxv/pf). Supervisão humana: sempre rascunho. Idempotente (id determinístico
 * + digest do contexto no payload). Regeneração NUNCA sobrescreve edição humana/importação/IA.
 */
export async function generateDFDDraft(params: {
  organizationId: number; processId: string; object: string; correlationId: string;
  idempotencyKey: string; actorUserId: number;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  const ctx = await resolveContextSoft(params);
  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: "dfd", object: params.object,
    // Contexto consumido entra no payload: retry com o MESMO contexto replaya; contexto diferente sob a
    // mesma chave → CONFLICT (nunca devolve um DFD montado com contexto antigo).
    sourcesDigest: ctx ? `${DFD_PREFILL_VERSION}:${ctx.digest}` : undefined,
  });
  const { result, replayed } = await runReplaySafeGeneration<GeneratedDocument>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    reviveIdempotent,
    async () => {
      // Estado de partida (sentinel explícito de ausência) revalidado sob lock na persistência.
      const before = await getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd");
      assertDFDMutable(before);
      if (before && dfdHasNonSystemContent(before.sources ?? [])) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "DFD_HAS_HUMAN_CONTENT: o DFD já contém edição humana, importação ou rascunho de IA — a regeneração não sobrescreve. Use \"Atualizar no rascunho\" campo a campo.",
        });
      }
      const expectedState = before ? { type: "present" as const, contentHash: draftContentHash(before.content) } : { type: "absent" as const };
      let content: string;
      let sources: string[];
      if (ctx) {
        const prefill = buildDFDPrefill(ctx);
        const withObject = { ...prefill, object: prefill.object ?? (params.object.trim() || null) };
        content = renderDFDContent(withObject);
        sources = writeMarkers([DFD_BASE_SOURCE], prefillMarkers(withObject));
      } else {
        content = buildDFDDraft(params.object);
        sources = [DFD_BASE_SOURCE];
      }
      const doc = createGeneratedDocument({
        processId: params.processId, organizationId: params.organizationId,
        kind: "dfd", title: `DFD — ${params.object}`,
        content, sources,
        authorUserId: params.actorUserId,
        lastSubstantiveActorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });
      const prefilledCount = Object.keys(readMarkers(sources).prefill).length;
      return {
        response: doc,
        persist: async (tx) => {
          // Criação/regeneração DETERMINÍSTICA do DFD (template, SEM IA) — proveniência: author =
          // originador; último ator substantivo = solicitante. Ledger dfd_regenerate (nunca ai_*).
          const { document } = await applyDraftContentMutationTx(tx, {
            organizationId: params.organizationId, processId: params.processId, kind: "dfd",
            actorUserId: params.actorUserId, doc, operation: "dfd_regenerate",
            expectedState, idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
          });
          await recordProcessEvent({
            organizationId: params.organizationId, processId: params.processId, eventType: "change",
            actor: "sistema",
            summary: prefilledCount > 0
              ? `DFD criado (rascunho estruturado, ${prefilledCount} campo(s) pré-preenchido(s) a partir do processo).`
              : "DFD criado (rascunho estruturado).",
            refId: doc.id, correlationId: params.correlationId,
          }, tx);
          if (ctx) {
            // Auditoria/métrica: SÓ contagens e digest (nunca conteúdo).
            log.info("dfd_prefill_generated", {
              organizationId: params.organizationId, processId: params.processId, correlationId: params.correlationId,
              actorUserId: params.actorUserId, documentId: doc.id, contextVersion: ctx.version,
              contextDigest: ctx.digest.slice(0, 16), prefilledFields: prefilledCount,
              knownFields: ctx.stats.knownFields, unknownFields: ctx.stats.unknownFields,
              conflictCount: ctx.stats.conflictCount, items: ctx.items.length,
            });
          }
          return document;
        },
      };
    },
  );
  return { document: result, replayed };
}

// C.4B.3A/C.4B.3B — operações de EDIÇÃO governada (idempotency op por tipo de write).
const DFD_SAVE_OP = "procurement.dfd.save";       // edição manual do DFD (C.4B.3A)
const DRAFT_EDIT_OP = "procurement.draft.edit";   // edição humana de ETP/TR/Edital (C.4B.3B)

/**
 * C.4B.3A/C.4B.3B — Runner ÚNICO de WRITE GOVERNADO de conteúdo do rascunho (DFD save + human edit de
 * ETP/TR/Edital compartilham o MESMO contrato institucional, sem duplicação):
 *   - ator humano/organização SEMPRE do ctx (nunca do cliente); concorrência otimista
 *     (expectedContentHash revalidado SOB LOCK via applyDraftContentMutationTx);
 *   - PRESERVA o originador (author_user_id) e a correlação de ORIGEM; último ator substantivo e ledger
 *     append-only só em mudança MATERIAL (no-op = sem ledger/last actor);
 *   - FAIL-CLOSED sem DB (nunca sucesso simulado); idempotência (replay/CONFLICT) reusando o serviço;
 *   - retorna o SNAPSHOT CANÔNICO persistido (resposta = cache da idempotência = estado de generated_documents).
 */
async function runGovernedDraftEdit(p: {
  op: string; operation: DraftEditOperation; timelineSummary: string;
  organizationId: number; processId: string; kind: DocumentKind;
  title: string; sources: string[]; content: string;
  actorUserId: number; expectedContentHash: string; idempotencyKey: string; correlationId: string;
  /** Efeitos adicionais na MESMA transação, só quando houve mudança material (ex.: fatos do DFD). */
  afterPersist?: (tx: ProcurementExecutor, document: GeneratedDocument) => Promise<void>;
  /** Linhagem da edição gravada no ledger (`generated_document_edits.reason`) — ex.: aceite de sugestão de IA. */
  reason?: string;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  const payloadHash = createHash("sha256").update(JSON.stringify({
    op: p.op, o: p.organizationId, pr: p.processId, k: p.kind,
    exp: p.expectedContentHash, h: draftContentHash(p.content),
  })).digest("hex");

  const doc = createGeneratedDocument({
    processId: p.processId, organizationId: p.organizationId, kind: p.kind,
    title: p.title, content: p.content, sources: p.sources, correlationId: p.correlationId,
  });

  const check = await checkIdempotency(p.idempotencyKey, p.actorUserId, p.organizationId, p.op, payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({ code: "CONFLICT", message: "Idempotency-Key reutilizada com conteúdo diferente — edição recusada." });
    }
    return { document: reviveIdempotent<GeneratedDocument>(check.response), replayed: true };
  }
  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "Uma edição idêntica já está em processamento para esta chave — aguarde a conclusão." });
  }

  // Fail-closed: sem persistência não há save/ledger/proveniência/idempotência — NUNCA sucesso simulado.
  const db = await getDb();
  if (!db) {
    await failIdempotencyKey(p.idempotencyKey, p.actorUserId, p.organizationId).catch(() => {});
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível — edição recusada (nada salvo)." });
  }

  try {
    // Edição exige rascunho EXISTENTE cujo hash corresponda ao carregado (estado de partida sob lock).
    const expectedState = { type: "present" as const, contentHash: p.expectedContentHash };
    let persisted!: GeneratedDocument;
    await db.transaction(async (tx) => {
      const { changed, document } = await applyDraftContentMutationTx(tx, {
        organizationId: p.organizationId, processId: p.processId, kind: p.kind,
        actorUserId: p.actorUserId, doc, operation: p.operation,
        expectedState, idempotencyKey: p.idempotencyKey, correlationId: p.correlationId, reason: p.reason ?? null,
      });
      persisted = document;
      // NO-OP (changed=false): sem ledger/último-ator (garantido pelo primitive) E sem timeline de
      // edição — não fabrica proveniência falsa. A idempotência conclui e o snapshot canônico é retornado.
      if (changed) {
        await recordProcessEvent({
          organizationId: p.organizationId, processId: p.processId, eventType: "change",
          actor: String(p.actorUserId), summary: p.timelineSummary, refId: doc.id, correlationId: p.correlationId,
        }, tx);
        if (p.afterPersist) await p.afterPersist(tx, document);
      }
      // Cacheia o SNAPSHOT CANÔNICO (originador preservado) — resposta = cache = estado persistido.
      await saveIdempotencyResult(p.idempotencyKey, p.actorUserId, p.organizationId, persisted, tx);
    });
    return { document: persisted, replayed: false };
  } catch (err) {
    await failIdempotencyKey(p.idempotencyKey, p.actorUserId, p.organizationId);
    throw err;
  }
}

/**
 * C.4B.3A — Edição MANUAL governada do rascunho de DFD (operation = dfd_manual_edit). DFD permanece
 * fora do lifecycle de emissão. Fino wrapper sobre o runner governado comum.
 *
 * Contexto Canônico: preserva os marcadores de linhagem por campo; o que o servidor INFORMOU/ALTEROU nos
 * campos afirmáveis (unidade, responsável, planejamento, prioridade, prazo, itens e quantidade PREVISTA)
 * vira afirmação `dfd`/confirmed no ledger do contexto — na MESMA transação do save (tudo-ou-nada) — com
 * `basisValueHash` = o valor que o humano viu (superação consciente; divergência posterior = conflito).
 */
export async function saveDFDDraft(params: {
  organizationId: number; processId: string; object: string; content: string;
  actorUserId: number; expectedContentHash: string; idempotencyKey: string; correlationId: string;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  const existing = await getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd");
  assertDFDMutable(existing);
  const previousSources = existing?.sources ?? [];
  let sources = ["edicao_manual", ...previousSources.filter(isAssistMarker)];
  const ctx = await resolveContextSoft(params);

  let facts: NewFactAssertion[] = [];
  let overridden: Array<{ field: string; beforeHash: string; afterHash: string; previousOrigin: string }> = [];
  let changedFields: string[] = [];
  if (ctx) {
    const { generatedId } = canonicalDocumentIdentity({ organizationId: params.organizationId, processId: params.processId, kind: "dfd" });
    const version = draftContentHash(params.content).slice(0, 64);
    facts = extractDFDAssertions(params.content, sources, ctx).map((d) => ({
      path: d.path, value: d.value, sourceType: "dfd" as const, sourceId: generatedId, sourceVersion: version,
      status: "confirmed" as const, actorUserId: params.actorUserId, basisValueHash: d.basisValueHash,
    }));
    ({ overridden, changedFields } = diffDFDFields(existing?.content ?? "", params.content, previousSources, buildDFDPrefill(ctx).items));
    // A linha editada pelo servidor continua sendo o MESMO Item Canônico: regrava a linhagem (pr:).
    sources = refreshRowLineage(params.content, sources, buildDFDPrefill(ctx).items);
  }
  const labels = changedFields.map((k) => DFD_FIELD_LABELS[k] ?? (k.startsWith("item:") ? "quantidade prevista" : k));
  return runGovernedDraftEdit({
    op: DFD_SAVE_OP, operation: "dfd_manual_edit",
    timelineSummary: changedFields.length
      ? `DFD salvo (rascunho). Campos informados/alterados pelo servidor: ${[...new Set(labels)].join(", ")}.`
      : "DFD salvo (rascunho).",
    organizationId: params.organizationId, processId: params.processId, kind: "dfd",
    title: `DFD — ${params.object}`, sources, content: params.content,
    actorUserId: params.actorUserId, expectedContentHash: params.expectedContentHash,
    idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
    afterPersist: ctx ? async (tx) => {
      if (facts.length) {
        await recordContextAssertions({
          organizationId: params.organizationId, processId: params.processId, correlationId: params.correlationId,
          facts, executor: tx,
        });
      }
      if (overridden.length) {
        // Override humano PRESERVADO e auditável: antes/depois (hash), origem anterior, ator, correlação.
        // O conteúdo integral anterior fica no ledger (generated_document_edits.previous_content).
        log.info("dfd_field_overridden", {
          organizationId: params.organizationId, processId: params.processId, correlationId: params.correlationId,
          actorUserId: params.actorUserId, fields: overridden.slice(0, 50),
        });
      }
    } : undefined,
  });
}

/** Campos cujo valor mudou entre dois conteúdos do DFD; "overridden" = o anterior era do sistema/IA. */
function diffDFDFields(before: string, after: string, previousSources: readonly string[], items: DFDPrefill["items"]): {
  changedFields: string[]; overridden: Array<{ field: string; beforeHash: string; afterHash: string; previousOrigin: string }>;
} {
  const a = parseDFD(before);
  const b = parseDFD(after);
  const mk = readMarkers(previousSources);
  // Linhagem persistida (canonicalItemId) do documento anterior liga as linhas dos dois lados.
  const qty = (p: ReturnType<typeof parseDFD>) => Object.fromEntries(
    linkDFDRows(p, items, previousSources).filter((l) => l.itemId !== null).map((l) => [`item:${l.itemId}`, l.row.quantity]));
  const av: Record<string, string | number | null> = { ...a.values, ...qty(a) };
  const bv: Record<string, string | number | null> = { ...b.values, ...qty(b) };
  const changedFields: string[] = [];
  const overridden: Array<{ field: string; beforeHash: string; afterHash: string; previousOrigin: string }> = [];
  for (const k of [...new Set([...Object.keys(av), ...Object.keys(bv)])].sort()) {
    const bh = fieldHash(av[k] ?? null);
    const ah = fieldHash(bv[k] ?? null);
    if (bh === ah || bv[k] === null || bv[k] === undefined) continue;
    changedFields.push(k);
    const prior = mk.ai[k] && mk.ai[k].hash === bh ? "ai_draft" : mk.prefill[k] && mk.prefill[k].hash === bh ? mk.prefill[k].origin : null;
    if (prior) overridden.push({ field: k, beforeHash: bh, afterHash: ah, previousOrigin: prior });
  }
  return { changedFields, overridden };
}

// ─── Contexto Canônico: estado assistido, reconciliação explícita e rascunho de IA do DFD ─────────

export interface DFDAssistState {
  /** false = contexto indisponível (o DFD segue funcionando como antes). */
  available: boolean;
  contextVersion: number | null;
  contextDigest: string | null;
  /** Versão/digest do contexto consumido pelo documento (marcadores gravados). */
  consumedContextVersion: number | null;
  consumedContextDigest: string | null;
  /** Algum campo pré-preenchido ficou desatualizado ou há informação nova disponível. */
  stale: boolean;
  fields: DFDFieldView[];
  summary: Record<DFDFieldState, number>;
  context: { knownFields: number; unknownFields: number; conflictCount: number; items: number } | null;
  aiDraft: { justification: { executionId: string; contextDigest: string } | null };
  /** Linhas da tabela do DFD sem Item Canônico correspondente (podem ser preparadas em Itens da contratação). */
  unlinkedItemRows: number;
}

/** Read-only: estado por campo do DFD = f(conteúdo salvo, marcadores, contexto ATUAL). Nada é gravado. */
export async function getDFDAssistState(params: {
  organizationId: number; processId: string; correlationId: string;
}): Promise<DFDAssistState> {
  const doc = await getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd");
  const ctx = await resolveContextSoft(params);
  const empty = { prefilled: 0, ai_draft: 0, user_modified: 0, stale: 0, conflict: 0, available: 0, unknown: 0 };
  const mk = readMarkers(doc?.sources ?? []);
  if (!ctx) {
    return {
      available: false, contextVersion: null, contextDigest: null,
      consumedContextVersion: mk.contextVersion, consumedContextDigest: mk.contextDigest,
      stale: false, fields: [], summary: empty, context: null, aiDraft: { justification: mk.ai.justificativa ?? null },
      unlinkedItemRows: 0,
    };
  }
  const prefillNow = buildDFDPrefill(ctx);
  const fields = doc ? computeDFDFieldStates(doc.content, doc.sources ?? [], prefillNow) : [];
  const summary = summarizeFieldStates(fields);
  const stale = summary.stale > 0 || summary.available > 0;
  if (doc && stale) {
    log.info("document_context_stale", {
      organizationId: params.organizationId, processId: params.processId, correlationId: params.correlationId,
      documentKind: "dfd", staleFields: summary.stale, availableFields: summary.available,
      conflictFields: summary.conflict, contextVersion: ctx.version, consumedContextVersion: mk.contextVersion,
    });
  }
  return {
    available: true, contextVersion: ctx.version, contextDigest: ctx.digest.slice(0, 16),
    consumedContextVersion: mk.contextVersion, consumedContextDigest: mk.contextDigest,
    stale, fields, summary,
    context: { knownFields: ctx.stats.knownFields, unknownFields: ctx.stats.unknownFields, conflictCount: ctx.stats.conflictCount, items: ctx.items.length },
    aiDraft: { justification: mk.ai.justificativa ?? null },
    unlinkedItemRows: doc ? unlinkedDFDRows(doc.content, doc.sources ?? [], prefillNow).length : 0,
  };
}

const DFD_RECONCILE_OP = "procurement.dfd.reconcile";

/**
 * "Atualizar no rascunho" — aplica, por AÇÃO EXPLÍCITA do servidor, o valor ATUAL do contexto a UM campo
 * do DFD (nenhum outro campo é tocado). Governado como qualquer edição: concorrência otimista, ledger
 * (`dfd_context_reconcile`, com conteúdo anterior), idempotência, timeline. Nunca em DFD aprovado.
 */
export async function reconcileDFDFieldDraft(params: {
  organizationId: number; processId: string; object: string; fieldKey: string;
  actorUserId: number; expectedContentHash: string; idempotencyKey: string; correlationId: string;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  const existing = await getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd");
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "DFD inexistente — crie o DFD antes de atualizar campos." });
  assertDFDMutable(existing);
  const ctx = await resolveProcurementContext(params);
  const prefill = buildDFDPrefill(ctx);
  const view = computeDFDFieldStates(existing.content, existing.sources ?? [], prefill).find((f) => f.key === params.fieldKey);
  if (!view || !view.reconcilable) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FIELD_NOT_RECONCILABLE: não há informação de origem atualizada para este campo." });
  }
  const next = reconcileDFDField(existing.content, existing.sources ?? [], params.fieldKey, prefill);
  if (!next) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FIELD_NOT_RECONCILABLE: não há informação de origem atualizada para este campo." });
  }
  const result = await runGovernedDraftEdit({
    op: DFD_RECONCILE_OP, operation: "dfd_context_reconcile",
    timelineSummary: `DFD: campo "${view.label}" atualizado a partir da informação de origem (ação explícita).`,
    organizationId: params.organizationId, processId: params.processId, kind: "dfd",
    title: existing.title || `DFD — ${params.object}`, sources: withContextMarkers(next.sources, ctx), content: next.content,
    actorUserId: params.actorUserId, expectedContentHash: params.expectedContentHash,
    idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
  });
  log.info("document_context_reconciled", {
    organizationId: params.organizationId, processId: params.processId, correlationId: params.correlationId,
    actorUserId: params.actorUserId, documentKind: "dfd", field: params.fieldKey, previousState: view.state,
    // Proveniência da substituição SEM conteúdo integral: origem aplicada + hashes antes/depois do campo.
    sourceType: view.contextOrigin, beforeHash: fieldHash(view.documentValue), afterHash: fieldHash(view.contextValue),
    contextVersion: ctx.version, contextDigest: ctx.digest.slice(0, 16), replayed: result.replayed,
  });
  return result;
}

export interface DFDAIDraftExplanation {
  field: "justificativa";
  executionId: string;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  contextVersion: number;
  contextDigest: string;
  inputDigest: string;
  unverifiedNumbers: string[];
  actorUserId: number;
  correlationId: string;
  generatedAt: string;
}

/** SEM-058 — o que está HOJE na seção 2, com a origem, para ser exibido ao lado da sugestão. */
export interface DFDJustificationCurrent {
  text: string | null;
  origin: JustificationOrigin;
  originLabel: string;
  /** Hash do conteúdo do DFD a que o aceite fica vinculado (CAS). */
  contentHash: string;
}

export interface DFDJustificationSuggestion {
  /** Texto SUGERIDO (já com as marcas [REVISAR: …]). Nada disto foi gravado no DFD. */
  suggestion: { text: string; textHash: string };
  explanation: DFDAIDraftExplanation;
  current: DFDJustificationCurrent;
}

async function describeCurrentJustification(
  scope: { organizationId: number; processId: string }, doc: NonNullable<CanonicalDraftRow>, ctx: ProcurementCanonicalContext,
): Promise<DFDJustificationCurrent> {
  const view = computeDFDFieldStates(doc.content, doc.sources ?? [], buildDFDPrefill(ctx)).find((f) => f.key === "justificativa");
  const contentHash = draftContentHash(doc.content);
  const lastEdit = await getLatestDraftEdit(scope.processId, scope.organizationId, "dfd");
  const origin = classifyJustificationOrigin({
    documentValue: view?.documentValue ?? null, state: view?.state ?? "unknown", sources: doc.sources ?? [], lastEdit, contentHash,
  });
  return { text: view?.documentValue ?? null, origin, originLabel: JUSTIFICATION_ORIGIN_LABELS[origin], contentHash };
}

/**
 * SEM-058 — SUGESTÃO supervisionada de IA para a "Justificativa da necessidade" (seção 2). A IA é só uma sugestão:
 * esta operação NÃO altera o DFD (nenhum documento, ledger de edição ou marcador é escrito); devolve a sugestão
 * junto do texto ATUAL e da sua origem. O texto só entra no DFD por `acceptDFDJustificationSuggestion` (aceite humano
 * explícito). IA exclusivamente via AIExecutionEngine (dfdJustificationAuthoring), contexto GOVERNADO, FORA de
 * transação. Replay-safe (idempotência da geração + do Engine). A timeline registra só que uma sugestão foi gerada
 * (com o hash do texto, que ancora o aceite posterior).
 */
export async function generateDFDJustificationDraft(params: {
  organizationId: number; processId: string; object: string;
  actorUserId: number; expectedContentHash: string;
  idempotencyKey: string; correlationId: string;
  /** Seam determinístico (testes) — substitui a chamada ao Engine; proveniência deixa de ser obrigatória. */
  invoke?: (prompt: string) => Promise<string>;
}): Promise<DFDJustificationSuggestion & { replayed: boolean }> {
  const existing = await getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd");
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "DFD inexistente — crie o DFD antes de gerar a sugestão da justificativa." });
  assertDFDMutable(existing);
  const ctx = await resolveProcurementContext(params);
  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: "dfd", object: params.object,
    sourcesDigest: canonicalDigest({
      op: "dfd_ai_justification_suggestion", pv: DFD_JUSTIFICATION_PROMPT_VERSION, ctx: ctx.digest, exp: params.expectedContentHash,
    }),
  });

  const { result, replayed } = await runReplaySafeGeneration<DFDJustificationSuggestion>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    reviveIdempotent,
    async () => {
      // Pré-condição ANTES da cognição: a sugestão é comparada com o texto que o servidor está vendo.
      if (draftContentHash(existing.content) !== params.expectedContentHash) {
        throw new TRPCError({ code: "CONFLICT", message: "O rascunho mudou desde o carregamento — recarregue antes de gerar." });
      }
      // Cognição FORA da transação, via AIExecutionEngine (ou seam).
      const draft = await generateDFDJustificationText({
        organizationId: params.organizationId, processId: params.processId, ctx,
        correlationId: params.correlationId, actorUserId: params.actorUserId,
        idempotencyKey: params.idempotencyKey, invoke: params.invoke,
      });
      if (!draft.text.trim()) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "A IA não produziu uma sugestão utilizável — nada foi alterado." });
      }
      // Cognição real ⇒ proveniência obrigatória (fail-closed: sem rastro da execução não há sugestão aceitável).
      if (params.invoke === undefined && (await listProvenanceByCorrelation(params.organizationId, params.correlationId)).length === 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Proveniência cognitiva obrigatória ausente para esta geração — operação abortada (fail-closed)." });
      }
      const current = await describeCurrentJustification(params, existing, ctx);
      const executionId = normalizeSuggestionExecutionId(draft.executionId) || "exec";
      const textHash = suggestionTextHash(draft.text);
      const out: DFDJustificationSuggestion = {
        suggestion: { text: draft.text, textHash },
        explanation: {
          field: "justificativa", executionId, provider: draft.provider, model: draft.model,
          promptVersion: draft.promptVersion, contextVersion: ctx.version, contextDigest: ctx.digest.slice(0, 16),
          inputDigest: draft.inputDigest.slice(0, 16), unverifiedNumbers: draft.unverifiedNumbers,
          actorUserId: params.actorUserId, correlationId: params.correlationId, generatedAt: new Date().toISOString(),
        },
        current,
      };
      return {
        response: out,
        persist: async (tx) => {
          await recordProcessEvent({
            organizationId: params.organizationId, processId: params.processId, eventType: "recommendation",
            actor: String(params.actorUserId), summary: suggestionEventSummary(executionId, textHash),
            refId: executionId, correlationId: params.correlationId,
          }, tx);
          log.info("dfd_ai_suggestion_generated", {
            organizationId: params.organizationId, processId: params.processId, correlationId: params.correlationId,
            actorUserId: params.actorUserId, field: "justificativa", executionId, provider: draft.provider, model: draft.model,
            promptVersion: draft.promptVersion, contextVersion: ctx.version, contextDigest: ctx.digest.slice(0, 16),
            inputDigest: draft.inputDigest.slice(0, 16), unverifiedNumbers: draft.unverifiedNumbers.length,
            currentOrigin: current.origin, engineReplayed: draft.replayed, persisted: false,
          });
          return out;
        },
      };
    },
  );
  return { ...result, replayed };
}

const DFD_AI_ACCEPT_OP = "procurement.dfd.ai_accept";
const MIN_ACCEPTED_JUSTIFICATION_CHARS = 10;

/**
 * SEM-058 — ACEITE HUMANO da sugestão de IA para a justificativa do DFD: o único caminho que grava o texto da IA.
 *   - exige uma sugestão realmente gerada neste processo/órgão (evento de timeline do servidor ancorado pelo id da
 *     execução; outro órgão/processo ⇒ NOT_FOUND) e vincula o aceite ao conteúdo que o servidor viu (CAS por hash);
 *   - o texto aceito pode ser editado antes do aceite (`edited` quando o hash difere do da sugestão): sem edição mantém
 *     o marcador `ai:` (linhagem), com edição vira texto humano — sem inventar proveniência;
 *   - governado como qualquer edição do DFD (runner comum): lock + concorrência otimista, ledger com o TEXTO ANTERIOR
 *     (`previous_content`) e a linhagem (`reason`: execução, origem anterior, ator da sugestão), ator = o humano
 *     (`user:<id>`, nunca copiloto), idempotência, timeline; vínculo da proveniência cognitiva ao DFD na mesma transação;
 *   - NÃO chama IA (a cognição ocorreu na geração). Nunca em DFD aprovado.
 */
export async function acceptDFDJustificationSuggestion(params: {
  organizationId: number; processId: string; object: string;
  actorUserId: number; expectedContentHash: string; text: string; suggestionExecutionId: string;
  idempotencyKey: string; correlationId: string;
}): Promise<{ document: GeneratedDocument; replayed: boolean; edited: boolean; previousOrigin: JustificationOrigin | null }> {
  const existing = await getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd");
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "DFD inexistente — não há o que aceitar." });
  assertDFDMutable(existing);
  const text = params.text.trim();
  if (text.length < MIN_ACCEPTED_JUSTIFICATION_CHARS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Informe a justificativa (mín. ${MIN_ACCEPTED_JUSTIFICATION_CHARS} caracteres) — nada foi gravado (JUSTIFICATION_TEXT_REQUIRED).` });
  }
  // A sugestão precisa existir NESTE órgão e processo (o evento é escrito pelo servidor na geração).
  const executionId = normalizeSuggestionExecutionId(params.suggestionExecutionId);
  const event = (await listProcessEventsByRef(params.processId, params.organizationId, "recommendation", executionId))
    .find((e) => parseSuggestionEventHash(e.summary) !== null);
  if (!executionId || !event) {
    throw new TRPCError({ code: "NOT_FOUND", message: "SUGGESTION_NOT_FOUND: a sugestão informada não existe neste processo — gere uma nova sugestão." });
  }
  const eventHash = parseSuggestionEventHash(event.summary)!;
  const edited = suggestionTextHash(text) !== eventHash;
  const ctx = await resolveProcurementContext(params);
  const corr = event.correlationId;
  const hasProvenance = corr ? (await listProvenanceByCorrelation(params.organizationId, corr)).length > 0 : false;
  if (!hasProvenance && !executionId.startsWith("seam-")) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SUGGESTION_PROVENANCE_MISSING: a execução de IA desta sugestão não tem proveniência registrada — gere uma nova sugestão." });
  }
  const previous = await describeCurrentJustification(params, existing, ctx);
  const applied = applyReviewedJustification(existing.content, existing.sources ?? [], text, edited ? null : { executionId, contextDigest: ctx.digest });
  // CAS: o aceite só vale para o conteúdo que o servidor comparou. Exceção: conteúdo JÁ igual ao resultado do aceite
  // (retry/replay da mesma operação) segue para o runner, que devolve o snapshot idempotente; com chave nova o CAS
  // sob lock do runner recusa (CONFLICT) — nunca uma segunda gravação.
  const currentHash = draftContentHash(existing.content);
  if (currentHash !== params.expectedContentHash && currentHash !== draftContentHash(applied.content)) {
    throw new TRPCError({ code: "CONFLICT", message: "O rascunho mudou desde que a sugestão foi comparada — gere/compare novamente antes de aceitar." });
  }
  const result = await runGovernedDraftEdit({
    op: DFD_AI_ACCEPT_OP, operation: "dfd_ai_accept",
    timelineSummary: `DFD: justificativa da necessidade registrada pelo servidor a partir de sugestão de IA${edited ? " editada" : ""} (aceite explícito; texto anterior — ${previous.originLabel} — preservado no histórico; execução ${executionId.slice(0, 24)}).`,
    organizationId: params.organizationId, processId: params.processId, kind: "dfd",
    title: existing.title || `DFD — ${params.object}`, sources: withContextMarkers(applied.sources, ctx), content: applied.content,
    actorUserId: params.actorUserId, expectedContentHash: params.expectedContentHash,
    idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
    reason: acceptanceLedgerReason({ executionId, edited, previousOrigin: previous.origin, suggestionTextHash: eventHash, suggestionActor: event.actor }),
    afterPersist: async (tx, document) => {
      if (corr) {
        await linkProvenanceArtifact(tx as unknown as ProvenanceExecutor, {
          organizationId: params.organizationId, correlationId: corr, artifactKind: "dfd", artifactId: document.id,
        });
      }
      log.info("dfd_ai_suggestion_accepted", {
        organizationId: params.organizationId, processId: params.processId, correlationId: params.correlationId,
        actorUserId: params.actorUserId, documentId: document.id, field: "justificativa", executionId, edited,
        previousOrigin: previous.origin, suggestionActor: event.actor, suggestionCorrelationId: corr,
      });
    },
  });
  // Em replay o texto anterior já não é o vigente: a origem anterior só é informada na execução original (ledger).
  return { ...result, edited, previousOrigin: result.replayed ? null : previous.origin };
}

/**
 * C.4B.3B — Edição HUMANA governada do rascunho canônico de ETP/TR/Edital (operation = human_edit).
 * MESMO contrato institucional do saveDFD (via runner comum): concorrência otimista sob lock, originador
 * preservado, último ator substantivo, ledger com previousContent, idempotência, fail-closed, snapshot
 * canônico. NÃO emite/aprova — apenas atualiza o working draft; a emissão governada (C.4B.1) segue
 * intacta e a SoD (C.4B.3A) usa o lastSubstantiveActor atualizado. Rascunho ausente → NOT_FOUND.
 */
export async function saveReviewableDraft(params: {
  organizationId: number; processId: string; kind: "etp" | "tr" | "edital"; content: string;
  actorUserId: number; expectedContentHash: string; idempotencyKey: string; correlationId: string;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  // Carrega o draft canônico (existência + título PRESERVADO). Nunca cria por esta via.
  const existing = await getGeneratedDocumentByKind(params.processId, params.organizationId, params.kind);
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Rascunho inexistente — gere o documento antes de editar." });
  }
  return runGovernedDraftEdit({
    op: DRAFT_EDIT_OP, operation: "human_edit", timelineSummary: `${params.kind.toUpperCase()} editado (rascunho).`,
    organizationId: params.organizationId, processId: params.processId, kind: params.kind,
    title: existing.title, sources: ["edicao_humana"], content: params.content,
    actorUserId: params.actorUserId, expectedContentHash: params.expectedContentHash,
    idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
  });
}

/**
 * PR-09 (SEM-014) — Estado de PARTIDA da regeneração de ETP/TR/Edital, resolvido ANTES de qualquer reserva de
 * idempotência ou cognição (recusa ⇒ zero chamadas de IA, zero writes):
 *   - `expectedContentHash` (opcional) = o hash que o humano VIU; divergente do vigente ⇒ CONFLICT (a
 *     confirmação vale só para o conteúdo exibido); também vira o estado esperado revalidado SOB LOCK;
 *   - conteúdo vigente com trabalho HUMANO (ledger/sources) sem `confirmReplace: true` ⇒ CONFLICT
 *     `HUMAN_EDIT_WOULD_BE_OVERWRITTEN`. Com confirmação, a regeneração segue e o conteúdo humano anterior
 *     fica recuperável no ledger (`generated_document_edits.previous_content`, operação ai_regenerate).
 */
type CanonicalDraftRow = Awaited<ReturnType<typeof getGeneratedDocumentByKind>>;

/**
 * R5 (decisão do owner) — documento APROVADO (status do rascunho) ou com versão OFICIAL emitida (ledger
 * `official_document_promotions`) NÃO é regenerado diretamente, nem com `confirmReplace`: recusa governada
 * PRECONDITION_FAILED `OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE`. Chamado ANTES de qualquer reserva de
 * idempotência, cognição ou write (recusa ⇒ zero efeitos) e revalidado DENTRO da transação de persistência
 * (fecha a janela em que uma emissão concorrente conclua durante a cognição — rollback total).
 */
async function assertRegenerationNotOfficial(p: {
  organizationId: number; processId: string; kind: "etp" | "tr" | "edital"; correlationId: string; actorUserId: number;
  draft: { status?: string | null } | null; executor?: PromotionExecutor;
}): Promise<void> {
  const latest = await getLatestOfficialPromotion(p.organizationId, p.processId, p.kind, p.executor);
  const block = officialRegenerationBlock(p.draft, latest);
  if (!block) return;
  log.warn("draft_regeneration_refused_official", {
    organizationId: p.organizationId, processId: p.processId, correlationId: p.correlationId,
    actorUserId: p.actorUserId, documentKind: p.kind, reason: block.reason, officialVersion: block.officialVersion,
  });
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: officialRegenerationRefusalMessage(p.kind, block) });
}

async function resolveRegenerationBaseline(p: {
  organizationId: number; processId: string; kind: "etp" | "tr" | "edital"; correlationId: string;
  actorUserId: number; confirmReplace?: boolean; expectedContentHash?: string;
  /** Rascunho já lido pelo chamador (evita segunda leitura); ausente ⇒ lido aqui. */
  preloaded?: { before: CanonicalDraftRow };
}): Promise<{ expectedState: DraftExpectedState; humanState: DraftHumanState }> {
  const before = p.preloaded ? p.preloaded.before : await getGeneratedDocumentByKind(p.processId, p.organizationId, p.kind);
  const currentHash = before ? draftContentHash(before.content) : null;
  if (p.expectedContentHash !== undefined && p.expectedContentHash !== currentHash) {
    throw new TRPCError({ code: "CONFLICT", message: "O rascunho mudou desde o carregamento — recarregue e revise antes de regenerar." });
  }
  let humanState: DraftHumanState = { human: false };
  if (before && before.content.trim()) {
    humanState = classifyDraftHumanState(before, await getLatestDraftEdit(p.processId, p.organizationId, p.kind));
    const refusal = humanEditRefusalMessage(p.kind, humanState, p.confirmReplace);
    if (refusal) {
      log.warn("draft_regeneration_refused_human_content", {
        organizationId: p.organizationId, processId: p.processId, correlationId: p.correlationId,
        actorUserId: p.actorUserId, documentKind: p.kind,
        reason: humanState.human ? humanState.reason : null, operation: humanState.human ? humanState.operation : null,
      });
      throw new TRPCError({ code: "CONFLICT", message: refusal });
    }
  }
  const expectedState: DraftExpectedState = before
    ? { type: "present", contentHash: p.expectedContentHash ?? currentHash! }
    : { type: "absent" };
  return { expectedState, humanState };
}

/** Motivo gravado no ledger quando a regeneração substitui conteúdo humano por confirmação explícita. */
function replaceReason(state: DraftHumanState): string | null {
  return state.human ? `confirm_replace:${state.reason}${state.operation ? `:${state.operation}` : ""}` : null;
}

/**
 * A2 — Gera um documento (ETP/TR) a partir do fluxo, via AUTORIA ESTRUTURADA com GROUNDING REAL:
 * recupera evidência do corpus institucional (fontes vigentes), fundamenta as seções nas exigências
 * legais reais da Lei 14.133/2021, alimenta a proveniência A1 com `EvidenceRef[]` reais e consolida um
 * rascunho estruturado, bounded e validado (Zod). O DFD permanece determinístico (path próprio).
 */
export async function generateDocument(params: {
  organizationId: number;
  processId: string;
  kind: "etp" | "tr";
  object: string;
  correlationId: string;
  idempotencyKey: string;
  actorUserId: number;
  /** PR-09 — confirmação EXPLÍCITA para substituir conteúdo humano (edição/importação). Opcional. */
  confirmReplace?: boolean;
  /** PR-09 — hash do rascunho que o humano viu (opcional; divergente ⇒ CONFLICT). */
  expectedContentHash?: string;
  invoke?: (prompt: string) => Promise<string>;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  // Regra de arquitetura: acesso ao Kernel só via kernelAccessService.
  assertKernelAccess(DOMAIN, "institutional_rag");
  assertKernelAccess(DOMAIN, "copilot_infrastructure");

  // R5 — documento APROVADO/OFICIAL não é regenerado diretamente (nem com confirmReplace): 1ª verificação,
  // antes de montar contexto, reservar idempotência ou chamar a IA.
  const beforeDraft = await getGeneratedDocumentByKind(params.processId, params.organizationId, params.kind);
  await assertRegenerationNotOfficial({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind,
    correlationId: params.correlationId, actorUserId: params.actorUserId, draft: beforeDraft,
  });

  const items = await listIntelligentItems(params.processId, params.organizationId);
  const approved = items.filter(i => i.status === "aprovado");

  // P0 piloto — CONTEXTO REAL de autoria (DFD/ETP/itens aprovados/cotações/classificação confirmada),
  // tenant-scoped. O digest das fontes entra no payloadHash: retry com as MESMAS fontes replaya; fonte
  // alterada sob a mesma chave → CONFLICT (nunca devolve um documento gerado com contexto antigo).
  const sourceContext = await resolveDocumentAuthoringContext({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind, object: params.object,
  });

  // Contexto Canônico — TR com Itens da contratação: FAIL-CLOSED antes de qualquer reserva de idempotência
  // ou cognição (guarda compartilhada com o Edital). O ETP NÃO bloqueia: exibe "[a definir]" e nunca usa a
  // quantidade da Pesquisa.
  if (params.kind === "tr") {
    assertCanonicalQuantitiesComplete("tr", sourceContext.canonical, params, sourceContext.legacyQuotedItemCount);
  }

  // Assinatura determinística dos itens aprovados (campos relevantes, não só IDs) → alterar um item
  // aprovado relevante muda o payloadHash e, sob a mesma chave, resulta em CONFLICT. No modo canônico o
  // `sourcesDigest` já inclui a quantidade PREVISTA de cada item.
  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind,
    object: params.object, approvedItems: approved, sourcesDigest: sourceContext.sourcesDigest,
  });

  // C.4B.3A + PR-09 — estado de PARTIDA capturado ANTES da idempotência e da cognição (sentinel de ausência
  // explícito). Conteúdo humano sem `confirmReplace` ⇒ recusa aqui (zero IA, zero writes). Se o rascunho
  // mudar enquanto a IA executa, a revalidação sob lock recusa (CONFLICT) e NÃO sobrescreve.
  const { expectedState, humanState } = await resolveRegenerationBaseline({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind,
    correlationId: params.correlationId, actorUserId: params.actorUserId,
    confirmReplace: params.confirmReplace, expectedContentHash: params.expectedContentHash,
    preloaded: { before: beforeDraft },
  });

  const { result, replayed } = await runReplaySafeGeneration<GeneratedDocument>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    reviveIdempotent,
    async () => {

      // A2 — AUTORIA ESTRUTURADA com GROUNDING REAL. Cognição SEMPRE fora da transação (rede/modelo).
      // Recupera evidência REAL do corpus institucional, alimenta a proveniência A1 com EvidenceRef[]
      // reais e produz um rascunho estruturado (Zod, bounded) fundamentado nas exigências legais reais
      // (ETP: art. 18, §1º; TR: art. 6º, XXIII da Lei 14.133/2021). Fail-closed em estrutura inválida.
      const authoring = await generateStructuredAuthoring({
        organizationId: params.organizationId,
        kind: params.kind,
        object: params.object,
        correlationId: params.correlationId,
        actorUserId: params.actorUserId,
        invoke: params.invoke,
        sourceContext,
      });
      const content = authoring.content;

      const doc = createGeneratedDocument({
        organizationId: params.organizationId,
        processId: params.processId,
        kind: params.kind,
        title: `${params.kind.toUpperCase()} — ${params.object}`,
        content,
        sources: [
          `itens_aprovados:${approved.length}`,
          `grounding:${authoring.groundingState}`,
          `evidencias:${authoring.evidences.length}`,
          ...sourceContext.lineageMarkers,
        ],
        authorUserId: params.actorUserId,
        lastSubstantiveActorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });

      return {
        response: doc,
        persist: async (tx) => {
          // R5 — revalidação na MESMA transação: emissão oficial concluída durante a cognição ⇒ rollback total.
          await assertRegenerationNotOfficial({
            organizationId: params.organizationId, processId: params.processId, kind: params.kind,
            correlationId: params.correlationId, actorUserId: params.actorUserId, draft: beforeDraft, executor: tx,
          });
          // C.4B.3A — mutação governada: cria (author = originador) ou regenera (preserva originador,
          // último ator substantivo = solicitante, ledger ai_regenerate) com revalidação sob lock.
          const { document } = await applyDraftContentMutationTx(tx, {
            organizationId: params.organizationId, processId: params.processId, kind: params.kind,
            actorUserId: params.actorUserId, doc, operation: "ai_regenerate",
            expectedState, idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
            reason: replaceReason(humanState),
          });
          // RC-3 — documento oficial pelo pipeline ÚNICO (Document Engine), na MESMA transação.
          const official = await generateOfficialDocument({
            organizationId: params.organizationId, businessDomain: DOMAIN, documentType: params.kind,
            origin: params.processId, title: doc.title, content, author: "structured_authoring", correlationId: params.correlationId,
            metadata: {
              approvedItems: approved.length,
              groundingState: authoring.groundingState,
              evidenceCount: authoring.evidences.length,
              evidenceComplete: authoring.evidenceComplete,
              evidenceFingerprint: authoring.evidenceFingerprint,
              corpusFingerprint: authoring.corpusFingerprint,
              usedSources: authoring.structured.usedSourceIds,
              // P0 piloto — lineage do contexto de autoria (fontes do processo + números autoritativos).
              sourcesDigest: sourceContext.sourcesDigest,
              sourceVersions: sourceContext.sourceVersions,
              contextUsedSources: sourceContext.usedSources,
              contextMissing: sourceContext.missing,
              estimatedGlobalTotalCents: sourceContext.estimate.globalTotalCents,
              quoteCount: sourceContext.estimate.quoteCount,
            },
          }, tx);
          // A1 — LINKAGE de proveniência cognitiva → artefato de trabalho (generated_document) + documento
          // oficial materializado + linhagem, na MESMA transação (atomicidade). Escopado ao tenant e à
          // correlação. FAIL-CLOSED: quando houve cognição REAL (sem injeção de `invoke`), a proveniência é
          // OBRIGATÓRIA — se ZERO linhas forem vinculadas (proveniência ausente), aborta a transação; nada é
          // persistido (generated_document/official_document/idempotency COMPLETED fazem rollback juntos).
          const { linked } = await linkProvenanceArtifact(tx as unknown as ProvenanceExecutor, {
            organizationId: params.organizationId, correlationId: params.correlationId,
            artifactKind: params.kind, artifactId: document.id,
            officialDocumentId: official.id, officialLineageId: official.lineageId,
          });
          const provenanceMandatory = params.invoke === undefined; // cognição real (sem seam determinístico)
          if (provenanceMandatory && linked === 0) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Proveniência cognitiva obrigatória ausente para esta geração — operação abortada (fail-closed).",
            });
          }
          await recordProcessEvent({
            organizationId: params.organizationId, processId: params.processId, eventType: "recommendation",
            actor: timelineActor(params.actorUserId),
            summary: `${params.kind.toUpperCase()} gerado (rascunho) com base no processo — fontes: ${sourceContext.usedSources.join(", ") || "objeto"}${sourceContext.missing.length ? ` · pendências: ${sourceContext.missing.join(", ")}` : ""}.${humanState.human ? " Substituiu conteúdo humano por confirmação explícita (anterior preservado no histórico)." : ""}`,
            refId: doc.id, correlationId: params.correlationId,
          }, tx);
          return document; // snapshot canônico (originador preservado em regeneração)
        },
      };
    },
  );
  return { document: result, replayed };
}

/**
 * Guarda COMPARTILHADA (TR e Edital) do modo canônico, antes de qualquer reserva de idempotência ou cognição:
 * nunca substitui a quantidade PREVISTA ausente pela da cotação, nem assume 1, nem presume que um Item
 * Inteligente sem vínculo represente a necessidade (nenhum vínculo é criado aqui). Legado (sem Itens da
 * contratação) ⇒ `canonical = null` ⇒ no-op.
 */
/** R6 / PR-13 (SEM-008) — código estável do bloqueio "quantidade da cotação sem Itens da contratação". */
export const CANONICAL_ITEMS_REQUIRED = "CANONICAL_ITEMS_REQUIRED";

function assertCanonicalQuantitiesComplete(
  documentKind: "tr" | "edital",
  canonical: CanonicalItemsState | null,
  ids: { organizationId: number; processId: string; correlationId: string },
  legacyQuotedItemCount = 0,
): void {
  const docName = documentKind === "tr" ? "o Termo de Referência" : "o Edital";
  if (!canonical) {
    // R6 / PR-13 (SEM-008, INV-09) — sem Itens da contratação, a única quantidade disponível é a da COTAÇÃO
    // (evidência), que nunca afirma a necessidade. Fail-closed ANTES de qualquer reserva/cognição; sem itens
    // aprovados não há quantidade alguma a afirmar (o documento não traz quadro quantitativo).
    if (legacyQuotedItemCount > 0) {
      log.warn("document_generation_blocked_quoted_quantity_without_items", {
        organizationId: ids.organizationId, processId: ids.processId, correlationId: ids.correlationId,
        documentKind, quotedItemCount: legacyQuotedItemCount,
      });
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${CANONICAL_ITEMS_REQUIRED}: cadastre os "Itens da contratação" com a quantidade prevista antes de gerar ${docName}. A quantidade da cotação (${legacyQuotedItemCount} item(ns) da Pesquisa de Preços) é evidência de preço e não representa a necessidade.`,
      });
    }
    return;
  }
  const { missingPlannedQuantity, unlinkedApprovedItemCount } = canonical;
  if (missingPlannedQuantity.length > 0) {
    log.warn("document_generation_blocked_missing_planned_quantity", {
      organizationId: ids.organizationId, processId: ids.processId, correlationId: ids.correlationId,
      documentKind, missingItemCount: missingPlannedQuantity.length,
    });
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `PLANNED_QUANTITY_REQUIRED: ${documentKind === "tr" ? "Defina a quantidade prevista do item antes de gerar o Termo de Referência." : "Defina a quantidade prevista dos itens antes de gerar o Edital."} (${missingPlannedQuantity.length} item(ns) sem quantidade prevista em "Itens da contratação").`,
    });
  }
  if (unlinkedApprovedItemCount > 0) {
    log.warn("document_generation_blocked_unlinked_price_research_items", {
      organizationId: ids.organizationId, processId: ids.processId, correlationId: ids.correlationId,
      documentKind, unlinkedItemCount: unlinkedApprovedItemCount,
    });
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `PRICE_RESEARCH_ITEM_UNLINKED: ${unlinkedApprovedItemCount} item(ns) aprovado(s) da Pesquisa de Preços não estão em "Itens da contratação". Prepare-os ou associe-os antes de gerar ${docName}.`,
    });
  }
}

/**
 * P0 — Gera o Edital após o TR, REAPROVEITANDO o contexto do processo (DFD/ETP/TR/itens/parâmetros) e
 * produzindo uma minuta ESTRUTURADA e fundamentada pelo Kernel cognitivo (AIExecutionEngine + RAG
 * governado), no MESMO pipeline replay-safe do ETP/TR. Presencial exige justificativa legal automática;
 * eletrônico exige plataforma. Valida modalidade/forma/plataforma ANTES de reservar idempotência.
 * Fail-closed: sem provider real (cognição real) a proveniência é obrigatória; falha não deixa rascunho falso.
 */
export async function generateNotice(params: {
  organizationId: number;
  processId: string;
  object: string;
  /**
   * PR-09 (SEM-009) — PROPOSTA de parâmetros (opcional). Os parâmetros EFETIVOS são os PERSISTIDOS no
   * rascunho canônico do Edital (leitura no servidor); proposta divergente exige `confirmParameterChange`;
   * sem persistidos, a proposta completa é a 1ª decisão humana; ausência ⇒ EDITAL_PARAMETERS_REQUIRED.
   */
  modality?: EditalModality;
  form?: EditalForm;
  platform?: EditalPlatform;
  /**
   * PR-09 / R5 (0311) — PROPOSTA de critério de julgamento / regime de execução (texto; opcional). Persistidos
   * no rascunho canônico como os demais parâmetros; ausentes ⇒ mantêm o persistido (ou NULL = [REVISAR]).
   */
  judgmentCriterion?: string;
  executionRegime?: string;
  confirmParameterChange?: boolean;
  /** PR-09 (SEM-014) — confirmação explícita para substituir conteúdo humano do Edital. */
  confirmReplace?: boolean;
  /** PR-09 — hash do rascunho que o humano viu (opcional; divergente ⇒ CONFLICT). */
  expectedContentHash?: string;
  correlationId: string;
  idempotencyKey: string;
  actorUserId: number;
  /** Seam determinístico (testes): OUTPUT ESTRUTURADO do provider (JSON) sem chamar o Engine. */
  invoke?: (prompt: string) => Promise<string>;
}): Promise<{ document: GeneratedDocument; validation: { valid: boolean; violations: string[] }; replayed: boolean }> {
  // Acesso cognitivo governado (RAG + copilotos + document engine) exclusivamente via kernelAccessService.
  assertKernelAccess(DOMAIN, "institutional_rag");
  assertKernelAccess(DOMAIN, "copilot_infrastructure");
  assertKernelAccess(DOMAIN, "document_engine");

  // PR-09 (SEM-009) — parâmetros EFETIVOS lidos no SERVIDOR a partir do rascunho canônico persistido
  // (decisão humana por processo). Nunca um padrão da UI: ausência ⇒ recusa; divergência ⇒ troca explícita.
  const beforeEdital = await getGeneratedDocumentByKind(params.processId, params.organizationId, "edital");
  // R5 — Edital APROVADO/OFICIAL não é regenerado diretamente (nem com confirmReplace/troca de parâmetros):
  // 1ª verificação, antes de resolver parâmetros, reservar idempotência ou chamar a IA.
  await assertRegenerationNotOfficial({
    organizationId: params.organizationId, processId: params.processId, kind: "edital",
    correlationId: params.correlationId, actorUserId: params.actorUserId, draft: beforeEdital,
  });
  const resolution = resolveEditalParameters({
    persisted: persistedEditalParameters(beforeEdital),
    proposed: {
      modality: params.modality, form: params.form, platform: params.platform,
      judgmentCriterion: params.judgmentCriterion, executionRegime: params.executionRegime,
    },
    confirmParameterChange: params.confirmParameterChange,
  });
  if (!resolution.ok) {
    log.warn("edital_generation_refused_parameters", {
      organizationId: params.organizationId, processId: params.processId, correlationId: params.correlationId,
      actorUserId: params.actorUserId, code: resolution.code,
      persisted: resolution.persisted ? describeEditalParameters(resolution.persisted) : null,
      proposed: resolution.proposed ? describeEditalParameters(resolution.proposed) : null,
    });
    throw new TRPCError({ code: resolution.code, message: resolution.message });
  }
  const { modality, form, platform, judgmentCriterion, executionRegime } = resolution.params;
  const legalJustification = form === "presencial" ? defaultPresencialJustification(modality) : "";

  // Validação de parâmetros (modalidade/forma/plataforma/justificativa) ANTES de qualquer efeito/cognição.
  // Edital inválido: nenhum efeito, nenhuma reserva de idempotência, nenhuma chamada ao provider.
  const prelim = createGeneratedDocument({
    organizationId: params.organizationId, processId: params.processId, kind: "edital",
    title: `Edital — ${params.object}`, content: "",
    modality, form, platform, legalJustification,
    correlationId: params.correlationId,
  });
  const validation = validateEdital(prelim);
  if (!validation.valid) {
    return { document: prelim, validation, replayed: false };
  }

  // C.4B.3A + PR-09 (SEM-014) — estado de partida (revalidado sob lock) + recusa de sobrescrita de conteúdo
  // humano sem `confirmReplace`, ANTES de qualquer reserva de idempotência ou cognição.
  const { expectedState: expectedStateEdital, humanState } = await resolveRegenerationBaseline({
    organizationId: params.organizationId, processId: params.processId, kind: "edital",
    correlationId: params.correlationId, actorUserId: params.actorUserId,
    confirmReplace: params.confirmReplace, expectedContentHash: params.expectedContentHash,
    preloaded: { before: beforeEdital },
  });

  // Reaproveitamento canônico do contexto (TENANT-SCOPED): DFD/ETP/TR/itens/parâmetros do processo.
  // PR-09 / R5 — critério de julgamento / regime de execução PERSISTIDOS entram no contexto (NULL ⇒ [REVISAR]).
  const sourceContext = await resolveEditalSources({
    organizationId: params.organizationId, processId: params.processId, object: params.object,
    modality, form, platform, criterioJulgamento: judgmentCriterion, regimeContratacao: executionRegime,
  });
  // Modo canônico (Itens da contratação): Edital nunca sai com quantidade da Pesquisa por fallback.
  assertCanonicalQuantitiesComplete("edital", sourceContext.canonical, params, sourceContext.legacyQuotedItemCount);

  // Replay-safe: o digest das FONTES entra no payload → retry técnico com as MESMAS fontes replaya; fonte
  // alterada sob a MESMA chave → CONFLICT (não cria duas versões independentes).
  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: "edital",
    object: params.object, modality, form, platform,
    sourcesDigest: sourceContext.sourcesDigest,
  });

  const { result, replayed } = await runReplaySafeGeneration<{ document: GeneratedDocument; validation: { valid: boolean; violations: string[] } }>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    reviveIdempotent,
    async () => {
      // Cognição SEMPRE fora da transação (rede/modelo): autoria estruturada do Edital com reaproveitamento
      // de contexto + grounding por evidência (RAG governado). Fail-closed em structured output inválido.
      const authoring = await generateEditalAuthoring({
        organizationId: params.organizationId, object: params.object,
        modality, form, platform,
        sourceContext, correlationId: params.correlationId, actorUserId: params.actorUserId,
        invoke: params.invoke,
      });

      const doc = createGeneratedDocument({
        organizationId: params.organizationId, processId: params.processId, kind: "edital",
        title: `Edital — ${params.object}`, content: authoring.content,
        // Lineage/explicabilidade nas `sources` (consumidas por reviewableDraft: grounding:… / evidencias:…).
        // R9 / SEM-039 — sem o antigo marcador fixo "tr_aprovado": a autoridade REAL do TR consumido (emitido vN /
        // aprovado / rascunho) vem em `autoridade:tr=…` dentro de `sourceContext.lineageMarkers`.
        sources: [
          `grounding:${authoring.groundingState}`,
          `evidencias:${authoring.evidences.length}`,
          ...sourceContext.lineageMarkers,
        ],
        modality, form, platform, legalJustification, judgmentCriterion, executionRegime,
        authorUserId: params.actorUserId, lastSubstantiveActorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });

      return {
        response: { document: doc, validation },
        persist: async (tx) => {
          // R5 — revalidação na MESMA transação: emissão oficial concluída durante a cognição ⇒ rollback total.
          await assertRegenerationNotOfficial({
            organizationId: params.organizationId, processId: params.processId, kind: "edital",
            correlationId: params.correlationId, actorUserId: params.actorUserId, draft: beforeEdital, executor: tx,
          });
          const { document } = await applyDraftContentMutationTx(tx, {
            organizationId: params.organizationId, processId: params.processId, kind: "edital",
            actorUserId: params.actorUserId, doc, operation: "ai_regenerate",
            expectedState: expectedStateEdital, idempotencyKey: params.idempotencyKey,
            correlationId: params.correlationId, reason: replaceReason(humanState),
          });
          // RC-3 — documento oficial pelo pipeline ÚNICO (Document Engine), na MESMA transação. Metadata
          // carrega o LINEAGE completo (parâmetros + fundamentação + versões das fontes) para explainability/replay.
          const official = await generateOfficialDocument({
            organizationId: params.organizationId, businessDomain: DOMAIN, documentType: "edital",
            origin: params.processId, title: doc.title, content: doc.content, author: "structured_authoring",
            correlationId: params.correlationId,
            metadata: {
              modality, form, platform, judgmentCriterion, executionRegime, parametersSource: resolution.source,
              groundingState: authoring.groundingState,
              evidenceCount: authoring.evidences.length,
              evidenceComplete: authoring.evidenceComplete,
              evidenceFingerprint: authoring.evidenceFingerprint,
              corpusFingerprint: authoring.corpusFingerprint,
              usedSources: authoring.structured.usedSourceIds,
              sourcesDigest: sourceContext.sourcesDigest,
              sourceVersions: sourceContext.sourceVersions,
              contextUsedSources: sourceContext.usedSources,
              contextMissing: sourceContext.missing,
            },
          }, tx);
          // A1 — LINKAGE de proveniência cognitiva → artefato + oficial + linhagem (MESMA transação).
          // FAIL-CLOSED: cognição real (sem seam `invoke`) exige proveniência; ZERO linhas → aborta tudo.
          const { linked } = await linkProvenanceArtifact(tx as unknown as ProvenanceExecutor, {
            organizationId: params.organizationId, correlationId: params.correlationId,
            artifactKind: "edital", artifactId: document.id,
            officialDocumentId: official.id, officialLineageId: official.lineageId,
          });
          if (params.invoke === undefined && linked === 0) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Proveniência cognitiva obrigatória ausente para esta geração — operação abortada (fail-closed).",
            });
          }
          await recordProcessEvent({
            organizationId: params.organizationId, processId: params.processId, eventType: "decision",
            actor: timelineActor(params.actorUserId),
            summary: `Edital gerado (rascunho) — ${modality}/${form} — fundamentação: ${authoring.groundingState}.`
              + (resolution.source === "explicit_change" && resolution.previous
                ? ` Parâmetros trocados explicitamente: ${describeEditalParameters(resolution.previous)} → ${describeEditalParameters(resolution.params)}.`
                : resolution.source === "first_decision" && resolution.previous
                  ? ` Parâmetros complementados: ${describeEditalParameters(resolution.previous)} → ${describeEditalParameters(resolution.params)}.`
                  : "")
              + (humanState.human ? " Substituiu conteúdo humano por confirmação explícita (anterior preservado no histórico)." : ""),
            refId: doc.id, correlationId: params.correlationId,
          }, tx);
          return { document, validation }; // snapshot canônico + validação
        },
      };
    },
  );
  return { ...result, replayed };
}

/**
 * P0 — Detecção de DESATUALIZAÇÃO (SOURCE_CHANGED) do Edital: compara o digest de fontes gravado na
 * geração (marcador `srcdigest:` em `sources`) com o digest ATUAL das fontes (DFD/ETP/TR/itens/parâmetros).
 * NÃO altera nem regenera nada (read-only). Estados: `never_generated`, `current`, `source_changed`.
 */
export async function getEditalSourceState(params: {
  organizationId: number; processId: string; object: string;
  /** Proposta da UI (opcional). Havendo parâmetros PERSISTIDOS, a staleness é calculada contra ELES. */
  modality?: EditalModality; form?: EditalForm; platform?: EditalPlatform;
  /** PR-09 / R5 — proposta de critério de julgamento / regime de execução (texto; opcional). */
  judgmentCriterion?: string; executionRegime?: string;
}): Promise<{
  state: "never_generated" | "current" | "source_changed";
  storedDigest: string | null; currentDigest: string;
  usedSources: string[]; missing: string[];
  /** PR-09 (SEM-009) — parâmetros persistidos × proposta (a proposta NÃO altera o estado de staleness). */
  parameters: { persisted: EditalParameters | null; proposedDiffers: boolean };
  /** R9 / SEM-047 — fontes que mudaram (vazio no modo legado sem `srcd:` e quando nada mudou). */
  changedSources: Array<{ key: SourceKey; label: string }>;
}> {
  const existing = await getGeneratedDocumentByKind(params.processId, params.organizationId, "edital");
  const persisted = persistedEditalParameters(existing);
  const proposal = {
    modality: params.modality, form: params.form, platform: params.platform,
    judgmentCriterion: params.judgmentCriterion, executionRegime: params.executionRegime,
  };
  const proposed: EditalParameters | null = params.modality && params.form
    ? {
        modality: params.modality, form: params.form, platform: params.form === "eletronico" ? (params.platform ?? null) : null,
        judgmentCriterion: normalizeEditalText(params.judgmentCriterion), executionRegime: normalizeEditalText(params.executionRegime),
      }
    : null;
  const effective = persisted ?? proposed;
  // A proposta sobreposta aos persistidos difere deles? (informativo; NÃO altera a staleness).
  const overlaid = persisted ? overlayEditalProposal(persisted, proposal) : null;
  const parameters = { persisted, proposedDiffers: !!(persisted && overlaid) && !sameEditalParameters(persisted!, overlaid!) };
  // Staleness contra os PERSISTIDOS (critério/regime incluídos: são parte do digest do contexto).
  const current = await resolveEditalSources({
    organizationId: params.organizationId, processId: params.processId, object: params.object,
    modality: effective?.modality ?? "", form: effective?.form ?? "", platform: effective?.platform ?? null,
    criterioJulgamento: effective?.judgmentCriterion ?? null, regimeContratacao: effective?.executionRegime ?? null,
  });
  if (!existing || !existing.content.trim()) {
    return { state: "never_generated", storedDigest: null, currentDigest: current.sourcesDigest, usedSources: current.usedSources, missing: current.missing, parameters, changedSources: [] };
  }
  const stored = (existing.sources ?? []).find((s) => s.startsWith("srcdigest:"))?.slice("srcdigest:".length) ?? null;
  // R9 / SEM-047 — por FONTE quando o documento tem `srcd:` (diz o QUE mudou); senão o digest global legado
  // (prefixo de 16 chars) — documentos antigos não mudam de estado por causa desta versão.
  const cmp = compareSources(existing.sources, { perSource: current.sourceDigests, globalDigest: current.sourcesDigest });
  return { state: cmp.state, storedDigest: stored, currentDigest: current.sourcesDigest, usedSources: current.usedSources, missing: current.missing, parameters, changedSources: describeChangedSources(cmp.changed) };
}

/**
 * P0 piloto — Estado das FONTES de autoria do ETP/TR (generaliza o SOURCE_CHANGED do Edital). Read-only:
 * compara o digest gravado na geração (`srcdigest:`) com o digest ATUAL (DFD/ETP/itens aprovados/cotações/
 * classificação confirmada). Documento importado (sem digest) ⇒ `imported` (não foi gerado a partir das fontes).
 * Devolve também o RESUMO das fontes para a UI de pré-geração ("Gerar TR com base no processo").
 */
export async function getAuthoringSourceState(params: {
  organizationId: number; processId: string; kind: "etp" | "tr"; object: string;
}): Promise<{
  state: "never_generated" | "current" | "source_changed" | "imported";
  storedDigest: string | null; currentDigest: string;
  usedSources: string[]; missing: string[];
  summary: {
    dfd: { present: boolean; origin: string | null }; etp: { present: boolean; origin: string | null };
    approvedItems: number; pendingItems: number; quoteCount: number;
    pricedItems: number; unpricedItems: number; confirmedClassifications: number; pendingClassifications: number;
    estimatedGlobalTotalCents: number;
  };
  /** R9 / SEM-047 — fontes que mudaram (vazio no modo legado sem `srcd:` e quando nada mudou). */
  changedSources: Array<{ key: SourceKey; label: string }>;
}> {
  const ctx = await resolveDocumentAuthoringContext(params);
  const existing = await getGeneratedDocumentByKind(params.processId, params.organizationId, params.kind);
  const summary = {
    dfd: { present: ctx.sourceVersions.dfd.present, origin: ctx.sourceVersions.dfd.origin },
    etp: { present: ctx.sourceVersions.etp.present, origin: ctx.sourceVersions.etp.origin },
    approvedItems: ctx.estimate.itemCount, pendingItems: ctx.pendingItemCount, quoteCount: ctx.estimate.quoteCount,
    pricedItems: ctx.estimate.pricedItemCount, unpricedItems: ctx.estimate.unpricedItemCount,
    confirmedClassifications: ctx.estimate.confirmedClassificationCount,
    pendingClassifications: ctx.estimate.pendingClassificationCount,
    estimatedGlobalTotalCents: ctx.estimate.globalTotalCents,
  };
  const base = { currentDigest: ctx.sourcesDigest, usedSources: ctx.usedSources, missing: ctx.missing, summary };
  if (!existing || !existing.content.trim()) return { state: "never_generated", storedDigest: null, ...base, changedSources: [] };
  const stored = storedSourcesDigest(existing.sources);
  if (stored === null) {
    return { state: existing.sources.includes("origem:import") ? "imported" : "source_changed", storedDigest: null, ...base, changedSources: [] };
  }
  // R9 / SEM-047 — por FONTE quando há `srcd:`; senão o digest global legado.
  const cmp = compareSources(existing.sources, { perSource: ctx.sourceDigests, globalDigest: ctx.sourcesDigest });
  return { state: cmp.state, storedDigest: stored, ...base, changedSources: describeChangedSources(cmp.changed) };
}

/** R9 / SEM-047 — fontes alteradas com rótulo para a UI (lista o QUE mudou, não só "fontes mudaram"). */
function describeChangedSources(keys: readonly SourceKey[]): Array<{ key: SourceKey; label: string }> {
  return keys.map((key) => ({ key, label: SOURCE_LABELS[key] }));
}
