/**
 * Sprint 5.1 — Item Intelligence Router (operational).
 *
 * Painel do Item Inteligente e decisões de CATMAT/recomendações. O servidor SEMPRE
 * decide (aceitar/rejeitar/pesquisar/manual). tenantProcedure, multi-tenant.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import { getItemPanel, catmatCandidates } from "../services/itemIntelligenceService";
import { rankCATMAT, manualMatch } from "../domain/catmatMatching";
import { approveItem as approveItemDomain } from "../domain/intelligentItem";
import {
  getIntelligentItem, listItemHistory, listCatmatMatches, updateMatchDecision,
  updateItemCatmat, listRecommendations, insertCatmatMatch, updateItemStatus, recordProcessEvent,
} from "../db/procurement";

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
});
