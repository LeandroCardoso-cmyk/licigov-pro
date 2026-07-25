import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { serviceLogger } from "../services/observabilityService";
import { logActivity } from "../services/activityLogService";
import { assertStorageUsable, storageDelete, storagePut } from "../storage";
import {
  MAX_TASK_ATTACHMENT_BASE64_CHARS,
  isAllowedTaskAttachmentMime,
  sanitizeAttachmentFileName,
  validateTaskAttachment,
} from "../domain/taskAttachmentPolicy";

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

  // SEC-037 (PR B) — Upload SEGURO de anexo de tarefa.
  // O cliente envia o CONTEÚDO em base64 (nunca uma URL arbitrária → sem SSRF).
  // O servidor: (1) autoriza tenant + posse da tarefa; (2) valida allowlist de
  // MIME e o conteúdo real por magic-bytes + limite de tamanho; (3) grava no
  // Storage Service (S3) com chave interna segura; (4) persiste a referência de
  // forma tenant-scoped; (5) compensa (remove o objeto) se a gravação falhar,
  // evitando arquivo/registro órfão; (6) audita o evento.
  addAttachment: tenantProcedure
    .input(
      z.object({
        taskId: z.number(),
        fileName: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^\\/]+$/, "Nome de arquivo inválido"),
        fileBase64: z.string().min(1).max(MAX_TASK_ATTACHMENT_BASE64_CHARS),
        mimeType: z
          .string()
          .refine(isAllowedTaskAttachmentMime, "Tipo de arquivo não permitido"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // (1) Autorização: tenant + posse da tarefa (fail-closed, antes de qualquer
      // upload). Cross-tenant/inexistente → o MESMO NOT_FOUND.
      const task = await db.getTaskByIdForOrganization(input.taskId, ctx.organizationId);
      if (!task) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.addAttachment",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.taskId,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }

      // (2) Validação de conteúdo: tamanho + magic-bytes vs. MIME declarado.
      const buffer = Buffer.from(input.fileBase64, "base64");
      const validation = validateTaskAttachment(buffer, input.mimeType);
      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: validation.reason ?? "Arquivo inválido.",
        });
      }

      // (3) Gravação no Storage Service com chave interna segura (nome sanitizado,
      // sem path traversal). Em produção/staging o storage é obrigatório.
      assertStorageUsable();
      const safeName = sanitizeAttachmentFileName(input.fileName);
      const s3Key = `tasks/${input.taskId}/${Date.now()}_${safeName}`;
      const { key, url } = await storagePut(s3Key, buffer, input.mimeType);

      // (4) Persistência tenant-scoped + (5) compensação se a gravação falhar.
      let attachmentId: number | null;
      try {
        attachmentId = await db.createTaskAttachmentForOrganization(
          {
            taskId: input.taskId,
            fileName: safeName,
            fileUrl: url,
            fileSize: buffer.length,
            uploadedBy: ctx.user.id,
          },
          ctx.organizationId,
        );
      } catch (err) {
        await storageDelete(key).catch(() => {});
        throw err;
      }
      if (attachmentId === null) {
        // A tarefa deixou de pertencer à organização entre as checagens: remove o
        // objeto recém-gravado para não deixar arquivo órfão.
        await storageDelete(key).catch(() => {});
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.addAttachment",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.taskId,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }

      // (6) Auditoria persistida (rastreabilidade obrigatória).
      await logActivity({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        action: "adicionou anexo à tarefa",
        entityType: "task",
        entityId: input.taskId,
        details: { fileName: safeName, fileSize: buffer.length, s3Key: key },
      });

      return { success: true, id: attachmentId };
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
