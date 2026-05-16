import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";

export const templatesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return await db.getTemplatesByUser(ctx.user.id);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await db.getTemplateById(input.id);
    }),

  getDefault: protectedProcedure
    .input(z.object({ type: z.enum(["etp", "tr", "dfd", "edital"]) }))
    .query(async ({ ctx, input }) => {
      return await db.getDefaultTemplate(ctx.user.id, input.type);
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      type: z.enum(["etp", "tr", "dfd", "edital"]),
      content: z.string(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const templateId = await db.createTemplate({
        userId: ctx.user.id,
        name: input.name,
        description: input.description || null,
        type: input.type,
        content: input.content,
        isDefault: input.isDefault ? 1 : 0,
      });

      return { id: templateId, success: true };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      content: z.string().optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const template = await db.getTemplateById(input.id);
      if (!template || template.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const updates: any = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.content !== undefined) updates.content = input.content;
      if (input.isDefault !== undefined) {
        updates.isDefault = input.isDefault ? 1 : 0;
        updates.userId = ctx.user.id;
        updates.type = template.type;
      }

      await db.updateTemplate(input.id, updates);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const template = await db.getTemplateById(input.id);
      if (!template || template.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await db.deleteTemplate(input.id);
      return { success: true };
    }),
});
