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

const DOMAIN = "processo_licitatorio" as const;

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

/**
 * "Criar DFD do zero" (production-ready mínimo): estrutura um RASCUNHO editável do
 * DFD (art. 12, §1º) e persiste como documento canônico (kind "dfd", status
 * "rascunho"). NÃO usa Kernel/IA (template determinístico) — a geração assistida
 * por IA plena fica como evolução. Supervisão humana: sempre rascunho, nunca
 * aprovação automática. Idempotente: id determinístico por (processo, kind) →
 * retry não duplica.
 */
export async function generateDFDDraft(params: {
  organizationId: number; processId: string; object: string; correlationId: string;
  idempotencyKey: string; actorUserId: number;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  const payloadHash = generatePayloadHash({ organizationId: params.organizationId, processId: params.processId, kind: "dfd", object: params.object });
  const { result, replayed } = await runReplaySafeGeneration<GeneratedDocument>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    reviveIdempotent,
    async () => {
      // Estado de partida (sentinel explícito de ausência) revalidado sob lock na persistência.
      const before = await getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd");
      const expectedState = before ? { type: "present" as const, contentHash: draftContentHash(before.content) } : { type: "absent" as const };
      const doc = createGeneratedDocument({
        processId: params.processId, organizationId: params.organizationId,
        kind: "dfd", title: `DFD — ${params.object}`,
        content: buildDFDDraft(params.object),
        sources: ["estrutura:art_12_par_1_lei_14133"],
        authorUserId: params.actorUserId,
        lastSubstantiveActorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });
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
            actor: "sistema", summary: "DFD criado (rascunho estruturado).", refId: doc.id,
            correlationId: params.correlationId,
          }, tx);
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
 */
export async function saveDFDDraft(params: {
  organizationId: number; processId: string; object: string; content: string;
  actorUserId: number; expectedContentHash: string; idempotencyKey: string; correlationId: string;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  return runGovernedDraftEdit({
    op: DFD_SAVE_OP, operation: "dfd_manual_edit", timelineSummary: "DFD salvo (rascunho).",
    organizationId: params.organizationId, processId: params.processId, kind: "dfd",
    title: `DFD — ${params.object}`, sources: ["edicao_manual"], content: params.content,
    actorUserId: params.actorUserId, expectedContentHash: params.expectedContentHash,
    idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
  });
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

  // Assinatura determinística dos itens aprovados (campos relevantes, não só IDs) → alterar um item
  // aprovado relevante muda o payloadHash e, sob a mesma chave, resulta em CONFLICT.
  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind,
    object: params.object, approvedItems: approved,
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
            actor: "multi_copilot", summary: `${params.kind.toUpperCase()} gerado (rascunho) a partir de ${approved.length} item(ns).`,
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
