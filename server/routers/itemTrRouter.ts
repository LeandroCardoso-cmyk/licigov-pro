/**
 * Sprint 3.1 — ItemTR Router.
 *
 * tRPC router para operações sobre ItemTR (in-memory demo store).
 * Contratos de tipo corretos; persistência real virá na Sprint 3.2.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createItemTR,
  computeItemTRId,
  approveItem,
  rejectItem,
  overrideItem,
  selectCandidate as selectCandidateFn,
  type ItemTR,
} from "../domain/itemTR";
import {
  type ItemReviewState,
} from "../domain/itemReviewWorkflow";
import {
  computeItemAnalytics,
  type ItemLifecycleData,
} from "../services/itemAnalyticsService";
import type { ReviewActor } from "../domain/importReviewState";

// ─── In-memory demo store ─────────────────────────────────────────────────────

// Map<organizationId-processId, ItemTR[]>
const itemStore = new Map<string, ItemTR[]>();

function storeKey(organizationId: number, processId: number): string {
  return `${organizationId}:${processId}`;
}

function makeMockProvenance() {
  return {
    sourceFileId:   "mock-file-001",
    sourceFileName: "planilha-itens.xlsx",
    sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sourceChecksum: "abc123def456",
    location:       { row: 1, column: "A", sheet: "Itens" },
    parserType:     "xlsx",
    parserVersion:  "1.0.0",
    extractedAt:    new Date().toISOString(),
  };
}

function makeMockCandidate(id: string, description: string, score: number, rank: number) {
  return {
    id,
    stagingItemId:       "staging-001",
    importSessionId:     1,
    organizationId:      1,
    proposedDescription: description,
    proposedUnit:        "UN",
    proposedQuantity:    null,
    proposedUnitPrice:   null,
    score,
    rank,
    source:  "token_match" as const,
    status:  "pending" as const,
    explanation: {
      reason:    "Correspondência por tokens",
      matchedOn: ["computador", "notebook"],
      penalty:   0,
      bonus:     0.05,
    },
    originalRaw:  description,
    catmatCode:   `CATMAT-${rank}`,
    catmatDesc:   `Descrição oficial CATMAT ${rank}`,
    catmatGroup:  "Equipamentos de TI",
    generatedAt:  new Date().toISOString(),
  };
}

function initializeDemoStore(organizationId: number, processId: number): ItemTR[] {
  const key = storeKey(organizationId, processId);
  if (itemStore.has(key)) return itemStore.get(key)!;

  const prov = makeMockProvenance();
  const now  = new Date().toISOString();

  const items: ItemTR[] = [
    {
      ...createItemTR({
        organizationId, processId, itemNumber: 1,
        description: "Notebook Dell Latitude 5440, Core i5, 16GB RAM, SSD 512GB",
        unit: "UN", quantity: 10,
        estimatedUnitPrice: 4500.00,
        normalizedDescription: "notebook dell latitude core i5 16gb ssd 512gb",
        canonicalUnit: "UN",
        catmatCode: "CATMAT-001",
        catmatDescription: "Microcomputador Portátil",
        confidenceScore: 0.92,
        provenance: prov,
        semanticCandidates: [
          makeMockCandidate("cand-001a", "Notebook Dell Latitude 5440 Core i5 16GB 512GB SSD", 0.92, 1),
          makeMockCandidate("cand-001b", "Notebook Dell Core i5 16GB RAM 512GB SSD", 0.85, 2),
        ],
        sourceImportSessionId: 1,
      }),
      reviewState: "awaiting_review",
    },
    {
      ...createItemTR({
        organizationId, processId, itemNumber: 2,
        description: "Mouse óptico sem fio USB 2.4GHz",
        unit: "UN", quantity: 50,
        estimatedUnitPrice: 85.00,
        normalizedDescription: "mouse optico sem fio usb",
        canonicalUnit: "UN",
        catmatCode: "CATMAT-002",
        catmatDescription: "Mouse para Computador",
        confidenceScore: 0.88,
        provenance: prov,
        semanticCandidates: [
          makeMockCandidate("cand-002a", "Mouse Óptico USB sem fio 2.4GHz", 0.88, 1),
        ],
        sourceImportSessionId: 1,
      }),
      reviewState: "awaiting_review",
    },
    {
      ...createItemTR({
        organizationId, processId, itemNumber: 3,
        description: "Teclado ABNT2 USB padrão brasileiro",
        unit: "UN", quantity: 50,
        estimatedUnitPrice: 120.00,
        normalizedDescription: "teclado abnt2 usb padrao brasileiro",
        canonicalUnit: "UN",
        catmatCode: "CATMAT-003",
        catmatDescription: "Teclado para Computador ABNT2",
        confidenceScore: 0.95,
        provenance: prov,
        semanticCandidates: [
          makeMockCandidate("cand-003a", "Teclado ABNT2 USB padrão brasileiro", 0.95, 1),
        ],
        sourceImportSessionId: 1,
      }),
      reviewState: "approved",
      approvedBy: 1,
      approvedAt: now,
    },
    {
      ...createItemTR({
        organizationId, processId, itemNumber: 4,
        description: "Monitor LED 24 polegadas Full HD HDMI",
        unit: "UN", quantity: 20,
        estimatedUnitPrice: 950.00,
        normalizedDescription: "monitor led 24 polegadas full hd hdmi",
        canonicalUnit: "UN",
        catmatCode: "CATMAT-004",
        catmatDescription: "Monitor de Vídeo LED 24\"",
        confidenceScore: 0.78,
        provenance: prov,
        semanticCandidates: [
          makeMockCandidate("cand-004a", "Monitor LED 24\" Full HD HDMI VGA", 0.78, 1),
          makeMockCandidate("cand-004b", "Monitor de Vídeo 24 polegadas LED", 0.70, 2),
        ],
        sourceImportSessionId: 1,
      }),
      reviewState: "candidate_generated",
    },
    {
      ...createItemTR({
        organizationId, processId, itemNumber: 5,
        description: "Headset USB com microfone e cancelamento de ruído",
        unit: "UN", quantity: 30,
        estimatedUnitPrice: 280.00,
        normalizedDescription: "headset usb microfone cancelamento ruido",
        canonicalUnit: "UN",
        confidenceScore: 0.55,
        provenance: prov,
        semanticCandidates: [],
        sourceImportSessionId: 1,
      }),
      reviewState: "pending_match",
    },
    {
      ...createItemTR({
        organizationId, processId, itemNumber: 6,
        description: "Webcam Full HD 1080p USB com microfone integrado",
        unit: "UN", quantity: 25,
        estimatedUnitPrice: 350.00,
        normalizedDescription: "webcam full hd 1080p usb microfone integrado",
        canonicalUnit: "UN",
        catmatCode: "CATMAT-006",
        catmatDescription: "Câmera de Vídeo para Computador",
        confidenceScore: 0.83,
        provenance: prov,
        semanticCandidates: [
          makeMockCandidate("cand-006a", "Webcam USB Full HD 1080p com microfone", 0.83, 1),
        ],
        sourceImportSessionId: 1,
      }),
      reviewState: "rejected",
    },
  ];

  itemStore.set(key, items);
  return items;
}

function getItems(organizationId: number, processId: number): ItemTR[] {
  return initializeDemoStore(organizationId, processId);
}

function setItems(organizationId: number, processId: number, items: ItemTR[]): void {
  itemStore.set(storeKey(organizationId, processId), items);
}

function findItem(organizationId: number, processId: number, id: string): ItemTR | undefined {
  return getItems(organizationId, processId).find(i => i.id === id);
}

// Find item across all processes for this org (getById)
function findItemById(id: string, organizationId: number): ItemTR | undefined {
  for (const [key, items] of itemStore.entries()) {
    if (!key.startsWith(`${organizationId}:`)) continue;
    const found = items.find(i => i.id === id);
    if (found) return found;
  }
  return undefined;
}

function replaceItem(organizationId: number, processId: number, updated: ItemTR): void {
  const items = getItems(organizationId, processId);
  setItems(organizationId, processId, items.map(i => (i.id === updated.id ? updated : i)));
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

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

// ─── Router ───────────────────────────────────────────────────────────────────

export const itemTrRouter = router({
  list: protectedProcedure
    .input(z.object({
      processId:      z.number(),
      organizationId: z.number(),
      reviewState:    itemReviewStateSchema.optional(),
      page:           z.number().min(1).default(1),
      pageSize:       z.number().min(1).max(100).default(20),
    }))
    .query(({ input }) => {
      // Ensure demo store is seeded
      const all = getItems(input.organizationId, input.processId);
      let filtered = all;
      if (input.reviewState) {
        filtered = all.filter(i => i.reviewState === input.reviewState);
      }
      const start = (input.page - 1) * input.pageSize;
      const items = filtered.slice(start, start + input.pageSize);
      return { items, total: filtered.length };
    }),

  getById: protectedProcedure
    .input(z.object({
      id:             z.string(),
      organizationId: z.number(),
    }))
    .query(({ input }) => {
      // seed all demo processes
      initializeDemoStore(input.organizationId, 1);
      const item = findItemById(input.id, input.organizationId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado" });
      return item;
    }),

  approve: protectedProcedure
    .input(z.object({
      id:             z.string(),
      organizationId: z.number(),
      processId:      z.number().default(1),
      actorUserId:    z.number(),
    }))
    .mutation(({ input }) => {
      const items = getItems(input.organizationId, input.processId);
      const item  = items.find(i => i.id === input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado" });
      const actor: ReviewActor = {
        type:           "human",
        userId:         input.actorUserId,
        organizationId: input.organizationId,
      };
      try {
        const updated = approveItem(item, actor);
        replaceItem(input.organizationId, input.processId, updated);
        return { success: true as const, item: updated };
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (err as Error).message });
      }
    }),

  reject: protectedProcedure
    .input(z.object({
      id:             z.string(),
      organizationId: z.number(),
      processId:      z.number().default(1),
      actorUserId:    z.number(),
      reason:         z.string().min(1, "Motivo de rejeição obrigatório"),
    }))
    .mutation(({ input }) => {
      const items = getItems(input.organizationId, input.processId);
      const item  = items.find(i => i.id === input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado" });
      const actor: ReviewActor = {
        type:           "human",
        userId:         input.actorUserId,
        organizationId: input.organizationId,
      };
      try {
        const updated = rejectItem(item, actor, input.reason);
        replaceItem(input.organizationId, input.processId, updated);
        return { success: true as const, item: updated };
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (err as Error).message });
      }
    }),

  override: protectedProcedure
    .input(z.object({
      id:             z.string(),
      organizationId: z.number(),
      processId:      z.number().default(1),
      actorUserId:    z.number(),
      overrides:      z.object({
        quantity:           z.number().optional(),
        estimatedUnitPrice: z.number().optional(),
        description:        z.string().optional(),
        canonicalUnit:      z.string().optional(),
      }),
      justification:  z.string().min(5, "Justificativa deve ter no mínimo 5 caracteres"),
    }))
    .mutation(({ input }) => {
      const items = getItems(input.organizationId, input.processId);
      const item  = items.find(i => i.id === input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado" });
      const actor: ReviewActor = {
        type:           "human",
        userId:         input.actorUserId,
        organizationId: input.organizationId,
      };
      try {
        const updated = overrideItem(item, actor, input.overrides, input.justification);
        replaceItem(input.organizationId, input.processId, updated);
        return { success: true as const, item: updated };
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (err as Error).message });
      }
    }),

  selectCandidate: protectedProcedure
    .input(z.object({
      id:             z.string(),
      organizationId: z.number(),
      processId:      z.number().default(1),
      candidateId:    z.string(),
      actorUserId:    z.number(),
    }))
    .mutation(({ input }) => {
      const items = getItems(input.organizationId, input.processId);
      const item  = items.find(i => i.id === input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado" });
      const actor: ReviewActor = {
        type:           "human",
        userId:         input.actorUserId,
        organizationId: input.organizationId,
      };
      try {
        const updated = selectCandidateFn(item, input.candidateId, actor);
        replaceItem(input.organizationId, input.processId, updated);
        return { success: true as const, item: updated };
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (err as Error).message });
      }
    }),

  bulkApprove: protectedProcedure
    .input(z.object({
      ids:            z.array(z.string()),
      organizationId: z.number(),
      processId:      z.number().default(1),
      actorUserId:    z.number(),
    }))
    .mutation(({ input }) => {
      const actor: ReviewActor = {
        type:           "human",
        userId:         input.actorUserId,
        organizationId: input.organizationId,
      };
      const approved: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];

      for (const id of input.ids) {
        const items = getItems(input.organizationId, input.processId);
        const item  = items.find(i => i.id === id);
        if (!item) {
          failed.push({ id, error: "Item não encontrado" });
          continue;
        }
        try {
          const updated = approveItem(item, actor);
          replaceItem(input.organizationId, input.processId, updated);
          approved.push(id);
        } catch (err) {
          failed.push({ id, error: (err as Error).message });
        }
      }

      return { approved, failed };
    }),

  bulkReject: protectedProcedure
    .input(z.object({
      ids:            z.array(z.string()),
      organizationId: z.number(),
      processId:      z.number().default(1),
      actorUserId:    z.number(),
      reason:         z.string().min(1),
    }))
    .mutation(({ input }) => {
      const actor: ReviewActor = {
        type:           "human",
        userId:         input.actorUserId,
        organizationId: input.organizationId,
      };
      const rejected: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];

      for (const id of input.ids) {
        const items = getItems(input.organizationId, input.processId);
        const item  = items.find(i => i.id === id);
        if (!item) {
          failed.push({ id, error: "Item não encontrado" });
          continue;
        }
        try {
          const updated = rejectItem(item, actor, input.reason);
          replaceItem(input.organizationId, input.processId, updated);
          rejected.push(id);
        } catch (err) {
          failed.push({ id, error: (err as Error).message });
        }
      }

      return { rejected, failed };
    }),

  getAnalytics: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      processId:      z.number().optional(),
    }))
    .query(({ input }) => {
      const processId = input.processId ?? 1;
      const items = getItems(input.organizationId, processId);

      const lifecycleData: ItemLifecycleData[] = items.map(item => ({
        itemId:            item.id,
        organizationId:    item.organizationId,
        reviewState:       item.reviewState,
        hadCandidates:     item.semanticCandidates.length > 0,
        selectedCandidate: item.selectedCandidate !== null,
        overridden:        item.reviewState === "overridden",
        manualEntry:       item.reviewState === "manual_entry",
        catalogLinked:     item.catmatCode !== null || item.catserCode !== null,
        catalogCorrect:    item.reviewState === "approved" || item.reviewState === "finalized",
        confidenceScore:   item.confidenceScore,
        reviewLatencyMs:   item.approvedAt && item.createdAt
          ? new Date(item.approvedAt).getTime() - new Date(item.createdAt).getTime()
          : null,
      }));

      return computeItemAnalytics(input.organizationId, lifecycleData);
    }),
});
