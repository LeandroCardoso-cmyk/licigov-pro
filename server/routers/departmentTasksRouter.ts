import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

export const departmentTasksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return await db.getAllTasks();
  }),

  create: protectedProcedure
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
        createdBy: ctx.user.id,
      } as any);
    }),

  update: protectedProcedure
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
    .mutation(async ({ input }) => {
      const { id, ...updateData } = input;
      return await db.updateTask(id, updateData as any);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return await db.deleteTask(input.id);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await db.getTaskById(input.id);
    }),

  // Comentários
  listComments: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      return await db.listTaskComments(input.taskId);
    }),

  addComment: protectedProcedure
    .input(
      z.object({
        taskId: z.number(),
        content: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await db.createTaskComment({
        taskId: input.taskId,
        userId: ctx.user.id,
        content: input.content,
      });
    }),

  // Anexos
  listAttachments: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      return await db.listTaskAttachments(input.taskId);
    }),

  addAttachment: protectedProcedure
    .input(
      z.object({
        taskId: z.number(),
        fileName: z.string(),
        fileUrl: z.string(),
        fileSize: z.number(),
        mimeType: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await db.createTaskAttachment({
        taskId: input.taskId,
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        uploadedBy: ctx.user.id,
      });
    }),

  deleteAttachment: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return await db.deleteTaskAttachment(input.id);
    }),

  // Processos (para vincular tarefas)
  listProcesses: protectedProcedure.query(async ({ ctx }) => {
    return await db.getProcessesByUser(ctx.user.id);
  }),

  getProcess: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await db.getProcessById(input.id);
    }),

  linkProcess: protectedProcedure
    .input(
      z.object({
        taskId: z.number(),
        processId: z.number().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      return await db.updateTask(input.taskId, { processId: input.processId });
    }),
});
