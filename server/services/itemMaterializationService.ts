/**
 * P0 piloto — MATERIALIZAÇÃO CANÔNICA Pesquisa de Preços → Itens Inteligentes.
 *
 * Fecha a lacuna da promoção canônica (que só criava price_research + price_research_items). Duas fases:
 *
 *   1) BASE (determinística, TRANSACIONAL, sem IA) — `materializeIntelligentItemsTx(tx, …)`, executada na
 *      MESMA transação da promoção: consolida as cotações por chave lógica (sem fuzzy), e cria/atualiza UM
 *      Item Inteligente por item lógico (fornecedores + preço médio em centavos half-up). Regras:
 *        - item novo → criado `pendente`, enrichment `pending`;
 *        - item existente `pendente`/`em_analise` → cotações MESCLADAS por quoteId (união), média recalculada;
 *          nenhuma cotação nova → nenhuma escrita (replay-safe);
 *        - item existente `aprovado`/`rejeitado` → NÃO é alterado (decisão humana preservada); reportado.
 *   2) ENRIQUECIMENTO (pós-commit, degradável) — `enrichMaterializedItems`: sugestão CATMAT (nunca decisão),
 *      riscos e recomendações com ids determinísticos (upsert idempotente). Falha → enrichment `failed`,
 *      a pesquisa e o item base continuam válidos (nunca finge sucesso).
 *
 * Tenant-scoped em todas as leituras/escritas. Nenhuma chamada a provider dentro de transação.
 */
import { and, eq, inArray } from "drizzle-orm";
import { intelligentItemsTable, catmatDecisionsTable } from "../../drizzle/schema";
import { getDb } from "../db/connection";
import { toDbDatetime } from "../db/institutionalConsultations";
import {
  consolidateQuotes, mergeQuotes, intelligentItemIdForKey, type PriceQuote,
} from "../domain/priceQuoteConsolidation";
import { averageCents, centsToDecimalString, centsToReais, reaisToCents, type Cents } from "../domain/money";
import type { IntelligentItemSupplier } from "../domain/intelligentItem";
import { rankCATMAT, suggestedAndAlternatives } from "../domain/catmatMatching";
import { createItemRecommendation, createItemRisk, detectPriceOutlier } from "../domain/itemRecommendation";
import { insertCatmatMatch, insertItemRecommendation, insertItemRisk, type ProcurementExecutor } from "../db/procurement";
import { catmatCandidates, suggestSpecifications } from "./itemIntelligenceService";
import { serviceLogger } from "./observabilityService";
import { assertKernelAccess } from "./kernelAccessService";

const log = serviceLogger("ItemMaterializationService");
const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;

export interface MaterializationResult {
  readonly created: string[];
  readonly updated: string[];
  readonly unchanged: string[];
  /** Itens já aprovados/rejeitados por decisão humana — NÃO alterados (a nova cotação exige revisão). */
  readonly preserved: string[];
  readonly items: ReadonlyArray<{ id: string; logicalKey: string; quoteCount: number; averageCents: Cents }>;
}

function parseSuppliers(raw: string | null): IntelligentItemSupplier[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as IntelligentItemSupplier[] : []; } catch { return []; }
}

/** Cotação (domínio canônico) → entrada de fornecedor do Item Inteligente (valor em REAIS). */
function quoteToSupplier(q: PriceQuote): IntelligentItemSupplier {
  return {
    name: q.supplier.trim() || "Fornecedor não identificado",
    value: q.valueCents !== null ? centsToReais(q.valueCents) : 0,
    ...(q.brand ? { brand: q.brand } : {}),
    ...(q.model ? { model: q.model } : {}),
    ...(q.source ? { source: q.source } : {}),
    quoteId: q.quoteId,
    researchId: q.researchId,
  };
}

/** Fornecedor persistido → cotação (para merge idempotente). Entradas legadas sem quoteId ganham id estável. */
function supplierToQuote(s: IntelligentItemSupplier, idx: number, base: { description: string; quantity: number; unit: string }): PriceQuote {
  return {
    quoteId: s.quoteId ?? `legacy:${idx}:${s.name}:${s.value}`,
    researchId: s.researchId ?? "",
    description: base.description, quantity: base.quantity, unit: base.unit,
    supplier: s.name ?? "", brand: s.brand ?? "", model: s.model ?? "", source: s.source ?? "",
    valueCents: s.value > 0 ? reaisToCents(s.value) : null,
  };
}

/**
 * FASE 1 — materialização BASE dentro da transação do chamador (promoção). Determinística e replay-safe.
 */
export async function materializeIntelligentItemsTx(
  tx: ProcurementExecutor,
  params: { organizationId: number; processId: string; researchId: string; quotes: readonly PriceQuote[]; correlationId: string },
): Promise<MaterializationResult> {
  const { organizationId: org, processId } = params;
  const groups = consolidateQuotes(params.quotes);
  const created: string[] = [], updated: string[] = [], unchanged: string[] = [], preserved: string[] = [];
  const items: Array<{ id: string; logicalKey: string; quoteCount: number; averageCents: Cents }> = [];
  const now = new Date().toISOString();

  for (const g of groups) {
    const id = intelligentItemIdForKey(org, processId, g.logicalKey);
    const rows = await tx.select().from(intelligentItemsTable)
      .where(and(eq(intelligentItemsTable.id, id), eq(intelligentItemsTable.organizationId, org)))
      .for("update").limit(1);
    const existing = rows[0];

    if (!existing) {
      await tx.insert(intelligentItemsTable).values({
        id, organizationId: org, processId, sourceResearchId: params.researchId,
        description: g.description, quantity: String(g.quantity), unit: g.unit,
        averagePrice: centsToDecimalString(g.averageCents),
        suppliers: JSON.stringify(g.quotes.map(quoteToSupplier)),
        suggestedCatmat: null, alternativeCatmat: "[]", specifications: "[]", risks: "[]", recommendations: "[]",
        status: "pendente", approvedBy: null, enrichmentStatus: "pending", correlationId: params.correlationId,
        createdAt: toDb(now), updatedAt: toDb(now),
      });
      created.push(id);
      items.push({ id, logicalKey: g.logicalKey, quoteCount: g.quotes.length, averageCents: g.averageCents });
      continue;
    }

    if (existing.status === "aprovado" || existing.status === "rejeitado") {
      // Decisão humana preservada: números de item aprovado/rejeitado NUNCA mudam por nova importação.
      preserved.push(id);
      const current = parseSuppliers(existing.suppliers);
      items.push({ id, logicalKey: g.logicalKey, quoteCount: current.length, averageCents: reaisToCents(existing.averagePrice) });
      continue;
    }

    const base = { description: existing.description ?? g.description, quantity: Number(existing.quantity), unit: existing.unit };
    const currentQuotes = parseSuppliers(existing.suppliers).map((s, i) => supplierToQuote(s, i, base));
    const merged = mergeQuotes(currentQuotes, g.quotes);
    const noNew = merged.length === currentQuotes.length && merged.every((q) => currentQuotes.some((c) => c.quoteId === q.quoteId));
    const avg = averageCents(merged.map((q) => q.valueCents).filter((v): v is Cents => v !== null && v > 0));
    if (noNew) {
      unchanged.push(id);
      items.push({ id, logicalKey: g.logicalKey, quoteCount: merged.length, averageCents: avg });
      continue;
    }
    await tx.update(intelligentItemsTable).set({
      suppliers: JSON.stringify(merged.map(quoteToSupplier)),
      averagePrice: centsToDecimalString(avg),
      enrichmentStatus: "pending",
      updatedAt: toDb(now),
    }).where(and(eq(intelligentItemsTable.id, id), eq(intelligentItemsTable.organizationId, org)));
    updated.push(id);
    items.push({ id, logicalKey: g.logicalKey, quoteCount: merged.length, averageCents: avg });
  }
  return { created, updated, unchanged, preserved, items };
}

/**
 * FASE 2 — enriquecimento PÓS-COMMIT, degradável e idempotente (ids determinísticos + upsert). Nunca lança:
 * falha marca `enrichment_status = failed` e é observável; o item base permanece válido.
 */
export async function enrichMaterializedItems(params: {
  organizationId: number; processId: string; itemIds: readonly string[]; correlationId: string;
}): Promise<{ enriched: number; failed: number }> {
  const db = await getDb();
  if (!db || params.itemIds.length === 0) return { enriched: 0, failed: 0 };
  let enriched = 0, failed = 0;
  const rows = await db.select().from(intelligentItemsTable)
    .where(and(eq(intelligentItemsTable.organizationId, params.organizationId), inArray(intelligentItemsTable.id, [...params.itemIds])));
  for (const it of rows) {
    try {
      // Mesmo gate de acesso ao Kernel do enriquecimento legado (sem chamada a provider).
      assertKernelAccess("processo_licitatorio", "procurement_knowledge_graph");
      const description = it.description ?? "";
      const suppliers = parseSuppliers(it.suppliers);
      const matches = rankCATMAT({
        itemId: it.id, organizationId: params.organizationId, description,
        candidates: catmatCandidates(description), correlationId: params.correlationId,
      });
      const { suggested, alternatives } = suggestedAndAlternatives(matches);
      const values = suppliers.map((s) => s.value).filter((v) => v > 0);
      const risks = [];
      const outlier = detectPriceOutlier(values);
      if (outlier.outlier) {
        risks.push(createItemRisk({
          itemId: it.id, organizationId: params.organizationId, type: "preco_fora_da_curva", severity: "alto",
          description: "Um dos preços desvia mais de 50% da média.",
          explanation: "Verifique a fonte da cotação divergente antes de usar a média.", correlationId: params.correlationId,
        }));
      }
      if (suppliers.length < 3) {
        risks.push(createItemRisk({
          itemId: it.id, organizationId: params.organizationId, type: "baixa_competitividade", severity: "medio",
          description: "Menos de 3 fornecedores na pesquisa.",
          explanation: "Amostra pequena pode comprometer a estimativa. Recomenda-se ampliar as fontes.", correlationId: params.correlationId,
        }));
      }
      const recs = [];
      if (suggested) {
        recs.push(createItemRecommendation({
          itemId: it.id, organizationId: params.organizationId, type: "catmat",
          summary: `Sugestão de CATMAT ${suggested.catmatCode}.`,
          reasoning: `Maior aderência de descrição (score ${suggested.score.toFixed(2)}) entre os candidatos.`,
          explainability: "Ranking por interseção de tokens; SUGESTÃO — o servidor decide (confirmar/rejeitar/substituir).",
          provenance: "catmat_matching", confidence: suggested.score, correlationId: params.correlationId,
        }));
      }
      for (const m of matches) await insertCatmatMatch(m);
      for (const r of risks) await insertItemRisk(r);
      for (const rec of recs) await insertItemRecommendation(rec);

      // Sugestão NUNCA sobrescreve classificação já decidida por humano (ledger) nem um valor já presente.
      const decided = await db.select({ id: catmatDecisionsTable.id }).from(catmatDecisionsTable)
        .where(and(eq(catmatDecisionsTable.organizationId, params.organizationId), eq(catmatDecisionsTable.itemId, it.id))).limit(1);
      await db.update(intelligentItemsTable).set({
        ...(decided.length === 0 && !it.suggestedCatmat ? { suggestedCatmat: suggested?.catmatCode ?? null } : {}),
        alternativeCatmat: JSON.stringify(alternatives.map((a) => a.catmatCode)),
        specifications: JSON.stringify(suggestSpecifications(description)),
        risks: JSON.stringify(risks.map((r) => r.description)),
        enrichmentStatus: "done",
      }).where(and(eq(intelligentItemsTable.id, it.id), eq(intelligentItemsTable.organizationId, params.organizationId)));
      enriched++;
    } catch (err) {
      failed++;
      log.warn("item_enrichment_failed", {
        organizationId: params.organizationId, processId: params.processId, itemId: it.id,
        correlationId: params.correlationId, error: err instanceof Error ? err.message : String(err),
      });
      await db.update(intelligentItemsTable).set({ enrichmentStatus: "failed" })
        .where(and(eq(intelligentItemsTable.id, it.id), eq(intelligentItemsTable.organizationId, params.organizationId)))
        .catch(() => {});
    }
  }
  return { enriched, failed };
}

/**
 * Materializa (transação própria) + enriquece (pós-commit). Usado pelo caminho de inserção MANUAL/colar
 * (legado) para que ele convirja no MESMO modelo canônico (mesma chave lógica, sem reset de aprovados).
 */
export async function materializeAndEnrich(params: {
  organizationId: number; processId: string; researchId: string; quotes: readonly PriceQuote[]; correlationId: string;
}): Promise<MaterializationResult> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível — materialização não persistida (fail-closed).");
  const result = await db.transaction((tx) => materializeIntelligentItemsTx(tx, params));
  await enrichMaterializedItems({
    organizationId: params.organizationId, processId: params.processId,
    itemIds: [...result.created, ...result.updated], correlationId: params.correlationId,
  });
  return result;
}
