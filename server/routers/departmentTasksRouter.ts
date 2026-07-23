import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { serviceLogger } from "../services/observabilityService";

const authzLog = serviceLogger("departmentTasksRouter");

export const departmentTasksRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    return await db.listTasksForOrganization(ctx.organizationId);
  }),

  create: tenantProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        type: z.string(),
        status: z.enum(["pendente", "em_andamento", "pausada", "atrasada", "aguardando_informacao", "concluida", "cancelada"]).default("pendente"),
        priority: z.enum(["baixa", "media", "alta", "urgente"]).default("media"),
        deadline: z.string(),
        assignedTo: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await db.createTask({
        ...input,
        organizationId: ctx.organizationId,
        createdBy: ctx.user.id,
      } as any);
    }),

  update: tenantProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        type: z.string().optional(),
        status: z.enum(["pendente", "em_andamento", "pausada", "atrasada", "aguardando_informacao", "concluida", "cancelada"]).optional(),
        priority: z.enum(["baixa", "media", "alta", "urgente"]).optional(),
        deadline: z.string().optional(),
        assignedTo: z.number().optional(),
        processId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...updateData } = input;
      const ok = await db.updateTaskForOrganization(id, ctx.organizationId, updateData as any);
      if (!ok) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.update",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: id,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }
      return { success: true };
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const ok = await db.deleteTaskForOrganization(input.id, ctx.organizationId);
      if (!ok) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.delete",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.id,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }
      return { success: true };
    }),

  getById: tenantProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const task = await db.getTaskByIdForOrganization(input.id, ctx.organizationId);
      if (!task) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.getById",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.id,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }
      return task;
    }),

  // Comentários
  listComments: tenantProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input, ctx }) => {
      return await db.listTaskCommentsForOrganization(input.taskId, ctx.organizationId);
    }),

  addComment: tenantProcedure
    .input(
      z.object({
        taskId: z.number(),
        content: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const commentId = await db.createTaskCommentForOrganization(
        {
          taskId: input.taskId,
          userId: ctx.user.id,
          content: input.content,
        },
        ctx.organizationId,
      );
      if (commentId === null) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.addComment",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.taskId,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }
      return commentId;
    }),

  // Anexos
  listAttachments: tenantProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input, ctx }) => {
      return await db.listTaskAttachmentsForOrganization(input.taskId, ctx.organizationId);
    }),

  addAttachment: tenantProcedure
    .input(
      z.object({
        taskId: z.number(),
        fileName: z.string(),
        fileUrl: z.string(),
        fileSize: z.number(),
        mimeType: z.string(),
      })
    )
    .mutation(async () => {
      // SEC-037 / SAFE_DISABLED_PENDING_STORAGE_INTEGRATION:
      // O input aceitava fileUrl arbitrário (SSRF/URL injection). O pipeline de
      // upload seguro (S3) é escopo da PR B. Até lá, a mutation fica desabilitada.
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Upload de anexos de tarefa temporariamente desabilitado por segurança (SAFE_DISABLED_PENDING_STORAGE_INTEGRATION).",
      });
    }),

  deleteAttachment: tenantProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const ok = await db.deleteTaskAttachmentForOrganization(input.id, ctx.organizationId);
      if (!ok) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.deleteAttachment",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.id,
          reason: "attachment_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
      }
      return { success: true };
    }),

  // Processos (para vincular tarefas)
  listProcesses: tenantProcedure.query(async ({ ctx }) => {
    return await db.listProcessesForOrganization(ctx.organizationId);
  }),

  getProcess: tenantProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const process = await db.getProcessByIdForOrganization(input.id, ctx.organizationId);
      if (!process) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.getProcess",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.id,
          reason: "process_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
      }
      return process;
    }),

  linkProcess: tenantProcedure
    .input(
      z.object({
        taskId: z.number(),
        processId: z.number().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Se vinculando a um processo, ele precisa pertencer à organização.
      if (input.processId !== null) {
        const process = await db.getProcessByIdForOrganization(input.processId, ctx.organizationId);
        if (!process) {
          authzLog.warn("cross_tenant_denied", {
            procedure: "departmentTasks.linkProcess",
            organizationId: ctx.organizationId,
            userId: ctx.user.id,
            resourceId: input.processId,
            reason: "process_not_found_or_cross_tenant",
          });
          throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
        }
      }

      const ok = await db.updateTaskForOrganization(input.taskId, ctx.organizationId, {
        processId: input.processId,
      });
      if (!ok) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.linkProcess",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.taskId,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }
      return { success: true };
    }),
});
