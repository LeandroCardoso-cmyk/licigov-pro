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
import { resolveDocumentAuthoringContext, storedSourcesDigest } from "./authoring/authoringContext";
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
  recordProcessEvent, listIntelligentItems, applyDraftContentMutationTx,
  getGeneratedDocumentByKind, type ProcurementExecutor, type DraftEditOperation,
} from "../db/procurement";
// V1 PRE-PILOT CLOSURE — Fase A1: linkage de proveniência cognitiva → artefato (transacional).
import { linkProvenanceArtifact, type ProvenanceExecutor } from "../db/cognitiveProvenance";
// Contexto Canônico da Contratação — DFD como 1º consumidor (prefill, estado por campo, reconciliação, IA).
import { serviceLogger } from "./observabilityService";
import { resolveProcurementContext, recordContextAssertions } from "./canonicalContextService";
import { generateDFDJustificationText, DFD_JUSTIFICATION_PROMPT_VERSION } from "./authoring/dfdJustificationAuthoring";
import type { NewFactAssertion } from "../db/procurementContext";
import type { ProcurementCanonicalContext } from "../domain/canonicalProcurementContext";
import { canonicalDigest } from "../domain/canonicalJson";
import {
  buildDFDPrefill, renderDFDContent, prefillMarkers, writeMarkers, readMarkers, isAssistMarker,
  computeDFDFieldStates, reconcileDFDField, applyAIJustification, extractDFDAssertions, summarizeFieldStates,
  parseDFD, fieldHash, DFD_FIELD_LABELS, DFD_PREFILL_VERSION,
  type DFDFieldView, type DFDFieldState,
} from "../domain/dfdPrefill";

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
        expectedState, idempotencyKey: p.idempotencyKey, correlationId: p.correlationId,
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
  const sources = ["edicao_manual", ...previousSources.filter(isAssistMarker)];
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
    ({ overridden, changedFields } = diffDFDFields(existing?.content ?? "", params.content, previousSources));
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
function diffDFDFields(before: string, after: string, previousSources: readonly string[]): {
  changedFields: string[]; overridden: Array<{ field: string; beforeHash: string; afterHash: string; previousOrigin: string }>;
} {
  const a = parseDFD(before);
  const b = parseDFD(after);
  const mk = readMarkers(previousSources);
  const qty = (p: ReturnType<typeof parseDFD>) => Object.fromEntries(p.items.map((i) => [`item:${i.key}`, i.quantity]));
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
    };
  }
  const fields = doc ? computeDFDFieldStates(doc.content, doc.sources ?? [], buildDFDPrefill(ctx)) : [];
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

/**
 * Rascunho SUPERVISIONADO de IA da "Justificativa da necessidade" (seção 2) — ação EXPLÍCITA do servidor.
 * IA exclusivamente via AIExecutionEngine (dfdJustificationAuthoring), com contexto GOVERNADO (só fatos
 * canônicos; sem preços/pessoas). Saída = rascunho editável marcado (`ai:`), nunca decisão/aprovação.
 * Replay-safe: idempotência da geração + idempotência do Engine (retry não duplica chamada de IA).
 * Nunca sobrescreve justificativa escrita por humano sem confirmação explícita (`confirmReplace`).
 */
export async function generateDFDJustificationDraft(params: {
  organizationId: number; processId: string; object: string;
  actorUserId: number; expectedContentHash: string; confirmReplace?: boolean;
  idempotencyKey: string; correlationId: string;
  /** Seam determinístico (testes) — substitui a chamada ao Engine; proveniência deixa de ser obrigatória. */
  invoke?: (prompt: string) => Promise<string>;
}): Promise<{ document: GeneratedDocument; explanation: DFDAIDraftExplanation; replayed: boolean }> {
  const existing = await getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd");
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "DFD inexistente — crie o DFD antes de gerar o rascunho da justificativa." });
  assertDFDMutable(existing);
  const ctx = await resolveProcurementContext(params);
  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: "dfd", object: params.object,
    sourcesDigest: canonicalDigest({
      op: "dfd_ai_justification", pv: DFD_JUSTIFICATION_PROMPT_VERSION, ctx: ctx.digest,
      exp: params.expectedContentHash, rep: params.confirmReplace === true,
    }),
  });

  type Out = { document: GeneratedDocument; explanation: DFDAIDraftExplanation };
  const { result, replayed } = await runReplaySafeGeneration<Out>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    reviveIdempotent,
    async () => {
      // Pré-condições ANTES da cognição (nenhuma chamada de IA desperdiçada / nenhuma sobrescrita).
      if (draftContentHash(existing.content) !== params.expectedContentHash) {
        throw new TRPCError({ code: "CONFLICT", message: "O rascunho mudou desde o carregamento — recarregue antes de gerar." });
      }
      const view = computeDFDFieldStates(existing.content, existing.sources ?? [], buildDFDPrefill(ctx)).find((f) => f.key === "justificativa");
      if (view?.state === "user_modified" && params.confirmReplace !== true) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "USER_MODIFIED_FIELD: a justificativa foi escrita por você — confirme para substituí-la pelo rascunho da IA.",
        });
      }
      // Cognição FORA da transação, via AIExecutionEngine (ou seam).
      const draft = await generateDFDJustificationText({
        organizationId: params.organizationId, processId: params.processId, ctx,
        correlationId: params.correlationId, actorUserId: params.actorUserId,
        idempotencyKey: params.idempotencyKey, invoke: params.invoke,
      });
      if (!draft.text.trim()) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "A IA não produziu rascunho utilizável — nada foi alterado." });
      }
      const applied = applyAIJustification(existing.content, existing.sources ?? [], draft.text, draft.executionId, ctx.digest);
      const doc = createGeneratedDocument({
        processId: params.processId, organizationId: params.organizationId, kind: "dfd",
        title: existing.title || `DFD — ${params.object}`, content: applied.content,
        sources: withContextMarkers(applied.sources, ctx), correlationId: params.correlationId,
      });
      const explanation: DFDAIDraftExplanation = {
        field: "justificativa", executionId: draft.executionId, provider: draft.provider, model: draft.model,
        promptVersion: draft.promptVersion, contextVersion: ctx.version, contextDigest: ctx.digest.slice(0, 16),
        inputDigest: draft.inputDigest.slice(0, 16), unverifiedNumbers: draft.unverifiedNumbers,
        actorUserId: params.actorUserId, correlationId: params.correlationId, generatedAt: new Date().toISOString(),
      };
      return {
        response: { document: doc, explanation },
        persist: async (tx) => {
          const { document } = await applyDraftContentMutationTx(tx, {
            organizationId: params.organizationId, processId: params.processId, kind: "dfd",
            actorUserId: params.actorUserId, doc, operation: "dfd_ai_draft",
            expectedState: { type: "present", contentHash: params.expectedContentHash },
            idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
          });
          // A1 — proveniência cognitiva → artefato (MESMA transação). Cognição real ⇒ obrigatória.
          const { linked } = await linkProvenanceArtifact(tx as unknown as ProvenanceExecutor, {
            organizationId: params.organizationId, correlationId: params.correlationId,
            artifactKind: "dfd", artifactId: document.id,
          });
          if (params.invoke === undefined && linked === 0) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Proveniência cognitiva obrigatória ausente para esta geração — operação abortada (fail-closed).",
            });
          }
          await recordProcessEvent({
            organizationId: params.organizationId, processId: params.processId, eventType: "recommendation",
            actor: String(params.actorUserId),
            summary: `DFD: rascunho da justificativa gerado por IA a pedido do servidor (revisão obrigatória; execução ${draft.executionId.slice(0, 24)}).`,
            refId: document.id, correlationId: params.correlationId,
          }, tx);
          log.info("dfd_ai_draft_generated", {
            organizationId: params.organizationId, processId: params.processId, correlationId: params.correlationId,
            actorUserId: params.actorUserId, documentId: document.id, field: "justificativa",
            executionId: draft.executionId, provider: draft.provider, model: draft.model,
            promptVersion: draft.promptVersion, contextVersion: ctx.version, contextDigest: ctx.digest.slice(0, 16),
            inputDigest: draft.inputDigest.slice(0, 16), unverifiedNumbers: draft.unverifiedNumbers.length,
            replaced: view?.state === "user_modified", engineReplayed: draft.replayed,
          });
          return { document, explanation };
        },
      };
    },
  );
  return { ...result, replayed };
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
  invoke?: (prompt: string) => Promise<string>;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  // Regra de arquitetura: acesso ao Kernel só via kernelAccessService.
  assertKernelAccess(DOMAIN, "institutional_rag");
  assertKernelAccess(DOMAIN, "copilot_infrastructure");

  const items = await listIntelligentItems(params.processId, params.organizationId);
  const approved = items.filter(i => i.status === "aprovado");

  // P0 piloto — CONTEXTO REAL de autoria (DFD/ETP/itens aprovados/cotações/classificação confirmada),
  // tenant-scoped. O digest das fontes entra no payloadHash: retry com as MESMAS fontes replaya; fonte
  // alterada sob a mesma chave → CONFLICT (nunca devolve um documento gerado com contexto antigo).
  const sourceContext = await resolveDocumentAuthoringContext({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind, object: params.object,
  });

  // Assinatura determinística dos itens aprovados (campos relevantes, não só IDs) → alterar um item
  // aprovado relevante muda o payloadHash e, sob a mesma chave, resulta em CONFLICT.
  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind,
    object: params.object, approvedItems: approved, sourcesDigest: sourceContext.sourcesDigest,
  });

  const { result, replayed } = await runReplaySafeGeneration<GeneratedDocument>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    reviveIdempotent,
    async () => {
      // C.4B.3A — captura o estado de PARTIDA ANTES da cognição (sentinel de ausência explícito). Se o
      // rascunho mudar enquanto a IA executa, a revalidação sob lock na persistência recusa (CONFLICT)
      // e NÃO sobrescreve a alteração concorrente. 1ª geração: ausência esperada.
      const before = await getGeneratedDocumentByKind(params.processId, params.organizationId, params.kind);
      const expectedState = before ? { type: "present" as const, contentHash: draftContentHash(before.content) } : { type: "absent" as const };

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
          // C.4B.3A — mutação governada: cria (author = originador) ou regenera (preserva originador,
          // último ator substantivo = solicitante, ledger ai_regenerate) com revalidação sob lock.
          const { document } = await applyDraftContentMutationTx(tx, {
            organizationId: params.organizationId, processId: params.processId, kind: params.kind,
            actorUserId: params.actorUserId, doc, operation: "ai_regenerate",
            expectedState, idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
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
            actor: "multi_copilot",
            summary: `${params.kind.toUpperCase()} gerado (rascunho) com base no processo — fontes: ${sourceContext.usedSources.join(", ") || "objeto"}${sourceContext.missing.length ? ` · pendências: ${sourceContext.missing.join(", ")}` : ""}.`,
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
  modality: EditalModality;
  form: EditalForm;
  platform?: EditalPlatform;
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

  const legalJustification = params.form === "presencial"
    ? defaultPresencialJustification(params.modality)
    : "";
  const platform = params.form === "eletronico" ? (params.platform ?? null) : null;

  // Validação de parâmetros (modalidade/forma/plataforma/justificativa) ANTES de qualquer efeito/cognição.
  // Edital inválido: nenhum efeito, nenhuma reserva de idempotência, nenhuma chamada ao provider.
  const prelim = createGeneratedDocument({
    organizationId: params.organizationId, processId: params.processId, kind: "edital",
    title: `Edital — ${params.object}`, content: "",
    modality: params.modality, form: params.form, platform, legalJustification,
    correlationId: params.correlationId,
  });
  const validation = validateEdital(prelim);
  if (!validation.valid) {
    return { document: prelim, validation, replayed: false };
  }

  // Reaproveitamento canônico do contexto (TENANT-SCOPED): DFD/ETP/TR/itens/parâmetros do processo.
  const sourceContext = await resolveEditalSources({
    organizationId: params.organizationId, processId: params.processId, object: params.object,
    modality: params.modality, form: params.form, platform,
  });

  // C.4B.3A — estado de partida para revalidação sob lock (regeneração não sobrescreve edição concorrente).
  const beforeEdital = await getGeneratedDocumentByKind(params.processId, params.organizationId, "edital");
  const expectedStateEdital = beforeEdital
    ? { type: "present" as const, contentHash: draftContentHash(beforeEdital.content) }
    : { type: "absent" as const };

  // Replay-safe: o digest das FONTES entra no payload → retry técnico com as MESMAS fontes replaya; fonte
  // alterada sob a MESMA chave → CONFLICT (não cria duas versões independentes).
  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: "edital",
    object: params.object, modality: params.modality, form: params.form, platform,
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
        modality: params.modality, form: params.form, platform,
        sourceContext, correlationId: params.correlationId, actorUserId: params.actorUserId,
        invoke: params.invoke,
      });

      const doc = createGeneratedDocument({
        organizationId: params.organizationId, processId: params.processId, kind: "edital",
        title: `Edital — ${params.object}`, content: authoring.content,
        // Lineage/explicabilidade nas `sources` (consumidas por reviewableDraft: grounding:… / evidencias:…).
        sources: [
          "tr_aprovado",
          `grounding:${authoring.groundingState}`,
          `evidencias:${authoring.evidences.length}`,
          ...sourceContext.lineageMarkers,
        ],
        modality: params.modality, form: params.form, platform, legalJustification,
        authorUserId: params.actorUserId, lastSubstantiveActorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });

      return {
        response: { document: doc, validation },
        persist: async (tx) => {
          const { document } = await applyDraftContentMutationTx(tx, {
            organizationId: params.organizationId, processId: params.processId, kind: "edital",
            actorUserId: params.actorUserId, doc, operation: "ai_regenerate",
            expectedState: expectedStateEdital, idempotencyKey: params.idempotencyKey,
            correlationId: params.correlationId,
          });
          // RC-3 — documento oficial pelo pipeline ÚNICO (Document Engine), na MESMA transação. Metadata
          // carrega o LINEAGE completo (parâmetros + fundamentação + versões das fontes) para explainability/replay.
          const official = await generateOfficialDocument({
            organizationId: params.organizationId, businessDomain: DOMAIN, documentType: "edital",
            origin: params.processId, title: doc.title, content: doc.content, author: "structured_authoring",
            correlationId: params.correlationId,
            metadata: {
              modality: params.modality, form: params.form, platform,
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
            actor: "multi_copilot",
            summary: `Edital gerado (rascunho) — ${params.modality}/${params.form} — fundamentação: ${authoring.groundingState}.`,
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
  modality: EditalModality; form: EditalForm; platform?: EditalPlatform;
}): Promise<{
  state: "never_generated" | "current" | "source_changed";
  storedDigest: string | null; currentDigest: string;
  usedSources: string[]; missing: string[];
}> {
  const platform = params.form === "eletronico" ? (params.platform ?? null) : null;
  const current = await resolveEditalSources({
    organizationId: params.organizationId, processId: params.processId, object: params.object,
    modality: params.modality, form: params.form, platform,
  });
  const existing = await getGeneratedDocumentByKind(params.processId, params.organizationId, "edital");
  if (!existing || !existing.content.trim()) {
    return { state: "never_generated", storedDigest: null, currentDigest: current.sourcesDigest, usedSources: current.usedSources, missing: current.missing };
  }
  const stored = (existing.sources ?? []).find((s) => s.startsWith("srcdigest:"))?.slice("srcdigest:".length) ?? null;
  // O marcador guarda o prefixo (16 chars) do digest — compara com o mesmo prefixo do digest atual.
  const currentShort = current.sourcesDigest.slice(0, 16);
  const state = stored === null ? "source_changed" : stored === currentShort ? "current" : "source_changed";
  return { state, storedDigest: stored, currentDigest: current.sourcesDigest, usedSources: current.usedSources, missing: current.missing };
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
  if (!existing || !existing.content.trim()) return { state: "never_generated", storedDigest: null, ...base };
  const stored = storedSourcesDigest(existing.sources);
  if (stored === null) {
    return { state: existing.sources.includes("origem:import") ? "imported" : "source_changed", storedDigest: null, ...base };
  }
  return { state: stored === ctx.sourcesDigest.slice(0, 16) ? "current" : "source_changed", storedDigest: stored, ...base };
}
