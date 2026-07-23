import { tenantProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { serviceLogger } from "../services/observabilityService";

const authzLog = serviceLogger("commentsRouter");

export const commentsRouter = router({
  add: tenantProcedure
    .input(z.object({
      documentId: z.number(),
      processId: z.number(),
      content: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      // Documento e processo precisam pertencer à organização.
      const document = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      const process = await db.getProcessByIdForOrganization(input.processId, ctx.organizationId);
      if (!document || !process) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "comments.add",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.documentId,
          reason: "document_or_process_not_in_organization",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Recurso não encontrado" });
      }

      await db.createCommentForOrganization({
        documentId: input.documentId,
        processId: input.processId,
        userId: ctx.user.id,
        content: input.content,
      }, ctx.organizationId);
      await db.createActivityLogForOrganization({
        processId: input.processId,
        userId: ctx.user.id,
        action: `adicionou um comentário`,
      }, ctx.organizationId);
      return { success: true };
    }),

  list: tenantProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ ctx, input }) => {
      return await db.getCommentsByDocumentForOrganization(input.documentId, ctx.organizationId);
    }),

  update: tenantProcedure
    .input(z.object({ commentId: z.number(), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const comment = await db.getCommentByIdForOrganization(input.commentId, ctx.organizationId);
      // Cross-tenant/inexistente → NOT_FOUND (nunca revela existência).
      if (!comment) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "comments.update",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.commentId,
          reason: "comment_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Comentário não encontrado" });
      }
      // Mesmo tenant, mas outro autor → FORBIDDEN.
      if (comment.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
      }
      await db.updateCommentForOrganization(input.commentId, ctx.organizationId, input.content);
      return { success: true };
    }),

  delete: tenantProcedure
    .input(z.object({ commentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const comment = await db.getCommentByIdForOrganization(input.commentId, ctx.organizationId);
      // Cross-tenant/inexistente → NOT_FOUND (nunca revela existência).
      if (!comment) {
        authzLog.warn("cross_tenant_denied", {
          procedure: "comments.delete",
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          resourceId: input.commentId,
          reason: "comment_not_found_or_cross_tenant",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Comentário não encontrado" });
      }
      // Mesmo tenant, mas outro autor → FORBIDDEN.
      if (comment.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
      }
      await db.deleteCommentForOrganization(input.commentId, ctx.organizationId);
      return { success: true };
    }),
});
