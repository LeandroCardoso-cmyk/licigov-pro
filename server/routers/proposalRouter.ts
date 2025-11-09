import { z } from "zod";
import { publicProcedure, protectedProcedure, router, adminProcedure } from "../_core/trpc";
import * as db from "../db";
import { generatePropostaComercial, generateMinutaContrato, generateTermoReferencia } from "../services/proposalGenerator";
import { TRPCError } from "@trpc/server";

export const proposalRouter = router({
  // Criar solicitação de proposta (público - qualquer um pode solicitar)
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
      // Buscar informações do plano
      const plan = await db.getSubscriptionPlanBySlug(input.planSlug);
      if (!plan) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Plano não encontrado",
        });
      }

      // Criar solicitação
      const proposalId = await db.createProposalRequest({
        ...input,
        planName: plan.name,
        planPrice: plan.price,
        status: "pending",
      });

      // Atualizar status para documents_sent
      await db.updateProposalRequestStatus(proposalId, "documents_sent");

      return { proposalId };
    }),

  // Gerar documentos da proposta (público - após criar solicitação)
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

      // Gerar documentos
      const [propostaBuffer, contratoBuffer, trBuffer] = await Promise.all([
        generatePropostaComercial(proposal),
        generateMinutaContrato(proposal),
        generateTermoReferencia(proposal),
      ]);

      // Retornar buffers como base64 para download no frontend
      return {
        proposta: propostaBuffer.toString("base64"),
        contrato: contratoBuffer.toString("base64"),
        termoReferencia: trBuffer.toString("base64"),
      };
    }),

  // Listar todas as solicitações (admin)
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Apenas administradores podem acessar",
      });
    }

    return await db.getAllProposalRequests();
  }),

  // Atualizar status da proposta (admin)
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

  // Registrar empenho recebido (admin)
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

  // Ativar assinatura após receber empenho (admin)
  activateSubscription: protectedProcedure
    .input(
      z.object({
        proposalId: z.number(),
        userId: z.number(), // ID do usuário que terá a assinatura
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

      // Buscar plano
      const plan = await db.getSubscriptionPlanBySlug(proposal.planSlug);
      if (!plan) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Plano não encontrado",
        });
      }

      // Criar assinatura manual (12 meses)
      const startDate = new Date();
      const endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 1);

      await db.createSubscription({
        userId: input.userId,
        planId: plan.id,
        status: "active",
        currentPeriodStart: startDate,
        currentPeriodEnd: endDate,
        cancelAtPeriodEnd: false,
        paymentMethod: "empenho",
      });

      // Atualizar status da proposta
      await db.updateProposalRequestStatus(input.proposalId, "activated");

      // Registrar log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        action: "activate_subscription_empenho",
        entityType: "proposal",
        entityId: input.proposalId,
        details: `Assinatura ativada via empenho ${proposal.numeroEmpenho}`,
      });

      return { success: true };
    }),
});
