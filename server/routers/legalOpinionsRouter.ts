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
 * `hasSignaturePassword` opera sobre `ctx.user.id` — sem dado organizacional.
 *
 * R2 / PR-03 — CUTOVER do parecer legado (LEG-012; SEM-016, SEM-017; decisão humana R2.1 congelada).
 *  - MUTATION_DISABLED: `create`, `update`, `delete`, `generateOpinion`, `sign` e `setSignaturePassword`
 *    continuam REGISTRADAS e com o MESMO schema de input, mas a PRIMEIRA instrução de cada handler é
 *    `throwLegacyEndpointDisabled(..., "LEG-012", ...)` (FORBIDDEN + `LEGACY_ENDPOINT_DISABLED`, evento
 *    estruturado sem input) — antes de qualquer leitura/escrita em banco, IA (Cognitive Kernel), assinatura,
 *    notificação ou senha. Fecha: aprovador escolhido pelo cliente, autor aprovando o próprio parecer, edição
 *    de aprovado/assinado, exclusão de assinado e IA sobrescrevendo conteúdo/conclusão (SEM-016/017).
 *  - HISTORICAL_READ: `list`, `getById`, `getBySource`, `exportPDF`, `exportDOCX`, `verifySignature`,
 *    `getAnalytics`, `hasSignaturePassword` e `getSignatureHistory` seguem tenant-scoped e sem escrita — o
 *    histórico continua legível (nenhuma linha de `legal_opinions`/`signature_history` é apagada ou
 *    alterada). O volume real desse histórico é a verificação read-only R2.3 (pendente).
 *  - Novo parecer: workspace canônico (`legalOpinionWorkspace.*`, rota `/parecer`).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, tenantProcedure, router } from "../_core/trpc";
import { rateLimitMiddleware } from "../services/rateLimiter";
import { exportLegalOpinionToPDF, exportLegalOpinionToDOCX } from "../services/legalOpinionExportService";
import { resolveInstitutionalIdentity } from "../services/institutionalIdentityService";
import { throwLegacyEndpointDisabled } from "../services/legacyEndpointGuard";

/** R2 / PR-03 — superfície do inventário R2.1 desligada para mutação. */
export const LEG012_SURFACE_ID = "LEG-012";

/** Formato de saída histórico de `generateOpinion` (mantido só no nível de tipo para os chamadores legados). */
type LegacyGeneratedOpinion = {
  opinion: string;
  conclusion: "favorable" | "unfavorable" | "with_reservations";
  citedArticles: string[];
  jurisprudence: unknown[];
};

/**
 * Mapeia a identidade institucional COMPOSTA (fonte canônica única) para o formato de settings do
 * exportador de parecer. Elimina a leitura direta de `documentSettings` (que não guarda mais
 * nome/cnpj). Exportação de parecer legado é LIVE (preview); o parecer OFICIAL (emitido) sai
 * pelo pipeline `official_documents`, que congela o snapshot de identidade.
 */
async function opinionExportSettings(organizationId: number) {
  const identity = await resolveInstitutionalIdentity(organizationId);
  return {
    organizationName: identity.organizationName ?? null,
    organizationAddress: identity.address ?? null,
    organizationCnpj: identity.cnpj ?? null,
    organizationPhone: identity.phone ?? null,
    organizationEmail: identity.email ?? null,
    organizationWebsite: identity.website ?? null,
    logoUrl: identity.logoUrl ?? null,
  };
}
import {
  getLegalOpinionsByOrganization,
  getLegalOpinionByIdForOrganization,
  getLegalOpinionsBySourceForOrganization,
} from "../db";

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
    .mutation(async ({ ctx }): Promise<{ id: number }> => {
      throwLegacyEndpointDisabled("legalOpinions.create", LEG012_SURFACE_ID, ctx, "o workspace canônico do Parecer Jurídico (/parecer → legalOpinionWorkspace.*)");
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
    .mutation(async ({ ctx }): Promise<{ success: boolean }> => {
      throwLegacyEndpointDisabled("legalOpinions.update", LEG012_SURFACE_ID, ctx, "o workspace canônico do Parecer Jurídico (/parecer → legalOpinionWorkspace.*)");
    }),

  /**
   * Deletar parecer jurídico
   */
  delete: tenantProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx }): Promise<{ success: boolean }> => {
      throwLegacyEndpointDisabled("legalOpinions.delete", LEG012_SURFACE_ID, ctx, "o workspace canônico do Parecer Jurídico (/parecer → legalOpinionWorkspace.*)");
    }),

  /**
   * Exportar parecer em PDF
   */
  exportPDF: tenantProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const opinion = await requireOpinionForOrg(input.id, ctx.organizationId);

      const settings = await opinionExportSettings(ctx.organizationId);

      // Buscar assinatura digital se existir
      let signatureBlock: string | undefined;
      const pdfSignatureId = (opinion as { signatureId?: number }).signatureId;
      if (pdfSignatureId) {
        const { getDigitalSignatureById } = await import("../db");
        const { formatSignatureBlock } = await import("../services/digitalSignatureService");
        const signature = await getDigitalSignatureById(pdfSignatureId);
        if (signature) {
          signatureBlock = formatSignatureBlock(signature);
        }
      }

      const pdfSettings = (settings ?? {}) as Parameters<typeof exportLegalOpinionToPDF>[1];
      const pdfBuffer = await exportLegalOpinionToPDF(opinion, pdfSettings, signatureBlock);

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

      const settings = await opinionExportSettings(ctx.organizationId);

      // Buscar assinatura digital se existir
      let signatureBlock: string | undefined;
      const docxSignatureId = (opinion as { signatureId?: number }).signatureId;
      if (docxSignatureId) {
        const { getDigitalSignatureById } = await import("../db");
        const { formatSignatureBlock } = await import("../services/digitalSignatureService");
        const signature = await getDigitalSignatureById(docxSignatureId);
        if (signature) {
          signatureBlock = formatSignatureBlock(signature);
        }
      }

      const docxSettings = (settings ?? {}) as Parameters<typeof exportLegalOpinionToDOCX>[1];
      const docxBuffer = await exportLegalOpinionToDOCX(opinion, docxSettings, signatureBlock);

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
    .mutation(async ({ ctx }): Promise<LegacyGeneratedOpinion> => {
      throwLegacyEndpointDisabled("legalOpinions.generateOpinion", LEG012_SURFACE_ID, ctx, "o workspace canônico do Parecer Jurídico (/parecer → legalOpinionWorkspace.*)");
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
    .mutation(async ({ ctx }): Promise<{ success: boolean; signatureId: number; signaturesCount: number; requiredSignatures: number }> => {
      throwLegacyEndpointDisabled("legalOpinions.sign", LEG012_SURFACE_ID, ctx, "o workspace canônico do Parecer Jurídico (/parecer → legalOpinionWorkspace.*)");
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
      const verifySignatureId = opinion && (opinion as { signatureId?: number }).signatureId;
      if (!opinion || !verifySignatureId) {
        return { signed: false, valid: false };
      }

      // Buscar assinatura
      const digitalSignature = await getDigitalSignatureById(verifySignatureId);
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
    .mutation(async ({ ctx }): Promise<{ success: boolean }> => {
      throwLegacyEndpointDisabled("legalOpinions.setSignaturePassword", LEG012_SURFACE_ID, ctx, "o workspace canônico do Parecer Jurídico (/parecer → legalOpinionWorkspace.*)");
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
