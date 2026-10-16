/**
 * Sprint 5.1 — Item Intelligence Router (operational).
 *
 * Painel do Item Inteligente e decisões de CATMAT/recomendações. O servidor SEMPRE
 * decide (aceitar/rejeitar/pesquisar/manual). Multi-tenant: leituras em tenantProcedure;
 * mutações que decidem sobre o item exigem papel mínimo `operator` (SEM-026 — paridade RBAC
 * com a aprovação canônica `procurementProcess.approveItem`).
 */
import { z } from "zod";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { throwLegacyEndpointDisabled } from "../services/legacyEndpointGuard";
import { router, tenantProcedure, orgRoleProcedure } from "../_core/trpc";
import { getItemPanel } from "../services/itemIntelligenceService";
import { listVerifiedSuggestions, searchItemClassification } from "../services/itemCatalogClassificationService";
import { searchOfficialCatalog, UNAVAILABLE_MESSAGES } from "../services/officialCatalogService";
import { rateLimitMiddleware } from "../services/rateLimiter";
import { CATMAT_GOVERNANCE_DECISIONS, type CATMATGovernanceDecision } from "../domain/catmatGovernance";
import { decideCatmat, type AvailableSuggestion } from "../services/catmatGovernanceService";
import {
  getActiveCatmatThreshold, setCatmatThresholdConfig, listCatmatDecisions, getLatestCatmatDecision, summarizeCatmatThresholdImpact,
} from "../db/catmatGovernance";
import {
  getIntelligentItem, listItemHistory, updateMatchDecision,
  updateItemCatmat, listRecommendations, recordProcessEvent,
} from "../db/procurement";

/**
 * Sugestões PERSISTIDAS do item, cada uma com o estado de verificação contra a evidência oficial do órgão
 * (catálogo CATMAT/CATSER). Sem sugestão persistida ⇒ lista vazia: nenhum candidato é gerado localmente.
 * Base das decisões supervisionadas — confirmar exige sugestão VERIFICADA (o serviço recusa as demais).
 */
async function resolveAvailableSuggestions(itemId: string, orgId: number): Promise<AvailableSuggestion[]> {
  return (await listVerifiedSuggestions(itemId, orgId)).map((s) => ({
    id: s.id, catmatCode: s.catmatCode, catmatDescription: s.catmatDescription, score: s.score, source: s.source, verified: s.verified,
  }));
}

type CatmatCtx = { organizationId?: number | null; user?: { id: number } | null; correlationId: string };

/** Chave determinística (sha256) para wrappers legados sem chave explícita — mesma ação ⇒ replay, nunca nova decisão. */
function derivedCatmatKey(kind: string, itemId: string, discriminator: string): string {
  return `catmat-${kind}-${createHash("sha256").update(`${itemId}|${discriminator}`).digest("hex").slice(0, 40)}`;
}

/**
 * R9 / SEM-035 — caminho ÚNICO de decisão CATMAT/CATSER (ledger `catmat_decisions`): sugestão real para confirmar,
 * código explícito + justificativa para substituir; efeitos de lineage (código no item + timeline) só fora de replay.
 * A IA nunca escreve código definitivo: só a decisão humana registrada aqui.
 */
async function governedCatmatDecision(ctx: CatmatCtx, p: {
  itemId: string; decision: CATMATGovernanceDecision; idempotencyKey: string;
  suggestionId?: string | null; catmatCode?: string | null; catmatDescription?: string | null; justification?: string | null;
  /** acceptCATMAT: o código que o cliente acredita confirmar — precisa ser o da sugestão. */
  expectedCode?: string;
}) {
  const orgId = ctx.organizationId!;
  const item = await getIntelligentItem(p.itemId, orgId);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
  const suggestions = await resolveAvailableSuggestions(p.itemId, orgId);
  if (p.expectedCode !== undefined) {
    const s = suggestions.find((x) => x.id === p.suggestionId);
    if (!s) throw new TRPCError({ code: "BAD_REQUEST", message: "Sugestão CATMAT inexistente para este item; nada foi gravado (CATMAT_SUGGESTION_NOT_FOUND)." });
    if (s.catmatCode !== p.expectedCode.trim()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "O código informado não é o da sugestão escolhida; nada foi gravado (CATMAT_CODE_MISMATCH)." });
    }
  }
  const { decision: record, replayed } = await decideCatmat({
    organizationId: orgId, actorUserId: ctx.user!.id, correlationId: ctx.correlationId, idempotencyKey: p.idempotencyKey,
    itemId: p.itemId, processId: item.processId, decision: p.decision, suggestions,
    suggestionId: p.suggestionId ?? null, catmatCode: p.catmatCode ?? null,
    catmatDescription: p.catmatDescription ?? null, justification: p.justification ?? null,
  });
  if (!replayed) {
    if (record.catmatCode && (p.decision === "confirmado" || p.decision === "substituido")) {
      await updateItemCatmat(p.itemId, orgId, record.catmatCode, item.updatedAt);
    }
    await recordProcessEvent({
      organizationId: orgId, processId: item.processId, eventType: "decision", actor: String(ctx.user!.id),
      summary: `CATMAT/CATSER — decisão do servidor: ${p.decision}${record.catmatCode ? ` (${record.catmatCode})` : ""}${record.source ? ` · fonte ${record.source}` : ""}.`,
      refId: p.itemId, correlationId: ctx.correlationId,
    });
  }
  return { record, replayed };
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

  /** Sugestões persistidas do item, com verificação contra a evidência oficial (nenhuma é gerada localmente). */
  getCATMATSuggestions: tenantProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      return { suggestions: await listVerifiedSuggestions(input.itemId, orgId) };
    }),

  /**
   * "Buscar classificação": consulta o catálogo OFICIAL (CATMAT = material, CATSER = serviço — indicado pelo servidor),
   * registra a evidência e persiste as alternativas reais do item. Não decide nada. Indisponível ⇒ `status: "unavailable"`,
   * nada gravado, classificação pendente (nunca código substituto).
   */
  buscarClassificacaoOficial: orgRoleProcedure("operator").use(rateLimitMiddleware("catmat"))
    .input(z.object({
      itemId: z.string().min(1),
      catalogType: z.enum(["catmat", "catser"]),
      term: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => searchItemClassification({
      organizationId: ctx.organizationId!, itemId: input.itemId, catalogType: input.catalogType, term: input.term ?? null,
      actorUserId: ctx.user!.id, correlationId: ctx.correlationId,
    })),

  /**
   * R9 / SEM-035 — confirmação de uma SUGESTÃO existente pelo LEDGER governado (`catmat_decisions`), nunca código livre
   * do cliente: `matchId` é a sugestão decidida; `catmatCode` (compatibilidade) precisa ser o código DELA, senão
   * BAD_REQUEST `CATMAT_CODE_MISMATCH` sem escrita. Chave de idempotência explícita ou derivada da sugestão.
   */
  acceptCATMAT: orgRoleProcedure("operator")
    .input(z.object({ itemId: z.string().min(1), matchId: z.string().min(1), catmatCode: z.string().min(1), idempotencyKey: z.string().min(8).max(64).optional() }))
    .mutation(async ({ input, ctx }) => {
      const { record } = await governedCatmatDecision(ctx, {
        itemId: input.itemId, decision: "confirmado", suggestionId: input.matchId, expectedCode: input.catmatCode,
        idempotencyKey: input.idempotencyKey ?? derivedCatmatKey("accept", input.itemId, input.matchId),
      });
      return { success: true, itemId: input.itemId, catmatCode: record.catmatCode ?? input.catmatCode };
    }),

  rejectCATMAT: orgRoleProcedure("operator")
    .input(z.object({ matchId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await updateMatchDecision(input.matchId, orgId, "rejeitado");
      return { success: true, matchId: input.matchId, decision: "rejeitado" as const };
    }),

  /** Consulta livre ao catálogo OFICIAL (somente leitura, sem persistir). Indisponível ⇒ lista vazia + motivo. */
  searchCATMAT: tenantProcedure.use(rateLimitMiddleware("catmat"))
    .input(z.object({ query: z.string().min(2).max(200), catalogType: z.enum(["catmat", "catser"]).default("catmat") }))
    .query(async ({ input }) => {
      const res = await searchOfficialCatalog({ catalogType: input.catalogType, term: input.query });
      if (res.status === "unavailable") return { status: "unavailable" as const, message: UNAVAILABLE_MESSAGES[res.reason], results: [] };
      return {
        status: "ok" as const, message: null, retrievedAt: res.retrievedAt,
        results: res.entries.filter((e) => e.active === true)
          .map((e) => ({ catmatCode: e.code, catmatDescription: e.description, catalogType: e.catalogType, source: "api-comprasgov" })),
      };
    }),

  /**
   * R9 / SEM-035 — código informado à mão = decisão `substituido` no LEDGER (`catmat_decisions`), com justificativa
   * obrigatória, ator, origem e correlationId — nunca um match solto fora do ledger.
   */
  manualCATMAT: orgRoleProcedure("operator")
    .input(z.object({
      itemId: z.string().min(1), catmatCode: z.string().min(1).max(50), catmatDescription: z.string().max(2000).optional(),
      justification: z.string().max(2000).optional(), idempotencyKey: z.string().min(8).max(64).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { record } = await governedCatmatDecision(ctx, {
        itemId: input.itemId, decision: "substituido", catmatCode: input.catmatCode, catmatDescription: input.catmatDescription ?? null,
        justification: input.justification ?? null,
        idempotencyKey: input.idempotencyKey ?? derivedCatmatKey("manual", input.itemId, `${input.catmatCode}|${input.justification ?? ""}`),
      });
      return { success: true, decision: record };
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

  /**
   * SEM-026 — rota DUPLICADA retirada (desligamento governado). Era `tenantProcedure` (viewer aprovava item e
   * tornava a média o preço de referência canônico) e não tem caller de UI: a aprovação canônica é
   * `procurementProcess.approveItem` (`orgRoleProcedure("operator")`, mesma transição CAS). A procedure segue
   * registrada com o MESMO input; toda chamada é recusada antes de qualquer leitura/escrita/evento.
   */
  approveItem: tenantProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .mutation(async ({ ctx }): Promise<{ success: true; itemId: string; status: "aprovado" }> => {
      throwLegacyEndpointDisabled(
        "itemIntelligence.approveItem", "SEM-026", ctx,
        "a aprovação canônica do item (procurementProcess.approveItem, papel mínimo operator)",
      );
    }),

  // ─── PR C.2 — CATMAT/CATSER operacional supervisionado ─────────────────────
  // Decisão HUMANA registrada em ledger imutável, idempotente, com proveniência,
  // limiar em vigor e correlationId. NUNCA fabrica código; NUNCA auto-confirma.

  /**
   * Decisão supervisionada única: confirmar | rejeitar | substituir |
   * sem_correspondencia_segura. Requer `idempotencyKey` explícito (Block A).
   * SEM-026 — papel mínimo `operator` (paridade com `procurementProcess.approveItem` e com
   * `acceptCATMAT`/`rejectCATMAT`/`manualCATMAT`): viewer é recusado antes de qualquer leitura/escrita.
   */
  decidirCATMAT: orgRoleProcedure("operator")
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
      const { record, replayed } = await governedCatmatDecision(ctx, {
        itemId: input.itemId, decision: input.decision as CATMATGovernanceDecision, idempotencyKey: input.idempotencyKey,
        suggestionId: input.suggestionId ?? null, catmatCode: input.catmatCode ?? null,
        catmatDescription: input.catmatDescription ?? null, justification: input.justification ?? null,
      });
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
   * SEM-061 — prévia do IMPACTO ORG-WIDE de trocar o limiar (somente leitura, manager+ como a própria troca). Devolve o
   * limiar vigente, o proposto e a contagem das decisões vigentes do órgão; NÃO escolhe nem sugere valor.
   */
  previewCATMATThresholdChange: orgRoleProcedure("manager")
    .input(z.object({ minScore: z.number().min(0).max(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const [active, impact] = await Promise.all([
        getActiveCatmatThreshold(orgId), summarizeCatmatThresholdImpact(orgId, input.minScore),
      ]);
      return {
        current: active ? { minScore: active.minScore, version: active.version } : null,
        proposedMinScore: input.minScore,
        impact,
      };
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
