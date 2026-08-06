/**
 * Sprint 2.8 — Import Staging Service.
 *
 * Persiste RawExtractedItems para staging, isola da camada de domínio.
 * Nunca grava diretamente em tabelas de domínio (ItemTR, CATMAT, etc.).
 * Human review: approve/reject/skip por item, com nota opcional.
 */
import { eq, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { addDays } from "date-fns";
import { getDb } from "../db/connection";
import { importStagingItems, importItemCorrections } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import type { RawExtractedItem } from "../domain/importExtraction";
import { validateCorrections } from "../domain/importCorrectionFields";

const log = serviceLogger("ImportStagingService");

const STAGING_TTL_DAYS = 30;

// ─── Persist ──────────────────────────────────────────────────────────────────

export async function persistStagingItems(
  items:          RawExtractedItem[],
  organizationId: number,
): Promise<number[]> {
  if (items.length === 0) return [];

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const expiresAt = addDays(new Date(), STAGING_TTL_DAYS);
  const ids: number[] = [];

  for (const item of items) {
    const [row] = await db.insert(importStagingItems).values({
      importSessionId:    item.importSessionId,
      organizationId,
      rawDescription:     item.rawDescription ?? null,
      rawQuantity:        item.rawQuantity     ?? null,
      rawUnit:            item.rawUnit         ?? null,
      rawUnitPrice:       item.rawUnitPrice    ?? null,
      rawTotalPrice:      item.rawTotalPrice   ?? null,
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

  log.info("staging_items_persisted", {
    count:         items.length,
    sessionId:     items[0]?.importSessionId,
    organizationId,
  });

  return ids;
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

  await db.update(importStagingItems).set({
    reviewStatus: action,
    reviewedBy,
    reviewedAt:   new Date(),
    reviewNote:   note ?? null,
  }).where(and(
    eq(importStagingItems.id,             itemId),
    eq(importStagingItems.organizationId, organizationId),
  ));

  log.debug("staging_item_reviewed", { itemId, action, organizationId });
}

// ─── Human correction (auditável, optimistic lock, idempotente) ─────────────────

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
}

export interface CorrectStagingItemResult {
  item:       typeof importStagingItems.$inferSelect;
  revision:   number;
  idempotent: boolean;
}

/**
 * Correção humana de um item de staging. Preserva os `raw*` (imutáveis); grava um OVERLAY validado
 * em `correctedPayload` e o histórico imutável em `import_item_corrections`, na MESMA transação.
 * Concorrência otimista: o UPDATE exige `correctionRevision = expectedRevision`; se nada mudar,
 * distingue replay idempotente (mesma idempotencyKey já aplicada) de CONFLITO real (outro revisor).
 * NÃO altera o reviewStatus (correção não aprova o item) e NÃO promove ao domínio.
 */
export async function correctStagingItem(params: CorrectStagingItemParams): Promise<CorrectStagingItemResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const { itemId, organizationId, importSessionId } = params;

  if (!params.justification || params.justification.trim().length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Justificativa obrigatória." });
  }

  const item = await getStagingItem(itemId, organizationId);
  if (!item || item.importSessionId !== importSessionId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Item de staging não encontrado nesta sessão." });
  }

  // Idempotência (replay sequencial): mesma chave já aplicada → no-op de sucesso.
  const priorByKey = await db.select().from(importItemCorrections)
    .where(and(
      eq(importItemCorrections.organizationId, organizationId),
      eq(importItemCorrections.idempotencyKey, params.idempotencyKey),
    )).limit(1);
  if (priorByKey.length > 0) {
    return { item, revision: item.correctionRevision, idempotent: true };
  }

  const validated = validateCorrections(params.importType, params.corrections);
  if (!validated.ok) {
    const code = validated.code === "CAPABILITY_UNAVAILABLE" ? "FORBIDDEN" : "BAD_REQUEST";
    throw new TRPCError({ code, message: validated.message });
  }

  const before = (item.correctedPayload && typeof item.correctedPayload === "object"
    ? item.correctedPayload as Record<string, unknown> : {});
  const after = { ...before, ...validated.overlay };
  const fromRevision = item.correctionRevision;
  const toRevision   = params.expectedRevision + 1;

  // Optimistic lock: só avança se a revisão observada bater com a esperada.
  const [res] = await db.update(importStagingItems).set({
    correctedPayload:   after as unknown as object,
    correctionRevision: toRevision,
    correctedAt:        new Date(),
    correctedByUserId:  params.actorUserId,
  }).where(and(
    eq(importStagingItems.id,                 itemId),
    eq(importStagingItems.organizationId,     organizationId),
    eq(importStagingItems.correctionRevision, params.expectedRevision),
  ));

  const affected = (res as unknown as { affectedRows?: number }).affectedRows ?? 0;
  if (affected === 0) {
    // Nada mudou: pode ser replay idempotente concorrente (chave já aplicada) ou CONFLITO real.
    const raced = await db.select().from(importItemCorrections)
      .where(and(
        eq(importItemCorrections.organizationId, organizationId),
        eq(importItemCorrections.idempotencyKey, params.idempotencyKey),
      )).limit(1);
    if (raced.length > 0) {
      const fresh = await getStagingItem(itemId, organizationId);
      return { item: fresh ?? item, revision: fresh?.correctionRevision ?? item.correctionRevision, idempotent: true };
    }
    throw new TRPCError({
      code: "CONFLICT",
      message: "Este item foi alterado por outro revisor. Atualize os dados antes de continuar.",
    });
  }

  // Histórico imutável (após a projeção avançar). A unicidade (org,item,toRevision) e
  // (org,idempotencyKey) blinda contra dupla escrita; violação = já aplicado → idempotente.
  try {
    await db.insert(importItemCorrections).values({
      organizationId,
      procurementProcessId: params.procurementProcessId,
      importSessionId,
      stagingItemId:        itemId,
      fromRevision,
      toRevision,
      beforePayload:        before as unknown as object,
      afterPayload:         after as unknown as object,
      changedFields:        validated.changedFields as unknown as object,
      justification:        params.justification.trim(),
      actorUserId:          params.actorUserId,
      idempotencyKey:       params.idempotencyKey,
      correlationId:        params.correlationId ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/duplicate/i.test(msg)) {
      const fresh = await getStagingItem(itemId, organizationId);
      return { item: fresh ?? item, revision: fresh?.correctionRevision ?? toRevision, idempotent: true };
    }
    throw err;
  }

  const updated = await getStagingItem(itemId, organizationId);
  // OBS: sem conteúdo/overlay em log — apenas identificadores seguros.
  log.info("staging_item_corrected", {
    itemId, organizationId, importSessionId,
    procurementProcessId: params.procurementProcessId, toRevision,
    changedFields: validated.changedFields.length, correlationId: params.correlationId ?? null,
  });
  return { item: updated ?? item, revision: toRevision, idempotent: false };
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

export async function cleanupExpiredStaging(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.delete(importStagingItems)
    .where(
      // Drizzle MySQL doesn't expose lt() for timestamps in all versions — use raw SQL workaround
      eq(importStagingItems.reviewStatus, "pending"),
    );

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
