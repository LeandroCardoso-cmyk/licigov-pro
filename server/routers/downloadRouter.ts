import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { generatePublicationZip } from "../services/zipService";

/**
 * Router para downloads de pacotes e documentos
 */
export const downloadRouter = router({
  /**
   * Baixar pacote completo de publicação (ZIP)
   */
  publicationPackage: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se o usuário é dono do processo
      const process = await db.getProcessById(input.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new Error("Processo não encontrado ou sem permissão");
      }

      try {
        // Gerar ZIP
        const { buffer, filename } = await generatePublicationZip(
          input.processId,
          process.platformId
        );

        // Converter buffer para base64 para enviar ao cliente
        const base64 = buffer.toString("base64");

        // Registrar atividade
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: "baixou pacote de publicação",
          details: JSON.stringify({ filename }),
        });

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
  itemsSpreadsheet: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se o usuário é dono do processo
      const process = await db.getProcessById(input.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new Error("Processo não encontrado ou sem permissão");
      }

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
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: "baixou planilha de itens",
          details: JSON.stringify({ filename }),
        });

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
});
