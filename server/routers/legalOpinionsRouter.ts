import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { exportLegalOpinionToPDF, exportLegalOpinionToDOCX } from "../services/legalOpinionExportService";
import { getDocumentSettingsByUser } from "../db";
import {
  createLegalOpinion,
  getLegalOpinions,
  getLegalOpinionById,
  updateLegalOpinion,
  deleteLegalOpinion,
  getLegalOpinionsBySource,
  getProcessById,
  getDirectContractById,
  getContractById,
} from "../db";
import { generateLegalOpinion } from "../services/legalOpinionService";

export const legalOpinionsRouter = router({
  /**
   * Listar pareceres jurídicos com filtros opcionais
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["draft", "in_review", "approved", "archived"]).optional(),
        sourceType: z.enum(["process", "direct_contract", "contract", "other"]).optional(),
        requestedBy: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return await getLegalOpinions(input);
    }),

  /**
   * Buscar parecer jurídico por ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const opinion = await getLegalOpinionById(input.id);
      if (!opinion) {
        throw new Error("Parecer jurídico não encontrado");
      }
      return opinion;
    }),

  /**
   * Buscar pareceres por fonte (processo, contratação direta, etc)
   */
  getBySource: protectedProcedure
    .input(
      z.object({
        sourceType: z.enum(["process", "direct_contract", "contract", "other"]),
        sourceId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return await getLegalOpinionsBySource(input.sourceType, input.sourceId);
    }),

  /**
   * Criar novo parecer jurídico
   */
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1, "Título é obrigatório"),
        description: z.string().optional(),
        sourceType: z.enum(["process", "direct_contract", "contract", "other"]),
        sourceId: z.number().optional(),
        legalQuestion: z.string().min(10, "Questão jurídica deve ter pelo menos 10 caracteres"),
        context: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const opinionId = await createLegalOpinion({
        ...input,
        requestedBy: ctx.user.id,
        status: "draft",
      });

      return { id: opinionId };
    }),

  /**
   * Atualizar parecer jurídico
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        legalQuestion: z.string().optional(),
        context: z.string().optional(),
        opinion: z.string().optional(),
        conclusion: z.enum(["favorable", "unfavorable", "with_reservations"]).optional(),
        citedArticles: z.array(z.string()).optional(),
        jurisprudence: z.array(z.any()).optional(),
        status: z.enum(["draft", "in_review", "approved", "archived"]).optional(),
        reviewedBy: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      
      // Se está sendo aprovado, adicionar reviewedBy e reviewedAt
      if (data.status === "approved") {
        await updateLegalOpinion(id, {
          ...data,
          reviewedAt: new Date(),
        });
      } else {
        await updateLegalOpinion(id, data);
      }

      return { success: true };
    }),

  /**
   * Deletar parecer jurídico
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteLegalOpinion(input.id);
      return { success: true };
    }),

  /**
   * Exportar parecer em PDF
   */
  exportPDF: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const opinion = await getLegalOpinionById(input.id);
      if (!opinion) {
        throw new Error("Parecer não encontrado");
      }

      const settings = await getDocumentSettingsByUser(ctx.user.id);
      const pdfBuffer = await exportLegalOpinionToPDF(opinion, settings || {});

      return {
        buffer: pdfBuffer.toString("base64"),
        filename: `parecer-juridico-${opinion.id}.pdf`,
      };
    }),

  /**
   * Exportar parecer em DOCX
   */
  exportDOCX: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const opinion = await getLegalOpinionById(input.id);
      if (!opinion) {
        throw new Error("Parecer não encontrado");
      }

      const settings = await getDocumentSettingsByUser(ctx.user.id);
      const docxBuffer = await exportLegalOpinionToDOCX(opinion, settings || {});

      return {
        buffer: docxBuffer.toString("base64"),
        filename: `parecer-juridico-${opinion.id}.docx`,
      };
    }),

  /**
   * Gerar parecer jurídico com IA
   */
  generateOpinion: protectedProcedure
    .input(
      z.object({
        id: z.number(), // ID do parecer já criado
      })
    )
    .mutation(async ({ input }) => {
      // Buscar parecer
      const opinion = await getLegalOpinionById(input.id);
      if (!opinion) {
        throw new Error("Parecer não encontrado");
      }

      // Buscar dados da fonte (processo, contratação, contrato)
      let sourceData = null;
      if (opinion.sourceId) {
        if (opinion.sourceType === "process") {
          sourceData = await getProcessById(opinion.sourceId);
        } else if (opinion.sourceType === "direct_contract") {
          sourceData = await getDirectContractById(opinion.sourceId);
        } else if (opinion.sourceType === "contract") {
          sourceData = await getContractById(opinion.sourceId);
        }
      }

      // Gerar parecer com IA
      const result = await generateLegalOpinion({
        title: opinion.title,
        legalQuestion: opinion.legalQuestion,
        context: opinion.context || undefined,
        sourceType: opinion.sourceType,
        sourceData,
      });

      // Atualizar parecer com o resultado
      await updateLegalOpinion(input.id, {
        opinion: result.opinion,
        conclusion: result.conclusion,
        citedArticles: result.citedArticles,
        jurisprudence: result.jurisprudence,
      });

      return result;
    }),
});
