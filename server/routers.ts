import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { commercialRouter } from "./routers/commercialRouter";
import { companyDocumentsRouter } from "./routers/companyDocumentsRouter";
import { catmatRouter } from "./routers/catmatRouter";
import { taskRouter } from "./routers/taskRouter";
import { departmentTasksRouter } from "./routers/departmentTasksRouter";
import { aiUsageRouter } from "./routers/aiUsageRouter";
import { platformsRouter } from "./routers/platformsRouter";
import { downloadRouter } from "./routers/downloadRouter";
import { directContractsRouter } from "./routers/directContractsRouter";
import { contractsRouter } from "./routers/contractsRouter";
import { contactRouter } from "./routers/contactRouter";
import { legalOpinionsRouter } from "./routers/legalOpinionsRouter";
import { authRouter } from "./routers/authRouter";
import { processesRouter } from "./routers/processesRouter";
import { documentsRouter } from "./routers/documentsRouter";
import { collaborationRouter } from "./routers/collaborationRouter";
import { billingRouter } from "./routers/billingRouter";
import { templatesRouter } from "./routers/templatesRouter";

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";

export const appRouter = router({
  system: systemRouter,
  contact: contactRouter,
  auth: authRouter,
  processes: processesRouter,
  documents: documentsRouter,

  editalParameters: router({
    save: protectedProcedure
      .input(z.object({
        processId: z.number(),
        modalidade: z.string().optional(),
        formato: z.enum(["presencial", "eletronico"]).optional(),
        criterioJulgamento: z.string().optional(),
        regimeContratacao: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.upsertEditalParameters({
          processId: input.processId,
          modalidade: input.modalidade,
          formato: input.formato,
          criterioJulgamento: input.criterioJulgamento,
          regimeContratacao: input.regimeContratacao,
        });

        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: "atualizou os parâmetros do edital",
        });

        return { success: true };
      }),

    get: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getEditalParametersByProcess(input.processId);
      }),
  }),

  activities: router({
    listByProcess: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getActivityLogsByProcess(input.processId);
      }),
  }),

  collaboration: collaborationRouter,

  notifications: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(50) }))
      .query(async ({ ctx, input }) => {
        return await db.getUserNotifications(ctx.user.id, input.limit);
      }),

    unreadCount: protectedProcedure
      .query(async ({ ctx }) => {
        return await db.getUnreadNotificationsCount(ctx.user.id);
      }),

    markAsRead: protectedProcedure
      .input(z.object({ notificationId: z.number() }))
      .mutation(async ({ input }) => {
        await db.markNotificationAsRead(input.notificationId);
        return { success: true };
      }),

    markAllAsRead: protectedProcedure
      .mutation(async ({ ctx }) => {
        await db.markAllNotificationsAsRead(ctx.user.id);
        return { success: true };
      }),
  }),

  documentSettings: router({
    save: protectedProcedure
      .input(z.object({
        organizationName: z.string().optional(),
        logoUrl: z.string().optional(),
        address: z.string().optional(),
        cnpj: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        website: z.string().optional(),
        footerText: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.upsertDocumentSettings({
          userId: ctx.user.id,
          ...input,
        });

        return { success: true };
      }),

    get: protectedProcedure
      .query(async ({ ctx }) => {
        return await db.getDocumentSettingsByUser(ctx.user.id);
      }),
  }),

  comments: router({
    add: protectedProcedure
      .input(z.object({
        documentId: z.number(),
        processId: z.number(),
        content: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.createComment({
          documentId: input.documentId,
          processId: input.processId,
          userId: ctx.user.id,
          content: input.content,
        });
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: `adicionou um comentário`,
        });
        return { success: true };
      }),

    list: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ input }) => {
        return await db.getCommentsByDocument(input.documentId);
      }),

    update: protectedProcedure
      .input(z.object({
        commentId: z.number(),
        content: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const comment = await db.getCommentById(input.commentId);
        if (!comment || comment.userId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão' });
        }
        await db.updateComment(input.commentId, input.content);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ commentId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const comment = await db.getCommentById(input.commentId);
        if (!comment || comment.userId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão' });
        }
        await db.deleteComment(input.commentId);
        return { success: true };
      }),
  }),

  lgpd: router({
    recordConsent: protectedProcedure
      .input(z.object({
        consentType: z.enum(["terms_of_use", "privacy_policy", "data_processing"]),
        version: z.string(),
        ipAddress: z.string().optional(),
        userAgent: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.createUserConsent({
          userId: ctx.user.id,
          consentType: input.consentType,
          version: input.version,
          accepted: true,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });
        return { success: true };
      }),

    checkConsent: protectedProcedure
      .input(z.object({
        consentType: z.enum(["terms_of_use", "privacy_policy", "data_processing"]),
        version: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const hasAccepted = await db.hasUserAcceptedConsent(
          ctx.user.id,
          input.consentType,
          input.version
        );
        return { hasAccepted };
      }),

    exportMyData: protectedProcedure
      .mutation(async ({ ctx }) => {
        return await db.exportUserData(ctx.user.id);
      }),

    deleteMyAccount: protectedProcedure
      .mutation(async ({ ctx }) => {
        await db.deleteUserData(ctx.user.id);
        return { success: true };
      }),
  }),

  admin: router({
    listUsers: protectedProcedure
      .query(async ({ ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        return await db.getAllUsers();
      }),

    promoteToAdmin: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        await db.updateUserRole(input.userId, "admin");
        await db.createAuditLog({
          adminId: ctx.user.id,
          targetUserId: input.userId,
          action: "promote_to_admin",
          details: `Promovido a administrador`,
        });
        return { success: true };
      }),

    demoteFromAdmin: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        await db.updateUserRole(input.userId, "user");
        await db.createAuditLog({
          adminId: ctx.user.id,
          targetUserId: input.userId,
          action: "demote_from_admin",
          details: `Rebaixado para usuário`,
        });
        return { success: true };
      }),

    getUserStats: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        return await db.getUserStats(input.userId);
      }),

    getAuditLogs: protectedProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        return await db.getAuditLogs(input.limit);
      }),
  }),

  analytics: router({
    getOverview: protectedProcedure
      .query(async () => {
        const processesByStatus = await db.getProcessCountByStatus();
        const documentsByMonth = await db.getDocumentCountByMonth(6);
        const mostActiveMembers = await db.getMostActiveMembers(10);
        const allUsers = await db.getAllUsers();
        const totalProcesses = processesByStatus.reduce((sum, item) => sum + item.count, 0);
        return {
          totalUsers: allUsers.length,
          totalProcesses,
          processesByStatus,
          documentsByMonth,
          mostActiveMembers,
        };
      }),
  }),

  billing: billingRouter,

  commercial: commercialRouter,
  companyDocuments: companyDocumentsRouter,
  catmat: catmatRouter,
  tasks: taskRouter,
  departmentTasks: departmentTasksRouter,
  templates: templatesRouter,
  aiUsage: aiUsageRouter,
  platforms: platformsRouter,
  downloads: downloadRouter,
  directContracts: directContractsRouter,
  contracts: contractsRouter,
  legalOpinions: legalOpinionsRouter,
});

export type AppRouter = typeof appRouter;
