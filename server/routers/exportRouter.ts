/**
 * Sprint 3.2 — Export Router.
 *
 * tRPC procedures for DOCX/PDF export generation.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  generateDocx,
  generatePdf,
  buildExportAuditEntry,
  type ExportRequest,
  type ExportAuditEntry,
} from "../services/officialExportEngine";
import { createSection, createClause } from "../domain/trComposition";

// ─── In-memory export history ────────────────────────────────────────────────

const exportHistory: ExportAuditEntry[] = [];

export const exportRouter = router({
  generate: protectedProcedure
    .input(z.object({
      processId:      z.number(),
      organizationId: z.number(),
      format:         z.enum(["docx", "pdf"]),
      watermark:      z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const requestId = `exp_${Date.now()}_${input.processId}`;

      // Build a default section set for the export
      const defaultSections = [
        createSection("Objeto", [
          createClause("body", `Contratacao referente ao Processo ${input.processId}.`, { isRequired: true }),
        ], 1),
        createSection("Justificativa", [
          createClause("justification", "Justificativa tecnica conforme Lei 14.133/2021.", { isRequired: true, legalBasis: "Art. 18, Lei 14.133/2021" }),
        ], 2),
        createSection("Especificacoes", [
          createClause("specification", "Especificacoes tecnicas do objeto.", { isRequired: true }),
        ], 3),
      ];

      const request: ExportRequest = {
        id: requestId,
        organizationId: input.organizationId,
        processId: input.processId,
        format: input.format,
        sections: defaultSections,
        metadata: {
          processNumber: String(input.processId),
          year: new Date().getFullYear(),
          orgName: "Organizacao",
        },
        watermark: input.watermark ?? null,
        templateId: null,
        correlationId: requestId,
      };

      const result = input.format === "docx"
        ? await generateDocx(request)
        : await generatePdf(request);

      const auditEntry = buildExportAuditEntry(
        result,
        String(ctx.user.id),
        request,
      );
      exportHistory.push(auditEntry);

      return {
        exportId:    result.id,
        filename:    result.filename,
        contentHash: result.contentHash,
        pageCount:   result.pageCount,
      };
    }),

  getHistory: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      processId:      z.number().optional(),
      limit:          z.number().optional(),
    }))
    .query(({ input }) => {
      let filtered = exportHistory.filter(
        e => e.organizationId === input.organizationId,
      );
      if (input.processId) {
        filtered = filtered.filter(e => e.processId === input.processId);
      }
      if (input.limit) {
        filtered = filtered.slice(-input.limit);
      }
      return filtered;
    }),

  getPreview: protectedProcedure
    .input(z.object({
      processId:      z.number(),
      organizationId: z.number(),
    }))
    .query(({ input }) => {
      const sections = [
        createSection("Objeto", [
          createClause("body", `Contratacao referente ao Processo ${input.processId}.`, { isRequired: true }),
        ], 1),
        createSection("Justificativa", [
          createClause("justification", "Justificativa tecnica conforme Lei 14.133/2021.", { isRequired: true, legalBasis: "Art. 18, Lei 14.133/2021" }),
        ], 2),
      ];
      return { sections, itemCount: sections.length };
    }),
});
