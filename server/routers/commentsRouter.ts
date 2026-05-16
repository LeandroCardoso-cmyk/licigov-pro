import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const commentsRouter = router({
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
    .input(z.object({ commentId: z.number(), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const comment = await db.getCommentById(input.commentId);
      if (!comment || comment.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
      }
      await db.updateComment(input.commentId, input.content);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ commentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const comment = await db.getCommentById(input.commentId);
      if (!comment || comment.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
      }
      await db.deleteComment(input.commentId);
      return { success: true };
    }),
});
