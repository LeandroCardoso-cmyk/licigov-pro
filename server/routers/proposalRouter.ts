import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { generatePropostaComercial, generateMinutaContrato, generateTermoReferencia } from "../services/proposalGenerator";
import { generateProposalZip } from "../services/proposalZipGenerator";
import { TRPCError } from "@trpc/server";

export const proposalRouter = router({
  create: publicProcedure
    .input(
      z.object({
        orgaoNome: z.string().min(1),
        orgaoCnpj: z.string().min(14).max(18),
        orgaoEndereco: z.string().min(1),
        orgaoCidade: z.string().min(1),
        orgaoEstado: z.string().length(2),
        orgaoCep: z.string().min(8).max(9),
        responsavelNome: z.string().min(1),
        responsavelCargo: z.string().optional(),
        responsavelEmail: z.string().email(),
        responsavelTelefone: z.string().min(10),
        planSlug: z.string(),
        observacoes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const plan = await db.getSubscriptionPlanBySlug(input.planSlug);
      if (!plan) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Plano não encontrado",
        });
      }

      const proposalId = await db.createProposalRequest({
        ...input,
        planName: plan.name,
        planPrice: plan.price,
        status: "pending",
      });

      await db.updateProposalRequestStatus(proposalId, "documents_sent");

      return { proposalId };
    }),

  generateDocuments: publicProcedure
    .input(z.object({ proposalId: z.number() }))
    .mutation(async ({ input }) => {
      const proposal = await db.getProposalRequestById(input.proposalId);
      if (!proposal) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proposta não encontrada",
        });
      }

      const proposalData = {
        ...proposal,
        responsavelCargo: proposal.responsavelCargo ?? undefined,
        observacoes: proposal.observacoes ?? undefined,
      };
      
      // Gerar ZIP com proposta + documentos da empresa
      const zipBuffer = await generateProposalZip(proposalData);

      return {
        zip: zipBuffer.toString("base64"),
      };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Apenas administradores podem acessar",
      });
    }

    return await db.getAllProposalRequests();
  }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        proposalId: z.number(),
        status: z.enum(["pending", "documents_sent", "empenho_received", "activated", "cancelled"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem atualizar status",
        });
      }

      await db.updateProposalRequestStatus(input.proposalId, input.status);
      return { success: true };
    }),

  registerEmpenho: protectedProcedure
    .input(
      z.object({
        proposalId: z.number(),
        numeroEmpenho: z.string(),
        dataEmpenho: z.date(),
        valorEmpenho: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem registrar empenho",
        });
      }

      await db.updateProposalWithEmpenho(
        input.proposalId,
        input.numeroEmpenho,
        input.dataEmpenho,
        input.valorEmpenho
      );

      return { success: true };
    }),

  activateSubscription: protectedProcedure
    .input(
      z.object({
        proposalId: z.number(),
        userId: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem ativar assinaturas",
        });
      }

      const proposal = await db.getProposalRequestById(input.proposalId);
      if (!proposal) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proposta não encontrada",
        });
      }

      if (proposal.status !== "empenho_received") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Empenho ainda não foi registrado",
        });
      }

      const plan = await db.getSubscriptionPlanBySlug(proposal.planSlug);
      if (!plan) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Plano não encontrado",
        });
      }

      const startDate = new Date();
      const endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 1);

      const subscriptionResult = await db.createSubscription({
        userId: input.userId,
        planId: plan.id,
        status: "active",
        currentPeriodStart: startDate,
        currentPeriodEnd: endDate,
        cancelAtPeriodEnd: false,
      });

      const subscriptionId = Number((subscriptionResult as any).insertId);

      await db.updateProposalRequestStatus(input.proposalId, "activated");

      await db.createAuditLog({
        adminId: ctx.user.id,
        action: "other",
        details: `Assinatura ativada via empenho ${proposal.numeroEmpenho} para proposta #${input.proposalId}`,
      });

      return { success: true };
    }),

  uploadEmpenho: protectedProcedure
    .input(
      z.object({
        proposalId: z.number(),
        fileUrl: z.string(),
        fileKey: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem fazer upload de empenho",
        });
      }

      const proposal = await db.getProposalRequestById(input.proposalId);
      if (!proposal) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proposta não encontrada",
        });
      }

      await db.updateProposalRequest(input.proposalId, {
        empenhoFileUrl: input.fileUrl,
        empenhoFileKey: input.fileKey,
      });

      return { success: true };
    }),

  uploadContrato: protectedProcedure
    .input(
      z.object({
        proposalId: z.number(),
        fileUrl: z.string(),
        fileKey: z.string(),
        dataAssinatura: z.date(),
        dataInicioVigencia: z.date(),
        dataFimVigencia: z.date(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem fazer upload de contrato",
        });
      }

      const proposal = await db.getProposalRequestById(input.proposalId);
      if (!proposal) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proposta não encontrada",
        });
      }

      const now = new Date();
      const diffDays = Math.ceil((input.dataFimVigencia.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      let statusVigencia: "vigente" | "vence_30_dias" | "vence_60_dias" | "vence_90_dias" | "vencido" = "vigente";
      
      if (diffDays < 0) {
        statusVigencia = "vencido";
      } else if (diffDays <= 30) {
        statusVigencia = "vence_30_dias";
      } else if (diffDays <= 60) {
        statusVigencia = "vence_60_dias";
      } else if (diffDays <= 90) {
        statusVigencia = "vence_90_dias";
      }

      await db.updateProposalRequest(input.proposalId, {
        contratoFileUrl: input.fileUrl,
        contratoFileKey: input.fileKey,
        dataAssinatura: input.dataAssinatura,
        dataInicioVigencia: input.dataInicioVigencia,
        dataFimVigencia: input.dataFimVigencia,
        statusVigencia,
      });

      await db.createAuditLog({
        adminId: ctx.user.id,
        action: "other",
        details: `Contrato assinado anexado para proposta #${input.proposalId} - Vigência: ${input.dataInicioVigencia.toLocaleDateString('pt-BR')} a ${input.dataFimVigencia.toLocaleDateString('pt-BR')}`,
      });

      return { success: true };
    }),
});
