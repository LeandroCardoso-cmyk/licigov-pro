/**
 * @deprecated LEGACY_ACTIVE_MAINTENANCE_ONLY (RC-C0.1A) — mantém apenas por
 * compatibilidade (`/contracts/*`, fora do menu). Não adicione novas
 * funcionalidades, novos tipos de documento ou novos consumidores aqui. Destino
 * canônico: `contractWorkspaceRouter` (`/contratos`). Referência:
 * docs/architecture/LEGACY_INVENTORY.md.
 *
 * RC-C0.1A.1 — Isolamento multi-tenant completo. Toda procedure usa
 * `tenantProcedure`; `organizationId` é sempre resolvido no servidor (nunca aceito
 * do cliente) e aplicado antes de qualquer leitura/escrita. Para os registros
 * auxiliares sem coluna `organizationId` própria (aditivos, apostilamentos,
 * documentos, auditoria), o isolamento é garantido validando o contrato-pai dentro
 * da organização primeiro (na camada de repositório, não só no router) — ver
 * `server/db/contracts.ts`. `getById` e mutations cross-tenant retornam
 * `NOT_FOUND`/`null`, nunca revelando se o registro existe em outra organização.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { tenantProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { generateContractMinuta, generateAmendmentTerm, generateApostilleTerm, generateRescissionTerm } from "../services/contractDocuments";
import { checkContractExpirationsForOrganization, getExpirationSummaryForOrganization } from "../services/contractNotifications";
import { generateAlertsExcelReportForOrganization, generateAuditExcelReportForOrganization } from "../services/contractReports";
import { serviceLogger } from "../services/observabilityService";

const log = serviceLogger("contractsRouter");

type OpCtx = { correlationId: string; organizationId: number; user: { id: number } };

/** RC-C0.1A.1 — envelope mínimo de observabilidade (org/actor/correlationId/duração/operação), sem dados sensíveis. */
async function audited<T>(operation: string, ctx: OpCtx, fn: () => Promise<T>, extra?: Record<string, unknown>): Promise<T> {
  const spanResult = await log.span(operation, fn, { correlationId: ctx.correlationId, organizationId: ctx.organizationId, userId: ctx.user.id });
  log.info(operation, { correlationId: ctx.correlationId, organizationId: ctx.organizationId, userId: ctx.user.id, ...extra });
  return spanResult.result;
}

async function requireContractForOrg(contractId: number, organizationId: number) {
  const contract = await db.getContractByIdForOrganization(contractId, organizationId);
  if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
  return contract;
}

/**
 * Router de Contratos
 * Gerencia contratos administrativos, aditivos, apostilamentos e documentos
 */
export const contractsRouter = router({
  // ============================================================================
  // CONTRATOS
  // ============================================================================

  /**
   * Criar novo contrato
   */
  create: tenantProcedure
    .input(
      z.object({
        number: z.string(),
        year: z.number(),
        object: z.string(),
        type: z.enum(["fornecimento", "servico", "obra", "concessao", "outro"]),
        originType: z.enum(["processo", "contratacao_direta", "manual"]).optional(),
        originId: z.number().optional(),
        contractorName: z.string(),
        contractorCNPJ: z.string().optional(),
        contractorAddress: z.string().optional(),
        contractorContact: z.string().optional(),
        value: z.number(),
        currentValue: z.number(),
        startDate: z.date(),
        endDate: z.date(),
        autoRenewal: z.boolean().default(false),
        maxRenewals: z.number().default(0),
        fiscalUserId: z.number().optional(),
        fiscalUserName: z.string().optional(),
        status: z.enum(["draft", "active", "suspended", "terminated", "expired", "completed"]).default("draft"),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return audited("create", ctx, async () => {
        const contract = await db.createContract({
          ...input,
          organizationId: ctx.organizationId,
          createdBy: ctx.user.id,
        });

        if (contract) {
          await db.createContractAuditLog({
            contractId: contract.id,
            action: "created",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { number: contract.number, object: contract.object },
          });
        }

        return contract;
      }, { contractNumber: input.number });
    }),

  /**
   * Buscar contrato por ID
   */
  getById: tenantProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      return audited("getById", ctx, () => db.getContractByIdForOrganization(input.id, ctx.organizationId));
    }),

  /**
   * Listar contratos da organização
   */
  list: tenantProcedure
    .input(
      z.object({
        type: z.string().optional(),
        status: z.string().optional(),
        year: z.number().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      return audited("list", ctx, () => db.listContractsByOrganization(ctx.organizationId, input));
    }),

  /**
   * Atualizar contrato
   */
  update: tenantProcedure
    .input(
      z.object({
        id: z.number(),
        number: z.string().optional(),
        object: z.string().optional(),
        type: z.enum(["fornecimento", "servico", "obra", "concessao", "outro"]).optional(),
        contractorName: z.string().optional(),
        contractorCNPJ: z.string().optional(),
        contractorAddress: z.string().optional(),
        contractorContact: z.string().optional(),
        value: z.number().optional(),
        currentValue: z.number().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        autoRenewal: z.boolean().optional(),
        maxRenewals: z.number().optional(),
        fiscalUserId: z.number().optional(),
        fiscalUserName: z.string().optional(),
        status: z.enum(["draft", "active", "suspended", "terminated", "expired", "completed"]).optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return audited("update", ctx, async () => {
        const { id, ...data } = input;
        const contract = await db.updateContractForOrganization(id, ctx.organizationId, data);
        if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });

        await db.createContractAuditLog({
          contractId: contract.id,
          action: "updated",
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          details: { changes: Object.keys(data) },
        });

        return contract;
      }, { contractId: input.id });
    }),

  // ============================================================================
  // ADITIVOS
  // ============================================================================

  amendments: router({
    /**
     * Criar aditivo
     */
    create: tenantProcedure
      .input(
        z.object({
          contractId: z.number(),
          number: z.number(),
          type: z.enum(["prazo", "valor", "escopo", "misto"]),
          justification: z.string(),
          newEndDate: z.date().optional(),
          daysAdded: z.number().optional(),
          valueChange: z.number().optional(),
          newTotalValue: z.number().optional(),
          scopeChanges: z.string().optional(),
          signedAt: z.date().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return audited("amendments.create", ctx, async () => {
          // VALIDAÇÃO DE CONFORMIDADE LEGAL (Auditoria Técnica - Item 1.4, 1.5)
          const { validateAmendmentValue, validateContractDuration, validateAmendmentJustification } = await import("../services/contractValidation");

          // 1. Validar justificativa (sempre obrigatória)
          const justificationValidation = validateAmendmentJustification(input.justification);
          if (!justificationValidation.isValid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Justificativa inválida:\n${justificationValidation.errors.join('\n')}`,
            });
          }

          // 2. Buscar contrato-pai dentro da organização (NOT_FOUND se cross-tenant)
          const contract = await requireContractForOrg(input.contractId, ctx.organizationId);

          // 3. Validar limite de valor (se aplicável)
          if (input.type === 'valor' || input.type === 'misto') {
            if (!input.valueChange) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Valor do aditivo é obrigatório para aditivos de valor',
              });
            }

            const existingAmendments = await db.listAmendmentsForOrganization(input.contractId, ctx.organizationId);
            const totalExistingValue = existingAmendments
              .filter((a: any) => a.valueChange)
              .reduce((sum: any, a: any) => sum + (a.valueChange || 0), 0);

            const valueValidation = validateAmendmentValue(
              contract.value,
              totalExistingValue,
              input.valueChange
            );

            if (!valueValidation.isValid) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: valueValidation.error!,
              });
            }
          }

          // 4. Validar prazo contratual (se aplicável)
          if (input.type === 'prazo' || input.type === 'misto') {
            if (!input.newEndDate) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Nova data fim é obrigatória para aditivos de prazo',
              });
            }

            const durationValidation = validateContractDuration(
              contract.startDate,
              input.newEndDate
            );

            if (!durationValidation.isValid) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: durationValidation.error!,
              });
            }
          }

          // 5. Criar aditivo (validações aprovadas; revalida o contrato-pai internamente)
          const amendment = await db.createAmendmentForOrganization({
            ...input,
            createdBy: ctx.user.id,
          }, ctx.organizationId);
          if (!amendment) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });

          const updates: any = {};
          if (input.newEndDate) updates.endDate = input.newEndDate;
          if (input.newTotalValue) updates.currentValue = input.newTotalValue;
          if (Object.keys(updates).length > 0) {
            await db.updateContractForOrganization(input.contractId, ctx.organizationId, updates);
          }

          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "amendment_added",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { amendmentId: amendment.id, type: amendment.type, number: amendment.number },
          });

          return amendment;
        }, { contractId: input.contractId });
      }),

    /**
     * Listar aditivos de um contrato
     */
    list: tenantProcedure
      .input(z.object({ contractId: z.number() }))
      .query(async ({ input, ctx }) => {
        return audited("amendments.list", ctx, () => db.listAmendmentsForOrganization(input.contractId, ctx.organizationId), { contractId: input.contractId });
      }),
  }),

  // ============================================================================
  // APOSTILAMENTOS
  // ============================================================================

  apostilles: router({
    /**
     * Criar apostilamento
     */
    create: tenantProcedure
      .input(
        z.object({
          contractId: z.number(),
          number: z.number(),
          type: z.enum(["reajuste", "correcao", "designacao", "outro"]),
          description: z.string(),
          valueChange: z.number().optional(),
          newTotalValue: z.number().optional(),
          indexType: z.string().optional(),
          indexValue: z.string().optional(),
          signedAt: z.date().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return audited("apostilles.create", ctx, async () => {
          const apostille = await db.createApostilleForOrganization({
            ...input,
            createdBy: ctx.user.id,
          }, ctx.organizationId);
          if (!apostille) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });

          if (input.newTotalValue) {
            await db.updateContractForOrganization(input.contractId, ctx.organizationId, {
              currentValue: input.newTotalValue,
            });
          }

          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "apostille_added",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { apostilleId: apostille.id, type: apostille.type, number: apostille.number },
          });

          return apostille;
        }, { contractId: input.contractId });
      }),

    /**
     * Listar apostilamentos de um contrato
     */
    list: tenantProcedure
      .input(z.object({ contractId: z.number() }))
      .query(async ({ input, ctx }) => {
        return audited("apostilles.list", ctx, () => db.listApostillesForOrganization(input.contractId, ctx.organizationId), { contractId: input.contractId });
      }),
  }),

  // ============================================================================
  // DOCUMENTOS
  // ============================================================================

  documents: router({
    /**
     * Criar documento
     */
    create: tenantProcedure
      .input(
        z.object({
          contractId: z.number(),
          type: z.enum(["minuta", "aditivo", "apostilamento", "rescisao", "outro"]),
          referenceId: z.number().optional(),
          title: z.string(),
          content: z.string(),
          version: z.number().default(1),
          status: z.enum(["draft", "final", "archived"]).default("draft"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return audited("documents.create", ctx, async () => {
          const document = await db.createContractDocumentForOrganization(input, ctx.organizationId);
          if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });

          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "document_generated",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { documentId: document.id, type: document.type, title: document.title },
          });

          return document;
        }, { contractId: input.contractId });
      }),

    /**
     * Listar documentos de um contrato
     */
    list: tenantProcedure
      .input(z.object({ contractId: z.number() }))
      .query(async ({ input, ctx }) => {
        return audited("documents.list", ctx, () => db.listContractDocumentsForOrganization(input.contractId, ctx.organizationId), { contractId: input.contractId });
      }),

    /**
     * Atualizar documento
     */
    update: tenantProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().optional(),
          content: z.string().optional(),
          version: z.number().optional(),
          status: z.enum(["draft", "final", "archived"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return audited("documents.update", ctx, async () => {
          const { id, ...data } = input;
          const document = await db.updateContractDocumentForOrganization(id, ctx.organizationId, data);
          if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
          return document;
        }, { documentId: input.id });
      }),
  }),

  // ============================================================================
  // AUDITORIA
  // ============================================================================

  audit: router({
    /**
     * Buscar logs de auditoria
     */
    getLogs: tenantProcedure
      .input(z.object({ contractId: z.number() }))
      .query(async ({ input, ctx }) => {
        return audited("audit.getLogs", ctx, () => db.getContractAuditLogsForOrganization(input.contractId, ctx.organizationId), { contractId: input.contractId });
      }),

    /**
     * Buscar logs por ação
     */
    getLogsByAction: tenantProcedure
      .input(
        z.object({
          contractId: z.number(),
          action: z.string(),
        })
      )
      .query(async ({ input, ctx }) => {
        return audited("audit.getLogsByAction", ctx, () => db.getContractAuditLogsByActionForOrganization(input.contractId, ctx.organizationId, input.action), { contractId: input.contractId });
      }),
  }),

  // ============================================================================
  // ESTATÍSTICAS
  // ============================================================================

  analytics: router({
    /**
     * Buscar estatísticas gerais da organização autenticada.
     *
     * RC-C0.1A — MAINTENANCE_ONLY: correção de isolamento multi-tenant aplicada
     * ao endpoint legado existente (antes agregava globalmente, sem filtro de
     * organização — corrigido). Nenhuma funcionalidade nova foi adicionada.
     * organizationId é sempre resolvido no servidor via tenantProcedure — nunca
     * aceito do cliente. Admin de plataforma (ctx.user.role === 'admin') enxerga
     * a organização resolvida pelo header X-Organization-Id (mesmo mecanismo de
     * qualquer outro tenantProcedure), não uma agregação global — não há demanda
     * funcional confirmada por analytics verdadeiramente global de plataforma;
     * se surgir, deve ser um endpoint novo e nomeado, não este.
     * Substituição futura: analytics canônico do domínio de Contratos (ainda não
     * implementado — ver docs/architecture/LEGACY_INVENTORY.md).
     */
    getOverview: tenantProcedure.query(async ({ ctx }) => {
      const result = await log.span(
        "getOverview",
        () => db.getContractsOverview(ctx.organizationId!),
        { correlationId: ctx.correlationId, organizationId: ctx.organizationId, userId: ctx.user.id },
      );
      log.info("getOverview", {
        correlationId: ctx.correlationId,
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        totalContracts: result.result?.total ?? 0,
      });
      return result.result;
    }),

    /**
     * Buscar contratos recentes da organização
     */
    getRecent: tenantProcedure
      .input(z.object({ limit: z.number().default(10) }))
      .query(async ({ input, ctx }) => {
        return audited("analytics.getRecent", ctx, () => db.getRecentContractsForOrganization(ctx.organizationId, input.limit));
      }),
  }),

  // ============================================================================
  // GERAÇÃO DE DOCUMENTOS
  // ============================================================================

  generation: router({
    /**
     * Gerar Minuta de Contrato
     */
    generateMinuta: tenantProcedure
      .input(z.object({ contractId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return audited("generation.generateMinuta", ctx, async () => {
          const contract = await requireContractForOrg(input.contractId, ctx.organizationId);

          const content = generateContractMinuta({
            number: contract.number,
            year: contract.year,
            object: contract.object,
            type: contract.type as any,
            contractorName: contract.contractorName,
            contractorCNPJ: contract.contractorCNPJ || undefined,
            contractorAddress: contract.contractorAddress || undefined,
            contractorContact: contract.contractorContact || undefined,
            value: contract.value,
            currentValue: contract.currentValue,
            startDate: contract.startDate,
            endDate: contract.endDate,
            fiscalUserName: contract.fiscalUserName || undefined,
            notes: contract.notes || undefined,
            originType: contract.originType as any || undefined,
          });

          const document = await db.createContractDocumentForOrganization({
            contractId: input.contractId,
            type: "minuta",
            title: `Minuta de Contrato nº ${contract.number}/${contract.year}`,
            content,
            status: "draft",
          }, ctx.organizationId);

          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "document_generated",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { documentType: "minuta", documentId: document?.id },
          });

          return { documentId: document?.id, content };
        }, { contractId: input.contractId });
      }),

    /**
     * Gerar Termo de Aditivo
     */
    generateAmendment: tenantProcedure
      .input(z.object({ contractId: z.number(), amendmentId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return audited("generation.generateAmendment", ctx, async () => {
          const contract = await requireContractForOrg(input.contractId, ctx.organizationId);

          const amendments = await db.listAmendmentsForOrganization(input.contractId, ctx.organizationId);
          const amendment = amendments.find(a => a.id === input.amendmentId);
          if (!amendment) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Aditivo não encontrado" });
          }

          const content = generateAmendmentTerm(
            {
              number: contract.number,
              year: contract.year,
              object: contract.object,
              type: contract.type as any,
              contractorName: contract.contractorName,
              contractorCNPJ: contract.contractorCNPJ || undefined,
              value: contract.value,
              currentValue: contract.currentValue,
              startDate: contract.startDate,
              endDate: contract.endDate,
            },
            {
              number: amendment.number,
              type: amendment.type as any,
              justification: amendment.justification,
              newEndDate: amendment.newEndDate || undefined,
              daysAdded: amendment.daysAdded || undefined,
              valueChange: amendment.valueChange ?? undefined,
              newTotalValue: amendment.newTotalValue ?? undefined,
              scopeChanges: amendment.scopeChanges || undefined,
              signedAt: amendment.signedAt || undefined,
            }
          );

          const document = await db.createContractDocumentForOrganization({
            contractId: input.contractId,
            type: "aditivo",
            referenceId: input.amendmentId,
            title: `Termo Aditivo nº ${amendment.number}`,
            content,
            status: "draft",
          }, ctx.organizationId);

          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "document_generated",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { documentType: "aditivo", documentId: document?.id, amendmentId: input.amendmentId },
          });

          return { documentId: document?.id, content };
        }, { contractId: input.contractId });
      }),

    /**
     * Gerar Termo de Apostilamento
     */
    generateApostille: tenantProcedure
      .input(z.object({ contractId: z.number(), apostilleId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return audited("generation.generateApostille", ctx, async () => {
          const contract = await requireContractForOrg(input.contractId, ctx.organizationId);

          const apostilles = await db.listApostillesForOrganization(input.contractId, ctx.organizationId);
          const apostille = apostilles.find(a => a.id === input.apostilleId);
          if (!apostille) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Apostilamento não encontrado" });
          }

          const content = generateApostilleTerm(
            {
              number: contract.number,
              year: contract.year,
              object: contract.object,
              type: contract.type as any,
              contractorName: contract.contractorName,
              contractorCNPJ: contract.contractorCNPJ || undefined,
              value: contract.value,
              currentValue: contract.currentValue,
              startDate: contract.startDate,
              endDate: contract.endDate,
              fiscalUserName: contract.fiscalUserName || undefined,
            },
            {
              number: apostille.number,
              type: apostille.type as any,
              description: apostille.description,
              valueChange: apostille.valueChange ?? undefined,
              newTotalValue: apostille.newTotalValue ?? undefined,
              indexType: apostille.indexType || undefined,
              indexValue: apostille.indexValue || undefined,
              signedAt: apostille.signedAt || undefined,
            }
          );

          const document = await db.createContractDocumentForOrganization({
            contractId: input.contractId,
            type: "apostilamento",
            referenceId: input.apostilleId,
            title: `Termo de Apostilamento nº ${apostille.number}`,
            content,
            status: "draft",
          }, ctx.organizationId);

          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "document_generated",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { documentType: "apostilamento", documentId: document?.id, apostilleId: input.apostilleId },
          });

          return { documentId: document?.id, content };
        }, { contractId: input.contractId });
      }),

    /**
     * Gerar Termo de Rescisão
     */
    generateRescission: tenantProcedure
      .input(
        z.object({
          contractId: z.number(),
          type: z.enum(["unilateral", "bilateral", "judicial"]),
          reason: z.string(),
          effectiveDate: z.date(),
          penaltyAmount: z.number().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return audited("generation.generateRescission", ctx, async () => {
          const contract = await requireContractForOrg(input.contractId, ctx.organizationId);

          const content = generateRescissionTerm(
            {
              number: contract.number,
              year: contract.year,
              object: contract.object,
              type: contract.type as any,
              contractorName: contract.contractorName,
              contractorCNPJ: contract.contractorCNPJ || undefined,
              value: contract.value,
              currentValue: contract.currentValue,
              startDate: contract.startDate,
              endDate: contract.endDate,
            },
            {
              type: input.type,
              reason: input.reason,
              effectiveDate: input.effectiveDate,
              penaltyAmount: input.penaltyAmount,
              notes: input.notes,
            }
          );

          const document = await db.createContractDocumentForOrganization({
            contractId: input.contractId,
            type: "rescisao",
            title: `Termo de Rescisão ${input.type === "unilateral" ? "Unilateral" : input.type === "bilateral" ? "Bilateral" : "Judicial"}`,
            content,
            status: "draft",
          }, ctx.organizationId);

          await db.updateContractForOrganization(input.contractId, ctx.organizationId, {
            status: "terminated",
          });

          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "terminated",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { documentType: "rescisao", documentId: document?.id, rescissionType: input.type },
          });

          return { documentId: document?.id, content };
        }, { contractId: input.contractId });
      }),
  }),

  // ============================================================================
  // NOTIFICAÇÕES
  // ============================================================================

  notifications: router({
    /**
     * Verificar vencimentos e enviar notificações (da organização)
     */
    checkExpirations: tenantProcedure.mutation(async ({ ctx }) => {
      return audited("notifications.checkExpirations", ctx, () => checkContractExpirationsForOrganization(ctx.organizationId));
    }),

    /**
     * Obter resumo de vencimentos (da organização)
     */
    getSummary: tenantProcedure.query(async ({ ctx }) => {
      return audited("notifications.getSummary", ctx, () => getExpirationSummaryForOrganization(ctx.organizationId));
    }),
  }),

  // ============================================================================
  // RELATÓRIOS
  // ============================================================================

  reports: router({
    /**
     * Exportar relatório de alertas em Excel (da organização)
     */
    exportAlertsExcel: tenantProcedure.mutation(async ({ ctx }) => {
      return audited("reports.exportAlertsExcel", ctx, async () => {
        const buffer = await generateAlertsExcelReportForOrganization(ctx.organizationId);
        const base64 = Buffer.from(buffer as any).toString("base64");
        return {
          data: base64,
          filename: `alertas-contratos-${new Date().toISOString().split('T')[0]}.xlsx`,
        };
      });
    }),

    /**
     * Exportar histórico de auditoria em Excel
     */
    exportAuditExcel: tenantProcedure
      .input(z.object({ contractId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return audited("reports.exportAuditExcel", ctx, async () => {
          let buffer: Awaited<ReturnType<typeof generateAuditExcelReportForOrganization>>;
          try {
            buffer = await generateAuditExcelReportForOrganization(input.contractId, ctx.organizationId);
          } catch {
            throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
          }
          const base64 = Buffer.from(buffer as any).toString("base64");
          return {
            data: base64,
            filename: `auditoria-contrato-${input.contractId}-${new Date().toISOString().split('T')[0]}.xlsx`,
          };
        }, { contractId: input.contractId });
      }),
  }),
});
