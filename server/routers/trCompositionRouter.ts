/**
 * Sprint 3.1 — TR Composition Router.
 *
 * Procedimentos para composição e status do Termo de Referência.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  composeTR,
  composeItemSection,
  type TRIntelligenceInput,
  type TRIntelligenceResult,
} from "../services/trIntelligenceEngine";
import { createItemTR } from "../domain/itemTR";
import type { ItemTR } from "../domain/itemTR";

// ─── Demo data for composition ────────────────────────────────────────────────

function getMockApprovedItems(organizationId: number, processId: number): ItemTR[] {
  const now = new Date().toISOString();

  function prov() {
    return {
      sourceFileId:   "mock-001",
      sourceFileName: "planilha.xlsx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceChecksum: "abc123",
      location:       { row: 1, column: "A" },
      parserType:     "xlsx",
      parserVersion:  "1.0.0",
      extractedAt:    now,
    };
  }

  const approved1 = createItemTR({
    organizationId,
    processId,
    itemNumber:    1,
    description:   "Notebook Dell Latitude Core i5 16GB SSD 512GB",
    unit:          "UN",
    quantity:      10,
    estimatedUnitPrice: 4500.00,
    normalizedDescription: "notebook dell latitude core i5 16gb ssd",
    canonicalUnit: "UN",
    catmatCode:    "CATMAT-001",
    catmatDescription: "Microcomputador Portátil",
    confidenceScore: 0.92,
    provenance:    prov(),
    sourceImportSessionId: 1,
  });

  const approved2 = createItemTR({
    organizationId,
    processId,
    itemNumber:    3,
    description:   "Teclado ABNT2 USB padrão brasileiro",
    unit:          "UN",
    quantity:      50,
    estimatedUnitPrice: 120.00,
    normalizedDescription: "teclado abnt2 usb padrao brasileiro",
    canonicalUnit: "UN",
    catmatCode:    "CATMAT-003",
    catmatDescription: "Teclado para Computador ABNT2",
    confidenceScore: 0.95,
    provenance:    prov(),
    sourceImportSessionId: 1,
  });

  // Mark as approved for composition purposes
  return [
    { ...approved1, reviewState: "approved" as const, approvedBy: 1, approvedAt: now },
    { ...approved2, reviewState: "approved" as const, approvedBy: 1, approvedAt: now },
  ];
}

// ─── Status store ─────────────────────────────────────────────────────────────

const statusStore = new Map<string, "not_started" | "in_progress" | "completed">();

function statusKey(processId: number, organizationId: number): string {
  return `${organizationId}:${processId}`;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const trCompositionRouter = router({
  compose: protectedProcedure
    .input(z.object({
      processId:      z.number(),
      organizationId: z.number(),
    }))
    .mutation(({ input }) => {
      const items = getMockApprovedItems(input.organizationId, input.processId);

      const trInput: TRIntelligenceInput = {
        items,
        processContext: {
          processNumber: `PROC-${input.processId}-${input.organizationId}`,
          modality:      "pregão eletrônico",
          objectSummary: "Aquisição de equipamentos de tecnologia da informação",
        },
        organizationId: input.organizationId,
      };

      const result: TRIntelligenceResult = composeTR(trInput);

      // Mark as completed
      statusStore.set(statusKey(input.processId, input.organizationId), "completed");

      return result;
    }),

  getStatus: protectedProcedure
    .input(z.object({
      processId:      z.number(),
      organizationId: z.number(),
    }))
    .query(({ input }) => {
      const key    = statusKey(input.processId, input.organizationId);
      const status = statusStore.get(key) ?? "not_started";

      // Compute section count from mock approved items
      const items        = getMockApprovedItems(input.organizationId, input.processId);
      const itemSection  = composeItemSection(items);
      const sectionsCount = status === "completed" ? 2 : (status === "in_progress" ? 1 : 0);

      return {
        status,
        sectionsCount,
      };
    }),
});
