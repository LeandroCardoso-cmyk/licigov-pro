import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { commercialRouter } from "./routers/commercialRouter";
import { companyDocumentsRouter } from "./routers/companyDocumentsRouter";
import { catmatRouter } from "./routers/catmatRouter";
import { taskRouter } from "./routers/taskRouter";
import { departmentTasksRouter } from "./routers/departmentTasksRouter";
import { aiUsageRouter } from "./routers/aiUsageRouter";
import { platformsRouter } from "./routers/platformsRouter";
import { downloadRouter } from "./routers/downloadRouter";
import { directContractsRouter } from "./routers/directContractsRouter";

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { generateETP, generateTR, generateDFD, generateEdital } from "./services/gemini";
import { convertToPDF, convertToDOCX } from "./services/documentConverter";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  processes: router({
    // Listar processos do usuário
    list: protectedProcedure.query(async ({ ctx }) => {
      return await db.getProcessesByUser(ctx.user.id);
    }),

    // Buscar processos (para busca global)
    search: protectedProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ ctx, input }) => {
        return await db.searchProcesses(ctx.user.id, input.query);
      }),

    // Buscar todas as atividades do usuário (para relatório)
    getActivityLogs: protectedProcedure.query(async ({ ctx }) => {
      const userProcesses = await db.getProcessesByUser(ctx.user.id);
      const allActivities = [];

      for (const process of userProcesses) {
        const activities = await db.getActivityLogsByProcess(process.id);
        allActivities.push(...activities);
      }

      // Ordenar por data decrescente
      return allActivities.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }),

    // Criar novo processo
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        object: z.string().min(1),
        estimatedValue: z.number().positive(),
        modality: z.string().min(1),
        category: z.string().min(1),
        platformId: z.number().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Converter valor para centavos
        const valueInCents = Math.round(input.estimatedValue * 100);
        
        const result = await db.createProcess({
          name: input.name,
          description: input.description,
          object: input.object,
          estimatedValue: valueInCents,
          modality: input.modality,
          category: input.category,
          platformId: input.platformId || null,
          ownerId: ctx.user.id,
          status: "em_etp",
        });

        // Registrar atividade
        const processId = Number((result as any).insertId);
        
        await db.createActivityLog({
          processId,
          userId: ctx.user.id,
          action: "criou o processo",
          details: JSON.stringify({ name: input.name }),
        });

        // Buscar configurações do usuário
        const settings = await db.getDocumentSettingsByUser(ctx.user.id);

        // Gerar ETP automaticamente em background
        generateETP({
          processName: input.name,
          object: input.object,
          estimatedValue: valueInCents,
          modality: input.modality,
          category: input.category,
          organizationName: settings?.organizationName || undefined,
          address: settings?.address || undefined,
          cnpj: settings?.cnpj || undefined,
          phone: settings?.phone || undefined,
          email: settings?.email || undefined,
          website: settings?.website || undefined,
        })
          .then(async (etpContent) => {
            // Salvar ETP no banco de dados
            await db.createDocument({
              processId,
              type: "etp",
              content: etpContent,
              version: 1,
            });

            // Registrar atividade
            await db.createActivityLog({
              processId,
              userId: ctx.user.id,
              action: "gerou o ETP automaticamente",
              details: JSON.stringify({ generatedBy: "AI" }),
            });
          })
          .catch((error) => {
            console.error("Erro ao gerar ETP:", error);
            // Não falhar a criação do processo se a geração do ETP falhar
          });

        return { success: true, processId };
      }),

    // Obter detalhes de um processo
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getProcessById(input.id);
      }),

    // Adicionar itens CATMAT/CATSER ao TR (Lei 14.133/21)
    addItemsToTR: protectedProcedure
      .input(z.object({
        processId: z.number(),
        items: z.array(z.object({
          itemType: z.enum(['material', 'service']),
          catmatCode: z.string().optional(),
          catserCode: z.string().optional(),
          description: z.string(),
          unit: z.string(),
          groupCode: z.string().optional(),
          classCode: z.string().optional(),
          quantity: z.number().optional(),
          estimatedPrice: z.number().optional(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.saveProcessItems(input.processId, input.items);
        
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: `adicionou ${input.items.length} item(ns) ao TR`,
        });
        
        return { success: true };
      }),

    // Obter itens CATMAT/CATSER do processo
    getProcessItems: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getProcessItems(input.processId);
      }),

    // Parsear arquivo Excel/CSV com itens (Fase 1 MVP)
    parseItemsFile: protectedProcedure
      .input(z.object({
        fileContent: z.string(), // base64
        fileName: z.string(),
        columnMapping: z.object({
          description: z.number(), // índice da coluna (0-based)
          quantity: z.number().optional(),
          unit: z.number().optional(),
          unitPrice: z.number().optional(),
          totalPrice: z.number().optional(),
        }),
        previewOnly: z.boolean().optional(), // Se true, retorna apenas preview das primeiras 6 linhas
      }))
      .mutation(async ({ input }) => {
        const XLSX = await import('xlsx');
        
        // Decodificar base64
        const buffer = Buffer.from(input.fileContent, 'base64');
        
        // Parsear arquivo
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Converter para JSON (array de arrays)
        const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Validar
        if (data.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Arquivo vazio' });
        }
        
        // Se for apenas preview, retornar primeiras 6 linhas (header + 5 linhas)
        if (input.previewOnly) {
          return {
            success: true,
            preview: data.slice(0, 6),
            items: [],
            count: 0,
          };
        }
        
        if (data.length > 500) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Máximo 500 itens por importação' });
        }
        
        // Pular primeira linha (cabeçalho) e parsear itens
        const items = data.slice(1).map((row, index) => {
          const description = row[input.columnMapping.description]?.toString().trim();
          
          if (!description || description.length < 10) {
            throw new TRPCError({ 
              code: 'BAD_REQUEST', 
              message: `Linha ${index + 2}: Descrição inválida (mínimo 10 caracteres)` 
            });
          }
          
          return {
            description,
            quantity: input.columnMapping.quantity !== undefined 
              ? parseFloat(row[input.columnMapping.quantity]) || 1 
              : 1,
            unit: input.columnMapping.unit !== undefined 
              ? row[input.columnMapping.unit]?.toString().trim() || 'UN' 
              : 'UN',
            unitPrice: input.columnMapping.unitPrice !== undefined 
              ? parseFloat(row[input.columnMapping.unitPrice]) || 0 
              : 0,
            totalPrice: input.columnMapping.totalPrice !== undefined 
              ? parseFloat(row[input.columnMapping.totalPrice]) || 0 
              : 0,
          };
        }).filter(item => item.description); // Remover linhas vazias
        
        return { 
          success: true, 
          items,
          count: items.length 
        };
      }),

    // Gerar sugestões CATMAT para um item
    generateCatmatSuggestions: protectedProcedure
      .input(z.object({
        processItemId: z.number(),
        description: z.string(),
        itemType: z.enum(["material", "service"]).default("material"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { findCatmatMatches } = await import("./services/catmatMatcher");
        const { trackCATMATMatching } = await import("./services/aiUsageTracker");
        
        // Gerar sugestões com IA
        const matches = await findCatmatMatches(input.description, input.itemType);
        
        // Rastrear uso de IA
        await trackCATMATMatching({
          userId: ctx.user.id,
          itemDescription: input.description,
          suggestionsCount: matches.length,
        });
        
        // Salvar sugestões no banco
        for (const match of matches) {
          await db.createCatmatSuggestion({
            processItemId: input.processItemId,
            catmatCode: match.code,
            description: match.description,
            confidenceScore: match.confidence,
            reasoning: match.reasoning,
          });
        }
        
        return { success: true, suggestions: matches };
      }),
    
    // Obter sugestões CATMAT de um item
    getCatmatSuggestions: protectedProcedure
      .input(z.object({ processItemId: z.number() }))
      .query(async ({ input }) => {
        return await db.getCatmatSuggestionsByItem(input.processItemId);
      }),
    
    // Aprovar sugestão CATMAT (atualiza o item com o código)
    approveCatmatSuggestion: protectedProcedure
      .input(z.object({ 
        suggestionId: z.number(),
        processItemId: z.number(),
      }))
      .mutation(async ({ input }) => {
        // Buscar sugestão
        const suggestion = await db.getCatmatSuggestionById(input.suggestionId);
        if (!suggestion) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Sugestão não encontrada' });
        }
        
        // Atualizar item com código CATMAT
        const itemType = suggestion.catmatCode.startsWith('CAT') ? 'material' : 'service';
        await db.updateProcessItem(input.processItemId, {
          itemType,
          catmatCode: itemType === 'material' ? suggestion.catmatCode : undefined,
          catserCode: itemType === 'service' ? suggestion.catmatCode : undefined,
          description: suggestion.description,
        });
        
        // Atualizar status da sugestão
        await db.updateCatmatSuggestion(input.suggestionId, { status: 'approved' });
        
        // Rejeitar outras sugestões do mesmo item
        await db.rejectOtherSuggestions(input.processItemId, input.suggestionId);
        
        return { success: true };
      }),
    
    // Rejeitar sugestão CATMAT
    rejectCatmatSuggestion: protectedProcedure
      .input(z.object({ suggestionId: z.number() }))
      .mutation(async ({ input }) => {
        await db.updateCatmatSuggestion(input.suggestionId, { status: 'rejected' });
        return { success: true };
      }),
    
    // Atualizar item manualmente
    updateProcessItem: protectedProcedure
      .input(z.object({
        itemId: z.number(),
        description: z.string().optional(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        unitPrice: z.number().optional(),
        catmatCode: z.string().optional(),
        catserCode: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { itemId, ...data } = input;
        await db.updateProcessItem(itemId, data);
        return { success: true };
      }),
    
    // Deletar item
    deleteProcessItem: protectedProcedure
      .input(z.object({ itemId: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteProcessItem(input.itemId);
        return { success: true };
      }),

    // Atualizar status do processo
    updateStatus: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["em_etp", "em_tr", "em_dfd", "em_edital", "concluido"]),
      }))
      .mutation(async ({ ctx, input }) => {
        // Buscar processo antes da atualização para pegar status antigo
        const process = await db.getProcessById(input.id);
        const oldStatus = process?.status;
        
        await db.updateProcessStatus(input.id, input.status);
        
        await db.createActivityLog({
          processId: input.id,
          userId: ctx.user.id,
          action: `alterou o status para ${input.status}`,
        });

        // Enviar notificação por email se status mudou
        if (oldStatus && oldStatus !== input.status && ctx.user.email && process) {
          const { sendStatusChangeEmail } = await import("./services/emailService");
          sendStatusChangeEmail({
            recipientEmail: ctx.user.email,
            recipientName: ctx.user.name || "Usuário",
            processName: process.name,
            oldStatus,
            newStatus: input.status,
            processId: input.id,
          }).catch((error) => {
            console.error("[Email] Erro ao enviar notificação:", error);
          });
        }

        return { success: true };
      }),
  }),

  documents: router({
    // Listar documentos de um processo
    listByProcess: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getDocumentsByProcess(input.processId);
      }),

    // Listar documentos de um processo (alias para compatibilidade)
    // Listar documentos de um processo
    list: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getDocumentsByProcess(input.processId);
      }),

    // Criar/atualizar documento
    save: protectedProcedure
      .input(z.object({
        processId: z.number(),
        type: z.enum(["etp", "tr", "dfd", "edital"]),
        content: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verificar se já existe documento deste tipo
        const existing = await db.getDocumentByProcessAndType(input.processId, input.type);
        
        const version = existing ? existing.version + 1 : 1;
        
        await db.createDocument({
          processId: input.processId,
          type: input.type,
          content: input.content,
          version,
        });

        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: `${existing ? 'atualizou' : 'criou'} o documento ${input.type.toUpperCase()}`,
          details: JSON.stringify({ version }),
        });

        return { success: true, version };
      }),

    // Obter documento específico
    getByType: protectedProcedure
      .input(z.object({
        processId: z.number(),
        type: z.enum(["etp", "tr", "dfd", "edital"]),
      }))
      .query(async ({ input }) => {
        return await db.getDocumentByProcessAndType(input.processId, input.type);
      }),

    // Gerar próximo documento (TR, DFD ou Edital)
    generateNext: protectedProcedure
      .input(z.object({
        processId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Buscar processo
        const process = await db.getProcessById(input.processId);
        if (!process) {
          throw new Error("Processo não encontrado");
        }

        // Buscar configurações do usuário
        const settings = await db.getDocumentSettingsByUser(ctx.user.id);

        // Buscar documentos existentes
        const documents = await db.getDocumentsByProcess(input.processId);
        const etpDoc = documents.find(d => d.type === "etp");
        const trDoc = documents.find(d => d.type === "tr");
        const dfdDoc = documents.find(d => d.type === "dfd");

        let nextDocType: "tr" | "dfd" | "edital";
        let nextStatus: "em_tr" | "em_dfd" | "em_edital" | "concluido";
        let generatedContent: string;

        // Determinar qual documento gerar
        if (process.status === "em_etp" && etpDoc) {
          // Gerar TR
          nextDocType = "tr";
          nextStatus = "em_tr";
          
          // Buscar itens CATMAT/CATSER do processo
          const processItems = await db.getProcessItems(input.processId);
          const catmatItems = processItems.map(item => ({
            itemType: item.itemType,
            catmatCode: item.catmatCode ? String(item.catmatCode) : undefined,
            catserCode: item.catserCode ? String(item.catserCode) : undefined,
            description: item.description,
            unit: item.unit,
            groupCode: item.groupCode ? String(item.groupCode) : undefined,
            classCode: item.classCode ? String(item.classCode) : undefined,
          }));
          
          generatedContent = await generateTR({
            processName: process.name,
            object: process.object || "",
            estimatedValue: process.estimatedValue || 0,
            modality: process.modality || "",
            category: process.category || "",
            etpContent: etpDoc.content || "",
            catmatItems: catmatItems.length > 0 ? catmatItems : undefined,
            organizationName: settings?.organizationName || undefined,
            address: settings?.address || undefined,
            cnpj: settings?.cnpj || undefined,
            phone: settings?.phone || undefined,
            email: settings?.email || undefined,
            website: settings?.website || undefined,
          });
        } else if (process.status === "em_tr" && trDoc && etpDoc) {
          // Gerar DFD
          nextDocType = "dfd";
          nextStatus = "em_dfd";
          generatedContent = await generateDFD({
            processName: process.name,
            object: process.object || "",
            estimatedValue: process.estimatedValue || 0,
            modality: process.modality || "",
            category: process.category || "",
            etpContent: etpDoc.content || "",
            trContent: trDoc.content || "",
            organizationName: settings?.organizationName || undefined,
            address: settings?.address || undefined,
            cnpj: settings?.cnpj || undefined,
            phone: settings?.phone || undefined,
            email: settings?.email || undefined,
            website: settings?.website || undefined,
          });
        } else if (process.status === "em_dfd" && dfdDoc && trDoc && etpDoc) {
          // Gerar Edital
          nextDocType = "edital";
          nextStatus = "concluido";
          generatedContent = await generateEdital({
            processName: process.name,
            object: process.object || "",
            estimatedValue: process.estimatedValue || 0,
            modality: process.modality || "",
            category: process.category || "",
            etpContent: etpDoc.content || "",
            trContent: trDoc.content || "",
            dfdContent: dfdDoc.content || "",
            organizationName: settings?.organizationName || undefined,
            address: settings?.address || undefined,
            cnpj: settings?.cnpj || undefined,
            phone: settings?.phone || undefined,
            email: settings?.email || undefined,
            website: settings?.website || undefined,
          });
        } else {
          throw new Error("Não é possível gerar o próximo documento. Verifique o status do processo.");
        }

        // Salvar documento gerado
        await db.createDocument({
          processId: input.processId,
          type: nextDocType,
          content: generatedContent,
          version: 1,
        });

        // Atualizar status do processo
        await db.updateProcessStatus(input.processId, nextStatus);

        // Registrar atividade
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: `gerou o ${nextDocType.toUpperCase()} automaticamente`,
          details: JSON.stringify({ generatedBy: "AI", status: nextStatus }),
        });

        return { success: true, documentType: nextDocType, status: nextStatus };
      }),

    // Download documento em DOCX
    updateDocument: protectedProcedure
      .input(z.object({ documentId: z.number(), content: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const document = await db.getDocumentById(input.documentId);
        if (!document) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento não encontrado' });
        }

        const process = await db.getProcessById(document.processId);
        if (!process || process.ownerId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão para editar este documento' });
        }

        // Criar nova versão do documento
        const newVersion = document.version + 1;
        await db.createDocument({
          processId: document.processId,
          type: document.type,
          content: input.content,
          version: newVersion,
        });

        // Registrar atividade
        await db.createActivityLog({
          processId: document.processId,
          userId: ctx.user.id,
          action: `Editou ${document.type.toUpperCase()} (versão ${newVersion})`,
        });

        return { success: true, version: newVersion };
      }),

    // Obter histórico de versões de um documento
    getVersionHistory: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ input }) => {
        const document = await db.getDocumentById(input.documentId);
        if (!document) {
          throw new Error("Documento não encontrado");
        }

        // Buscar todas as versões do documento
        return await db.getDocumentVersions(document.processId, document.type);
      }),

    // Restaurar versão anterior
    restoreVersion: protectedProcedure
      .input(z.object({ 
        documentId: z.number(),
        versionId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        const currentDocument = await db.getDocumentById(input.documentId);
        if (!currentDocument) {
          throw new Error("Documento não encontrado");
        }

        const versionToRestore = await db.getDocumentById(input.versionId);
        if (!versionToRestore) {
          throw new Error("Versão não encontrada");
        }

        const process = await db.getProcessById(currentDocument.processId);
        if (!process) {
          throw new Error("Processo não encontrado");
        }

        // Criar nova versão com o conteúdo restaurado
        const newVersion = currentDocument.version + 1;
        await db.createDocument({
          processId: currentDocument.processId,
          type: currentDocument.type,
          content: versionToRestore.content,
          version: newVersion,
        });

        // Registrar atividade
        await db.createActivityLog({
          processId: currentDocument.processId,
          userId: ctx.user.id,
          action: `restaurou ${currentDocument.type.toUpperCase()} para versão ${versionToRestore.version}`,
          details: JSON.stringify({ 
            restoredFrom: versionToRestore.version,
            newVersion 
          }),
        });

        return { success: true, version: newVersion };
      }),

    downloadDocx: protectedProcedure
      .input(z.object({
        documentId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const document = await db.getDocumentById(input.documentId);
        if (!document) {
          throw new Error("Documento não encontrado");
        }

        const process = await db.getProcessById(document.processId);
        if (!process) {
          throw new Error("Processo não encontrado");
        }

        const documentLabels: Record<string, string> = {
          etp: "Estudo Técnico Preliminar (ETP)",
          tr: "Termo de Referência (TR)",
          dfd: "Documento Formalizador de Demanda (DFD)",
          edital: "Edital de Licitação",
        };

        // Buscar configurações do usuário
        const settings = await db.getDocumentSettingsByUser(ctx.user.id);

        const buffer = await convertToDOCX(
          document.content || "",
          `${documentLabels[document.type]} - ${process.name}`,
          settings?.organizationName || undefined,
          settings?.address || undefined,
          settings?.cnpj || undefined,
          settings?.phone || undefined,
          settings?.email || undefined,
          settings?.website || undefined
        );

        // Retornar como base64 para o frontend
        return {
          success: true,
          filename: `${document.type}_${process.name.replace(/\s+/g, "_")}.docx`,
          data: buffer.toString("base64"),
        };
      }),

    // Download documento em PDF
    downloadPdf: protectedProcedure
      .input(z.object({
        documentId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const document = await db.getDocumentById(input.documentId);
        if (!document) {
          throw new Error("Documento não encontrado");
        }

        const process = await db.getProcessById(document.processId);
        if (!process) {
          throw new Error("Processo não encontrado");
        }

        const documentLabels: Record<string, string> = {
          etp: "Estudo Técnico Preliminar (ETP)",
          tr: "Termo de Referência (TR)",
          dfd: "Documento Formalizador de Demanda (DFD)",
          edital: "Edital de Licitação",
        };

        // Buscar configurações do usuário
        const settings = await db.getDocumentSettingsByUser(ctx.user.id);

        const buffer = await convertToPDF(
          document.content || "",
          `${documentLabels[document.type]} - ${process.name}`,
          settings?.organizationName || undefined,
          settings?.address || undefined,
          settings?.cnpj || undefined,
          settings?.phone || undefined,
          settings?.email || undefined,
          settings?.website || undefined
        );

        // Retornar como base64 para o frontend
        return {
          success: true,
          filename: `${document.type}_${process.name.replace(/\s+/g, "_")}.pdf`,
          data: buffer.toString("base64"),
        };
      }),
  }),

  editalParameters: router({
    // Salvar parâmetros do edital
    save: protectedProcedure
      .input(z.object({
        processId: z.number(),
        modalidade: z.string().optional(),
        formato: z.enum(["presencial", "eletronico"]).optional(),
        criterioJulgamento: z.string().optional(),
        regimeContratacao: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.upsertEditalParameters({
          processId: input.processId,
          modalidade: input.modalidade,
          formato: input.formato,
          criterioJulgamento: input.criterioJulgamento,
          regimeContratacao: input.regimeContratacao,
        });

        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: "atualizou os parâmetros do edital",
        });

        return { success: true };
      }),

    // Obter parâmetros do edital
    get: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getEditalParametersByProcess(input.processId);
      }),
  }),

  activityLogs: router({
    // Listar atividades de um processo
    list: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getActivityLogsByProcess(input.processId);
      }),
  }),

  activities: router({
    // Listar atividades de um processo
    listByProcess: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getActivityLogsByProcess(input.processId);
      }),
  }),

  collaboration: router({
    // Adicionar membro ao processo
    addMember: protectedProcedure
      .input(z.object({
        processId: z.number(),
        userEmail: z.string().email(),
        permission: z.enum(["viewer", "editor", "approver"]),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verificar se o usuário atual é owner do processo
        const process = await db.getProcessById(input.processId);
        if (!process) {
          throw new Error("Processo n\u00e3o encontrado");
        }
        
        // Verificar se é owner ou tem permissão de approver
        const currentMember = await db.getProcessMember(input.processId, ctx.user.id);
        if (process.ownerId !== ctx.user.id && currentMember?.permission !== "approver") {
          throw new Error("Sem permiss\u00e3o para adicionar membros");
        }

        // Buscar usuário pelo email
        const targetUser = await db.getUserByEmail(input.userEmail);
        if (!targetUser) {
          throw new Error("Usu\u00e1rio n\u00e3o encontrado");
        }

        // Verificar se já é membro
        const existingMember = await db.getProcessMember(input.processId, targetUser.id);
        if (existingMember) {
          throw new Error("Usu\u00e1rio j\u00e1 \u00e9 membro deste processo");
        }

        // Adicionar membro
        await db.addProcessMember({
          processId: input.processId,
          userId: targetUser.id,
          permission: input.permission,
          invitedBy: ctx.user.id,
        });

        // Criar notificação
        await db.createNotification({
          userId: targetUser.id,
          title: "Voc\u00ea foi adicionado a um processo",
          message: `${ctx.user.name} adicionou voc\u00ea ao processo "${process.name}" como ${input.permission}`,
          type: "member_added",
          processId: input.processId,
          isRead: false,
        });

        // Registrar atividade
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: `adicionou ${targetUser.name} como ${input.permission}`,
        });

        return { success: true };
      }),

    // Remover membro do processo
    removeMember: protectedProcedure
      .input(z.object({
        processId: z.number(),
        userId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const process = await db.getProcessById(input.processId);
        if (!process) {
          throw new Error("Processo n\u00e3o encontrado");
        }

        // Verificar permissão
        const currentMember = await db.getProcessMember(input.processId, ctx.user.id);
        if (process.ownerId !== ctx.user.id && currentMember?.permission !== "approver") {
          throw new Error("Sem permiss\u00e3o para remover membros");
        }

        // Não pode remover o owner
        if (input.userId === process.ownerId) {
          throw new Error("N\u00e3o \u00e9 poss\u00edvel remover o propriet\u00e1rio do processo");
        }

        await db.removeProcessMember(input.processId, input.userId);

        // Registrar atividade
        const removedUser = await db.getUserById(input.userId);
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: `removeu ${removedUser?.name || "um membro"} do processo`,
        });

        return { success: true };
      }),

    // Atualizar permissão de membro
    updatePermission: protectedProcedure
      .input(z.object({
        processId: z.number(),
        userId: z.number(),
        permission: z.enum(["viewer", "editor", "approver"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const process = await db.getProcessById(input.processId);
        if (!process) {
          throw new Error("Processo n\u00e3o encontrado");
        }

        // Verificar permissão
        if (process.ownerId !== ctx.user.id) {
          throw new Error("Apenas o propriet\u00e1rio pode alterar permiss\u00f5es");
        }

        await db.updateProcessMemberPermission(input.processId, input.userId, input.permission);

        // Registrar atividade
        const targetUser = await db.getUserById(input.userId);
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: `alterou a permiss\u00e3o de ${targetUser?.name || "um membro"} para ${input.permission}`,
        });

        return { success: true };
      }),

    // Listar membros do processo
    listMembers: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getProcessMembers(input.processId);
      }),

    // Verificar permissão do usuário no processo
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
          isOwner: false 
        };
      }),
  }),

  notifications: router({
    // Listar notificações do usuário
    list: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(50) }))
      .query(async ({ ctx, input }) => {
        return await db.getUserNotifications(ctx.user.id, input.limit);
      }),

    // Contar notificações não lidas
    unreadCount: protectedProcedure
      .query(async ({ ctx }) => {
        return await db.getUnreadNotificationsCount(ctx.user.id);
      }),

    // Marcar notificação como lida
    markAsRead: protectedProcedure
      .input(z.object({ notificationId: z.number() }))
      .mutation(async ({ input }) => {
        await db.markNotificationAsRead(input.notificationId);
        return { success: true };
      }),

    // Marcar todas como lidas
    markAllAsRead: protectedProcedure
      .mutation(async ({ ctx }) => {
        await db.markAllNotificationsAsRead(ctx.user.id);
        return { success: true };
      }),
  }),

  documentSettings: router({
    // Salvar configurações de personalização
    save: protectedProcedure
      .input(z.object({
        organizationName: z.string().optional(),
        logoUrl: z.string().optional(),
        address: z.string().optional(),
        cnpj: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        website: z.string().optional(),
        footerText: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.upsertDocumentSettings({
          userId: ctx.user.id,
          ...input,
        });

        return { success: true };
      }),

    // Buscar configurações do usuário
    get: protectedProcedure
      .query(async ({ ctx }) => {
        return await db.getDocumentSettingsByUser(ctx.user.id);
      }),
  }),

  // Comentários
  comments: router({
    add: protectedProcedure
      .input(z.object({
        documentId: z.number(),
        processId: z.number(),
        content: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.createComment({
          documentId: input.documentId,
          processId: input.processId,
          userId: ctx.user.id,
          content: input.content,
        });
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: `adicionou um comentário`,
        });
        return { success: true };
      }),

    list: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ input }) => {
        return await db.getCommentsByDocument(input.documentId);
      }),

    update: protectedProcedure
      .input(z.object({
        commentId: z.number(),
        content: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const comment = await db.getCommentById(input.commentId);
        if (!comment || comment.userId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão' });
        }
        await db.updateComment(input.commentId, input.content);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ commentId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const comment = await db.getCommentById(input.commentId);
        if (!comment || comment.userId !== ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão' });
        }
        await db.deleteComment(input.commentId);
        return { success: true };
      }),
  }),

  // LGPD
  lgpd: router({
    recordConsent: protectedProcedure
      .input(z.object({
        consentType: z.enum(["terms_of_use", "privacy_policy", "data_processing"]),
        version: z.string(),
        ipAddress: z.string().optional(),
        userAgent: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.createUserConsent({
          userId: ctx.user.id,
          consentType: input.consentType,
          version: input.version,
          accepted: true,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });
        return { success: true };
      }),

    checkConsent: protectedProcedure
      .input(z.object({
        consentType: z.enum(["terms_of_use", "privacy_policy", "data_processing"]),
        version: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const hasAccepted = await db.hasUserAcceptedConsent(
          ctx.user.id,
          input.consentType,
          input.version
        );
        return { hasAccepted };
      }),

    exportMyData: protectedProcedure
      .mutation(async ({ ctx }) => {
        return await db.exportUserData(ctx.user.id);
      }),

    deleteMyAccount: protectedProcedure
      .mutation(async ({ ctx }) => {
        await db.deleteUserData(ctx.user.id);
        return { success: true };
      }),
  }),

  // Admin
  admin: router({
    listUsers: protectedProcedure
      .query(async ({ ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        return await db.getAllUsers();
      }),

    promoteToAdmin: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        await db.updateUserRole(input.userId, "admin");
        await db.createAuditLog({
          adminId: ctx.user.id,
          targetUserId: input.userId,
          action: "promote_to_admin",
          details: `Promovido a administrador`,
        });
        return { success: true };
      }),

    demoteFromAdmin: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        await db.updateUserRole(input.userId, "user");
        await db.createAuditLog({
          adminId: ctx.user.id,
          targetUserId: input.userId,
          action: "demote_from_admin",
          details: `Rebaixado para usuário`,
        });
        return { success: true };
      }),

    getUserStats: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        return await db.getUserStats(input.userId);
      }),

    getAuditLogs: protectedProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Apenas administradores' });
        }
        return await db.getAuditLogs(input.limit);
      }),
  }),

  // Analytics
  analytics: router({
    getOverview: protectedProcedure
      .query(async () => {
        const processesByStatus = await db.getProcessCountByStatus();
        const documentsByMonth = await db.getDocumentCountByMonth(6);
        const mostActiveMembers = await db.getMostActiveMembers(10);
        const allUsers = await db.getAllUsers();
        const totalProcesses = processesByStatus.reduce((sum, item) => sum + item.count, 0);
        return {
          totalUsers: allUsers.length,
          totalProcesses,
          processesByStatus,
          documentsByMonth,
          mostActiveMembers,
        };
      }),
  }),

  // Billing & Subscriptions
  billing: router({
    // Listar todos os planos disponíveis
    getPlans: publicProcedure
      .query(async () => {
        return await db.getAllSubscriptionPlans();
      }),

    // Obter plano específico
    getPlan: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        return await db.getSubscriptionPlanBySlug(input.slug);
      }),

    // Obter assinatura do usuário
    getMySubscription: protectedProcedure
      .query(async ({ ctx }) => {
        const subscription = await db.getUserSubscription(ctx.user.id);
        if (!subscription) return null;
        
        const plan = await db.getSubscriptionPlanById(subscription.planId);
        return { ...subscription, plan };
      }),

    // Listar todas as assinaturas (admin)
    getAllSubscriptions: protectedProcedure
      .query(async ({ ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Acesso negado. Apenas administradores podem acessar.",
          });
        }
        return await db.getAllSubscriptionsWithDetails();
      }),

    // Obter informações de uso e limites
    getMyLimits: protectedProcedure
      .query(async ({ ctx }) => {
        const { checkModuleAccess, getUserLimitsInfo } = await import('./middleware/limitsMiddleware');
        return await getUserLimitsInfo(ctx.user.id);
      }),

    // Criar sessão de checkout Stripe
    createCheckoutSession: protectedProcedure
      .input(z.object({ 
        planSlug: z.string(),
        successUrl: z.string(),
        cancelUrl: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createStripeCustomer, createCheckoutSession } = await import('./services/stripeService');
        
        const plan = await db.getSubscriptionPlanBySlug(input.planSlug);
        if (!plan || !plan.stripePriceId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Plano não encontrado' });
        }

        // Verificar se usuário já tem Stripe customer ID
        let subscription = await db.getUserSubscription(ctx.user.id);
        let customerId = subscription?.stripeCustomerId;

        if (!customerId) {
          const customer = await createStripeCustomer({
            email: ctx.user.email || '',
            name: ctx.user.name || '',
            metadata: { userId: ctx.user.id.toString() },
          });
          customerId = customer.id;
        }

        const session = await createCheckoutSession({
          customerId,
          priceId: plan.stripePriceId,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          trialDays: 30, // 30 dias de trial
          metadata: {
            userId: ctx.user.id.toString(),
            planId: plan.id.toString(),
          },
        });

        return { sessionUrl: session.url };
      }),

    // Cancelar assinatura
    cancelSubscription: protectedProcedure
      .input(z.object({ immediately: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const { cancelStripeSubscription } = await import('./services/stripeService');
        
        const subscription = await db.getUserSubscription(ctx.user.id);
        if (!subscription || !subscription.stripeSubscriptionId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Assinatura não encontrada' });
        }

        await cancelStripeSubscription({
          subscriptionId: subscription.stripeSubscriptionId,
          immediately: input.immediately || false,
        });

        await db.updateSubscription(subscription.id, {
          status: input.immediately ? 'canceled' : subscription.status,
          cancelAtPeriodEnd: !input.immediately,
          canceledAt: new Date(),
        });

        return { success: true };
      }),

    // Criar portal de billing (gerenciar assinatura)
    createBillingPortal: protectedProcedure
      .input(z.object({ returnUrl: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { createBillingPortalSession } = await import('./services/stripeService');
        
        const subscription = await db.getUserSubscription(ctx.user.id);
        if (!subscription || !subscription.stripeCustomerId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Assinatura não encontrada' });
        }

        const session = await createBillingPortalSession({
          customerId: subscription.stripeCustomerId,
          returnUrl: input.returnUrl,
        });

        return { portalUrl: session.url };
      }),

    // Listar pagamentos do usuário
    getMyPayments: protectedProcedure
      .query(async ({ ctx }) => {
        return await db.getUserPayments(ctx.user.id);
      }),
  }),

  // Rotas de gestão comercial (clientes e contratos do LiciGov Pro)
  commercial: commercialRouter,

  // Rotas de documentos da empresa
  companyDocuments: companyDocumentsRouter,

  // Rotas de integração CATMAT/CATSER
  catmat: catmatRouter,

  // Rotas de gestão do departamento
  tasks: taskRouter,
  departmentTasks: departmentTasksRouter,

  // Rotas de parcelas de notas fiscais (empenho)


  // Rotas de templates de documentos
  templates: router({
    // Listar templates do usuário
    list: protectedProcedure.query(async ({ ctx }) => {
      return await db.getTemplatesByUser(ctx.user.id);
    }),

    // Buscar template por ID
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getTemplateById(input.id);
      }),

    // Buscar template padrão por tipo
    getDefault: protectedProcedure
      .input(z.object({ type: z.enum(["etp", "tr", "dfd", "edital"]) }))
      .query(async ({ ctx, input }) => {
        return await db.getDefaultTemplate(ctx.user.id, input.type);
      }),

    // Criar novo template
    create: protectedProcedure
      .input(z.object({
        name: z.string(),
        description: z.string().optional(),
        type: z.enum(["etp", "tr", "dfd", "edital"]),
        content: z.string(),
        isDefault: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const templateId = await db.createTemplate({
          userId: ctx.user.id,
          name: input.name,
          description: input.description || null,
          type: input.type,
          content: input.content,
          isDefault: input.isDefault ? 1 : 0,
        });

        return { id: templateId, success: true };
      }),

    // Atualizar template
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        content: z.string().optional(),
        isDefault: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const template = await db.getTemplateById(input.id);
        if (!template || template.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const updates: any = {};
        if (input.name !== undefined) updates.name = input.name;
        if (input.description !== undefined) updates.description = input.description;
        if (input.content !== undefined) updates.content = input.content;
        if (input.isDefault !== undefined) {
          updates.isDefault = input.isDefault ? 1 : 0;
          updates.userId = ctx.user.id;
          updates.type = template.type;
        }

        await db.updateTemplate(input.id, updates);
        return { success: true };
      }),

    // Excluir template
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const template = await db.getTemplateById(input.id);
        if (!template || template.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await db.deleteTemplate(input.id);
        return { success: true };
      }),
  }),

  // Dashboard de custos de IA (admin only)
  aiUsage: aiUsageRouter,

  // Plataformas de pregão eletrônico
  platforms: platformsRouter,

  // Downloads de pacotes e documentos
  downloads: downloadRouter,
  directContracts: directContractsRouter,
});

export type AppRouter = typeof appRouter;
