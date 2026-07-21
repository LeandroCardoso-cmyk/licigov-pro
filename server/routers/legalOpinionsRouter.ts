/**
 * @deprecated LEGACY_ACTIVE_MAINTENANCE_ONLY (RC-C0.1A) — mantém apenas por
 * compatibilidade (`/parecer-juridico/*`, fora do menu). Não adicione novas
 * funcionalidades, novos tipos de documento ou novos consumidores aqui. Destino
 * canônico: `legalOpinionWorkspaceRouter` (`/parecer`). Referência:
 * docs/architecture/LEGACY_INVENTORY.md.
 *
 * RC-LEGAL-SEC-001 — Isolamento multi-tenant completo. Toda procedure
 * institucional usa `tenantProcedure`; `organizationId` é sempre resolvido no
 * servidor (nunca aceito do cliente) e aplicado antes de qualquer leitura/escrita.
 * `signature_history` (sem coluna `organizationId` própria) é protegida validando
 * o parecer-pai dentro da organização primeiro (na camada de repositório).
 * `setSignaturePassword`/`hasSignaturePassword` operam sobre `ctx.user.id` — sem
 * dado organizacional envolvido, sem vazamento cross-tenant possível — mantidas
 * em `protectedProcedure` deliberadamente (ver LEGACY_INVENTORY.md).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, tenantProcedure, router } from "../_core/trpc";
import { rateLimitMiddleware } from "../services/rateLimiter";
import { exportLegalOpinionToPDF, exportLegalOpinionToDOCX } from "../services/legalOpinionExportService";
import { getDocumentSettingsByUser, getContractByIdForOrganization } from "../db";
import {
  createLegalOpinion,
  getLegalOpinionsByOrganization,
  getLegalOpinionByIdForOrganization,
  updateLegalOpinionForOrganization,
  deleteLegalOpinionForOrganization,
  getLegalOpinionsBySourceForOrganization,
  getProcessById,
  getDirectContractById,
} from "../db";
import { generateLegalOpinion } from "../services/legalOpinionService";

async function requireOpinionForOrg(id: number, organizationId: number) {
  const opinion = await getLegalOpinionByIdForOrganization(id, organizationId);
  if (!opinion) throw new TRPCError({ code: "NOT_FOUND", message: "Parecer jurídico não encontrado" });
  return opinion;
}

export const legalOpinionsRouter = router({
  /**
   * Listar pareceres jurídicos com filtros opcionais
   */
  list: tenantProcedure
    .input(
      z.object({
        status: z.enum(["draft", "in_review", "approved", "archived"]).optional(),
        sourceType: z.enum(["process", "direct_contract", "contract", "other"]).optional(),
        requestedBy: z.number().optional(),
        isTemplate: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ input, ctx }) => {
      return await getLegalOpinionsByOrganization(ctx.organizationId, input);
    }),

  /**
   * Buscar parecer jurídico por ID
   */
  getById: tenantProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      return await requireOpinionForOrg(input.id, ctx.organizationId);
    }),

  /**
   * Buscar pareceres por fonte (processo, contratação direta, etc)
   */
  getBySource: tenantProcedure
    .input(
      z.object({
        sourceType: z.enum(["process", "direct_contract", "contract", "other"]),
        sourceId: z.number(),
      })
    )
    .query(async ({ input, ctx }) => {
      return await getLegalOpinionsBySourceForOrganization(input.sourceType, input.sourceId, ctx.organizationId);
    }),

  /**
   * Criar novo parecer jurídico
   */
  create: tenantProcedure
    .input(
      z.object({
        title: z.string().min(1, "Título é obrigatório"),
        description: z.string().optional(),
        sourceType: z.enum(["process", "direct_contract", "contract", "other"]),
        sourceId: z.number().optional(),
        legalQuestion: z.string().min(10, "Questão jurídica deve ter pelo menos 10 caracteres"),
        context: z.string().optional(),
        requiredSignatures: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // RC-LEGAL-SEC-001: contrato-fonte precisa pertencer à organização — nunca
      // vincular parecer a contrato de outro tenant.
      if (input.sourceType === "contract" && input.sourceId) {
        const contract = await getContractByIdForOrganization(input.sourceId, ctx.organizationId);
        if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
      }

      const opinionId = await createLegalOpinion({
        ...input,
        organizationId: ctx.organizationId,
        requestedBy: ctx.user.id,
        status: "draft",
      });

      return { id: opinionId };
    }),

  /**
   * Atualizar parecer jurídico
   */
  update: tenantProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        legalQuestion: z.string().optional(),
        context: z.string().optional(),
        opinion: z.string().optional(),
        conclusion: z.enum(["favorable", "unfavorable", "with_reservations"]).optional(),
        citedArticles: z.array(z.string()).optional(),
        jurisprudence: z.array(z.any()).optional(),
        status: z.enum(["draft", "in_review", "approved", "archived"]).optional(),
        reviewedBy: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;

      // AUDITORIA TÉCNICA - Item 1.2: Bloquear edição após assinatura
      const { getSignatureCountForOrganization } = await import("../db");
      const { canEditDocument } = await import("../services/signatureValidation");

      await requireOpinionForOrg(id, ctx.organizationId);
      const signatureCount = await getSignatureCountForOrganization(id, ctx.organizationId);
      const editCheck = canEditDocument(signatureCount);

      if (!editCheck.canEdit) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: editCheck.reason || "Documento não pode ser editado"
        });
      }

      // Se está sendo aprovado, adicionar reviewedBy e reviewedAt
      const updated = data.status === "approved"
        ? await updateLegalOpinionForOrganization(id, ctx.organizationId, { ...data, reviewedAt: new Date() })
        : await updateLegalOpinionForOrganization(id, ctx.organizationId, data);

      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Parecer jurídico não encontrado" });

      return { success: true };
    }),

  /**
   * Deletar parecer jurídico
   */
  delete: tenantProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const deleted = await deleteLegalOpinionForOrganization(input.id, ctx.organizationId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Parecer jurídico não encontrado" });
      return { success: true };
    }),

  /**
   * Exportar parecer em PDF
   */
  exportPDF: tenantProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const opinion = await requireOpinionForOrg(input.id, ctx.organizationId);

      const settings = await getDocumentSettingsByUser(ctx.user.id);

      // Buscar assinatura digital se existir
      let signatureBlock: string | undefined;
      if ((opinion as any).signatureId) {
        const { getDigitalSignatureById } = await import("../db");
        const { formatSignatureBlock } = await import("../services/digitalSignatureService");
        const signature = await getDigitalSignatureById((opinion as any).signatureId);
        if (signature) {
          signatureBlock = formatSignatureBlock(signature);
        }
      }

      const pdfBuffer = await exportLegalOpinionToPDF(opinion, settings as any || {}, signatureBlock);

      return {
        buffer: pdfBuffer.toString("base64"),
        filename: `parecer-juridico-${opinion.id}.pdf`,
      };
    }),

  /**
   * Exportar parecer em DOCX
   */
  exportDOCX: tenantProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const opinion = await requireOpinionForOrg(input.id, ctx.organizationId);

      const settings = await getDocumentSettingsByUser(ctx.user.id);

      // Buscar assinatura digital se existir
      let signatureBlock: string | undefined;
      if ((opinion as any).signatureId) {
        const { getDigitalSignatureById } = await import("../db");
        const { formatSignatureBlock } = await import("../services/digitalSignatureService");
        const signature = await getDigitalSignatureById((opinion as any).signatureId);
        if (signature) {
          signatureBlock = formatSignatureBlock(signature);
        }
      }

      const docxBuffer = await exportLegalOpinionToDOCX(opinion, settings as any || {}, signatureBlock);

      return {
        buffer: docxBuffer.toString("base64"),
        filename: `parecer-juridico-${opinion.id}.docx`,
      };
    }),

  /**
   * Gerar parecer jurídico com IA
   * RATE LIMIT: 20 gerações por hora (Auditoria Técnica - Item 3.2)
   */
  generateOpinion: tenantProcedure.use(rateLimitMiddleware('documentGeneration'))
    .input(
      z.object({
        id: z.number(), // ID do parecer já criado
      })
    )
    .mutation(async ({ input, ctx }) => {
      const opinion = await requireOpinionForOrg(input.id, ctx.organizationId);

      // Buscar dados da fonte (processo, contratação, contrato)
      // RC-LEGAL-SEC-001: contrato resolvido dentro da organização (getContractByIdForOrganization).
      // process/direct_contract permanecem via getProcessById/getDirectContractById — risco
      // registrado separadamente (fora do escopo desta sprint, routers diferentes).
      let sourceData = null;
      if (opinion.sourceId) {
        if (opinion.sourceType === "process") {
          sourceData = await getProcessById(opinion.sourceId);
        } else if (opinion.sourceType === "direct_contract") {
          sourceData = await getDirectContractById(opinion.sourceId);
        } else if (opinion.sourceType === "contract") {
          sourceData = await getContractByIdForOrganization(opinion.sourceId, ctx.organizationId);
        }
      }

      // Gerar parecer com IA
      const result = await generateLegalOpinion({
        title: opinion.title,
        legalQuestion: opinion.legalQuestion,
        context: opinion.context || undefined,
        sourceType: opinion.sourceType,
        sourceData,
      });

      // Atualizar parecer com o resultado
      await updateLegalOpinionForOrganization(input.id, ctx.organizationId, {
        opinion: result.opinion,
        conclusion: result.conclusion,
        citedArticles: result.citedArticles,
        jurisprudence: result.jurisprudence,
      });

      return result;
    }),
  /**
   * Assinar digitalmente um parecer jurídico (ATUALIZADO: com role e senha)
   * RATE LIMIT: 10 assinaturas por 15 minutos (Auditoria Técnica - Item 3.2)
   */
  sign: tenantProcedure.use(rateLimitMiddleware('signature'))
    .input(
      z.object({
        id: z.number(),
        signerRole: z.enum(["revisor", "responsavel", "gestor"]),
        signaturePassword: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { generateContentHash, generateSignature, generateCertificateInfo } = await import("../services/digitalSignatureService");
      const {
        validateSignaturePassword,
        hasUserSignedOpinionForOrganization,
        addSignatureToHistoryForOrganization,
        getSignatureCountForOrganization,
        getSignatureHistoryForOrganization,
      } = await import("../db");
      const { validateBeforeSign, canEditDocument } = await import("../services/signatureValidation");

      // Buscar parecer dentro da organização (NOT_FOUND se cross-tenant)
      const opinion = await requireOpinionForOrg(input.id, ctx.organizationId);

      // Validar senha de assinatura
      const isPasswordValid = await validateSignaturePassword(ctx.user.id, input.signaturePassword);
      if (!isPasswordValid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Senha de assinatura inválida" });
      }

      // Verificar se usuário já assinou
      const alreadySigned = await hasUserSignedOpinionForOrganization(input.id, ctx.user.id, ctx.organizationId);
      if (alreadySigned) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Você já assinou este parecer" });
      }

      // Verificar se já atingiu o número de assinaturas necessárias
      const currentSignatures = await getSignatureCountForOrganization(input.id, ctx.organizationId);
      if (currentSignatures >= opinion.requiredSignatures) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este parecer já possui todas as assinaturas necessárias" });
      }

      // AUDITORIA TÉCNICA - Item 1.2: Verificar se documento pode ser editado
      const editCheck = canEditDocument(currentSignatures);
      if (!editCheck.canEdit) {
        // Documento já assinado, validar integridade antes de adicionar nova assinatura
        const signatures = await getSignatureHistoryForOrganization(input.id, ctx.organizationId);
        if (signatures.length > 0) {
          const content = `${opinion.title}\n${opinion.legalQuestion}\n${opinion.opinion || ""}`;
          const validation = validateBeforeSign({
            documentContent: content,
            currentSignatureCount: currentSignatures,
            expectedSignatureCount: currentSignatures,
            originalHash: signatures[0].documentHash,
          });

          if (!validation.isValid) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Validação de assinatura falhou: ${validation.errors.join(", ")}`
            });
          }
        }
      }

      // Gerar hash do conteúdo
      const content = `${opinion.title}\n${opinion.legalQuestion}\n${opinion.opinion || ""}`;
      const documentHash = generateContentHash(content);

      // Gerar assinatura criptográfica
      const signature = generateSignature(documentHash, ctx.user.id);

      // Gerar informações do certificado
      const certificateInfo = generateCertificateInfo(ctx.user.name || "Usuário", ctx.user.email);

      // Adicionar assinatura ao histórico (revalida o parecer-pai internamente)
      const signatureId = await addSignatureToHistoryForOrganization({
        opinionId: input.id,
        userId: ctx.user.id,
        userName: ctx.user.name || "Usuário",
        userEmail: ctx.user.email || null,
        signerRole: input.signerRole,
        documentHash,
        signature,
        certificateInfo,
      }, ctx.organizationId);
      if (signatureId === null) throw new TRPCError({ code: "NOT_FOUND", message: "Parecer jurídico não encontrado" });

      // Enviar notificação automática
      const { notifyOwner } = await import("../_core/notification");
      const roleNames = {
        revisor: "Advogado Revisor",
        responsavel: "Advogado Responsável",
        gestor: "Gestor Jurídico",
      };
      await notifyOwner({
        title: `🔒 Parecer Jurídico Assinado`,
        content: `O parecer "${opinion.title}" foi assinado digitalmente por ${ctx.user.name || ctx.user.email} como ${roleNames[input.signerRole]}.\n\nAssinado em: ${new Date().toLocaleString("pt-BR")}\nAssinaturas: ${currentSignatures + 1}/${opinion.requiredSignatures}\nHash SHA-256: ${documentHash.substring(0, 16)}...`,
      });

      return { success: true, signatureId, signaturesCount: currentSignatures + 1, requiredSignatures: opinion.requiredSignatures };
    }),

  /**
   * Verificar assinatura digital de um parecer
   */
  verifySignature: tenantProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const { validateSignature } = await import("../services/digitalSignatureService");
      const { getDigitalSignatureById } = await import("../db");

      // Buscar parecer dentro da organização
      const opinion = await getLegalOpinionByIdForOrganization(input.id, ctx.organizationId);
      if (!opinion || !(opinion as any).signatureId) {
        return { signed: false, valid: false };
      }

      // Buscar assinatura
      const digitalSignature = await getDigitalSignatureById((opinion as any).signatureId);
      if (!digitalSignature) {
        return { signed: false, valid: false };
      }

      // Gerar hash do conteúdo atual
      const { generateContentHash } = await import("../services/digitalSignatureService");
      const content = `${opinion.title}\n${opinion.legalQuestion}\n${opinion.opinion || ""}`;
      const currentHash = generateContentHash(content);

      // Verificar se o hash corresponde
      const hashMatches = currentHash === digitalSignature.contentHash;

      // Validar assinatura
      const signatureValid = validateSignature(
        digitalSignature.contentHash,
        digitalSignature.signature,
        digitalSignature.signedBy
      );

      return {
        signed: true,
        valid: hashMatches && signatureValid && digitalSignature.isValid,
        signedBy: digitalSignature.signedByName,
        signedAt: digitalSignature.signedAt,
        hashMatches,
        signatureValid,
      };
    }),

  /**
   * Obter visão geral de estatísticas (da organização)
   */
  getAnalytics: tenantProcedure
    .input(
      z.object({
        period: z.enum(["all", "7days", "30days", "90days", "year"]).default("30days"),
      })
    )
    .query(async ({ input, ctx }) => {
    const {
      getLegalOpinionsOverviewForOrganization,
      getLegalOpinionsByMonthForOrganization,
      getTopCitedArticlesForOrganization,
      getConclusionDistributionForOrganization,
    } = await import("../db");

    const [overview, byMonth, topArticles, conclusionDist] = await Promise.all([
      getLegalOpinionsOverviewForOrganization(ctx.organizationId, input.period),
      getLegalOpinionsByMonthForOrganization(ctx.organizationId, input.period),
      getTopCitedArticlesForOrganization(ctx.organizationId, input.period),
      getConclusionDistributionForOrganization(ctx.organizationId, input.period),
    ]);

    return {
      overview,
      byMonth,
      topArticles,
      conclusionDist,
    };
  }),

  /**
   * Configurar senha de assinatura do usuário
   * (não institucional — escopo é o próprio usuário, sem dado organizacional)
   */
  setSignaturePassword: protectedProcedure
    .input(
      z.object({
        password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { setSignaturePassword } = await import("../db");
      await setSignaturePassword(ctx.user.id, input.password);
      return { success: true };
    }),

  /**
   * Verificar se usuário tem senha de assinatura configurada
   * (não institucional — escopo é o próprio usuário, sem dado organizacional)
   */
  hasSignaturePassword: protectedProcedure.query(async ({ ctx }) => {
    const { hasSignaturePassword } = await import("../db");
    return await hasSignaturePassword(ctx.user.id);
  }),

  /**
   * Obter histórico de assinaturas de um parecer
   */
  getSignatureHistory: tenantProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const { getSignatureHistoryForOrganization } = await import("../db");
      return await getSignatureHistoryForOrganization(input.id, ctx.organizationId);
    }),
});
