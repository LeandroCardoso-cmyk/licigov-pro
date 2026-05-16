import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";

export const collaborationRouter = router({
  addMember: protectedProcedure
    .input(z.object({
      processId: z.number(),
      userEmail: z.string().email(),
      permission: z.enum(["viewer", "editor", "approver"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process) {
        throw new Error("Processo não encontrado");
      }

      const currentMember = await db.getProcessMember(input.processId, ctx.user.id);
      if (process.ownerId !== ctx.user.id && currentMember?.permission !== "approver") {
        throw new Error("Sem permissão para adicionar membros");
      }

      const targetUser = await db.getUserByEmail(input.userEmail);
      if (!targetUser) {
        throw new Error("Usuário não encontrado");
      }

      const existingMember = await db.getProcessMember(input.processId, targetUser.id);
      if (existingMember) {
        throw new Error("Usuário já é membro deste processo");
      }

      await db.addProcessMember({
        processId: input.processId,
        userId: targetUser.id,
        permission: input.permission,
        invitedBy: ctx.user.id,
      });

      await db.createNotification({
        userId: targetUser.id,
        title: "Você foi adicionado a um processo",
        message: `${ctx.user.name} adicionou você ao processo "${process.name}" como ${input.permission}`,
        type: "member_added",
        processId: input.processId,
        isRead: false,
      });

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `adicionou ${targetUser.name} como ${input.permission}`,
      });

      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({
      processId: z.number(),
      userId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process) {
        throw new Error("Processo não encontrado");
      }

      const currentMember = await db.getProcessMember(input.processId, ctx.user.id);
      if (process.ownerId !== ctx.user.id && currentMember?.permission !== "approver") {
        throw new Error("Sem permissão para remover membros");
      }

      if (input.userId === process.ownerId) {
        throw new Error("Não é possível remover o proprietário do processo");
      }

      await db.removeProcessMember(input.processId, input.userId);

      const removedUser = await db.getUserById(input.userId);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `removeu ${removedUser?.name || "um membro"} do processo`,
      });

      return { success: true };
    }),

  updatePermission: protectedProcedure
    .input(z.object({
      processId: z.number(),
      userId: z.number(),
      permission: z.enum(["viewer", "editor", "approver"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process) {
        throw new Error("Processo não encontrado");
      }

      if (process.ownerId !== ctx.user.id) {
        throw new Error("Apenas o proprietário pode alterar permissões");
      }

      await db.updateProcessMemberPermission(input.processId, input.userId, input.permission);

      const targetUser = await db.getUserById(input.userId);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `alterou a permissão de ${targetUser?.name || "um membro"} para ${input.permission}`,
      });

      return { success: true };
    }),

  listMembers: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ input }) => {
      return await db.getProcessMembers(input.processId);
    }),

  checkPermission: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process) {
        return { permission: null, isOwner: false };
      }

      if (process.ownerId === ctx.user.id) {
        return { permission: "owner" as const, isOwner: true };
      }

      const member = await db.getProcessMember(input.processId, ctx.user.id);
      return {
        permission: member?.permission || null,
        isOwner: false,
      };
    }),
});
