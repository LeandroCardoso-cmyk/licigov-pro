import { z } from "zod";
import { tenantProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createTask,
  getProcessByIdForOrganization,
  getTaskByIdForOrganization,
  listTasksForOrganization,
  updateTaskForOrganization,
  deleteTaskForOrganization,
  updateTaskStatusForOrganization,
  getTaskStatsForOrganization,
  getOverdueTasksForOrganization,
} from "../db";
import { generateTasksExcelReport, generateTasksPDFContent } from "../services/taskReports";
import { checkTaskDeadlines, getTaskDeadlineSummary } from "../services/taskNotifications";
import { serviceLogger } from "../services/observabilityService";

const authzLog = serviceLogger("taskRouter");

export const taskRouter = router({
  /**
   * Criar nova tarefa
   */
  create: tenantProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        type: z.string().min(1).max(50),
        priority: z.enum(["baixa", "media", "alta", "urgente"]),
        assignedTo: z.number().int().positive(),
        deadline: z.date().optional(),
        processId: z.number().int().positive().optional(),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Se vinculada a um processo, ele precisa pertencer à organização.
      if (input.processId !== undefined) {
        const process = await getProcessByIdForOrganization(input.processId, ctx.organizationId);
        if (!process) {
          authzLog.warn("cross_tenant_denied", {
            procedure: "task.create",
            organizationId: ctx.organizationId,
            userId: ctx.user.id,
            resourceId: input.processId,
            reason: "process_not_in_organization",
          });
          throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
        }
      }

      const taskId = await createTask({
        ...input,
        tags: input.tags ? JSON.stringify(input.tags) : null,
        organizationId: ctx.organizationId,
        createdBy: ctx.user.id,
        status: "pendente",
      });

      return { success: true, taskId };
    }),

  /**
   * Listar tarefas com filtros
   */
  list: tenantProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        priority: z.array(z.string()).optional(),
        type: z.string().optional(),
        assignedTo: z.number().int().positive().optional(),
        processId: z.number().int().positive().optional(),
        createdFrom: z.date().optional(),
        createdTo: z.date().optional(),
        deadlineFrom: z.date().optional(),
        deadlineTo: z.date().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const tasks = await listTasksForOrganization(ctx.organizationId, input);
      return tasks;
    }),

  /**
   * Buscar tarefa por ID
   */
  getById: tenantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const task = await getTaskByIdForOrganization(input.id, ctx.organizationId);

      if (!task) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "task.getById",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.id,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tarefa não encontrada",
        });
      }

      return task;
    }),

  /**
   * Atualizar tarefa
   */
  update: tenantProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        type: z.string().min(1).max(50).optional(),
        status: z.enum([
          "pendente",
          "em_andamento",
          "pausada",
          "atrasada",
          "aguardando_informacao",
          "concluida",
          "cancelada"
        ]).optional(),
        priority: z.enum(["baixa", "media", "alta", "urgente"]).optional(),
        assignedTo: z.number().int().positive().optional(),
        deadline: z.date().optional(),
        processId: z.number().int().positive().optional(),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const ok = await updateTaskForOrganization(id, ctx.organizationId, {
        ...updates,
        tags: updates.tags ? JSON.stringify(updates.tags) : undefined,
      });

      if (!ok) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "task.update",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: id,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }

      return { success: true };
    }),

  /**
   * Excluir tarefa (admin only)
   */
  delete: tenantProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se é admin
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem excluir tarefas",
        });
      }

      const ok = await deleteTaskForOrganization(input.id, ctx.organizationId);

      if (!ok) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "task.delete",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.id,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }

      return { success: true };
    }),

  /**
   * Atualizar status da tarefa (para Kanban drag & drop)
   */
  updateStatus: tenantProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum([
          "pendente",
          "em_andamento",
          "pausada",
          "atrasada",
          "aguardando_informacao",
          "concluida",
          "cancelada"
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ok = await updateTaskStatusForOrganization(input.id, ctx.organizationId, input.status);

      if (!ok) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "task.updateStatus",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.id,
          reason: "task_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
      }

      return { success: true };
    }),

  /**
   * Buscar estatísticas para dashboard
   */
  getStats: tenantProcedure
    .input(
      z.object({
        assignedTo: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const stats = await getTaskStatsForOrganization(ctx.organizationId, input.assignedTo);
      return stats;
    }),

  /**
   * Buscar tarefas atrasadas
   */
  getOverdue: tenantProcedure
    .input(
      z.object({
        assignedTo: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const tasks = await getOverdueTasksForOrganization(ctx.organizationId, input.assignedTo);
      return tasks;
    }),

  /**
   * Exportar relatório de tarefas em Excel
   */
  exportExcel: tenantProcedure
    .input(
      z.object({
        status: z.array(z.string()).optional(),
        priority: z.array(z.string()).optional(),
        assignedTo: z.number().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        tags: z.array(z.string()).optional(),
      }).optional()
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = await generateTasksExcelReport(ctx.organizationId, input);
      const base64 = Buffer.from(buffer as any).toString("base64");
      return {
        data: base64,
        filename: `tarefas-${new Date().toISOString().split('T')[0]}.xlsx`,
      };
    }),

  /**
   * Exportar relatório resumido de tarefas (Markdown para PDF)
   */
  exportPDF: tenantProcedure
    .input(
      z.object({
        status: z.array(z.string()).optional(),
        priority: z.array(z.string()).optional(),
        assignedTo: z.number().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        tags: z.array(z.string()).optional(),
      }).optional()
    )
    .mutation(async ({ ctx, input }) => {
      const markdown = await generateTasksPDFContent(ctx.organizationId, input);
      return {
        content: markdown,
        filename: `tarefas-resumo-${new Date().toISOString().split('T')[0]}.md`,
      };
    }),

  /**
   * Verificar prazos e enviar notificações
   */
  checkDeadlines: tenantProcedure
    .mutation(async ({ ctx }) => {
      const result = await checkTaskDeadlines(ctx.organizationId);
      return result;
    }),

  /**
   * Obter resumo de prazos
   */
  getDeadlineSummary: tenantProcedure
    .query(async ({ ctx }) => {
      const summary = await getTaskDeadlineSummary(ctx.organizationId);
      return summary;
    }),
});
