import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { generateETP } from "./services/gemini";

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

    // Criar novo processo
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        object: z.string().min(1),
        estimatedValue: z.number().positive(),
        modality: z.string().min(1),
        category: z.string().min(1),
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

        // Gerar ETP automaticamente em background
        generateETP({
          processName: input.name,
          object: input.object,
          estimatedValue: valueInCents,
          modality: input.modality,
          category: input.category,
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

    // Atualizar status do processo
    updateStatus: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["em_etp", "em_tr", "em_dfd", "em_edital", "concluido"]),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateProcessStatus(input.id, input.status);
        
        await db.createActivityLog({
          processId: input.id,
          userId: ctx.user.id,
          action: `alterou o status para ${input.status}`,
        });

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

  collaborators: router({
    // Adicionar colaborador
    add: protectedProcedure
      .input(z.object({
        processId: z.number(),
        userId: z.number(),
        role: z.enum(["administrador", "editor", "leitor"]),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.addCollaborator({
          processId: input.processId,
          userId: input.userId,
          role: input.role,
          invitedBy: ctx.user.id,
        });

        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: `adicionou um colaborador como ${input.role}`,
        });

        return { success: true };
      }),

    // Listar colaboradores
    list: protectedProcedure
      .input(z.object({ processId: z.number() }))
      .query(async ({ input }) => {
        return await db.getCollaboratorsByProcess(input.processId);
      }),
  }),
});

export type AppRouter = typeof appRouter;
