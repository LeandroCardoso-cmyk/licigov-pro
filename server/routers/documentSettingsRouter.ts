import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";

export const documentSettingsRouter = router({
  save: protectedProcedure
    .input(z.object({
      organizationName: z.string().optional(),
      logoUrl: z.string().optional(),
      address: z.string().optional(),
      cnpj: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      website: z.string().optional(),
      footerText: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.upsertDocumentSettings({ userId: ctx.user.id, ...input });
      return { success: true };
    }),

  get: protectedProcedure
    .query(async ({ ctx }) => {
      return await db.getDocumentSettingsByUser(ctx.user.id);
    }),
});
