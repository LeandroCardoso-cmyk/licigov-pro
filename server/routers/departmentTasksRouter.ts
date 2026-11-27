import { z } from "zod";
import { parseTaskDeadline } from "../domain/taskDeadline";
import { router, tenantProcedure, orgRoleProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { serviceLogger } from "../services/observabilityService";
import { logActivity } from "../services/activityLogService";
import { assertStorageUsable, storageDelete, storagePut, storageSignedUrl } from "../storage";
import { attachmentStorageKey, TASK_ATTACHMENT_URL_TTL_SECONDS } from "../domain/taskAttachmentStorage";
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

  // LAUNCH-READY DELTA-01 — matriz NEW-006: operator.

  create: orgRoleProcedure("operator")
    .input(
      z.object({
        title: z.string().trim().min(1, "Informe o título da tarefa.").max(200),
        description: z.string().max(5000).optional(),
        type: z.string().trim().min(1).max(50).default("geral"),
        status: z.enum(["pendente", "em_andamento", "pausada", "atrasada", "aguardando_informacao", "concluida", "cancelada"]).default("pendente"),
        priority: z.enum(["baixa", "media", "alta", "urgente"]).default("media"),
        // PROMPT 08 / D-1 — prazo OPCIONAL, parseado numa fronteira única (antes: string crua numa coluna TIMESTAMP ⇒ 500).
        deadline: z.union([z.date(), z.string(), z.null()]).optional(),
        // Responsável: padrão = quem cria; outro usuário só se for membro ATIVO do órgão.
        assignedTo: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const deadline = parseTaskDeadline(input.deadline);
      if (!deadline.ok) throw new TRPCError({ code: "BAD_REQUEST", message: deadline.message });
      const assignedTo = input.assignedTo ?? ctx.user.id;
      if (assignedTo !== ctx.user.id && !(await db.getActiveOrganizationUserById(assignedTo, ctx.organizationId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "O responsável precisa ser membro ativo da organização." });
      }
      const taskId = await db.createTask({
        title: input.title, description: input.description ?? null, type: input.type, status: input.status,
        priority: input.priority, deadline: deadline.value, assignedTo,
        organizationId: ctx.organizationId, createdBy: ctx.user.id,
      });
      return { taskId };
    }),

  // LAUNCH-READY DELTA-01 — matriz NEW-006: operator.

  update: orgRoleProcedure("operator")
    .input(
      z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        type: z.string().optional(),
        status: z.enum(["pendente", "em_andamento", "pausada", "atrasada", "aguardando_informacao", "concluida", "cancelada"]).optional(),
        priority: z.enum(["baixa", "media", "alta", "urgente"]).optional(),
        deadline: z.union([z.date(), z.string(), z.null()]).optional(),
        assignedTo: z.number().int().positive().optional(),
        processId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, deadline: rawDeadline, ...rest } = input;
      const updateData: Parameters<typeof db.updateTaskForOrganization>[2] = { ...rest };
      // PROMPT 08 / D-1 — mesma fronteira de prazo do create (undefined = não altera; null/"" = remove o prazo).
      if (rawDeadline !== undefined) {
        const deadline = parseTaskDeadline(rawDeadline);
        if (!deadline.ok) throw new TRPCError({ code: "BAD_REQUEST", message: deadline.message });
        updateData.deadline = deadline.value;
      }
      if (rest.assignedTo !== undefined && !(await db.getActiveOrganizationUserById(rest.assignedTo, ctx.organizationId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "O responsável precisa ser membro ativo da organização." });
      }
      if (rest.processId !== undefined && rest.processId !== null) {
        const process = await db.getProcessByIdForOrganization(rest.processId, ctx.organizationId);
        if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });
      }
      const ok = await db.updateTaskForOrganization(id, ctx.organizationId, updateData);
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

  // LAUNCH-READY DELTA-01 — matriz NEW-006: operator.

  delete: orgRoleProcedure("operator")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // PROMPT 08 / D-3 — a exclusão da tarefa remove antes os objetos dos anexos (só chaves da própria tarefa); falha ⇒ nada é
      // excluído (a tarefa e os registros ficam; repetir é seguro — `DeleteObject` é idempotente).
      const attachments = await db.listTaskAttachmentsForOrganization(input.id, ctx.organizationId);
      for (const a of attachments) {
        const key = attachmentStorageKey(a.fileUrl, a.taskId);
        if (!key) continue;
        try {
          await storageDelete(key);
        } catch {
          authzLog.error("task_delete_attachment_storage_failed", { organizationId: ctx.organizationId, taskId: input.id, attachmentId: a.id });
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível remover os arquivos anexados. A tarefa foi mantida; tente novamente." });
        }
      }
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

  // LAUNCH-READY DELTA-01 — matriz NEW-006: operator.

  addComment: orgRoleProcedure("operator")
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
  // PROMPT 08 / D-3 — a listagem NÃO expõe URL/chave de armazenamento; o download é por `getAttachmentDownloadUrl`.
  listAttachments: tenantProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input, ctx }) => {
      const rows = await db.listTaskAttachmentsForOrganization(input.taskId, ctx.organizationId);
      return rows.map((r) => ({
        id: r.id, taskId: r.taskId, fileName: r.fileName, fileSize: r.fileSize, uploadedBy: r.uploadedBy, uploadedAt: r.uploadedAt,
        downloadable: attachmentStorageKey(r.fileUrl, r.taskId) !== null,
      }));
    }),

  /**
   * PROMPT 08 / D-3 — URL ASSINADA de curta duração (bucket privado). Autoriza sessão + tenant (`tenantProcedure`, leitura —
   * viewer pode baixar) + vínculo anexo↔tarefa do órgão; a chave só é assinada se pertencer ao prefixo da própria tarefa.
   */
  getAttachmentDownloadUrl: tenantProcedure
    .input(z.object({ attachmentId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const att = await db.getTaskAttachmentForOrganization(input.attachmentId, ctx.organizationId);
      if (!att) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "departmentTasks.getAttachmentDownloadUrl", organizationId: ctx.organizationId, userId: ctx.user.id,
          resourceId: input.attachmentId, reason: "attachment_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
      }
      const key = attachmentStorageKey(att.fileUrl, att.taskId);
      if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Este anexo antigo não tem referência de armazenamento reconhecível — não é possível gerar o download." });
      const { url } = await storageSignedUrl(key, TASK_ATTACHMENT_URL_TTL_SECONDS, att.fileName);
      return { url, expiresInSeconds: TASK_ATTACHMENT_URL_TTL_SECONDS };
    }),

  // SEC-037 (PR B) — Upload SEGURO de anexo de tarefa.
  // O cliente envia o CONTEÚDO em base64 (nunca uma URL arbitrária → sem SSRF).
  // O servidor: (1) autoriza tenant + posse da tarefa; (2) valida allowlist de
  // MIME e o conteúdo real por magic-bytes + limite de tamanho; (3) grava no
  // Storage Service (S3) com chave interna segura; (4) persiste a referência de
  // forma tenant-scoped; (5) compensa (remove o objeto) se a gravação falhar,
  // evitando arquivo/registro órfão; (6) audita o evento.
  // LAUNCH-READY DELTA-01 — matriz NEW-006: operator.
  addAttachment: orgRoleProcedure("operator")
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
      const { key } = await storagePut(s3Key, buffer, input.mimeType);

      // (4) Persistência tenant-scoped + (5) compensação se a gravação falhar.
      let attachmentId: number | null;
      try {
        attachmentId = await db.createTaskAttachmentForOrganization(
          {
            taskId: input.taskId,
            fileName: safeName,
            // PROMPT 08 / D-3 — guarda a CHAVE interna (bucket privado), nunca a URL pública.
            fileUrl: key,
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

  // LAUNCH-READY DELTA-01 — matriz NEW-006: operator.

  /**
   * PROMPT 08 / D-3 — remoção CONSISTENTE: (1) autoriza anexo↔tarefa do órgão; (2) remove o objeto (só a chave da própria
   * tarefa; `DeleteObject` é idempotente — em bucket versionado cria marcador de exclusão, NÃO elimina versões anteriores);
   * falha do S3 ⇒ o registro é MANTIDO, a falha é auditada e a operação pode ser repetida (sem órfão silencioso);
   * (3) remove o registro; (4) audita o resultado. Replay de anexo já removido ⇒ NOT_FOUND, sem efeito.
   */
  deleteAttachment: orgRoleProcedure("operator")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const att = await db.getTaskAttachmentForOrganization(input.id, ctx.organizationId);
      const key = att ? attachmentStorageKey(att.fileUrl, att.taskId) : null;
      if (att && key) {
        try {
          await storageDelete(key);
        } catch (err) {
          await logActivity({
            organizationId: ctx.organizationId, userId: ctx.user.id, action: "task.attachment_delete_failed", entityType: "task",
            entityId: att.taskId, details: { attachmentId: att.id, s3Key: key, error: err instanceof Error ? err.name : "unknown" },
          });
          authzLog.error("task_attachment_storage_delete_failed", { organizationId: ctx.organizationId, attachmentId: att.id });
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível remover o arquivo do armazenamento. O anexo foi mantido; tente novamente." });
        }
      }
      const ok = att ? await db.deleteTaskAttachmentForOrganization(input.id, ctx.organizationId) : false;
      if (ok && att) {
        await logActivity({
          organizationId: ctx.organizationId, userId: ctx.user.id, action: "task.attachment_deleted", entityType: "task", entityId: att.taskId,
          details: key ? { attachmentId: att.id, s3Key: key, storageDeleted: true } : { attachmentId: att.id, storageDeleted: false, reason: "storage_key_unresolved" },
        });
      }
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

  // LAUNCH-READY DELTA-01 — matriz NEW-006: operator.

  linkProcess: orgRoleProcedure("operator")
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
