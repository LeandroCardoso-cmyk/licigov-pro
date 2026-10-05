import { z } from "zod";
import { tenantProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { generatePublicationZip } from "../services/zipService";
import { generateProcessReport } from "../services/processReportService";
import { requireOwnedProcessInTenant } from "../services/legacyProcessAccess";

/**
 * Router para downloads de pacotes e documentos
 *
 * SEM-086 — `tenantProcedure` (membership ATIVA vigente) + processo buscado na organização do contexto + autoria
 * (`requireOwnedProcessInTenant`); o log de atividade leva o `organizationId` do contexto (SEM-046).
 */
export const downloadRouter = router({
  /**
   * Baixar pacote completo de publicação (ZIP)
   */
  publicationPackage: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se o usuário é dono do processo
      const process = await requireOwnedProcessInTenant(ctx, input.processId);

      try {
        // Gerar ZIP
        const { buffer, filename } = await generatePublicationZip(
          input.processId,
          process.platformId
        );

        // Converter buffer para base64 para enviar ao cliente
        const base64 = buffer.toString("base64");

        // Registrar atividade
        await db.createActivityLogForOrganization({
          processId: input.processId,
          userId: ctx.user.id,
          action: "baixou pacote de publicação",
          details: JSON.stringify({ filename }),
        }, ctx.organizationId);

        return {
          success: true,
          filename,
          data: base64,
          mimeType: "application/zip",
        };
      } catch (error) {
        console.error("Erro ao gerar pacote de publicação:", error);
        throw new Error("Falha ao gerar pacote de publicação. Tente novamente.");
      }
    }),

  /**
   * Baixar planilha de itens (XLSX)
   */
  itemsSpreadsheet: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se o usuário é dono do processo
      const process = await requireOwnedProcessInTenant(ctx, input.processId);

      try {
        const { generateItemsSpreadsheet, getSpreadsheetFileName } = await import("../services/excelService");

        // Gerar planilha
        const buffer = await generateItemsSpreadsheet(
          input.processId,
          process.platformId
        );

        const platform = process.platformId
          ? await db.getPlatformById(process.platformId)
          : null;

        const filename = getSpreadsheetFileName(
          process.name,
          platform?.slug || null
        );

        // Converter buffer para base64
        const base64 = buffer.toString("base64");

        // Registrar atividade
        await db.createActivityLogForOrganization({
          processId: input.processId,
          userId: ctx.user.id,
          action: "baixou planilha de itens",
          details: JSON.stringify({ filename }),
        }, ctx.organizationId);

        return {
          success: true,
          filename,
          data: base64,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
      } catch (error) {
        console.error("Erro ao gerar planilha:", error);
        throw new Error("Falha ao gerar planilha. Tente novamente.");
      }
    }),

  /**
   * Baixar checklist em PDF
   */
  checklistPDF: tenantProcedure
    .input(z.object({ processId: z.number(), platformId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se o usuário é dono do processo
      const process = await requireOwnedProcessInTenant(ctx, input.processId);

      try {
        const { generateChecklistPDF, getChecklistFileName } = await import("../services/pdfChecklistService");

        // Gerar PDF
        const buffer = await generateChecklistPDF(
          input.processId,
          input.platformId
        );

        const platform = await db.getPlatformById(input.platformId);
        const filename = getChecklistFileName(
          process.name,
          platform?.name || "Plataforma"
        );

        // Converter buffer para base64
        const base64 = buffer.toString("base64");

        // Registrar atividade
        await db.createActivityLogForOrganization({
          processId: input.processId,
          userId: ctx.user.id,
          action: "baixou checklist em PDF",
          details: JSON.stringify({ filename }),
        }, ctx.organizationId);

        return {
          success: true,
          filename,
          data: base64,
          mimeType: "application/pdf",
        };
      } catch (error) {
        console.error("Erro ao gerar checklist PDF:", error);
        throw new Error("Falha ao gerar checklist. Tente novamente.");
      }
    }),

  /**
   * Baixar relatório completo do processo em PDF
   */
  processReport: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se o usuário é dono do processo
      const process = await requireOwnedProcessInTenant(ctx, input.processId);

      try {
        // Gerar PDF do relatório
        const buffer = await generateProcessReport(input.processId);

        const filename = `RELATORIO_${process.name.replace(/\s+/g, "_").toUpperCase()}.pdf`;

        // Converter buffer para base64
        const base64 = buffer.toString("base64");

        // Registrar atividade
        await db.createActivityLogForOrganization({
          processId: input.processId,
          userId: ctx.user.id,
          action: "baixou relatório do processo",
          details: JSON.stringify({ filename }),
        }, ctx.organizationId);

        return {
          success: true,
          filename,
          data: base64,
          mimeType: "application/pdf",
        };
      } catch (error) {
        console.error("Erro ao gerar relatório:", error);
        throw new Error("Falha ao gerar relatório. Tente novamente.");
      }
    }),
});
