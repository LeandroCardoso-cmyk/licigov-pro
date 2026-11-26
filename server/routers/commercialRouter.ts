import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { throwLegacyEndpointDisabled } from "../services/legacyEndpointGuard";
import { enqueueEmail } from "../services/email/emailOutboxService";
import { kick as kickEmailDispatcher } from "../services/email/emailDispatcher";
import { EMAIL_CONFIG } from "../config/email";
import { serviceLogger } from "../services/observabilityService";

const log = serviceLogger("CommercialRouter");

/**
 * LR-08 — aviso INTERNO de nova manifestação de interesse, pelo outbox transacional existente (Brevo/console/fake).
 * Sempre DEPOIS da persistência: falha ou ausência de destinatário nunca perde a solicitação. Idempotente por solicitação
 * (`commercial_proposal:<id>`): reenvio/dedup não gera novo aviso. Conteúdo mínimo (sem dados pessoais do responsável).
 */
export async function notifyCommercialProposalReceived(p: {
  proposalId: number; orgaoNome: string; orgaoCidade: string; orgaoEstado: string; correlationId?: string;
}): Promise<"enqueued" | "not_configured" | "failed"> {
  const recipient = EMAIL_CONFIG.commercialNotificationEmail;
  if (!recipient) {
    log.info("commercial_notification_not_configured", { proposalId: p.proposalId, correlationId: p.correlationId });
    return "not_configured";
  }
  try {
    await enqueueEmail({
      organizationId: null,
      messageType: "commercial_proposal_received",
      templateKey: "commercial_proposal_received",
      recipient,
      payload: {
        proposalId: p.proposalId, orgaoNome: p.orgaoNome, orgaoCidade: p.orgaoCidade, orgaoEstado: p.orgaoEstado,
        adminUrl: `${EMAIL_CONFIG.appBaseUrl}/admin/propostas`,
      },
      idempotencyKey: `commercial_proposal:${p.proposalId}`,
      correlationId: p.correlationId,
    });
    kickEmailDispatcher();
    return "enqueued";
  } catch (err) {
    log.error("commercial_notification_enqueue_failed", {
      proposalId: p.proposalId, correlationId: p.correlationId, error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}
import * as db from "../db";
import { validateCNPJ } from "../services/cnpjValidator";
import { rateLimitMiddleware } from "../services/rateLimiter";
import { TRPCError } from "@trpc/server";

/** COM-01 — janela de deduplicação da solicitação comercial pendente. */
export const PROPOSAL_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Grafias equivalentes do mesmo CNPJ (como digitado, só dígitos, com máscara) — o cadastro histórico guarda como digitado. */
export function cnpjLookupVariants(raw: string): string[] {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  const variants = new Set<string>([trimmed, digits]);
  if (digits.length === 14) {
    variants.add(`${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`);
  }
  return Array.from(variants).filter((v) => v.length > 0);
}

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
        // LR-02 — opcional e SEM consulta a planos/preços/seed: a manifestação de interesse não depende de plano.
        planSlug: z.string().trim().max(50).regex(/^[a-z0-9-]*$/).optional(),
        observacoes: z.string().max(2000).optional(),
        // Honeypot anti-bot: campo invisível ao usuário humano no formulário real;
        // qualquer preenchimento indica submissão automatizada. Sem `.max(0)` aqui de
        // propósito — a rejeição acontece no corpo da mutation (abaixo), não no schema,
        // para não dar ao chamador automatizado um erro de validação que ensine o formato
        // esperado do campo.
        website: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
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

      const { website: _website, ...rawInput } = input;
      // LR-02 — nenhum preço/nome de plano é derivado de seed; só a preferência informada (se houver) é guardada.
      const proposalInput = {
        ...rawInput,
        responsavelEmail: rawInput.responsavelEmail.trim().toLowerCase(),
        planSlug: rawInput.planSlug ? rawInput.planSlug : null,
        planName: null,
        planPrice: null,
      };

      // COM-01 — manifestação de interesse idempotente: reenvio da mesma solicitação pendente (mesmo CNPJ + e-mail,
      // janela de 24h) devolve a existente. A resposta é a mesma do caso novo (não revela existência a terceiros).
      const existingId = await db.findRecentPendingProposalRequest({
        cnpjVariants: cnpjLookupVariants(input.orgaoCnpj),
        responsavelEmail: proposalInput.responsavelEmail,
        since: new Date(Date.now() - PROPOSAL_DEDUP_WINDOW_MS),
      });
      if (existingId !== null) {
        // Reenvio COMPLEMENTA a solicitação pendente: acrescenta observações novas; nunca sobrescreve contato/dados já
        // registrados (o endpoint é público e CNPJ é dado público — auditoria P2).
        await db.appendPendingProposalNotes(existingId, proposalInput.observacoes);
        return { proposalId: existingId };
      }

      const proposalId = await db.createProposalRequest({ ...proposalInput, status: "pending" });

      // LR-08 — aviso interno só depois da persistência; o resultado do aviso não altera a resposta ao solicitante.
      await notifyCommercialProposalReceived({
        proposalId, orgaoNome: input.orgaoNome, orgaoCidade: input.orgaoCidade, orgaoEstado: input.orgaoEstado,
        correlationId: ctx.correlationId,
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

  list: adminProcedure.query(async () => {

    return await db.getAllProposalRequests();
  }),

  updateStatus: adminProcedure
    .input(
      z.object({
        proposalId: z.number(),
        status: z.enum(["pending", "documents_sent", "empenho_received", "activated", "cancelled"]),
      })
    )
    .mutation(async ({ input }) => {

      await db.updateProposalRequestStatus(input.proposalId, input.status);
      return { success: true };
    }),

  registerEmpenho: adminProcedure
    .input(
      z.object({
        proposalId: z.number(),
        numeroEmpenho: z.string(),
        dataEmpenho: z.date(),
        valorEmpenho: z.number(),
      })
    )
    .mutation(async ({ input }) => {

      await db.updateProposalWithEmpenho(
        input.proposalId,
        input.numeroEmpenho,
        input.dataEmpenho,
        input.valorEmpenho
      );

      return { success: true };
    }),

  /**
   * LR-03 (LICIGOV-LAUNCH-READY, P0) — DESATIVADO. A tela enviava `userId: proposalId`: ativar a proposta N criava uma
   * assinatura ativa de 1 ano para o USUÁRIO de id N (sem relação com o órgão solicitante), e o servidor aceitava qualquer
   * `userId`. No modelo institucional o cliente é a ORGANIZAÇÃO e o acesso é concedido administrativamente: criação do
   * órgão + convite do administrador (`tenantOnboarding.create`) e, quando aplicável, licenciamento por organização
   * (`moduleLicensing.activateModule`, admin de plataforma com tenant explícito). Nota de empenho registrada não é, por si,
   * concessão de acesso. Nenhuma escrita acontece aqui.
   */
  activateSubscription: adminProcedure
    .input(z.object({ proposalId: z.number(), userId: z.number().optional() }).passthrough())
    .mutation(({ ctx }) => throwLegacyEndpointDisabled(
      "commercial.activateSubscription", "LR-03", ctx,
      "Conceda o acesso por organização: Administração › Organizações (criar órgão e convidar o administrador).",
    )),

  uploadEmpenho: adminProcedure
    .input(
      z.object({
        proposalId: z.number(),
        fileUrl: z.string(),
        fileKey: z.string(),
      })
    )
    .mutation(async ({ input }) => {

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

  uploadContrato: adminProcedure
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
