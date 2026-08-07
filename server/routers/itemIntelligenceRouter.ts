/**
 * Sprint 5.1 — Item Intelligence Router (operational).
 *
 * Painel do Item Inteligente e decisões de CATMAT/recomendações. O servidor SEMPRE
 * decide (aceitar/rejeitar/pesquisar/manual). tenantProcedure, multi-tenant.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, orgRoleProcedure } from "../_core/trpc";
import { getItemPanel, catmatCandidates } from "../services/itemIntelligenceService";
import { rankCATMAT, manualMatch } from "../domain/catmatMatching";
import { approveItem as approveItemDomain } from "../domain/intelligentItem";
import { CATMAT_GOVERNANCE_DECISIONS, type CATMATGovernanceDecision } from "../domain/catmatGovernance";
import { decideCatmat, type AvailableSuggestion } from "../services/catmatGovernanceService";
import {
  getActiveCatmatThreshold, setCatmatThresholdConfig, listCatmatDecisions, getLatestCatmatDecision,
} from "../db/catmatGovernance";
import {
  getIntelligentItem, listItemHistory, listCatmatMatches, updateMatchDecision,
  updateItemCatmat, listRecommendations, insertCatmatMatch, updateItemStatus, recordProcessEvent,
} from "../db/procurement";

/**
 * Resolve as sugestões CATMAT/CATSER REAIS de um item (persistidas ou, na ausência,
 * as determinísticas do domínio). Base para decisões supervisionadas — o código de
 * uma confirmação SEMPRE provém daqui, nunca é fabricado.
 */
async function resolveAvailableSuggestions(
  itemId: string,
  orgId: number,
  correlationId: string,
): Promise<AvailableSuggestion[]> {
  const persisted = await listCatmatMatches(itemId, orgId);
  if (persisted.length > 0) {
    return persisted.map(m => ({ id: m.id, catmatCode: m.catmatCode, catmatDescription: m.catmatDescription, score: m.score }));
  }
  const item = await getIntelligentItem(itemId, orgId);
  if (!item) return [];
  return rankCATMAT({
    itemId: item.id, organizationId: orgId, description: item.description,
    candidates: catmatCandidates(item.description), correlationId,
  }).map(m => ({ id: m.id, catmatCode: m.catmatCode, catmatDescription: m.catmatDescription, score: m.score, source: m.source }));
}

export const itemIntelligenceRouter = router({
  getItem: tenantProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      return getItemPanel(input.itemId, orgId);
    }),

  getHistory: tenantProcedure
    .input(z.object({ processId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const history = await listItemHistory(input.processId, orgId);
      return { history };
    }),

  getCATMATSuggestions: tenantProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const item = await getIntelligentItem(input.itemId, orgId);
      const persisted = await listCatmatMatches(input.itemId, orgId);
      // Se ainda não há matches persistidos (sem DB), calcula sugestões determinísticas.
      const computed = item
        ? rankCATMAT({ itemId: item.id, organizationId: orgId, description: item.description, candidates: catmatCandidates(item.description), correlationId: ctx.correlationId })
            .map(m => ({ id: m.id, catmatCode: m.catmatCode, catmatDescription: m.catmatDescription, score: m.score, rank: m.rank, decision: m.decision }))
        : [];
      return { suggestions: persisted.length > 0 ? persisted : computed };
    }),

  acceptCATMAT: tenantProcedure
    .input(z.object({ itemId: z.string().min(1), matchId: z.string().min(1), catmatCode: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const item = await getIntelligentItem(input.itemId, orgId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
      await updateMatchDecision(input.matchId, orgId, "aceito");
      await updateItemCatmat(input.itemId, orgId, input.catmatCode, item.updatedAt);
      await recordProcessEvent({ organizationId: orgId, processId: item.processId, eventType: "decision", actor: String(ctx.user.id), summary: `CATMAT ${input.catmatCode} aceito para o item.`, refId: input.itemId, correlationId: ctx.correlationId });
      return { success: true, itemId: input.itemId, catmatCode: input.catmatCode };
    }),

  rejectCATMAT: tenantProcedure
    .input(z.object({ matchId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await updateMatchDecision(input.matchId, orgId, "rejeitado");
      return { success: true, matchId: input.matchId, decision: "rejeitado" as const };
    }),

  searchCATMAT: tenantProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const matches = rankCATMAT({ itemId: "search", organizationId: orgId, description: input.query, candidates: catmatCandidates(input.query), correlationId: ctx.correlationId });
      return { results: matches.map(m => ({ catmatCode: m.catmatCode, catmatDescription: m.catmatDescription, score: m.score, rank: m.rank })) };
    }),

  manualCATMAT: tenantProcedure
    .input(z.object({ itemId: z.string().min(1), catmatCode: z.string().min(1), catmatDescription: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const item = await getIntelligentItem(input.itemId, orgId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
      const match = manualMatch({ itemId: item.id, organizationId: orgId, catmatCode: input.catmatCode, catmatDescription: input.catmatDescription ?? "Informado manualmente", correlationId: ctx.correlationId });
      await insertCatmatMatch(match);
      await updateItemCatmat(input.itemId, orgId, input.catmatCode, item.updatedAt);
      return { success: true, match };
    }),

  getRecommendations: tenantProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const recommendations = await listRecommendations(input.itemId, orgId);
      return { recommendations };
    }),

  explainRecommendation: tenantProcedure
    .input(z.object({ itemId: z.string().min(1), recommendationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const recs = await listRecommendations(input.itemId, orgId);
      const rec = recs.find(r => r.id === input.recommendationId) ?? null;
      return { recommendation: rec };
    }),

  approveItem: tenantProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const item = await getIntelligentItem(input.itemId, orgId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
      const approved = approveItemDomain(item, ctx.user.id);
      await updateItemStatus(item.id, orgId, "aprovado", ctx.user.id, approved.updatedAt);
      await recordProcessEvent({ organizationId: orgId, processId: item.processId, eventType: "approval", actor: String(ctx.user.id), summary: `Item aprovado (painel): ${item.description}.`, refId: item.id, correlationId: ctx.correlationId });
      return { success: true, itemId: item.id, status: "aprovado" as const };
    }),

  // ─── PR C.2 — CATMAT/CATSER operacional supervisionado ─────────────────────
  // Decisão HUMANA registrada em ledger imutável, idempotente, com proveniência,
  // limiar em vigor e correlationId. NUNCA fabrica código; NUNCA auto-confirma.

  /**
   * Decisão supervisionada única: confirmar | rejeitar | substituir |
   * sem_correspondencia_segura. Requer `idempotencyKey` explícito (Block A).
   */
  decidirCATMAT: tenantProcedure
    .input(z.object({
      itemId: z.string().min(1),
      decision: z.enum(CATMAT_GOVERNANCE_DECISIONS as unknown as [string, ...string[]]),
      idempotencyKey: z.string().min(8).max(64),
      suggestionId: z.string().min(1).optional(),
      catmatCode: z.string().min(1).max(50).optional(),
      catmatDescription: z.string().max(2000).optional(),
      justification: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const item = await getIntelligentItem(input.itemId, orgId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });

      const suggestions = await resolveAvailableSuggestions(input.itemId, orgId, ctx.correlationId);
      const decision = input.decision as CATMATGovernanceDecision;

      const { decision: record, replayed } = await decideCatmat({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        correlationId: ctx.correlationId,
        idempotencyKey: input.idempotencyKey,
        itemId: input.itemId,
        processId: item.processId,
        decision,
        suggestions,
        suggestionId: input.suggestionId ?? null,
        catmatCode: input.catmatCode ?? null,
        catmatDescription: input.catmatDescription ?? null,
        justification: input.justification ?? null,
      });

      // Efeitos de lineage aplicados uma única vez (nunca em replay idempotente):
      // fixa o código no item apenas em confirmar/substituir e registra a timeline.
      if (!replayed) {
        if (record.catmatCode && (decision === "confirmado" || decision === "substituido")) {
          await updateItemCatmat(input.itemId, orgId, record.catmatCode, item.updatedAt);
        }
        await recordProcessEvent({
          organizationId: orgId, processId: item.processId, eventType: "decision",
          actor: String(ctx.user.id),
          summary: `CATMAT/CATSER — decisão do servidor: ${decision}${record.catmatCode ? ` (${record.catmatCode})` : ""}.`,
          refId: input.itemId, correlationId: ctx.correlationId,
        });
      }

      return { success: true, replayed, decision: record };
    }),

  /** Histórico IMUTÁVEL de decisões CATMAT/CATSER do item (auditoria). */
  getCATMATDecisions: tenantProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const [history, current] = await Promise.all([
        listCatmatDecisions(input.itemId, orgId),
        getLatestCatmatDecision(input.itemId, orgId),
      ]);
      return { history, current };
    }),

  /**
   * Limiar institucional VIGENTE (fail-closed). `configured:false` significa que
   * nenhum valor foi definido — o sistema NÃO assume um número por conta própria.
   */
  getCATMATThreshold: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      const active = await getActiveCatmatThreshold(orgId);
      return active
        ? { configured: true as const, minScore: active.minScore, version: active.version }
        : { configured: false as const, minScore: null, version: null };
    }),

  /**
   * Define o VALOR institucional do limiar (decisão humana em runtime, papel mínimo
   * `manager`). O sistema jamais escolhe este número: ele é fornecido aqui por um
   * responsável autorizado. Versionado — a versão anterior é preservada (inativa).
   */
  setCATMATThreshold: orgRoleProcedure("manager")
    .input(z.object({
      minScore: z.number().min(0).max(1),
      reason: z.string().min(3).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const created = await setCatmatThresholdConfig({
        organizationId: orgId,
        minScore: input.minScore,
        reason: input.reason,
        actorUserId: ctx.user!.id,
        correlationId: ctx.correlationId,
      });
      return { success: true, configured: created !== null, version: created?.version ?? null, minScore: created?.minScore ?? null };
    }),
});
