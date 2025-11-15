import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

/**
 * Router para gerenciamento de plataformas de pregão eletrônico
 * Suporta Nível 1, 2 e preparação para Nível 3
 */
export const platformsRouter = router({
  /**
   * Listar todas as plataformas ativas
   */
  list: protectedProcedure.query(async () => {
    return await db.getPlatforms();
  }),

  /**
   * Buscar plataforma por ID
   */
  getById: protectedProcedure
    .input(z.object({ platformId: z.number() }))
    .query(async ({ input }) => {
      return await db.getPlatformById(input.platformId);
    }),

  /**
   * Buscar plataforma por slug
   */
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      return await db.getPlatformBySlug(input.slug);
    }),

  /**
   * Buscar templates de uma plataforma
   */
  getTemplates: protectedProcedure
    .input(z.object({
      platformId: z.number(),
      documentType: z.enum(["etp", "tr", "dfd", "edital"]).optional(),
    }))
    .query(async ({ input }) => {
      return await db.getPlatformTemplates(input.platformId, input.documentType);
    }),

  /**
   * Buscar checklist de publicação de uma plataforma
   */
  getChecklist: protectedProcedure
    .input(z.object({ platformId: z.number() }))
    .query(async ({ input }) => {
      return await db.getPlatformChecklist(input.platformId);
    }),

  /**
   * Vincular plataforma a um processo
   */
  updateProcessPlatform: protectedProcedure
    .input(z.object({
      processId: z.number(),
      platformId: z.number().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se o usuário é dono do processo
      const process = await db.getProcessById(input.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new Error("Processo não encontrado ou sem permissão");
      }

      // Atualizar plataforma do processo
      const updated = await db.updateProcessPlatform(input.processId, input.platformId);

      // Registrar atividade
      if (input.platformId) {
        const platform = await db.getPlatformById(input.platformId);
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: "selecionou plataforma",
          details: JSON.stringify({ 
            platformName: platform?.name,
            platformSlug: platform?.slug
          }),
        });
      }

      return updated;
    }),

  /**
   * Gerar pacote de publicação (Nível 2)
   * Retorna dados formatados para checklist e exportação
   */
  generatePublicationPackage: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Buscar processo completo
      const process = await db.getProcessById(input.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new Error("Processo não encontrado ou sem permissão");
      }

      // Buscar plataforma
      const platform = process.platformId 
        ? await db.getPlatformById(process.platformId)
        : null;

      // Buscar documentos do processo
      const documents = await db.getDocumentsByProcess(input.processId);

      // Buscar itens CATMAT/CATSER
      const items = await db.getProcessItems(input.processId);

      // Buscar checklist da plataforma
      const checklist = platform 
        ? await db.getPlatformChecklist(platform.id)
        : [];

      // Buscar configurações do usuário
      const settings = await db.getDocumentSettingsByUser(ctx.user.id);

      // Montar pacote de publicação
      return {
        process,
        platform,
        documents: documents.map(doc => ({
          id: doc.id,
          type: doc.type,
          version: doc.version,
          createdAt: doc.createdAt,
          // URLs de download serão geradas no frontend
        })),
        items: items.map(item => ({
          id: item.id,
          itemType: item.itemType,
          code: item.itemType === "material" ? item.catmatCode : item.catserCode,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          estimatedUnitPrice: item.estimatedUnitPrice,
        })),
        checklist: checklist.map(step => ({
          stepNumber: step.stepNumber,
          title: step.title,
          description: step.description,
          fields: step.fields,
          requiredDocuments: step.requiredDocuments,
          category: step.category,
          isOptional: step.isOptional,
        })),
        settings: {
          organizationName: settings?.organizationName,
          cnpj: settings?.cnpj,
          address: settings?.address,
          phone: settings?.phone,
          email: settings?.email,
          website: settings?.website,
        },
      };
    }),

  /**
   * Criar publicação em plataforma (Nível 3 - Futuro)
   * Preparado mas não implementado ainda
   */
  publish: protectedProcedure
    .input(z.object({
      processId: z.number(),
      platformId: z.number(),
      scheduledFor: z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se o usuário é dono do processo
      const process = await db.getProcessById(input.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new Error("Processo não encontrado ou sem permissão");
      }

      // Verificar se a plataforma tem integração API ativa
      const platform = await db.getPlatformById(input.platformId);
      if (!platform || !platform.hasApiIntegration) {
        throw new Error("Plataforma não suporta integração API ainda. Use o checklist manual.");
      }

      // TODO: Implementar integração API (Nível 3)
      // Por enquanto, apenas criar registro de publicação como "draft"
      const publication = await db.createPlatformPublication({
        processId: input.processId,
        platformId: input.platformId,
        status: "draft",
        scheduledFor: input.scheduledFor,
        metadata: {
          createdBy: ctx.user.id,
          createdAt: new Date().toISOString(),
        },
      });

      return {
        success: false,
        message: "Integração API ainda não implementada. Use o checklist manual para publicar.",
        publicationId: publication,
      };
    }),

  /**
   * Listar publicações de um processo
   */
  getPublications: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Verificar se o usuário é dono do processo
      const process = await db.getProcessById(input.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new Error("Processo não encontrado ou sem permissão");
      }

      return await db.getProcessPublications(input.processId);
    }),

  /**
   * Atualizar instruções de templates (Admin only)
   */
  updateInstructions: protectedProcedure
    .input(
      z.object({
        platformId: z.number(),
        instructions: z.object({
          general: z.string().optional(),
          etp: z.string().optional(),
          tr: z.string().optional(),
          dfd: z.string().optional(),
          edital: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verificar se é admin
      if (ctx.user.role !== "admin") {
        throw new Error("Apenas administradores podem editar instruções");
      }

      await db.updatePlatformInstructions(input.platformId, input.instructions);

      return { success: true };
    }),

  /**
   * Criar novo passo de checklist (Admin only)
   */
  createChecklistStep: protectedProcedure
    .input(
      z.object({
        platformId: z.number(),
        stepNumber: z.number(),
        title: z.string(),
        description: z.string().optional(),
        category: z.string().optional(),
        fields: z.any().optional(),
        requiredDocuments: z.any().optional(),
        isOptional: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Apenas administradores podem criar passos");
      }

      const stepId = await db.createChecklistStep(input);
      return { success: true, stepId };
    }),

  /**
   * Atualizar passo de checklist (Admin only)
   */
  updateChecklistStep: protectedProcedure
    .input(
      z.object({
        stepId: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        fields: z.any().optional(),
        requiredDocuments: z.any().optional(),
        isOptional: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Apenas administradores podem editar passos");
      }

      const { stepId, ...data } = input;
      await db.updateChecklistStep(stepId, data);
      return { success: true };
    }),

  /**
   * Deletar passo de checklist (Admin only)
   */
  deleteChecklistStep: protectedProcedure
    .input(z.object({ stepId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Apenas administradores podem deletar passos");
      }

      await db.deleteChecklistStep(input.stepId);
      return { success: true };
    }),
});
