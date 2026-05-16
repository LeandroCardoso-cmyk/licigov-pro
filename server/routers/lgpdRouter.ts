import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";

export const lgpdRouter = router({
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
      const hasAccepted = await db.hasUserAcceptedConsent(ctx.user.id, input.consentType, input.version);
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
});
