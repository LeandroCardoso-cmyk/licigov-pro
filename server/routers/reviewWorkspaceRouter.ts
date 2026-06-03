/**
 * Sprint 3.1 — Review Workspace Router.
 *
 * Procedimentos para a central de revisão semântica de ItemTR.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { createHash } from "crypto";
import type { ItemTR } from "../domain/itemTR";
import type { ItemReviewState, ItemReviewTransition } from "../domain/itemReviewWorkflow";

// ─── In-memory demo store (independente do itemTrRouter) ──────────────────────

const itemStoreRef = new Map<string, ItemTR[]>();

function storeKey(organizationId: number, processId: number): string {
  return `${organizationId}:${processId}`;
}

function makeProv() {
  return {
    sourceFileId:   "mock-file-001",
    sourceFileName: "planilha.xlsx",
    sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sourceChecksum: "abc123",
    location:       { row: 1, column: "A" },
    parserType:     "xlsx",
    parserVersion:  "1.0.0",
    extractedAt:    new Date().toISOString(),
  };
}

function makeItem(
  organizationId: number,
  processId:      number,
  itemNumber:     number,
  description:    string,
  reviewState:    ItemReviewState,
  confidenceScore: number,
): ItemTR {
  const now       = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();

  const id = createHash("sha256")
    .update(JSON.stringify({ organizationId, processId, itemNumber, sourceImportSessionId: 1 }))
    .digest("hex")
    .slice(0, 32);

  return {
    id,
    organizationId,
    processId,
    sourceImportSessionId: 1,
    itemNumber,
    description,
    normalizedDescription: description.toLowerCase(),
    detailedSpecification: null,
    quantity:              10,
    unit:                  "UN",
    canonicalUnit:         "UN",
    estimatedUnitPrice:    100.0,
    estimatedTotalPrice:   1000.0,
    catmatCode:            confidenceScore > 0.6 ? `CATMAT-00${itemNumber}` : null,
    catmatDescription:     null,
    catserCode:            null,
    semanticCandidates:    [],
    selectedCandidate:     null,
    candidateConsensus:    null,
    confidenceScore,
    reviewState,
    reviewHistory:         [],
    approvedBy:            reviewState === "approved" ? 1 : null,
    approvedAt:            reviewState === "approved" ? yesterday : null,
    provenance:            makeProv(),
    evidenceRef:           null,
    warnings:              [],
    metadata:              {},
    createdAt:             yesterday,
    updatedAt:             now,
  };
}

function initializeDemoStore(organizationId: number, processId: number): ItemTR[] {
  const key = storeKey(organizationId, processId);
  if (itemStoreRef.has(key)) return itemStoreRef.get(key)!;

  const items: ItemTR[] = [
    makeItem(organizationId, processId, 1, "Notebook Dell Latitude 5440 Core i5 16GB SSD 512GB", "awaiting_review", 0.92),
    makeItem(organizationId, processId, 2, "Mouse óptico sem fio USB", "awaiting_review", 0.88),
    makeItem(organizationId, processId, 3, "Teclado ABNT2 USB", "approved", 0.95),
    makeItem(organizationId, processId, 4, "Monitor LED 24 polegadas Full HD", "candidate_generated", 0.78),
    makeItem(organizationId, processId, 5, "Headset USB com microfone", "pending_match", 0.55),
    makeItem(organizationId, processId, 6, "Webcam Full HD USB", "rejected", 0.62),
  ];

  itemStoreRef.set(key, items);
  return items;
}

function getAllItems(organizationId: number, processId?: number): ItemTR[] {
  return initializeDemoStore(organizationId, processId ?? 1);
}

// ─── State ordering for queue ─────────────────────────────────────────────────

const STATE_ORDER: Record<ItemReviewState, number> = {
  awaiting_review:     0,
  candidate_generated: 1,
  pending_match:       2,
  manual_entry:        3,
  approved:            4,
  overridden:          5,
  rejected:            6,
  finalized:           7,
};

// ─── Router ───────────────────────────────────────────────────────────────────

const itemReviewStateSchema = z.enum([
  "pending_match",
  "candidate_generated",
  "awaiting_review",
  "approved",
  "rejected",
  "overridden",
  "manual_entry",
  "finalized",
]);

export const reviewWorkspaceRouter = router({
  getQueue: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      processId:      z.number().optional(),
      filterState:    itemReviewStateSchema.optional(),
    }))
    .query(({ input }) => {
      let items = getAllItems(input.organizationId, input.processId);
      if (input.filterState) {
        items = items.filter(i => i.reviewState === input.filterState);
      }
      return [...items].sort((a, b) => {
        const oa = STATE_ORDER[a.reviewState] ?? 99;
        const ob = STATE_ORDER[b.reviewState] ?? 99;
        if (oa !== ob) return oa - ob;
        return a.itemNumber - b.itemNumber;
      });
    }),

  getReviewHistory: protectedProcedure
    .input(z.object({
      itemId:         z.string(),
      organizationId: z.number(),
      processId:      z.number().optional(),
    }))
    .query(({ input }) => {
      const items = getAllItems(input.organizationId, input.processId);
      const item  = items.find(i => i.id === input.itemId);
      if (!item) {
        return {
          history:      [] as ItemReviewTransition[],
          currentState: "pending_match" as ItemReviewState,
        };
      }
      return {
        history:      item.reviewHistory,
        currentState: item.reviewState,
      };
    }),

  getSummary: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      processId:      z.number().optional(),
    }))
    .query(({ input }) => {
      const items = getAllItems(input.organizationId, input.processId);
      const today = new Date().toDateString();

      const pendingCount  = items.filter(i =>
        i.reviewState === "awaiting_review" ||
        i.reviewState === "pending_match" ||
        i.reviewState === "candidate_generated",
      ).length;
      const approvedToday = items.filter(i =>
        i.reviewState === "approved" &&
        i.approvedAt != null &&
        new Date(i.approvedAt).toDateString() === today,
      ).length;
      const rejectedToday = items.filter(i => i.reviewState === "rejected").length;
      const avgConfidence = items.length > 0
        ? items.reduce((sum, i) => sum + i.confidenceScore, 0) / items.length
        : 0;

      return {
        pendingCount,
        approvedToday,
        rejectedToday,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
      };
    }),
});
