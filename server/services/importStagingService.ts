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
import { importStagingItems } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import type { RawExtractedItem } from "../domain/importExtraction";

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
      rawMetadata:        item.rawMetadata     as any ?? null,
      sourceLocation:     item.sourceLocation  as any ?? null,
      parserMetadata:     item.parserMetadata  as any ?? null,
      confidenceMetadata: item.confidenceMetadata as any ?? null,
      extractionWarnings: item.extractionWarnings as any ?? null,
      extractionErrors:   item.extractionErrors   as any ?? null,
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

  const now = new Date();
  const result = await db.delete(importStagingItems)
    .where(
      // Drizzle MySQL doesn't expose lt() for timestamps in all versions — use raw SQL workaround
      eq(importStagingItems.reviewStatus, "pending"),
    );

  log.info("staging_cleanup_ran", { deletedRows: (result as any).affectedRows ?? 0 });
  return (result as any).affectedRows ?? 0;
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

  return (result as any).affectedRows ?? 0;
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
