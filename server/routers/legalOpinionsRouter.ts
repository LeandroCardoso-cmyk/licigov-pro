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
        isTemplate: z.boolean().optional(),
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

      // Buscar assinatura digital se existir
      let signatureBlock: string | undefined;
      if (opinion.signatureId) {
        const { getDigitalSignatureById } = await import("../db");
        const { formatSignatureBlock } = await import("../services/digitalSignatureService");
        const signature = await getDigitalSignatureById(opinion.signatureId);
        if (signature) {
          signatureBlock = formatSignatureBlock(signature);
        }
      }

      const pdfBuffer = await exportLegalOpinionToPDF(opinion, settings || {}, signatureBlock);

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

      // Buscar assinatura digital se existir
      let signatureBlock: string | undefined;
      if (opinion.signatureId) {
        const { getDigitalSignatureById } = await import("../db");
        const { formatSignatureBlock } = await import("../services/digitalSignatureService");
        const signature = await getDigitalSignatureById(opinion.signatureId);
        if (signature) {
          signatureBlock = formatSignatureBlock(signature);
        }
      }

      const docxBuffer = await exportLegalOpinionToDOCX(opinion, settings || {}, signatureBlock);

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

  /**
   * Assinar parecer jurídico digitalmente
   */
  sign: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const { generateContentHash, generateSignature, generateCertificateInfo } = await import("../services/digitalSignatureService");
      const { createDigitalSignature, updateLegalOpinion, getLegalOpinionById } = await import("../db");

      // Buscar parecer
      const opinion = await getLegalOpinionById(input.id);
      if (!opinion) {
        throw new Error("Parecer jurídico não encontrado");
      }

      // Gerar hash do conteúdo
      const content = `${opinion.title}\n${opinion.legalQuestion}\n${opinion.opinion || ""}`;
      const contentHash = generateContentHash(content);

      // Gerar assinatura
      const signature = generateSignature(contentHash, ctx.user.id);

      // Gerar informações do certificado
      const certificateInfo = generateCertificateInfo(ctx.user.name || "Usuário", ctx.user.email);

      // Criar assinatura digital no banco
      const signatureId = await createDigitalSignature({
        documentType: "legal_opinion",
        documentId: input.id,
        contentHash,
        signature,
        signedBy: ctx.user.id,
        signedByName: ctx.user.name || "Usuário",
        signedByEmail: ctx.user.email,
        certificateInfo,
        isValid: true,
      });

      // Atualizar parecer com signatureId
      await updateLegalOpinion(input.id, { signatureId: signature.id });

      // Enviar notificação automática
      const { notifyOwner } = await import("../_core/notification");
      await notifyOwner({
        title: `🔒 Parecer Jurídico Assinado Digitalmente`,
        content: `O parecer "${opinion.title}" foi assinado digitalmente por ${ctx.user.name || ctx.user.email}.\n\nAssinado em: ${new Date().toLocaleString("pt-BR")}\nHash SHA-256: ${signature.documentHash.substring(0, 16)}...`,
      });

      return { success: true, signatureId: signature.id };
    }),

  /**
   * Verificar assinatura digital de um parecer
   */
  verifySignature: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const { validateSignature } = await import("../services/digitalSignatureService");
      const { getLegalOpinionById, getDigitalSignatureById } = await import("../db");

      // Buscar parecer
      const opinion = await getLegalOpinionById(input.id);
      if (!opinion || !opinion.signatureId) {
        return { signed: false, valid: false };
      }

      // Buscar assinatura
      const digitalSignature = await getDigitalSignatureById(opinion.signatureId);
      if (!digitalSignature) {
        return { signed: false, valid: false };
      }

      // Gerar hash do conteúdo atual
      const { generateContentHash } = await import("../services/digitalSignatureService");
      const content = `${opinion.title}\n${opinion.legalQuestion}\n${opinion.opinion || ""}`;
      const currentHash = generateContentHash(content);

      // Verificar se o hash corresponde
      const hashMatches = currentHash === digitalSignature.contentHash;

      // Validar assinatura
      const signatureValid = validateSignature(
        digitalSignature.contentHash,
        digitalSignature.signature,
        digitalSignature.signedBy
      );

      return {
        signed: true,
        valid: hashMatches && signatureValid && digitalSignature.isValid,
        signedBy: digitalSignature.signedByName,
        signedAt: digitalSignature.signedAt,
        hashMatches,
        signatureValid,
      };
    }),

  /**
   * Obter visão geral de estatísticas
   */
  getAnalytics: protectedProcedure
    .input(
      z.object({
        period: z.enum(["all", "7days", "30days", "90days", "year"]).default("30days"),
      })
    )
    .query(async ({ input }) => {
    const {
      getLegalOpinionsOverview,
      getLegalOpinionsByMonth,
      getTopCitedArticles,
      getConclusionDistribution,
    } = await import("../db");

    const [overview, byMonth, topArticles, conclusionDist] = await Promise.all([
      getLegalOpinionsOverview(input.period),
      getLegalOpinionsByMonth(input.period),
      getTopCitedArticles(input.period),
      getConclusionDistribution(input.period),
    ]);

    return {
      overview,
      byMonth,
      topArticles,
      conclusionDist,
    };
  }),
});
