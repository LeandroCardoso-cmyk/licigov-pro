import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { suggestLegalArticle, generateJustification, validateValue } from "../services/legalFrameworkAssistant";
import {
  generateTermoDispensa,
  generateTermoInexigibilidade,
  generateMinutaContrato,
  generatePlanilhaCotacao,
  generateMapaComparativo,
} from "../services/directContractDocuments";
import {
  generatePresentialPackage,
  generateEmailTemplate,
} from "../services/directContractPackage";
import { validateCNPJ, consultCNPJ } from "../services/cnpjValidator";
import { generateAuditReport } from "../services/directContractAuditReport";
import { tenantProcedure, router } from "../_core/trpc";
import {
  getLegalArticles,
  getLegalArticleById,
  createDirectContract,
  getDirectContractByIdForOrganization,
  listDirectContractsForOrganization,
  updateDirectContractForOrganization,
  createDirectContractDocument,
  getDirectContractDocuments,
  updateDirectContractDocument,
  updateDirectContractDocumentForOrganization,
  createQuotation,
  listQuotations,
  updateQuotation,
  updateQuotationForOrganization,
  listPlatforms,
  getPlatformById,
  getPlatformChecklists,
  createDirectContractAuditLog,
  getDirectContractAuditLogs,
  getDirectContractAuditLogsByAction,
  saveChecklistProgress,
  getChecklistProgress,
  getDirectContractsOverviewForOrganization,
  getDirectContractsChartDataForOrganization,
  getTopSuppliersForOrganization,
  getTopLegalArticlesForOrganization,
  getRecentDirectContractsForOrganization,
} from "../db";

/**
 * Router para gerenciar contratações diretas (dispensas e inexigibilidades)
 */
export const directContractsRouter = router({
  // ========================================
  // ASSISTENTE DE ENQUADRAMENTO LEGAL (IA)
  // ========================================
  
  assistant: router({
    // Sugerir artigo legal baseado na situação
    suggestArticle: tenantProcedure
      .input(
        z.object({
          situation: z.string().min(20),
          object: z.string().min(10),
          estimatedValue: z.number().positive(),
          urgency: z.string().optional(),
          hasExclusiveSupplier: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return await suggestLegalArticle(input);
      }),

    // Gerar justificativa inicial
    generateJustification: tenantProcedure
      .input(
        z.object({
          articleId: z.number(),
          object: z.string(),
          situation: z.string(),
          estimatedValue: z.number(),
        })
      )
      .mutation(async ({ input }) => {
        return await generateJustification(input);
      }),

    // Validar valor
    validateValue: tenantProcedure
      .input(
        z.object({
          articleId: z.number(),
          articleType: z.enum(["dispensa", "inexigibilidade"]),
          estimatedValue: z.number(),
          category: z.enum(["obras", "servicos", "compras"]),
        })
      )
      .query(({ input }) => {
        return validateValue(input);
      }),
  }),

  // ========================================
  // ARTIGOS LEGAIS
  // ========================================
  
  legalArticles: router({
    list: tenantProcedure
      .input(z.object({
        type: z.enum(["dispensa", "inexigibilidade"]).optional(),
      }).optional())
      .query(async ({ input }) => {
        return await getLegalArticles(input?.type);
      }),
    
    getById: tenantProcedure
      .input(z.object({
        id: z.number(),
      }))
      .query(async ({ input }) => {
        const article = await getLegalArticleById(input.id);
        
        if (!article) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Artigo legal não encontrado",
          });
        }
        
        return article;
      }),
  }),

  // ========================================
  // CONTRATAÇÕES DIRETAS
  // ========================================
  
  create: tenantProcedure
    .input(z.object({
      number: z.string(),
      year: z.number(),
      type: z.enum(["dispensa", "inexigibilidade"]),
      legalArticleId: z.number(),
      object: z.string().min(10, "Objeto deve ter no mínimo 10 caracteres"),
      justification: z.string().min(20, "Justificativa deve ter no mínimo 20 caracteres"),
      value: z.number().positive("Valor deve ser positivo"),
      executionDeadline: z.number().optional(),
      supplierName: z.string().optional(),
      supplierCNPJ: z.string().optional(),
      supplierAddress: z.string().optional(),
      supplierContact: z.string().optional(),
      mode: z.enum(["presencial", "eletronico"]).default("presencial"),
      platformId: z.number().optional(),
      metadata: z.any().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // VALIDAÇÃO DE CONFORMIDADE LEGAL (Auditoria Técnica - Item 4.2)
      if (input.type === 'dispensa') {
        const { validateDispensaValue } = await import("../services/contractValidation");
        
        // Buscar artigo legal para determinar fundamentação
        const article = await getLegalArticleById(input.legalArticleId);
        if (!article) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Artigo legal não encontrado',
          });
        }
        
        // Validar limite de valor conforme fundamentação legal
        const legalBasis = article.article.includes('75, I') ? 'art75_i_a' : 'art75_ii_outros';
        const valueValidation = validateDispensaValue(input.value, legalBasis as any);
        
        if (!valueValidation.isValid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: valueValidation.error!,
          });
        }
        
      }
      
      const directContract = await createDirectContract({
        ...input,
        createdBy: ctx.user.id,
        organizationId: ctx.organizationId,
        status: "draft",
      });
      
      if (!directContract) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao criar contratação direta",
        });
      }
      
      // Registrar auditoria
      await createDirectContractAuditLog({
        directContractId: directContract.id,
        action: "created",
        userId: ctx.user.id,
        userName: ctx.user.name || undefined,
        details: {
          type: input.type,
          number: input.number,
          year: input.year,
        },
      });
      
      return directContract;
    }),
  
  list: tenantProcedure
    .input(z.object({
      type: z.enum(["dispensa", "inexigibilidade"]).optional(),
      status: z.string().optional(),
      year: z.number().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return await listDirectContractsForOrganization(ctx.organizationId, input);
    }),
  
  getById: tenantProcedure
    .input(z.object({
      id: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      const directContract = await getDirectContractByIdForOrganization(input.id, ctx.organizationId);
      
      if (!directContract) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contratação direta não encontrada",
        });
      }
      
      // Verificar permissão
      if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Você não tem permissão para acessar esta contratação",
        });
      }
      
      return directContract;
    }),
  
  update: tenantProcedure
    .input(z.object({
      id: z.number(),
      data: z.object({
        number: z.string().optional(),
        object: z.string().optional(),
        justification: z.string().optional(),
        value: z.number().optional(),
        executionDeadline: z.number().optional(),
        supplierName: z.string().optional(),
        supplierCNPJ: z.string().optional(),
        supplierAddress: z.string().optional(),
        supplierContact: z.string().optional(),
        mode: z.enum(["presencial", "eletronico"]).optional(),
        platformId: z.number().optional(),
        status: z.enum(["draft", "pending_approval", "approved", "published", "in_execution", "completed", "cancelled"]).optional(),
        metadata: z.any().optional(),
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      // Verificar permissão
      const directContract = await getDirectContractByIdForOrganization(input.id, ctx.organizationId);
      
      if (!directContract) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contratação direta não encontrada",
        });
      }
      
      if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Você não tem permissão para editar esta contratação",
        });
      }
      
      const result = await updateDirectContractForOrganization(input.id, ctx.organizationId, input.data);

      // Registrar auditoria
      if (result) {
        await createDirectContractAuditLog({
          directContractId: input.id,
          action: "updated",
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          details: {
            updatedFields: Object.keys(input.data),
          },
        });
      }
      
      return result;
    }),

  // ========================================
  // DOCUMENTOS
  // ========================================
  
  documents: router({
    create: tenantProcedure
      .input(z.object({
        directContractId: z.number(),
        type: z.enum([
          "termo_dispensa",
          "termo_inexigibilidade",
          "dfd",
          "tr",
          "minuta_contrato",
          "planilha_cotacao",
          "mapa_comparativo",
          "ata_ratificacao",
          "outro"
        ]),
        title: z.string(),
        content: z.string(),
        version: z.number().default(1),
        status: z.enum(["draft", "final", "archived"]).default("draft"),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.directContractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para criar documentos nesta contratação",
          });
        }
        
        const document = await createDirectContractDocument(input);
        
        // Registrar auditoria
        if (document) {
          await createDirectContractAuditLog({
            directContractId: input.directContractId,
            action: "document_generated",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: {
              documentType: input.type,
              documentTitle: input.title,
            },
          });
        }
        
        return document;
      }),
    
    list: tenantProcedure
      .input(z.object({
        directContractId: z.number(),
      }))
      .query(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.directContractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para acessar documentos desta contratação",
          });
        }
        
        return await getDirectContractDocuments(input.directContractId);
      }),
    
    update: tenantProcedure
      .input(z.object({
        id: z.number(),
        data: z.object({
          content: z.string().optional(),
          status: z.enum(["draft", "final", "archived"]).optional(),
        }),
      }))
      .mutation(async ({ input, ctx }) => {
        return await updateDirectContractDocumentForOrganization(input.id, ctx.organizationId, input.data);
      }),
  }),

  // ========================================
  // COTAÇÕES
  // ========================================
  
  quotations: router({
    create: tenantProcedure
      .input(z.object({
        directContractId: z.number(),
        supplierName: z.string(),
        supplierCNPJ: z.string().optional(),
        supplierContact: z.string().optional(),
        value: z.number().positive(),
        deliveryDeadline: z.number().optional(),
        paymentTerms: z.string().optional(),
        attachmentUrl: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.directContractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para adicionar cotações nesta contratação",
          });
        }
        
        // AUDITORIA TÉCNICA - Item 2.1: Validar CNPJ duplicado
        const existingQuotations = await listQuotations(input.directContractId);
        const duplicateCNPJ = existingQuotations.find(
          q => q.supplierCNPJ === input.supplierCNPJ
        );
        
        if (duplicateCNPJ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Já existe uma cotação do fornecedor ${duplicateCNPJ.supplierName} (CNPJ: ${input.supplierCNPJ}) nesta contratação.`,
          });
        }
        
        const quotation = await createQuotation(input);
        
        // Registrar auditoria
        if (quotation) {
          await createDirectContractAuditLog({
            directContractId: input.directContractId,
            action: "quotation_added",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: {
              supplierName: input.supplierName,
              value: input.value,
            },
          });
        }
        
        return quotation;
      }),
    
    list: tenantProcedure
      .input(z.object({
        directContractId: z.number(),
      }))
      .query(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.directContractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para acessar cotações desta contratação",
          });
        }
        
        return await listQuotations(input.directContractId);
      }),
    
    update: tenantProcedure
      .input(z.object({
        id: z.number(),
        data: z.object({
          value: z.number().optional(),
          deliveryDeadline: z.number().optional(),
          paymentTerms: z.string().optional(),
          attachmentUrl: z.string().optional(),
          notes: z.string().optional(),
          isSelected: z.boolean().optional(),
        }),
      }))
      .mutation(async ({ input, ctx }) => {
        return await updateQuotationForOrganization(input.id, ctx.organizationId, input.data);
      }),
  }),

  // ========================================
  // GERAÇÃO DE DOCUMENTOS
  // ========================================
  
  generate: router({
    // Gerar Termo de Dispensa
    termoDispensa: tenantProcedure
      .input(z.object({
        directContractId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.directContractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para gerar documentos desta contratação",
          });
        }
        
        const content = await generateTermoDispensa({
          directContractId: input.directContractId,
          userId: ctx.user.id,
        });
        
        // Salvar documento no banco
        const document = await createDirectContractDocument({
          directContractId: input.directContractId,
          type: "termo_dispensa",
          title: `Termo de Dispensa nº ${directContract.number}/${directContract.year}`,
          content,
          version: 1,
          status: "draft",
        });
        
        return { documentId: document?.id, content };
      }),
    
    // Gerar Termo de Inexigibilidade
    termoInexigibilidade: tenantProcedure
      .input(z.object({
        directContractId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.directContractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para gerar documentos desta contratação",
          });
        }
        
        const content = await generateTermoInexigibilidade({
          directContractId: input.directContractId,
          userId: ctx.user.id,
        });
        
        // Salvar documento no banco
        const document = await createDirectContractDocument({
          directContractId: input.directContractId,
          type: "termo_inexigibilidade",
          title: `Termo de Inexigibilidade nº ${directContract.number}/${directContract.year}`,
          content,
          version: 1,
          status: "draft",
        });
        
        return { documentId: document?.id, content };
      }),
    
    // Gerar Minuta de Contrato
    minutaContrato: tenantProcedure
      .input(z.object({
        directContractId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.directContractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para gerar documentos desta contratação",
          });
        }
        
        const content = await generateMinutaContrato({
          directContractId: input.directContractId,
          userId: ctx.user.id,
        });
        
        // Salvar documento no banco
        const document = await createDirectContractDocument({
          directContractId: input.directContractId,
          type: "minuta_contrato",
          title: `Minuta de Contrato nº ${directContract.number}/${directContract.year}`,
          content,
          version: 1,
          status: "draft",
        });
        
        return { documentId: document?.id, content };
      }),
    
    // Gerar Planilha de Cotação
    planilhaCotacao: tenantProcedure
      .input(z.object({
        directContractId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.directContractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para gerar documentos desta contratação",
          });
        }
        
        // Buscar cotações
        const quotations = await listQuotations(input.directContractId);
        
        if (quotations.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "É necessário cadastrar pelo menos uma cotação antes de gerar a planilha",
          });
        }
        
        const content = await generatePlanilhaCotacao({
          directContractId: input.directContractId,
          quotations: quotations.map((q) => ({
            supplierName: q.supplierName,
            supplierCNPJ: q.supplierCNPJ || undefined,
            value: q.value,
            deliveryDeadline: q.deliveryDeadline || undefined,
            paymentTerms: q.paymentTerms || undefined,
          })),
        });
        
        // Salvar documento no banco
        const document = await createDirectContractDocument({
          directContractId: input.directContractId,
          type: "planilha_cotacao",
          title: `Planilha de Cotação nº ${directContract.number}/${directContract.year}`,
          content,
          version: 1,
          status: "draft",
        });
        
        return { documentId: document?.id, content };
      }),
    
    // Gerar Mapa Comparativo
    mapaComparativo: tenantProcedure
      .input(z.object({
        directContractId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.directContractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para gerar documentos desta contratação",
          });
        }
        
        // Buscar cotações
        const quotations = await listQuotations(input.directContractId);
        
        if (quotations.length < 2) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "É necessário cadastrar pelo menos 2 cotações para gerar o mapa comparativo",
          });
        }
        
        const content = await generateMapaComparativo({
          directContractId: input.directContractId,
          quotations: quotations.map((q) => ({
            supplierName: q.supplierName,
            supplierCNPJ: q.supplierCNPJ || undefined,
            value: q.value,
            deliveryDeadline: q.deliveryDeadline || undefined,
            paymentTerms: q.paymentTerms || undefined,
            notes: q.notes || undefined,
          })),
        });
        
        // Salvar documento no banco
        const document = await createDirectContractDocument({
          directContractId: input.directContractId,
          type: "mapa_comparativo",
          title: `Mapa Comparativo nº ${directContract.number}/${directContract.year}`,
          content,
          version: 1,
          status: "draft",
        });
        
        return { documentId: document?.id, content };
      }),
  }),

  // ========================================
  // PACOTE PRESENCIAL
  // ========================================
  
  presential: router({
    // Gerar pacote completo (ZIP)
    generatePackage: tenantProcedure
      .input(z.object({
        contractId: z.number(),
        includeDocuments: z.boolean().optional(),
        includeQuotations: z.boolean().optional(),
        includeReadme: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.contractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para gerar pacote desta contratação",
          });
        }
        
        const zipBuffer = await generatePresentialPackage(input);
        
        // Registrar auditoria
        await createDirectContractAuditLog({
          directContractId: input.contractId,
          action: "package_generated",
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          details: {
            includeDocuments: input.includeDocuments,
            includeQuotations: input.includeQuotations,
            includeReadme: input.includeReadme,
          },
        });
        
        // Converter buffer para base64 para enviar via tRPC
        return {
          filename: `Contratacao_Direta_${directContract.number}_${directContract.year}.zip`,
          data: zipBuffer.toString("base64"),
        };
      }),
    
    // Gerar template de email
    getEmailTemplate: tenantProcedure
      .input(z.object({
        contractId: z.number(),
      }))
      .query(async ({ input, ctx }) => {
        // Verificar permissão
        const directContract = await getDirectContractByIdForOrganization(input.contractId, ctx.organizationId);
        
        if (!directContract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (directContract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para acessar esta contratação",
          });
        }
        
        return generateEmailTemplate(directContract);
      }),
  }),

  // ========================================
  // PLATAFORMAS E CHECKLISTS
  // ========================================
  
  platforms: router({
    // Listar todas as plataformas ativas
    list: tenantProcedure
      .query(async () => {
        return await listPlatforms();
      }),
    
    // Buscar plataforma por ID
    getById: tenantProcedure
      .input(z.object({
        id: z.number(),
      }))
      .query(async ({ input }) => {
        const platform = await getPlatformById(input.id);
        
        if (!platform) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Plataforma não encontrada",
          });
        }
        
        return platform;
      }),
    
    // Buscar checklists de uma plataforma
    getChecklists: tenantProcedure
      .input(z.object({
        platformId: z.number(),
      }))
      .query(async ({ input }) => {
        return await getPlatformChecklists(input.platformId);
      }),
  }),

  // ========================================
  // VALIDAÇÃO DE DOCUMENTOS
  // ========================================
  
  validation: router({
    // Validar CNPJ (formato e dígitos verificadores)
    validateCNPJ: tenantProcedure
      .input(z.object({
        cnpj: z.string(),
      }))
      .query(async ({ input }) => {
        return validateCNPJ(input.cnpj);
      }),
    
    // Consultar CNPJ na Receita Federal
    consultCNPJ: tenantProcedure
      .input(z.object({
        cnpj: z.string(),
      }))
      .mutation(async ({ input }) => {
        return await consultCNPJ(input.cnpj);
      }),
  }),

  // ========================================
  // AUDITORIA E HISTÓRICO
  // ========================================
  
  audit: router({
    // Buscar logs de auditoria de uma contratação
    getLogs: tenantProcedure
      .input(z.object({
        contractId: z.number(),
      }))
      .query(async ({ input, ctx }) => {
        // Verificar permissão
        const contract = await getDirectContractByIdForOrganization(input.contractId, ctx.organizationId);
        
        if (!contract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (contract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para acessar esta contratação",
          });
        }
        
        return await getDirectContractAuditLogs(input.contractId);
      }),
    
    // Buscar logs por tipo de ação
    getLogsByAction: tenantProcedure
      .input(z.object({
        contractId: z.number(),
        action: z.string(),
      }))
      .query(async ({ input, ctx }) => {
        // Verificar permissão
        const contract = await getDirectContractByIdForOrganization(input.contractId, ctx.organizationId);
        
        if (!contract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (contract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para acessar esta contratação",
          });
        }
        
        return await getDirectContractAuditLogsByAction(input.contractId, input.action);
      }),
    
    // Exportar relatório de auditoria em PDF
    exportReport: tenantProcedure
      .input(z.object({
        contractId: z.number(),
        filterAction: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const contract = await getDirectContractByIdForOrganization(input.contractId, ctx.organizationId);
        
        if (!contract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (contract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para acessar esta contratação",
          });
        }
        
        const pdfBuffer = await generateAuditReport({
          contractId: input.contractId,
          filterAction: input.filterAction,
        });
        
        // Registrar auditoria
        await createDirectContractAuditLog({
          directContractId: input.contractId,
          action: "document_downloaded",
          userId: ctx.user.id,
          userName: ctx.user.name || undefined,
          details: {
            documentType: "audit_report",
            filterAction: input.filterAction,
          },
        });
        
        return {
          filename: `Auditoria_Contratacao_${contract.number}_${contract.year}.pdf`,
          data: pdfBuffer.toString("base64"),
        };
      }),
  }),

  // ========================================
  // PROGRESSO DO CHECKLIST
  // ========================================
  
  checklist: router({
    // Salvar progresso de um passo
    saveProgress: tenantProcedure
      .input(z.object({
        contractId: z.number(),
        stepNumber: z.number(),
        isCompleted: z.boolean(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const contract = await getDirectContractByIdForOrganization(input.contractId, ctx.organizationId);
        
        if (!contract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (contract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para atualizar esta contratação",
          });
        }
        
        const result = await saveChecklistProgress({
          directContractId: input.contractId,
          stepNumber: input.stepNumber,
          isCompleted: input.isCompleted,
          completedBy: ctx.user.id,
          notes: input.notes,
        });
        
        // Registrar auditoria
        if (result) {
          await createDirectContractAuditLog({
            directContractId: input.contractId,
            action: "checklist_updated",
            userId: ctx.user.id,
            userName: ctx.user.name || undefined,
            details: {
              stepNumber: input.stepNumber,
              isCompleted: input.isCompleted,
            },
          });
        }
        
        return { success: true, id: result };
      }),
    
    // Buscar progresso de uma contratação
    getProgress: tenantProcedure
      .input(z.object({
        contractId: z.number(),
      }))
      .query(async ({ input, ctx }) => {
        // Verificar permissão
        const contract = await getDirectContractByIdForOrganization(input.contractId, ctx.organizationId);
        
        if (!contract) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contratação direta não encontrada",
          });
        }
        
        if (contract.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para acessar esta contratação",
          });
        }
        
        return await getChecklistProgress(input.contractId);
      }),
  }),

  // ========================================
  // ESTATÍSTICAS E ANALYTICS
  // ========================================
  
  analytics: router({
    // Buscar estatísticas gerais (RC-SEC-PR-A: agregação isolada por organização)
    getOverview: tenantProcedure.query(async ({ ctx }) => {
      return await getDirectContractsOverviewForOrganization(ctx.organizationId);
    }),

    // Buscar dados para gráficos
    getCharts: tenantProcedure.query(async ({ ctx }) => {
      return await getDirectContractsChartDataForOrganization(ctx.organizationId);
    }),

    // Buscar top fornecedores
    getTopSuppliers: tenantProcedure.query(async ({ ctx }) => {
      return await getTopSuppliersForOrganization(ctx.organizationId);
    }),

    // Buscar top artigos legais
    getTopArticles: tenantProcedure.query(async ({ ctx }) => {
      return await getTopLegalArticlesForOrganization(ctx.organizationId);
    }),

    // Buscar contratações recentes
    getRecent: tenantProcedure
      .input(z.object({
        limit: z.number().optional().default(10),
      }))
      .query(async ({ ctx, input }) => {
        return await getRecentDirectContractsForOrganization(ctx.organizationId, input.limit);
      }),
  }),
});
