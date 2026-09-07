import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { validateCNPJ } from "../services/cnpjValidator";
import { rateLimitMiddleware } from "../services/rateLimiter";
import { TRPCError } from "@trpc/server";

export const commercialRouter = router({
  // PR 0 (Security Emergency Closure): fluxo de captação comercial pública da landing
  // (`/solicitar-proposta`) — permanece PÚBLICO por design (não há tenant nesta etapa).
  // Endurecido com: rate limit por IP, validação real de CNPJ (dígitos verificadores),
  // limites de payload nos campos livres, e honeypot anti-bot.
  create: publicProcedure
    .use(rateLimitMiddleware("commercial"))
    .input(
      z.object({
        orgaoNome: z.string().min(1).max(200),
        orgaoCnpj: z.string().min(14).max(18),
        orgaoEndereco: z.string().min(1).max(300),
        orgaoCidade: z.string().min(1).max(100),
        orgaoEstado: z.string().length(2),
        orgaoCep: z.string().min(8).max(9),
        responsavelNome: z.string().min(1).max(200),
        responsavelCargo: z.string().max(100).optional(),
        responsavelEmail: z.string().email().max(255),
        responsavelTelefone: z.string().min(10).max(20),
        planSlug: z.string().max(50),
        observacoes: z.string().max(2000).optional(),
        // Honeypot anti-bot: campo invisível ao usuário humano no formulário real;
        // qualquer preenchimento indica submissão automatizada. Sem `.max(0)` aqui de
        // propósito — a rejeição acontece no corpo da mutation (abaixo), não no schema,
        // para não dar ao chamador automatizado um erro de validação que ensine o formato
        // esperado do campo.
        website: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.website) {
        // Honeypot preenchido — descarta silenciosamente sem revelar o motivo ao chamador.
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solicitação inválida." });
      }

      const cnpjCheck = validateCNPJ(input.orgaoCnpj);
      if (!cnpjCheck.isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: cnpjCheck.error || "CNPJ inválido",
        });
      }

      const plan = await db.getSubscriptionPlanBySlug(input.planSlug);
      if (!plan) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Plano não encontrado",
        });
      }

      const { website: _website, ...proposalInput } = input;

      const proposalId = await db.createProposalRequest({
        ...proposalInput,
        planName: plan.name,
        planPrice: plan.price,
        status: "pending",
      });

      // PR 0: removida a transição fabricada para "documents_sent" — nenhum documento é
      // enviado neste passo. O status avança para "documents_sent" somente via ação real
      // de um fluxo autorizado (hoje: `updateStatus`, admin-gated).

      return { proposalId };
    }),

  // `generateDocuments` foi removido nesta PR (Security Emergency Closure): era
  // `publicProcedure`, autorizava só por `proposalId` sequencial e devolvia um ZIP com
  // documentos empresariais completos (contrato social, certidões etc.) sem nenhum
  // consumidor funcional legítimo — o frontend chamava `proposals.generateDocuments`,
  // router inexistente no appRouter (`proposals` nunca foi registrado), logo o download
  // já era um call morto em runtime. Não foi substituído por outro mecanismo: não há
  // necessidade legítima comprovada de download externo nesta fase. Se essa necessidade
  // surgir, o desenho correto é um capability token criptográfico, expirável, escopado e
  // vinculado à proposta — nunca autorização por ID sequencial.

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

      await db.createSubscription({
        userId: input.userId,
        planId: plan.id,
        status: "active",
        currentPeriodStart: startDate,
        currentPeriodEnd: endDate,
        cancelAtPeriodEnd: false,
      });

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
