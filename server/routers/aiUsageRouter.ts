import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

/**
 * Router para dashboard de custos de IA
 * Acesso restrito a administradores
 */
export const aiUsageRouter = router({
  /**
   * Buscar estatísticas de uso de IA
   */
  getStats: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(), // ISO date string
        endDate: z.string().optional(),
        userId: z.number().optional(),
        operationType: z.enum(["embedding", "rag_query", "catmat_matching", "document_generation"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const filters: any = {};

      if (input.startDate) {
        filters.startDate = new Date(input.startDate);
      }
      if (input.endDate) {
        filters.endDate = new Date(input.endDate);
      }
      if (input.userId) {
        filters.userId = input.userId;
      }
      if (input.operationType) {
        filters.operationType = input.operationType;
      }

      return await db.getAIUsageStats(filters);
    }),

  /**
   * Buscar histórico de uso de IA (paginado)
   */
  getHistory: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        userId: z.number().optional(),
        operationType: z.enum(["embedding", "rag_query", "catmat_matching", "document_generation"]).optional(),
        limit: z.number().min(1).max(1000).default(100),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const filters: any = {
        limit: input.limit,
        offset: input.offset,
      };

      if (input.startDate) {
        filters.startDate = new Date(input.startDate);
      }
      if (input.endDate) {
        filters.endDate = new Date(input.endDate);
      }
      if (input.userId) {
        filters.userId = input.userId;
      }
      if (input.operationType) {
        filters.operationType = input.operationType;
      }

      return await db.getAIUsageHistory(filters);
    }),

  /**
   * Exportar dados de uso para CSV
   */
  exportCSV: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        userId: z.number().optional(),
        operationType: z.enum(["embedding", "rag_query", "catmat_matching", "document_generation"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const filters: any = {};

      if (input.startDate) {
        filters.startDate = new Date(input.startDate);
      }
      if (input.endDate) {
        filters.endDate = new Date(input.endDate);
      }
      if (input.userId) {
        filters.userId = input.userId;
      }
      if (input.operationType) {
        filters.operationType = input.operationType;
      }

      const csvContent = await db.exportAIUsageCSV(filters);

      return {
        filename: `ai-usage-${new Date().toISOString().split("T")[0]}.csv`,
        content: csvContent,
      };
    }),
});
