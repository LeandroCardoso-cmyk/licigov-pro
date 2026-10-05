/**
 * @deprecated LEGACY_ACTIVE_MAINTENANCE_ONLY (RC-C0.1A) — CRUD de processo licitatório
 * legado. A navegação oficial NÃO passa mais por aqui: `/processos` monta o fluxo canônico
 * (ProcessoLicitatorio → `procurementProcess.*`), e `create` está em corte controlado (PR B).
 * Não adicione novos tipos documentais, novos consumidores ou novas rotas aqui. Hotfix
 * crítico e correção de segurança são permitidos.
 *
 * R2 / LEG-005 (decisão humana 27/09/2026 = DISABLE): as procedures legadas de ITENS do TR /
 * CATMAT (addItemsToTR, getProcessItems, parseItemsFile, generateCatmatSuggestions,
 * getCatmatSuggestions, approveCatmatSuggestion, rejectCatmatSuggestion, updateProcessItem,
 * deleteProcessItem) estão DESATIVADAS de forma governada (`throwLegacyEndpointDisabled`,
 * FORBIDDEN + LEGACY_ENDPOINT_DISABLED, antes de qualquer leitura/escrita, IA ou log de
 * atividade). Seus únicos callers (TRItemsModal/ImportItemsModal/CatmatSuggestionsModal/
 * EditItemDialog) só são alcançáveis pela página NÃO roteada `pages/ProcessDetails.tsx`.
 * Destino canônico: Itens da Contratação / Itens Inteligentes (`itemIntelligence`) no
 * Processo Licitatório canônico. Dados históricos (process_items / catmat_suggestions) são
 * preservados — nada é apagado. Referência: `docs/architecture/LEGACY_INVENTORY.md` e
 * `server/kernel/architecture/legacyBoundaries.ts`.
 */
import { tenantProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { throwLegacyEndpointDisabled } from "../services/legacyEndpointGuard";
import { z } from "zod";
import * as db from "../db";
import { serviceLogger } from "../services/observabilityService";
import { toActivityReportEntry } from "../services/activityReport";
import { throwLegacyProcessPipelineDisabled } from "../domain/legacyPipeline";
import type { CatmatMatch } from "../services/catmatMatcher";

const log = serviceLogger("processesRouter");

/** R2 / LEG-005 — superfície legada de itens do TR / CATMAT desativada (DISABLE governado). */
const LEG005 = "LEG-005";
const LEG005_ALTERNATIVE =
  "Itens da Contratação / Itens Inteligentes (itemIntelligence) no Processo Licitatório canônico";

// Tipos de saída PRESERVADOS (somente tipo, sem efeito em runtime): o contrato tipado da API
// continua o mesmo para os consumidores legados congelados, embora toda chamada seja recusada.
type LegacySuccess = { success: boolean };
type LegacyProcessItems = Awaited<ReturnType<typeof db.getProcessItemsForOrganization>>;
type LegacyCatmatSuggestions = Awaited<ReturnType<typeof db.getCatmatSuggestionsByItemForOrganization>>;
type LegacyParsedItem = { description: string; quantity: number; unit: string; unitPrice: number; totalPrice: number };
type LegacyParseItemsFileResult = {
  success: boolean;
  preview?: (string | number | boolean | null)[][];
  items: LegacyParsedItem[];
  count: number;
};
type LegacyGenerateCatmatSuggestionsResult = {
  success: boolean;
  suggestions: CatmatMatch[];
  requiresHumanValidation: true;
  notice: string;
};

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
    // SEM-046 — relatório da organização do CONTEXTO, com os campos reais de `activity_logs` (ator e detalhes).
    const rows = await db.getActivityReportForOrganization(ctx.organizationId);
    return rows.map(toActivityReportEntry);
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
    .mutation(async () => {
      // PR B — Corte controlado: o pipeline legado de Processo Licitatório não
      // recebe novas gravações. A criação e a condução do processo (incluindo a
      // geração de DFD/ETP/TR/Edital) ocorrem EXCLUSIVAMENTE pelo fluxo canônico
      // (procurementProcess.createProcess). Procedure mantida registrada apenas
      // por inércia técnica — nenhuma tela a alcança (rota /novo-processo
      // redireciona para a jornada canônica).
      throwLegacyProcessPipelineDisabled();
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
    .mutation(async ({ ctx }): Promise<LegacySuccess> => {
      // R2 / LEG-005 — DISABLE governado: recusa antes de qualquer leitura/escrita, IA ou log.
      throwLegacyEndpointDisabled("processes.addItemsToTR", LEG005, ctx, LEG005_ALTERNATIVE);
    }),

  getProcessItems: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx }): Promise<LegacyProcessItems> => {
      // R2 / LEG-005 — DISABLE governado: recusa antes de qualquer leitura/escrita, IA ou log.
      throwLegacyEndpointDisabled("processes.getProcessItems", LEG005, ctx, LEG005_ALTERNATIVE);
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
    .mutation(async ({ ctx }): Promise<LegacyParseItemsFileResult> => {
      // R2 / LEG-005 — DISABLE governado: recusa antes de qualquer leitura/escrita, IA ou log.
      throwLegacyEndpointDisabled("processes.parseItemsFile", LEG005, ctx, LEG005_ALTERNATIVE);
    }),

  generateCatmatSuggestions: tenantProcedure
    .input(z.object({
      processItemId: z.number(),
      description: z.string(),
      itemType: z.enum(["material", "service"]).default("material"),
    }))
    .mutation(async ({ ctx }): Promise<LegacyGenerateCatmatSuggestionsResult> => {
      // R2 / LEG-005 — DISABLE governado: recusa antes de qualquer leitura/escrita, IA ou log.
      throwLegacyEndpointDisabled("processes.generateCatmatSuggestions", LEG005, ctx, LEG005_ALTERNATIVE);
    }),

  getCatmatSuggestions: tenantProcedure
    .input(z.object({ processItemId: z.number() }))
    .query(async ({ ctx }): Promise<LegacyCatmatSuggestions> => {
      // R2 / LEG-005 — DISABLE governado: recusa antes de qualquer leitura/escrita, IA ou log.
      throwLegacyEndpointDisabled("processes.getCatmatSuggestions", LEG005, ctx, LEG005_ALTERNATIVE);
    }),

  approveCatmatSuggestion: tenantProcedure
    .input(z.object({
      suggestionId: z.number(),
      processItemId: z.number(),
    }))
    .mutation(async ({ ctx }): Promise<LegacySuccess> => {
      // R2 / LEG-005 — DISABLE governado: recusa antes de qualquer leitura/escrita, IA ou log.
      throwLegacyEndpointDisabled("processes.approveCatmatSuggestion", LEG005, ctx, LEG005_ALTERNATIVE);
    }),

  rejectCatmatSuggestion: tenantProcedure
    .input(z.object({ suggestionId: z.number() }))
    .mutation(async ({ ctx }): Promise<LegacySuccess> => {
      // R2 / LEG-005 — DISABLE governado: recusa antes de qualquer leitura/escrita, IA ou log.
      throwLegacyEndpointDisabled("processes.rejectCatmatSuggestion", LEG005, ctx, LEG005_ALTERNATIVE);
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
    .mutation(async ({ ctx }): Promise<LegacySuccess> => {
      // R2 / LEG-005 — DISABLE governado: recusa antes de qualquer leitura/escrita, IA ou log.
      throwLegacyEndpointDisabled("processes.updateProcessItem", LEG005, ctx, LEG005_ALTERNATIVE);
    }),

  deleteProcessItem: tenantProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ ctx }): Promise<LegacySuccess> => {
      // R2 / LEG-005 — DISABLE governado: recusa antes de qualquer leitura/escrita, IA ou log.
      throwLegacyEndpointDisabled("processes.deleteProcessItem", LEG005, ctx, LEG005_ALTERNATIVE);
    }),

  updateStatus: tenantProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["em_dfd", "em_etp", "em_tr", "em_edital", "concluido"]),
    }))
    .mutation(async ({ ctx }) => {
      // R2 / LEG-006 — desligamento governado: esta procedure gravava `processes.status` legado,
      // `activity_logs` sem organizationId e disparava e-mail real (sendStatusChangeEmail) fora do
      // fluxo canônico. Recusa determinística ANTES de qualquer leitura/escrita/e-mail. Procedure e
      // schema de input mantidos (contrato da API não some silenciosamente).
      throwLegacyEndpointDisabled("processes.updateStatus", "LEG-006", ctx, "o fluxo canônico do Processo Licitatório");
    }),
});
