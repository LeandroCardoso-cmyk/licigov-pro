/**
 * Sprint 2.8 — Import Staging Service.
 *
 * Persiste RawExtractedItems para staging, isola da camada de domínio.
 * Nunca grava diretamente em tabelas de domínio (ItemTR, CATMAT, etc.).
 * Human review: approve/reject/skip por item, com nota opcional.
 */
import { eq, and, inArray, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { addDays } from "date-fns";
import { getDb } from "../db/connection";
import { importStagingItems, importItemCorrections, importSessions, activityLogs } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "./idempotencyService";
import type { RawExtractedItem } from "../domain/importExtraction";
import { validateCorrections } from "../domain/importCorrectionFields";
import {
  planCorrectionReview, correctionPayloadHash, isSameCorrection,
  CORRECTION_REFUSAL_MESSAGE, CORRECTION_IDEMPOTENCY_OPERATION,
} from "../domain/importCorrectionReview";

const log = serviceLogger("ImportStagingService");

const STAGING_TTL_DAYS = 30;

type StagingDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/** Conexão ou transação (a substituição do staging acontece DENTRO de uma transação). */
export type StagingExecutor = StagingDb | Parameters<Parameters<StagingDb["transaction"]>[0]>[0];

// ─── Persist ──────────────────────────────────────────────────────────────────

/** Insere os itens brutos no staging (pendentes) pelo executor informado — conexão ou transação. */
export async function insertStagingRows(
  exec:           StagingExecutor,
  items:          RawExtractedItem[],
  organizationId: number,
): Promise<number[]> {
  const expiresAt = addDays(new Date(), STAGING_TTL_DAYS);
  const ids: number[] = [];
  for (const item of items) {
    const [row] = await exec.insert(importStagingItems).values({
      importSessionId:    item.importSessionId,
      organizationId,
      rawDescription:     item.rawDescription ?? null,
      rawQuantity:        item.rawQuantity     ?? null,
      rawUnit:            item.rawUnit         ?? null,
      rawUnitPrice:       item.rawUnitPrice    ?? null,
      rawTotalPrice:      item.rawTotalPrice   ?? null,
      // Campos de cotação de 1ª classe (IMUTÁVEIS como os demais raw*; correção é overlay).
      rawSupplier:        item.rawSupplier     ?? null,
      rawBrand:           item.rawBrand        ?? null,
      rawModel:           item.rawModel        ?? null,
      rawNotes:           item.rawNotes        ?? null,
      rawSource:          item.rawSource       ?? null,
      rawTypedValues:     (item.rawTypedValues ?? null) as object | null,
      rawMetadata:        (item.rawMetadata ?? null) as object | null,
      sourceLocation:     (item.sourceLocation ?? null) as object | null,
      parserMetadata:     (item.parserMetadata ?? null) as object | null,
      confidenceMetadata: (item.confidenceMetadata ?? null) as object | null,
      extractionWarnings: (item.extractionWarnings ?? null) as object | null,
      extractionErrors:   (item.extractionErrors ?? null) as object | null,
      reviewStatus:       "pending",
      expiresAt,
    }).$returningId();
    ids.push(row.id);
  }
  return ids;
}

export async function persistStagingItems(
  items:          RawExtractedItem[],
  organizationId: number,
): Promise<number[]> {
  if (items.length === 0) return [];

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const ids = await insertStagingRows(db, items, organizationId);

  log.info("staging_items_persisted", {
    count:         items.length,
    sessionId:     items[0]?.importSessionId,
    organizationId,
  });

  return ids;
}

/**
 * U2A — Persistência REPLAY-SAFE para o worker: uma nova tentativa de extração da MESMA sessão substitui os
 * itens que NINGUÉM tocou (pendentes, sem correção) em vez de duplicá-los. Se houver QUALQUER item já
 * revisado ou corrigido por humano, nada é alterado e a chamada falha (a decisão humana nunca é sobrescrita).
 * Layout v2: a substituição é ATÔMICA (uma transação: bloqueia os itens da sessão, confere que ninguém os
 * tocou, remove e insere) — nunca "metade antiga + metade nova". Parse/OCR continuam FORA da transação.
 */
export class StagingAlreadyReviewedError extends Error {
  constructor(readonly touched: number) {
    super(`STAGING_ALREADY_REVIEWED: ${touched} item(ns) já revisado(s)/corrigido(s) nesta sessão; a reextração foi bloqueada.`);
    this.name = "StagingAlreadyReviewedError";
  }
}

export async function replaceUnreviewedStagingItems(
  importSessionId: number,
  organizationId:  number,
  items:           RawExtractedItem[],
): Promise<{ ids: number[]; replaced: number }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const result = await db.transaction((tx) => replaceUntouchedStagingTx(tx, importSessionId, organizationId, items));
  if (result.replaced > 0) log.info("staging_items_replaced", { sessionId: importSessionId, organizationId, removed: result.replaced });
  log.info("staging_items_persisted", { count: result.ids.length, sessionId: importSessionId, organizationId });
  return result;
}

/**
 * Substituição do staging INTOCADO dentro de uma transação existente: `SELECT … FOR UPDATE` dos itens da sessão
 * (tenant-scoped), recusa se algum foi revisado/corrigido, remove e insere. Uma revisão concorrente espera o
 * lock e, após o commit, não encontra mais o item antigo (CONFLICT/NOT_FOUND) — nunca sobrescreve a decisão.
 */
export async function replaceUntouchedStagingTx(
  tx:              StagingExecutor,
  importSessionId: number,
  organizationId:  number,
  items:           RawExtractedItem[],
): Promise<{ ids: number[]; replaced: number }> {
  const scope = and(eq(importStagingItems.importSessionId, importSessionId), eq(importStagingItems.organizationId, organizationId));
  const existing = await tx.select({
    id: importStagingItems.id, reviewStatus: importStagingItems.reviewStatus, correctionRevision: importStagingItems.correctionRevision,
  }).from(importStagingItems).where(scope).for("update");
  const touched = existing.filter(i => i.reviewStatus !== "pending" || (i.correctionRevision ?? 0) > 0).length;
  if (touched > 0) throw new StagingAlreadyReviewedError(touched);
  if (existing.length > 0) {
    await tx.delete(importStagingItems).where(and(scope, inArray(importStagingItems.id, existing.map(i => i.id))));
  }
  const ids = items.length > 0 ? await insertStagingRows(tx, items, organizationId) : [];
  return { ids, replaced: existing.length };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getStagingItems(
  importSessionId: number,
  organizationId:  number,
): Promise<(typeof importStagingItems.$inferSelect)[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(importStagingItems)
    .where(and(
      eq(importStagingItems.importSessionId, importSessionId),
      eq(importStagingItems.organizationId,  organizationId),
    ));
}

export async function getStagingItem(
  itemId:         number,
  organizationId: number,
): Promise<typeof importStagingItems.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(importStagingItems)
    .where(and(
      eq(importStagingItems.id,             itemId),
      eq(importStagingItems.organizationId, organizationId),
    ))
    .limit(1);

  return rows[0] ?? null;
}

// ─── Review actions ───────────────────────────────────────────────────────────

export type ReviewAction = "approved" | "rejected" | "skipped";

export async function reviewStagingItem(
  itemId:         number,
  organizationId: number,
  reviewedBy:     number,
  action:         ReviewAction,
  note?:          string,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const item = await getStagingItem(itemId, organizationId);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item de staging não encontrado." });

  if (item.reviewStatus !== "pending") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Item já revisado: ${item.reviewStatus}.` });
  }

  // Compare-and-set: só revisa se o item AINDA existe e está pendente (uma reextração concorrente pode tê-lo
  // substituído — nesse caso a decisão não é gravada "no vazio": CONFLICT acionável).
  const result = await db.update(importStagingItems).set({
    reviewStatus: action,
    reviewedBy,
    reviewedAt:   new Date(),
    reviewNote:   note ?? null,
  }).where(and(
    eq(importStagingItems.id,             itemId),
    eq(importStagingItems.organizationId, organizationId),
    eq(importStagingItems.reviewStatus,   "pending"),
  ));
  const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
  if (header && typeof header.affectedRows === "number" && header.affectedRows === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "O item mudou durante a revisão (reextração ou outro revisor). Atualize a lista e revise novamente." });
  }

  log.debug("staging_item_reviewed", { itemId, action, organizationId });
}

// ─── Human correction (auditável, transacional, idempotente, re-revisão) ────────
// R9 / SEM-048 — antes: correção aceita após aprovação/promoção sem re-revisão; update do item e histórico em
// escritas separadas (fora de transação); idempotência só por chave (payload diferente sob a mesma chave virava
// "replay"). Agora: governança de revisão (planCorrectionReview), UMA transação e idempotência por chave+payload.

export interface CorrectStagingItemParams {
  itemId:               number;
  organizationId:       number;
  importSessionId:      number;
  procurementProcessId: string | null;
  importType:           string;
  actorUserId:          number;
  corrections:          unknown;         // patch bruto (validado por importType)
  justification:        string;
  expectedRevision:     number;          // concorrência otimista
  idempotencyKey:       string;
  correlationId?:       string | null;
  requestId?:           string | null;
}

export interface CorrectStagingItemResult {
  item:       typeof importStagingItems.$inferSelect;
  revision:   number;
  idempotent: boolean;
  /** R9 / SEM-048 — o item tinha decisão humana e voltou a `pending` (nova revisão exigida). */
  reviewReopened:  boolean;
  /** R9 / SEM-048 — a sessão estava aprovada e voltou a `awaiting_review` (nova aprovação exigida). */
  sessionReopened: boolean;
}

/** Resposta persistida na chave idempotente (sem conteúdo do item — apenas o desfecho). */
interface CorrectionOutcome { revision: number; reviewReopened: boolean; sessionReopened: boolean }

const CORRECTION_CONFLICT = "Este item foi alterado por outro revisor. Atualize os dados antes de continuar.";
const IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT: esta chave de correção já foi usada com outro conteúdo. Gere uma nova correção.";

function isDuplicateEntry(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const x = e as { code?: string; errno?: number; cause?: unknown };
    if (x.code === "ER_DUP_ENTRY" || x.errno === 1062) return true;
    e = x.cause;
  }
  return false;
}

function affectedRows(res: unknown): number {
  const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined;
  return header?.affectedRows ?? 0;
}

/**
 * Correção humana de um item de staging. Preserva os `raw*` (imutáveis); grava um OVERLAY validado em
 * `correctedPayload` e o histórico imutável em `import_item_corrections`.
 *
 * R9 / SEM-048:
 *  - Governança: sessão PROMOVIDA ⇒ PRECONDITION_FAILED `SESSION_ALREADY_PROMOTED` (o domínio não diverge em
 *    silêncio); item já decidido ⇒ volta a `pending`; sessão APROVADA ⇒ volta a `awaiting_review` (a aprovação
 *    anterior valia para o conteúdo anterior — nova aprovação humana antes da promoção).
 *  - Atomicidade: lock da sessão e do item (FOR UPDATE, mesma ordem da promoção/revisão por grupo), update do
 *    item, histórico, reabertura (item + sessão), auditoria e conclusão da chave idempotente em UMA transação.
 *  - Concorrência otimista: `correctionRevision` precisa bater com `expectedRevision` (CONFLICT acionável).
 *  - Idempotência (idempotencyService, chave vinculada à operação `ingestion.correctItem`): mesma chave + mesmo
 *    payload ⇒ replay sem segunda escrita; mesma chave + payload diferente ⇒ CONFLICT.
 * NÃO aprova o item e NÃO promove ao domínio.
 */
export async function correctStagingItem(params: CorrectStagingItemParams): Promise<CorrectStagingItemResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const { itemId, organizationId, importSessionId } = params;

  if (!params.justification || params.justification.trim().length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Justificativa obrigatória." });
  }
  const validated = validateCorrections(params.importType, params.corrections);
  if (!validated.ok) {
    const code = validated.code === "CAPABILITY_UNAVAILABLE" ? "FORBIDDEN" : "BAD_REQUEST";
    throw new TRPCError({ code, message: validated.message });
  }
  const justification = params.justification.trim();

  // Idempotência por chave + payload (a chave fica vinculada à operação; payload diferente ⇒ CONFLICT).
  const idem = {
    key: params.idempotencyKey, userId: params.actorUserId,
    payloadHash: correctionPayloadHash({
      organizationId, importSessionId, itemId, expectedRevision: params.expectedRevision,
      corrections: params.corrections, justification,
    }),
  };
  const check = await checkIdempotency(idem.key, idem.userId, organizationId, CORRECTION_IDEMPOTENCY_OPERATION, idem.payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) throw new TRPCError({ code: "CONFLICT", message: IDEMPOTENCY_CONFLICT });
    const cached = check.response as Partial<CorrectionOutcome> | null;
    const item = await getStagingItem(itemId, organizationId);
    if (!item || item.importSessionId !== importSessionId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Item de staging não encontrado nesta sessão." });
    }
    return {
      item, revision: cached?.revision ?? item.correctionRevision, idempotent: true,
      reviewReopened: cached?.reviewReopened ?? false, sessionReopened: cached?.sessionReopened ?? false,
    };
  }
  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "Esta correção já está em processamento — aguarde e atualize os dados." });
  }

  let outcome: CorrectionOutcome & { idempotent: boolean };
  try {
    outcome = await db.transaction(async (tx) => {
      // 1) Lock da SESSÃO (mesma ordem de locks da promoção e da revisão por grupo ⇒ sem deadlock).
      const [session] = await tx.select({
        id: importSessions.id, status: importSessions.status, promotionStatus: importSessions.promotionStatus,
      }).from(importSessions)
        .where(and(eq(importSessions.id, importSessionId), eq(importSessions.organizationId, organizationId)))
        .for("update");
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });

      // 2) Lock do ITEM (tenant + sessão).
      const [item] = await tx.select().from(importStagingItems)
        .where(and(
          eq(importStagingItems.id,              itemId),
          eq(importStagingItems.organizationId,  organizationId),
          eq(importStagingItems.importSessionId, importSessionId),
        ))
        .for("update");
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item de staging não encontrado nesta sessão." });

      // 3) Compatibilidade: chave já aplicada no histórico (pré-R9 ou outro usuário do tenant) — replay só se for
      //    a MESMA correção; caso contrário CONFLICT (a chave nunca "absorve" outro conteúdo).
      const [priorByKey] = await tx.select().from(importItemCorrections)
        .where(and(
          eq(importItemCorrections.organizationId, organizationId),
          eq(importItemCorrections.idempotencyKey, params.idempotencyKey),
        )).limit(1);
      if (priorByKey) {
        if (!isSameCorrection(priorByKey, { itemId, overlay: validated.overlay, justification })) {
          throw new TRPCError({ code: "CONFLICT", message: IDEMPOTENCY_CONFLICT });
        }
        const replay: CorrectionOutcome = { revision: priorByKey.toRevision, reviewReopened: false, sessionReopened: false };
        await saveIdempotencyResult(idem.key, idem.userId, organizationId, replay, tx);
        return { ...replay, idempotent: true };
      }

      // 4) Governança de revisão (fonte única: domínio puro).
      const plan = planCorrectionReview({
        sessionStatus: session.status, promotionStatus: session.promotionStatus, itemReviewStatus: item.reviewStatus,
      });
      if (!plan.ok) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: CORRECTION_REFUSAL_MESSAGE[plan.refusal] });
      }

      // 5) Concorrência otimista (sob lock: a revisão observada precisa ser a esperada).
      if (item.correctionRevision !== params.expectedRevision) {
        throw new TRPCError({ code: "CONFLICT", message: CORRECTION_CONFLICT });
      }

      const before = (item.correctedPayload && typeof item.correctedPayload === "object"
        ? item.correctedPayload as Record<string, unknown> : {});
      const after = { ...before, ...validated.overlay };
      const fromRevision = item.correctionRevision;
      const toRevision   = params.expectedRevision + 1;

      // 6) Projeção do item: overlay + revisão; decisão anterior REABERTA (volta a pendente) se havia.
      const res = await tx.update(importStagingItems).set({
        correctedPayload:   after as unknown as object,
        correctionRevision: toRevision,
        correctedAt:        new Date(),
        correctedByUserId:  params.actorUserId,
        ...(plan.reopenItem ? { reviewStatus: "pending" as const, reviewedBy: null, reviewedAt: null, reviewNote: null } : {}),
      }).where(and(
        eq(importStagingItems.id,                 itemId),
        eq(importStagingItems.organizationId,     organizationId),
        eq(importStagingItems.correctionRevision, params.expectedRevision),
      ));
      if (affectedRows(res) !== 1) throw new TRPCError({ code: "CONFLICT", message: CORRECTION_CONFLICT });

      // 7) Histórico imutável NA MESMA transação. Violação de unicidade (revisão/chave) ⇒ CONFLICT e rollback
      //    TOTAL (o item nunca fica corrigido sem histórico).
      try {
        await tx.insert(importItemCorrections).values({
          organizationId,
          procurementProcessId: params.procurementProcessId,
          importSessionId,
          stagingItemId:        itemId,
          fromRevision,
          toRevision,
          beforePayload:        before as unknown as object,
          afterPayload:         after as unknown as object,
          changedFields:        validated.changedFields as unknown as object,
          justification,
          actorUserId:          params.actorUserId,
          idempotencyKey:       params.idempotencyKey,
          correlationId:        params.correlationId ?? null,
        });
      } catch (err) {
        if (isDuplicateEntry(err)) {
          throw new TRPCError({ code: "CONFLICT", message: "Esta revisão do item já foi registrada por outra correção. Atualize os dados antes de continuar." });
        }
        throw err;
      }

      // 8) Aprovação da sessão INVALIDADA (nova aprovação humana antes da promoção). Compare-and-set sob o lock.
      if (plan.reopenSession) {
        const sres = await tx.update(importSessions)
          .set({ status: "awaiting_review", stage: "awaiting_review", progress: 90 })
          .where(and(
            eq(importSessions.id, importSessionId),
            eq(importSessions.organizationId, organizationId),
            eq(importSessions.status, "approved"),
            eq(importSessions.promotionStatus, "none"),
          ));
        if (affectedRows(sres) !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "A sessão mudou durante a correção (aprovação/promoção concorrente). Atualize os dados." });
        }
      }

      // 9) Auditoria da reabertura NA MESMA transação (sem conteúdo: só identificadores e estados).
      if (plan.reopenItem || plan.reopenSession) {
        await tx.insert(activityLogs).values({
          organizationId, userId: params.actorUserId, action: "import_review_reopened_by_correction", sourceContext: "api",
          entityType: "import_staging_item", entityId: itemId,
          correlationId: params.correlationId ?? null, requestId: params.requestId ?? null,
          details: JSON.stringify({
            sessionId: importSessionId, procurementProcessId: params.procurementProcessId, toRevision,
            item: plan.reopenItem ? { from: plan.previousItemStatus, to: "pending" } : null,
            session: plan.reopenSession ? { from: "approved", to: "awaiting_review" } : null,
          }),
        });
      }

      const done: CorrectionOutcome = { revision: toRevision, reviewReopened: plan.reopenItem, sessionReopened: plan.reopenSession };
      // 10) Conclusão da chave idempotente NA MESMA transação (commit ⇒ replay garantido).
      await saveIdempotencyResult(idem.key, idem.userId, organizationId, done, tx);
      return { ...done, idempotent: false };
    });
  } catch (err) {
    // Nada foi gravado (rollback): a chave não fica como sucesso — retry permitido.
    await failIdempotencyKey(idem.key, idem.userId, organizationId).catch(() => {});
    throw err;
  }

  const updated = await getStagingItem(itemId, organizationId);
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Item de staging não encontrado nesta sessão." });
  // OBS: sem conteúdo/overlay em log — apenas identificadores seguros.
  log.info(outcome.idempotent ? "staging_item_correction_replayed" : "staging_item_corrected", {
    itemId, organizationId, importSessionId,
    procurementProcessId: params.procurementProcessId, toRevision: outcome.revision,
    changedFields: validated.changedFields.length, correlationId: params.correlationId ?? null,
    reviewReopened: outcome.reviewReopened, sessionReopened: outcome.sessionReopened,
  });
  return {
    item: updated, revision: outcome.revision, idempotent: outcome.idempotent,
    reviewReopened: outcome.reviewReopened, sessionReopened: outcome.sessionReopened,
  };
}

/** Lista o histórico de correções de um item (auditoria consultável, tenant-safe). */
export async function getItemCorrectionHistory(
  itemId:         number,
  organizationId: number,
): Promise<(typeof importItemCorrections.$inferSelect)[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(importItemCorrections)
    .where(and(
      eq(importItemCorrections.stagingItemId,  itemId),
      eq(importItemCorrections.organizationId, organizationId),
    ))
    .orderBy(importItemCorrections.toRevision);
}

export async function bulkReviewStagingItems(
  itemIds:        number[],
  organizationId: number,
  reviewedBy:     number,
  action:         ReviewAction,
  note?:          string,
): Promise<number> {
  if (itemIds.length === 0) return 0;

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  await db.update(importStagingItems).set({
    reviewStatus: action,
    reviewedBy,
    reviewedAt:   new Date(),
    reviewNote:   note ?? null,
  }).where(and(
    inArray(importStagingItems.id,          itemIds),
    eq(importStagingItems.organizationId,   organizationId),
    eq(importStagingItems.reviewStatus,     "pending"),
  ));

  log.info("staging_items_bulk_reviewed", { count: itemIds.length, action, organizationId });
  return itemIds.length;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export async function cleanupExpiredStaging(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // P0 piloto — CORREÇÃO: antes apagava TODOS os itens `pending` de TODOS os tenants, ignorando
  // `expiresAt` (perda de dados em revisão). Agora só remove itens pendentes cujo TTL EXPIROU.
  const result = await db.delete(importStagingItems)
    .where(and(
      eq(importStagingItems.reviewStatus, "pending"),
      lt(importStagingItems.expiresAt, now),
    ));

  log.info("staging_cleanup_ran", { deletedRows: (result as unknown as { affectedRows?: number }).affectedRows ?? 0 });
  return (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
}

export async function deleteSessionStaging(
  importSessionId: number,
  organizationId:  number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.delete(importStagingItems)
    .where(and(
      eq(importStagingItems.importSessionId, importSessionId),
      eq(importStagingItems.organizationId,  organizationId),
    ));

  return (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export interface StagingSummary {
  total:    number;
  pending:  number;
  approved: number;
  rejected: number;
  skipped:  number;
}

export async function getStagingSummary(
  importSessionId: number,
  organizationId:  number,
): Promise<StagingSummary> {
  const items = await getStagingItems(importSessionId, organizationId);
  return {
    total:    items.length,
    pending:  items.filter(i => i.reviewStatus === "pending").length,
    approved: items.filter(i => i.reviewStatus === "approved").length,
    rejected: items.filter(i => i.reviewStatus === "rejected").length,
    skipped:  items.filter(i => i.reviewStatus === "skipped").length,
  };
}
