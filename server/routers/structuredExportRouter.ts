/**
 * Sprint 3.3 — Structured Export Router.
 *
 * JSON/XML exports for TR items, audit trails, and interoperability contracts.
 * Multi-tenant: a organização vem do contexto autenticado (SEM-073).
 */

import { router } from "../_core/trpc";
// R2 / LEG-028 — API experimental em memória: gate governado (desligada em production/staging; dev só com opt-in).
import { experimentalTenantProcedure } from "../services/experimentalApiGate";
// SEM-073 — a organização vem do contexto autenticado; `organizationId` do input é só compatibilidade (divergente ⇒ recusa).
import { organizationFromContext } from "../services/experimentalApiGate";
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
  exportItemTRs: experimentalTenantProcedure
    .input(
      z.object({
        processId: z.number(),
        organizationId: z.number().optional(),
        format: z.enum(["json", "xml"]),
      }),
    )
    .mutation(({ input, ctx }) => {
      const organizationId = organizationFromContext(ctx, input.organizationId, "structuredExports.exportItemTRs");
      // In production: query items from DB by processId + organizationId
      // For now: empty array (integration tests use domain functions directly)
      const items: ItemTR[] = [];
      if (input.format === "xml") {
        return exportItemTRsAsXml(items, organizationId);
      }
      return exportItemTRsAsJson(items, organizationId);
    }),

  exportAuditTrail: experimentalTenantProcedure
    .input(
      z.object({
        organizationId: z.number().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        format: z.enum(["json", "xml"]).default("json"),
      }),
    )
    .mutation(({ input, ctx }) => {
      const organizationId = organizationFromContext(ctx, input.organizationId, "structuredExports.exportAuditTrail");
      const events = queryAuditEvents({
        organizationId,
        from: input.from,
        to: input.to,
      });
      return exportAuditTrailAsJson(events, organizationId);
    }),

  getContract: experimentalTenantProcedure
    .input(
      z.object({
        schema: z.enum(["item_tr_v1", "tr_v1", "audit_v1", "workflow_v1"]),
      }),
    )
    .query(({ input }) => {
      return getInteroperabilityContract(input.schema as StructuredExportSchema);
    }),
});
