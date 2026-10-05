/**
 * Sprint 3.2 — Export Router.
 *
 * tRPC procedures for DOCX/PDF export generation.
 */

import { router } from "../_core/trpc";
// R2 / LEG-028 — API experimental em memória: gate governado (desligada em production/staging; dev só com opt-in).
import { experimentalTenantProcedure } from "../services/experimentalApiGate";
// SEM-073 — a organização vem do contexto autenticado; `organizationId` do input é só compatibilidade (divergente ⇒ recusa).
import { organizationFromContext } from "../services/experimentalApiGate";
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
  generate: experimentalTenantProcedure
    .input(z.object({
      processId:      z.number(),
      organizationId: z.number().optional(),
      format:         z.enum(["docx", "pdf"]),
      watermark:      z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const organizationId = organizationFromContext(ctx, input.organizationId, "exports.generate");
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
        organizationId,
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

  getHistory: experimentalTenantProcedure
    .input(z.object({
      organizationId: z.number().optional(),
      processId:      z.number().optional(),
      limit:          z.number().optional(),
    }))
    .query(({ input, ctx }) => {
      const organizationId = organizationFromContext(ctx, input.organizationId, "exports.getHistory");
      let filtered = exportHistory.filter(
        e => e.organizationId === organizationId,
      );
      if (input.processId) {
        filtered = filtered.filter(e => e.processId === input.processId);
      }
      if (input.limit) {
        filtered = filtered.slice(-input.limit);
      }
      return filtered;
    }),

  getPreview: experimentalTenantProcedure
    .input(z.object({
      processId:      z.number(),
      organizationId: z.number().optional(),
    }))
    .query(({ input, ctx }) => {
      organizationFromContext(ctx, input.organizationId, "exports.getPreview");
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
