/**
 * @deprecated LEGACY_ACTIVE_MAINTENANCE_ONLY (RC-C0.1A) — CRUD de processo licitatório
 * legado, ATIVO em produção hoje (alimenta o fluxo real de `/processos` no menu). Não
 * adicione novos tipos documentais, novos consumidores ou novas rotas aqui. Hotfix
 * crítico e correção de segurança são permitidos. Destino canônico:
 * `procurementProcessRouter` (ainda órfão do frontend — ver
 * `server/kernel/architecture/legacyBoundaries.ts` → `CANONICAL_NOT_YET_WIRED`).
 * Referência: `docs/architecture/LEGACY_INVENTORY.md`, seção "Licitação / Processo
 * Licitatório / Geração Documental". Migração prevista para sprint dedicada futura (C1+).
 */
import { tenantProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { generateDFD } from "../services/gemini";
import { serviceLogger } from "../services/observabilityService";

const log = serviceLogger("processesRouter");

/**
 * RC-SEC-PR-A — Negação de autorização multi-tenant. Cross-tenant e inexistente
 * produzem o MESMO erro NOT_FOUND (nunca revela existência em outra organização).
 * Log estruturado leve, sem conteúdo sensível (apenas identificadores).
 */
function denyNotFound(
  procedure: string,
  ctx: { organizationId: number; user: { id: number } },
  resourceId: number,
  reason: string,
  message = "Recurso não encontrado",
): never {
  log.warn("tenant_authorization_denied", {
    procedure,
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    resourceId,
    reason,
  });
  throw new TRPCError({ code: "NOT_FOUND", message });
}

export const processesRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    return await db.listProcessesForOrganization(ctx.organizationId);
  }),

  search: tenantProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      return await db.searchProcessesForOrganization(ctx.organizationId, input.query);
    }),

  getActivityLogs: tenantProcedure.query(async ({ ctx }) => {
    const userProcesses = await db.listProcessesForOrganization(ctx.organizationId);
    const allActivities = [];

    for (const process of userProcesses) {
      const activities = await db.getActivityLogsByProcess(process.id);
      allActivities.push(...activities);
    }

    return allActivities.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }),

  create: tenantProcedure
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
        organizationId: ctx.organizationId,
        status: "em_dfd",
      });

      const processId = Number((result as any).insertId);

      await db.createActivityLog({
        processId,
        userId: ctx.user.id,
        action: "criou o processo",
        details: JSON.stringify({ name: input.name }),
      });

      const settings = await db.getDocumentSettingsByUser(ctx.user.id);

      generateDFD({
        processName: input.name,
        object: input.object,
        estimatedValue: valueInCents,
        modality: input.modality,
        category: input.category,
        platformId: input.platformId || null,
        organizationName: settings?.organizationName || undefined,
        address: settings?.address || undefined,
        cnpj: settings?.cnpj || undefined,
        phone: settings?.phone || undefined,
        email: settings?.email || undefined,
        website: settings?.website || undefined,
      })
        .then(async (dfdContent) => {
          await db.createDocument({
            processId,
            type: "dfd",
            content: dfdContent,
            version: 1,
            organizationId: ctx.organizationId,
          });
          await db.createActivityLog({
            processId,
            userId: ctx.user.id,
            action: "gerou o DFD automaticamente",
            details: JSON.stringify({ generatedBy: "AI" }),
          });
        })
        .catch(() => {
          // Fire-and-forget: error silently swallowed, no user-facing impact
        });

      return { success: true, processId };
    }),

  getById: tenantProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const process = await db.getProcessByIdForOrganization(input.id, ctx.organizationId);
      if (!process) {
        denyNotFound("getById", ctx, input.id, "process_cross_tenant_or_missing", "Processo não encontrado");
      }
      return process;
    }),

  addItemsToTR: tenantProcedure
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
      const saved = await db.saveProcessItemsForOrganization(input.processId, ctx.organizationId, input.items);
      if (!saved) {
        denyNotFound("addItemsToTR", ctx, input.processId, "process_cross_tenant_or_missing", "Processo não encontrado");
      }

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `adicionou ${input.items.length} item(ns) ao TR`,
      });

      return { success: true };
    }),

  getProcessItems: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      return await db.getProcessItemsForOrganization(input.processId, ctx.organizationId);
    }),

  parseItemsFile: tenantProcedure
    .input(z.object({
      fileContent: z.string(),
      fileName: z.string(),
      columnMapping: z.object({
        description: z.number(),
        quantity: z.number().optional(),
        unit: z.number().optional(),
        unitPrice: z.number().optional(),
        totalPrice: z.number().optional(),
      }),
      previewOnly: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const XLSX = await import('xlsx');

      const buffer = Buffer.from(input.fileContent, 'base64');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (data.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Arquivo vazio' });
      }

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

      const items = data.slice(1).map((row, index) => {
        const description = row[input.columnMapping.description]?.toString().trim();

        if (!description || description.length < 10) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Linha ${index + 2}: Descrição inválida (mínimo 10 caracteres)`,
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
      }).filter(item => item.description);

      return {
        success: true,
        items,
        count: items.length,
      };
    }),

  generateCatmatSuggestions: tenantProcedure
    .input(z.object({
      processItemId: z.number(),
      description: z.string(),
      itemType: z.enum(["material", "service"]).default("material"),
    }))
    .mutation(async ({ ctx, input }) => {
      const { findCatmatMatches } = await import("../services/catmatMatcher");
      const { trackCATMATMatching } = await import("../services/aiUsageTracker");

      const matches = await findCatmatMatches(input.description, input.itemType);

      await trackCATMATMatching({
        userId: ctx.user.id,
        itemDescription: input.description,
        suggestionsCount: matches.length,
      });

      for (const match of matches) {
        const created = await db.createCatmatSuggestionForOrganization({
          processItemId: input.processItemId,
          catmatCode: match.code,
          description: match.description,
          confidenceScore: match.confidence,
          reasoning: match.reasoning,
        }, ctx.organizationId);
        if (created === null) {
          denyNotFound("generateCatmatSuggestions", ctx, input.processItemId, "process_item_cross_tenant_or_missing", "Item não encontrado");
        }
      }

      return { success: true, suggestions: matches };
    }),

  getCatmatSuggestions: tenantProcedure
    .input(z.object({ processItemId: z.number() }))
    .query(async ({ ctx, input }) => {
      return await db.getCatmatSuggestionsByItemForOrganization(input.processItemId, ctx.organizationId);
    }),

  approveCatmatSuggestion: tenantProcedure
    .input(z.object({
      suggestionId: z.number(),
      processItemId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const suggestion = await db.getCatmatSuggestionByIdForOrganization(input.suggestionId, ctx.organizationId);
      if (!suggestion) {
        denyNotFound("approveCatmatSuggestion", ctx, input.suggestionId, "suggestion_cross_tenant_or_missing", "Sugestão não encontrada");
      }

      const itemType = suggestion.catmatCode.startsWith('CAT') ? 'material' : 'service';
      const parsedCode = parseInt(suggestion.catmatCode.replace(/\D/g, '')) || null;
      const updatedItem = await db.updateProcessItemForOrganization(input.processItemId, ctx.organizationId, {
        itemType,
        catmatCode: itemType === 'material' ? parsedCode : undefined,
        catserCode: itemType === 'service' ? parsedCode : undefined,
        description: suggestion.description,
      });
      if (!updatedItem) {
        denyNotFound("approveCatmatSuggestion", ctx, input.processItemId, "process_item_cross_tenant_or_missing", "Item não encontrado");
      }

      const updatedSuggestion = await db.updateCatmatSuggestionForOrganization(input.suggestionId, ctx.organizationId, { status: 'approved' });
      if (!updatedSuggestion) {
        denyNotFound("approveCatmatSuggestion", ctx, input.suggestionId, "suggestion_cross_tenant_or_missing", "Sugestão não encontrada");
      }

      const rejected = await db.rejectOtherSuggestionsForOrganization(input.processItemId, input.suggestionId, ctx.organizationId);
      if (!rejected) {
        denyNotFound("approveCatmatSuggestion", ctx, input.processItemId, "process_item_cross_tenant_or_missing", "Item não encontrado");
      }

      return { success: true };
    }),

  rejectCatmatSuggestion: tenantProcedure
    .input(z.object({ suggestionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const rejected = await db.updateCatmatSuggestionForOrganization(input.suggestionId, ctx.organizationId, { status: 'rejected' });
      if (!rejected) {
        denyNotFound("rejectCatmatSuggestion", ctx, input.suggestionId, "suggestion_cross_tenant_or_missing", "Sugestão não encontrada");
      }
      return { success: true };
    }),

  updateProcessItem: tenantProcedure
    .input(z.object({
      itemId: z.number(),
      description: z.string().optional(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      unitPrice: z.number().optional(),
      catmatCode: z.string().optional(),
      catserCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { itemId, catmatCode, catserCode, ...rest } = input;
      const updated = await db.updateProcessItemForOrganization(itemId, ctx.organizationId, {
        ...rest,
        catmatCode: catmatCode ? parseInt(catmatCode) : undefined,
        catserCode: catserCode ? parseInt(catserCode) : undefined,
      });
      if (!updated) {
        denyNotFound("updateProcessItem", ctx, itemId, "process_item_cross_tenant_or_missing", "Item não encontrado");
      }
      return { success: true };
    }),

  deleteProcessItem: tenantProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await db.deleteProcessItemForOrganization(input.itemId, ctx.organizationId);
      if (!deleted) {
        denyNotFound("deleteProcessItem", ctx, input.itemId, "process_item_cross_tenant_or_missing", "Item não encontrado");
      }
      return { success: true };
    }),

  updateStatus: tenantProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["em_dfd", "em_etp", "em_tr", "em_edital", "concluido"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessByIdForOrganization(input.id, ctx.organizationId);
      if (!process) {
        denyNotFound("updateStatus", ctx, input.id, "process_cross_tenant_or_missing", "Processo não encontrado");
      }
      const oldStatus = process.status;

      await db.updateProcessStatusForOrganization(input.id, ctx.organizationId, input.status);

      await db.createActivityLog({
        processId: input.id,
        userId: ctx.user.id,
        action: `alterou o status para ${input.status}`,
      });

      if (oldStatus && oldStatus !== input.status && ctx.user.email && process) {
        const { sendStatusChangeEmail } = await import("../services/emailService");
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
});
