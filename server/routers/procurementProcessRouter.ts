/**
 * Sprint 5.1 — Procurement Process Router (operational).
 *
 * Conduz o servidor pelo ciclo do Processo Licitatório. Documentos são
 * consequência do fluxo. tenantProcedure, multi-tenant, timeline auditável.
 * Todo acesso ao Kernel ocorre via kernelAccessService (nos serviços).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import {
  createProcurementWorkspace,
  advanceStage,
  setStage,
  type StartOption,
  type ProcessStage,
} from "../domain/procurementProcess";
import { createDFDState, importDFD as importDFDDomain, type DFDSource } from "../domain/dfdState";
import { createPriceResearchWorkspace, extractItemsFromText } from "../domain/priceResearch";
import { approveItem as approveItemDomain, rejectItem as rejectItemDomain } from "../domain/intelligentItem";
import { generateDocument, generateNotice, generateDFDDraft, saveDFDDraft } from "../services/procurementProcessService";
import { enrichItem } from "../services/itemIntelligenceService";
import { serviceLogger } from "../services/observabilityService";
import {
  insertProcess, getProcess, listProcesses, updateProcessStage,
  insertResearch, insertResearchItem, listIntelligentItems, getIntelligentItem,
  updateItemStatus, recordProcessEvent, listProcessTimeline, listGeneratedDocuments,
  getGeneratedDocumentByKind,
} from "../db/procurement";

const log = serviceLogger("procurementProcessRouter");

const START_OPTIONS = ["criar_dfd", "importar_dfd", "importar_oficio", "importar_memorando", "importar_pdf", "iniciar_etp"] as const;
const STAGES = ["NEW_PROCESS", "DFD", "ETP", "PRICE_RESEARCH", "ITEM_WORKSPACE", "TR", "NOTICE", "REVIEW", "ISSUED", "ARCHIVED"] as const;
const MODALITIES = ["pregao", "concorrencia", "leilao", "concurso", "chamada_publica", "credenciamento", "registro_de_precos"] as const;
const FORMS = ["eletronico", "presencial"] as const;
const PLATFORMS = ["compras_gov", "bll", "licitanet", "portal_proprio", "outra"] as const;

async function requireProcess(id: string, orgId: number) {
  const p = await getProcess(id, orgId);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado nesta organização." });
  return p;
}

export const procurementProcessRouter = router({
  createProcess: tenantProcedure
    .input(z.object({
      processNumber: z.string().min(1),
      object: z.string().min(1),
      startOption: z.enum(START_OPTIONS),
      modality: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const process = createProcurementWorkspace({
        organizationId: orgId, processNumber: input.processNumber, object: input.object,
        modality: input.modality, startOption: input.startOption as StartOption,
        responsibleUser: ctx.user.id, correlationId: ctx.correlationId,
      });
      try {
        // Idempotente: id determinístico (org + número) + onDuplicateKeyUpdate →
        // clique repetido/retry NÃO cria processo duplicado.
        await insertProcess(process);
        await recordProcessEvent({
          organizationId: orgId, processId: process.id, eventType: "workspace_created",
          actor: String(ctx.user.id), summary: `Processo ${process.processNumber} criado (início: ${input.startOption}).`,
          refId: process.id, correlationId: ctx.correlationId,
        });
      } catch (err) {
        // Não mascarar: persistir o erro técnico com correlationId para diagnóstico;
        // ao usuário, mensagem amigável e estável em pt-BR.
        log.error("create_process_failed", {
          organizationId: orgId, userId: ctx.user.id, processNumber: input.processNumber,
          startOption: input.startOption, correlationId: ctx.correlationId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível criar o processo. Tente novamente; se persistir, contate o suporte.",
        });
      }
      return { process };
    }),

  loadProcess: tenantProcedure
    .input(z.object({ processId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const process = await getProcess(input.processId, orgId);
      if (!process) return { process: null, items: [], timeline: [], documents: [] };
      const [items, timeline, documents] = await Promise.all([
        listIntelligentItems(input.processId, orgId),
        listProcessTimeline(input.processId, orgId),
        listGeneratedDocuments(input.processId, orgId),
      ]);
      return { process, items, timeline, documents };
    }),

  listProcesses: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const processes = await listProcesses(orgId, input.limit ?? 50);
      return { processes, total: processes.length };
    }),

  updateStage: tenantProcedure
    .input(z.object({ processId: z.string().min(1), stage: z.enum(STAGES).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const process = await requireProcess(input.processId, orgId);
      const updated = input.stage ? setStage(process, input.stage as ProcessStage) : advanceStage(process);
      await updateProcessStage(process.id, orgId, updated.currentStage, updated.status, updated.updatedAt);
      await recordProcessEvent({
        organizationId: orgId, processId: process.id, eventType: "change",
        actor: String(ctx.user.id), summary: `Etapa: ${updated.currentStage}.`, refId: process.id,
        correlationId: ctx.correlationId,
      });
      return { process: updated };
    }),

  importDFD: tenantProcedure
    .input(z.object({ processId: z.string().min(1), source: z.enum(["pdf", "docx", "oficio", "memorando"]), fields: z.record(z.string(), z.string()).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireProcess(input.processId, orgId);
      const dfd = importDFDDomain(
        createDFDState({ processId: input.processId, organizationId: orgId, correlationId: ctx.correlationId }),
        input.source as DFDSource, input.fields ?? {},
      );
      await recordProcessEvent({
        organizationId: orgId, processId: input.processId, eventType: "change",
        actor: String(ctx.user.id), summary: `DFD importado (${input.source}).`, refId: dfd.id,
        correlationId: ctx.correlationId,
      });
      return { dfd };
    }),

  /** Carrega o DFD (rascunho) do processo, se existir. */
  loadDFD: tenantProcedure
    .input(z.object({ processId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireProcess(input.processId, orgId);
      const document = await getGeneratedDocumentByKind(input.processId, orgId, "dfd");
      return { document };
    }),

  /**
   * "Criar DFD do zero": estrutura um rascunho editável do DFD (art. 12, §1º) e
   * persiste como documento canônico (kind "dfd", rascunho). Idempotente.
   */
  generateDFD: tenantProcedure
    .input(z.object({ processId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const process = await requireProcess(input.processId, orgId);
      const document = await generateDFDDraft({
        organizationId: orgId, processId: input.processId, object: process.object,
        correlationId: ctx.correlationId,
      });
      return { document };
    }),

  /** Salva a edição do rascunho de DFD (supervisão humana; mantém status rascunho). */
  saveDFD: tenantProcedure
    .input(z.object({ processId: z.string().min(1), content: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const process = await requireProcess(input.processId, orgId);
      const document = await saveDFDDraft({
        organizationId: orgId, processId: input.processId, object: process.object,
        content: input.content, correlationId: ctx.correlationId,
      });
      return { document };
    }),

  generateETP: tenantProcedure
    .input(z.object({ processId: z.string().min(1), object: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireProcess(input.processId, orgId);
      const document = await generateDocument({
        organizationId: orgId, processId: input.processId, kind: "etp", object: input.object,
        correlationId: ctx.correlationId,
      });
      return { document };
    }),

  importPriceResearch: tenantProcedure
    .input(z.object({
      processId: z.string().min(1),
      source: z.enum(["pdf", "docx", "xlsx", "csv", "colar", "manual"]),
      text: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireProcess(input.processId, orgId);
      const research = createPriceResearchWorkspace({ processId: input.processId, organizationId: orgId, source: input.source, correlationId: ctx.correlationId });
      const rawItems = extractItemsFromText(input.text, { researchId: research.id, processId: input.processId, organizationId: orgId });
      await insertResearch({ ...research, itemCount: rawItems.length });
      for (const it of rawItems) await insertResearchItem(it);

      // Cada item da pesquisa vira um Item Inteligente enriquecido.
      const enriched = [];
      for (const it of rawItems) {
        const e = await enrichItem({
          organizationId: orgId, processId: input.processId, researchId: research.id,
          description: it.description, quantity: it.quantity, unit: it.unit,
          supplierValues: it.value > 0 ? [{ name: it.supplier || "fornecedor", value: it.value }] : [],
          correlationId: ctx.correlationId,
        });
        enriched.push({ id: e.item.id, description: e.item.description, suggestedCATMAT: e.item.suggestedCATMAT });
      }
      await recordProcessEvent({
        organizationId: orgId, processId: input.processId, eventType: "change",
        actor: String(ctx.user.id), summary: `Pesquisa importada (${input.source}): ${rawItems.length} item(ns) → Itens Inteligentes.`,
        refId: research.id, correlationId: ctx.correlationId,
      });
      return { research: { ...research, itemCount: rawItems.length }, intelligentItems: enriched };
    }),

  listItems: tenantProcedure
    .input(z.object({ processId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const items = await listIntelligentItems(input.processId, orgId);
      return { items, total: items.length };
    }),

  approveItem: tenantProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const item = await getIntelligentItem(input.itemId, orgId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
      const approved = approveItemDomain(item, ctx.user.id);
      await updateItemStatus(item.id, orgId, "aprovado", ctx.user.id, approved.updatedAt);
      await recordProcessEvent({ organizationId: orgId, processId: item.processId, eventType: "approval", actor: String(ctx.user.id), summary: `Item aprovado: ${item.description}.`, refId: item.id, correlationId: ctx.correlationId });
      return { success: true, itemId: item.id, status: "aprovado" as const };
    }),

  rejectItem: tenantProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const item = await getIntelligentItem(input.itemId, orgId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
      const rejected = rejectItemDomain(item);
      await updateItemStatus(item.id, orgId, "rejeitado", null, rejected.updatedAt);
      await recordProcessEvent({ organizationId: orgId, processId: item.processId, eventType: "decision", actor: String(ctx.user.id), summary: `Item rejeitado: ${item.description}.`, refId: item.id, correlationId: ctx.correlationId });
      return { success: true, itemId: item.id, status: "rejeitado" as const };
    }),

  generateTR: tenantProcedure
    .input(z.object({ processId: z.string().min(1), object: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireProcess(input.processId, orgId);
      const document = await generateDocument({ organizationId: orgId, processId: input.processId, kind: "tr", object: input.object, correlationId: ctx.correlationId });
      return { document };
    }),

  generateNotice: tenantProcedure
    .input(z.object({
      processId: z.string().min(1), object: z.string().min(1),
      modality: z.enum(MODALITIES), form: z.enum(FORMS), platform: z.enum(PLATFORMS).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireProcess(input.processId, orgId);
      const result = await generateNotice({
        organizationId: orgId, processId: input.processId, object: input.object,
        modality: input.modality, form: input.form, platform: input.platform, correlationId: ctx.correlationId,
      });
      if (!result.validation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Edital inválido: ${result.validation.violations.join(" ")}` });
      }
      return { document: result.document };
    }),

  issueProcess: tenantProcedure
    .input(z.object({ processId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const process = await requireProcess(input.processId, orgId);
      const issued = setStage(process, "ISSUED");
      await updateProcessStage(process.id, orgId, "ISSUED", "emitido", issued.updatedAt);
      await recordProcessEvent({ organizationId: orgId, processId: process.id, eventType: "approval", actor: String(ctx.user.id), summary: "Processo emitido.", refId: process.id, correlationId: ctx.correlationId });
      return { success: true, processId: process.id, status: "emitido" as const };
    }),
});
