import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const adminRouter = router({
  listUsers: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas administradores" });
      return await db.getAllUsers();
    }),

  promoteToAdmin: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas administradores" });
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
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas administradores" });
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
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas administradores" });
      return await db.getUserStats(input.userId);
    }),

  getAuditLogs: protectedProcedure
    .input(z.object({ limit: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas administradores" });
      return await db.getAuditLogs(input.limit);
    }),
});
