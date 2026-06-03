/**
 * Sprint 3.3 — Structured Export Router.
 *
 * JSON/XML exports for TR items, audit trails, and interoperability contracts.
 * Multi-tenant: organizationId required.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  exportItemTRsAsJson,
  exportItemTRsAsXml,
  exportAuditTrailAsJson,
  getInteroperabilityContract,
} from "../services/structuredExportService";
import type { StructuredExportSchema } from "../services/structuredExportService";
import { queryAuditEvents } from "../services/operationalAuditService";
import type { ItemTR } from "../domain/itemTR";

// In-memory item store reference (from other routers / DB)
// In tests, we use the in-memory store from itemTrRouter
// For simplicity, this router uses empty arrays when no items found
// Real integration would query the DB

export const structuredExportRouter = router({
  exportItemTRs: protectedProcedure
    .input(
      z.object({
        processId: z.number(),
        organizationId: z.number(),
        format: z.enum(["json", "xml"]),
      }),
    )
    .mutation(({ input }) => {
      // In production: query items from DB by processId + organizationId
      // For now: empty array (integration tests use domain functions directly)
      const items: ItemTR[] = [];
      if (input.format === "xml") {
        return exportItemTRsAsXml(items, input.organizationId);
      }
      return exportItemTRsAsJson(items, input.organizationId);
    }),

  exportAuditTrail: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        from: z.string().optional(),
        to: z.string().optional(),
        format: z.enum(["json", "xml"]).default("json"),
      }),
    )
    .mutation(({ input }) => {
      const events = queryAuditEvents({
        organizationId: input.organizationId,
        from: input.from,
        to: input.to,
      });
      return exportAuditTrailAsJson(events, input.organizationId);
    }),

  getContract: protectedProcedure
    .input(
      z.object({
        schema: z.enum(["item_tr_v1", "tr_v1", "audit_v1", "workflow_v1"]),
      }),
    )
    .query(({ input }) => {
      return getInteroperabilityContract(input.schema as StructuredExportSchema);
    }),
});
