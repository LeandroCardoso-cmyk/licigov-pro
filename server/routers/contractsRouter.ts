import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { generateContractMinuta, generateAmendmentTerm, generateApostilleTerm, generateRescissionTerm } from "../services/contractDocuments";
import { checkContractExpirations, getExpirationSummary } from "../services/contractNotifications";
import { generateAlertsExcelReport, generateAuditExcelReport } from "../services/contractReports";

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
  create: protectedProcedure
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
      const contract = await db.createContract({
        ...input,
        createdBy: ctx.user.id,
      });

      // Registrar auditoria
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
    }),

  /**
   * Buscar contrato por ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await db.getContractById(input.id);
    }),

  /**
   * Listar contratos do usuário
   */
  list: protectedProcedure
    .input(
      z.object({
        type: z.string().optional(),
        status: z.string().optional(),
        year: z.number().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      return await db.listContracts(ctx.user.id, input);
    }),

  /**
   * Atualizar contrato
   */
  update: protectedProcedure
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
      const { id, ...data } = input;
      const contract = await db.updateContract(id, data);

      // Registrar auditoria
      if (contract) {
        await db.createContractAuditLog({
          contractId: contract.id,
          action: "updated",
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          details: { changes: Object.keys(data) },
        });
      }

      return contract;
    }),

  // ============================================================================
  // ADITIVOS
  // ============================================================================

  amendments: router({
    /**
     * Criar aditivo
     */
    create: protectedProcedure
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
        
        // 2. Buscar contrato para validações
        const contract = await db.getContractById(input.contractId);
        if (!contract) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Contrato não encontrado' });
        }
        
        // 3. Validar limite de valor (se aplicável)
        if (input.type === 'valor' || input.type === 'misto') {
          if (!input.valueChange) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Valor do aditivo é obrigatório para aditivos de valor',
            });
          }
          
          // Buscar total de aditivos existentes
          const existingAmendments = await db.getAmendmentsByContractId(input.contractId);
          const totalExistingValue = existingAmendments
            .filter(a => a.valueChange)
            .reduce((sum, a) => sum + (a.valueChange || 0), 0);
          
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
          
          console.log('[Amendment] Validação de valor aprovada:', {
            percentage: valueValidation.percentage.toFixed(2) + '%',
            remaining: `R$ ${(valueValidation.remaining / 100).toFixed(2)}`,
          });
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
          
          console.log('[Amendment] Validação de prazo aprovada:', {
            totalMonths: durationValidation.totalDurationMonths.toFixed(1),
            maxDate: durationValidation.maxDate.toISOString().split('T')[0],
          });
        }
        
        // 5. Criar aditivo (validações aprovadas)
        const amendment = await db.createAmendment({
          ...input,
          createdBy: ctx.user.id,
        });

        // Atualizar contrato se houver mudanças de prazo ou valor
        if (amendment) {
          const updates: any = {};
          if (input.newEndDate) {
            updates.endDate = input.newEndDate;
          }
          if (input.newTotalValue) {
            updates.currentValue = input.newTotalValue;
          }

          if (Object.keys(updates).length > 0) {
            await db.updateContract(input.contractId, updates);
          }

          // Registrar auditoria
          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "amendment_added",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { amendmentId: amendment.id, type: amendment.type, number: amendment.number },
          });
        }

        return amendment;
      }),

    /**
     * Listar aditivos de um contrato
     */
    list: protectedProcedure
      .input(z.object({ contractId: z.number() }))
      .query(async ({ input }) => {
        return await db.listAmendments(input.contractId);
      }),
  }),

  // ============================================================================
  // APOSTILAMENTOS
  // ============================================================================

  apostilles: router({
    /**
     * Criar apostilamento
     */
    create: protectedProcedure
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
        const apostille = await db.createApostille({
          ...input,
          createdBy: ctx.user.id,
        });

        // Atualizar valor do contrato se houver reajuste
        if (apostille && input.newTotalValue) {
          await db.updateContract(input.contractId, {
            currentValue: input.newTotalValue,
          });
        }

        // Registrar auditoria
        if (apostille) {
          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "apostille_added",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { apostilleId: apostille.id, type: apostille.type, number: apostille.number },
          });
        }

        return apostille;
      }),

    /**
     * Listar apostilamentos de um contrato
     */
    list: protectedProcedure
      .input(z.object({ contractId: z.number() }))
      .query(async ({ input }) => {
        return await db.listApostilles(input.contractId);
      }),
  }),

  // ============================================================================
  // DOCUMENTOS
  // ============================================================================

  documents: router({
    /**
     * Criar documento
     */
    create: protectedProcedure
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
        const document = await db.createContractDocument(input);

        // Registrar auditoria
        if (document) {
          await db.createContractAuditLog({
            contractId: input.contractId,
            action: "document_generated",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: { documentId: document.id, type: document.type, title: document.title },
          });
        }

        return document;
      }),

    /**
     * Listar documentos de um contrato
     */
    list: protectedProcedure
      .input(z.object({ contractId: z.number() }))
      .query(async ({ input }) => {
        return await db.listContractDocuments(input.contractId);
      }),

    /**
     * Atualizar documento
     */
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().optional(),
          content: z.string().optional(),
          version: z.number().optional(),
          status: z.enum(["draft", "final", "archived"]).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.updateContractDocument(id, data);
      }),
  }),

  // ============================================================================
  // AUDITORIA
  // ============================================================================

  audit: router({
    /**
     * Buscar logs de auditoria
     */
    getLogs: protectedProcedure
      .input(z.object({ contractId: z.number() }))
      .query(async ({ input }) => {
        return await db.getContractAuditLogs(input.contractId);
      }),

    /**
     * Buscar logs por ação
     */
    getLogsByAction: protectedProcedure
      .input(
        z.object({
          contractId: z.number(),
          action: z.string(),
        })
      )
      .query(async ({ input }) => {
        return await db.getContractAuditLogsByAction(input.contractId, input.action);
      }),
  }),

  // ============================================================================
  // ESTATÍSTICAS
  // ============================================================================

  analytics: router({
    /**
     * Buscar estatísticas gerais
     */
    getOverview: protectedProcedure.query(async () => {
      return await db.getContractsOverview();
    }),

    /**
     * Buscar contratos recentes
     */
    getRecent: protectedProcedure
      .input(z.object({ limit: z.number().default(10) }))
      .query(async ({ input }) => {
        return await db.getRecentContracts(input.limit);
      }),
  }),

  // ============================================================================
  // GERAÇÃO DE DOCUMENTOS
  // ============================================================================

  generation: router({
    /**
     * Gerar Minuta de Contrato
     */
    generateMinuta: protectedProcedure
      .input(z.object({ contractId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const contract = await db.getContractById(input.contractId);
        if (!contract) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
        }

        const content = generateContractMinuta({
          number: contract.number,
          year: contract.year,
          object: contract.object,
          type: contract.type as any,
          contractorName: contract.contractorName,
          contractorCNPJ: contract.contractorCNPJ || undefined,
          contractorAddress: contract.contractorAddress || undefined,
          contractorContact: contract.contractorContact || undefined,
          value: parseFloat(contract.value),
          currentValue: parseFloat(contract.currentValue),
          startDate: contract.startDate,
          endDate: contract.endDate,
          fiscalUserName: contract.fiscalUserName || undefined,
          notes: contract.notes || undefined,
          originType: contract.originType as any || undefined,
        });

        const document = await db.createContractDocument({
          contractId: input.contractId,
          type: "minuta",
          title: `Minuta de Contrato nº ${contract.number}/${contract.year}`,
          content,
          status: "draft",
        });

        await db.createContractAuditLog({
          contractId: input.contractId,
          action: "document_generated",
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          details: { documentType: "minuta", documentId: document?.id },
        });

        return { documentId: document?.id, content };
      }),

    /**
     * Gerar Termo de Aditivo
     */
    generateAmendment: protectedProcedure
      .input(z.object({ contractId: z.number(), amendmentId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const contract = await db.getContractById(input.contractId);
        if (!contract) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
        }

        const amendments = await db.listAmendments(input.contractId);
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
            value: parseFloat(contract.value),
            currentValue: parseFloat(contract.currentValue),
            startDate: contract.startDate,
            endDate: contract.endDate,
          },
          {
            number: amendment.number,
            type: amendment.type as any,
            justification: amendment.justification,
            newEndDate: amendment.newEndDate || undefined,
            daysAdded: amendment.daysAdded || undefined,
            valueChange: amendment.valueChange ? parseFloat(amendment.valueChange) : undefined,
            newTotalValue: amendment.newTotalValue ? parseFloat(amendment.newTotalValue) : undefined,
            scopeChanges: amendment.scopeChanges || undefined,
            signedAt: amendment.signedAt || undefined,
          }
        );

        const document = await db.createContractDocument({
          contractId: input.contractId,
          type: "aditivo",
          referenceId: input.amendmentId,
          title: `Termo Aditivo nº ${amendment.number}`,
          content,
          status: "draft",
        });

        await db.createContractAuditLog({
          contractId: input.contractId,
          action: "document_generated",
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          details: { documentType: "aditivo", documentId: document?.id, amendmentId: input.amendmentId },
        });

        return { documentId: document?.id, content };
      }),

    /**
     * Gerar Termo de Apostilamento
     */
    generateApostille: protectedProcedure
      .input(z.object({ contractId: z.number(), apostilleId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const contract = await db.getContractById(input.contractId);
        if (!contract) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
        }

        const apostilles = await db.listApostilles(input.contractId);
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
            value: parseFloat(contract.value),
            currentValue: parseFloat(contract.currentValue),
            startDate: contract.startDate,
            endDate: contract.endDate,
            fiscalUserName: contract.fiscalUserName || undefined,
          },
          {
            number: apostille.number,
            type: apostille.type as any,
            description: apostille.description,
            valueChange: apostille.valueChange ? parseFloat(apostille.valueChange) : undefined,
            newTotalValue: apostille.newTotalValue ? parseFloat(apostille.newTotalValue) : undefined,
            indexType: apostille.indexType || undefined,
            indexValue: apostille.indexValue || undefined,
            signedAt: apostille.signedAt || undefined,
          }
        );

        const document = await db.createContractDocument({
          contractId: input.contractId,
          type: "apostilamento",
          referenceId: input.apostilleId,
          title: `Termo de Apostilamento nº ${apostille.number}`,
          content,
          status: "draft",
        });

        await db.createContractAuditLog({
          contractId: input.contractId,
          action: "document_generated",
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          details: { documentType: "apostilamento", documentId: document?.id, apostilleId: input.apostilleId },
        });

        return { documentId: document?.id, content };
      }),

    /**
     * Gerar Termo de Rescisão
     */
    generateRescission: protectedProcedure
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
        const contract = await db.getContractById(input.contractId);
        if (!contract) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
        }

        const content = generateRescissionTerm(
          {
            number: contract.number,
            year: contract.year,
            object: contract.object,
            type: contract.type as any,
            contractorName: contract.contractorName,
            contractorCNPJ: contract.contractorCNPJ || undefined,
            value: parseFloat(contract.value),
            currentValue: parseFloat(contract.currentValue),
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

        const document = await db.createContractDocument({
          contractId: input.contractId,
          type: "rescisao",
          title: `Termo de Rescisão ${input.type === "unilateral" ? "Unilateral" : input.type === "bilateral" ? "Bilateral" : "Judicial"}`,
          content,
          status: "draft",
        });

        // Atualizar status do contrato
        await db.updateContract(input.contractId, {
          status: "terminated",
        });

        await db.createContractAuditLog({
          contractId: input.contractId,
          action: "rescission_created",
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          details: { documentType: "rescisao", documentId: document?.id, rescissionType: input.type },
        });

        return { documentId: document?.id, content };
      }),
  }),

  // ============================================================================
  // NOTIFICAÇÕES
  // ============================================================================

  notifications: router({
    /**
     * Verificar vencimentos e enviar notificações
     */
    checkExpirations: protectedProcedure.mutation(async ({ ctx }) => {
      const result = await checkContractExpirations();
      return result;
    }),

    /**
     * Obter resumo de vencimentos
     */
    getSummary: protectedProcedure.query(async ({ ctx }) => {
      const summary = await getExpirationSummary();
      return summary;
    }),
  }),

  // ============================================================================
  // RELATÓRIOS
  // ============================================================================

  reports: router({
    /**
     * Exportar relatório de alertas em Excel
     */
    exportAlertsExcel: protectedProcedure.mutation(async ({ ctx }) => {
      const buffer = await generateAlertsExcelReport();
      const base64 = buffer.toString("base64");
      return {
        data: base64,
        filename: `alertas-contratos-${new Date().toISOString().split('T')[0]}.xlsx`,
      };
    }),

    /**
     * Exportar histórico de auditoria em Excel
     */
    exportAuditExcel: protectedProcedure
      .input(z.object({ contractId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const buffer = await generateAuditExcelReport(input.contractId);
        const base64 = buffer.toString("base64");
        return {
          data: base64,
          filename: `auditoria-contrato-${input.contractId}-${new Date().toISOString().split('T')[0]}.xlsx`,
        };
      }),
  }),
});
