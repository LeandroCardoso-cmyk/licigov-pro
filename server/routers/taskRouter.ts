import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { 
  createTask, 
  getTaskById, 
  listTasks, 
  updateTask, 
  deleteTask,
  updateTaskStatus,
  getTaskStats,
  getOverdueTasks
} from "../db";
import { generateTasksExcelReport, generateTasksPDFContent } from "../services/taskReports";

export const taskRouter = router({
  /**
   * Criar nova tarefa
   */
  create: protectedProcedure
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
      const taskId = await createTask({
        ...input,
        tags: input.tags ? JSON.stringify(input.tags) : null,
        createdBy: ctx.user.id,
        status: "pendente",
      });

      return { success: true, taskId };
    }),

  /**
   * Listar tarefas com filtros
   */
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z.array(z.string()).optional(),
        priority: z.array(z.string()).optional(),
        type: z.string().optional(),
        assignedTo: z.number().int().positive().optional(),
        processId: z.number().int().positive().optional(),
        createdFrom: z.date().optional(),
        createdTo: z.date().optional(),
        deadlineFrom: z.date().optional(),
        deadlineTo: z.date().optional(),
        tags: z.array(z.string()).optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
      })
    )
    .query(async ({ input }) => {
      const tasks = await listTasks(input);
      return tasks;
    }),

  /**
   * Buscar tarefa por ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const task = await getTaskById(input.id);
      
      if (!task) {
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
  update: protectedProcedure
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

      await updateTask(id, {
        ...updates,
        tags: updates.tags ? JSON.stringify(updates.tags) : undefined,
      });

      return { success: true };
    }),

  /**
   * Excluir tarefa (admin only)
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se é admin
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem excluir tarefas",
        });
      }

      await deleteTask(input.id);

      return { success: true };
    }),

  /**
   * Atualizar status da tarefa (para Kanban drag & drop)
   */
  updateStatus: protectedProcedure
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
    .mutation(async ({ input }) => {
      await updateTaskStatus(input.id, input.status);

      return { success: true };
    }),

  /**
   * Buscar estatísticas para dashboard
   */
  getStats: protectedProcedure
    .input(
      z.object({
        assignedTo: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const stats = await getTaskStats(input.assignedTo);
      return stats;
    }),

  /**
   * Buscar tarefas atrasadas
   */
  getOverdue: protectedProcedure
    .input(
      z.object({
        assignedTo: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const tasks = await getOverdueTasks(input.assignedTo);
      return tasks;
    }),

  /**
   * Exportar relatório de tarefas em Excel
   */
  exportExcel: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        priority: z.string().optional(),
        assignedTo: z.number().optional(),
      }).optional()
    )
    .mutation(async ({ input }) => {
      const buffer = await generateTasksExcelReport(input);
      const base64 = buffer.toString("base64");
      return {
        data: base64,
        filename: `tarefas-${new Date().toISOString().split('T')[0]}.xlsx`,
      };
    }),

  /**
   * Exportar relatório resumido de tarefas (Markdown para PDF)
   */
  exportPDF: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        priority: z.string().optional(),
        assignedTo: z.number().optional(),
      }).optional()
    )
    .mutation(async ({ input }) => {
      const markdown = await generateTasksPDFContent(input);
      return {
        content: markdown,
        filename: `tarefas-resumo-${new Date().toISOString().split('T')[0]}.md`,
      };
    }),
});
