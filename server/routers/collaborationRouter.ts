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

  updateFunctionalRole: protectedProcedure
    .input(z.object({
      processId: z.number(),
      userId: z.number(),
      functionalRole: z.enum(["solicitante", "compras", "juridico", "controle_interno", "gestor", "fiscal", "administrador"]).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new Error("Apenas o proprietário pode definir perfis funcionais");
      }
      await db.updateProcessMemberFunctionalRole(input.processId, input.userId, input.functionalRole);
      const targetUser = await db.getUserById(input.userId);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `definiu perfil de ${targetUser?.name || "membro"} como ${input.functionalRole || "nenhum"}`,
      });
      return { success: true };
    }),

  assignStage: protectedProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"]),
      assignedUserId: z.number(),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new Error("Apenas o proprietário pode atribuir responsáveis por etapa");
      }
      const assignedUser = await db.getUserById(input.assignedUserId);
      if (!assignedUser) throw new Error("Usuário não encontrado");

      await db.upsertStageAssignment({
        processId: input.processId,
        docType: input.docType,
        assignedUserId: input.assignedUserId,
        assignedBy: ctx.user.id,
        note: input.note || null,
      });

      await db.createNotification({
        userId: input.assignedUserId,
        title: "Você foi designado como responsável por uma etapa",
        message: `${ctx.user.name} designou você como responsável pela etapa ${input.docType.toUpperCase()} no processo "${process.name}"${input.note ? `. Nota: ${input.note}` : ""}`,
        type: "stage_assigned",
        processId: input.processId,
        isRead: false,
      });

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `designou ${assignedUser.name} como responsável pela etapa ${input.docType.toUpperCase()}`,
        details: JSON.stringify({ docType: input.docType, assignedUserId: input.assignedUserId }),
      });

      return { success: true };
    }),

  unassignStage: protectedProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new Error("Apenas o proprietário pode remover responsáveis");
      }
      await db.removeStageAssignment(input.processId, input.docType);
      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `removeu responsável da etapa ${input.docType.toUpperCase()}`,
      });
      return { success: true };
    }),

  getStageAssignments: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ input }) => {
      return await db.getStageAssignments(input.processId);
    }),
});
