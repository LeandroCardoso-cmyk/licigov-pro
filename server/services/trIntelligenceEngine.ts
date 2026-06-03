/**
 * Sprint 3.0 — TR Intelligence Engine.
 *
 * Composição inteligente de Termos de Referência a partir de ItemTR aprovados.
 * Compõe seções, agrupa itens, recomenda cláusulas (delegando a clauseIntelligence),
 * injeta cláusulas legais e produz um racional de composição explicável.
 *
 * PRINCÍPIOS:
 *   - Composição determinística e replay-safe: mesmos itens/contexto → mesmo output.
 *   - replayKey = sha256(JSON.stringify de inputs ordenados).
 *   - Fallback-safe: entrada vazia produz resultado coerente (sem throw).
 *   - Proveniência preservada; cláusulas explicáveis.
 *
 * Reusa trComposition (estrutura) e clauseIntelligence (recomendação).
 *
 * Embasamento: planejamento da contratação e elaboração do TR
 * (Lei 14.133/2021, arts. 6º, XXIII e 18).
 */

import { nanoid } from "nanoid";
import { createHash } from "crypto";

import {
  createClause,
  createSection,
  substituteTemplate,
  type TRSection,
  type TRClause,
} from "../domain/trComposition";
import {
  recommendClauses,
  inferProcurementType,
  type ClauseRecommendation,
  type ClauseRecommendationContext,
  type ClauseItemInput,
  type ProcurementType,
} from "../domain/clauseIntelligence";
import type { ItemTR } from "../domain/itemTR";

// ─── Input / Output ───────────────────────────────────────────────────────────

export interface TRProcessContext {
  processNumber?:  string;
  modality?:       string;
  objectSummary?:  string;
  [key: string]:   unknown;
}

export interface TRIntelligenceInput {
  items:          ItemTR[];           // itens aprovados
  processContext: TRProcessContext;
  organizationId: number;
}

export interface ItemGroup {
  key:             string;            // chave de agrupamento (ex: catmat group)
  procurementType: ProcurementType;
  itemIds:         string[];
  totalQuantity:   number;
  totalValue:      number;
}

export interface TRIntelligenceResult {
  composedSections:    TRSection[];
  recommendedClauses:  ClauseRecommendation[];
  itemGroups:          ItemGroup[];
  compositionRationale: string;
  replayKey:           string;
  correlationId:       string;
  organizationId:      number;
}

// ─── replayKey ────────────────────────────────────────────────────────────────

export function computeCompositionReplayKey(input: TRIntelligenceInput): string {
  const sortedItems = [...input.items]
    .map(i => ({
      id:            i.id,
      itemNumber:    i.itemNumber,
      normalizedDescription: i.normalizedDescription,
      canonicalUnit: i.canonicalUnit,
      quantity:      i.quantity,
      estimatedUnitPrice: i.estimatedUnitPrice,
      catmatCode:    i.catmatCode,
      catserCode:    i.catserCode,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const ctxKeys = Object.keys(input.processContext).sort();
  const sortedCtx: Record<string, unknown> = {};
  for (const k of ctxKeys) sortedCtx[k] = input.processContext[k];
  return createHash("sha256")
    .update(JSON.stringify({ organizationId: input.organizationId, items: sortedItems, context: sortedCtx }), "utf8")
    .digest("hex");
}

// ─── Item grouping ────────────────────────────────────────────────────────────

/**
 * Agrupa itens por (procurementType + grupo de catálogo). Determinístico.
 */
export function groupItems(items: ItemTR[]): ItemGroup[] {
  const groups = new Map<string, ItemGroup>();
  const ordered = [...items].sort((a, b) => a.itemNumber - b.itemNumber || a.id.localeCompare(b.id));

  for (const item of ordered) {
    const ptype = inferProcurementType(toClauseInput(item));
    const groupLabel = (item.metadata["catalogGroup"] as string | undefined)
      ?? (item.catserCode ? "servicos" : item.catmatCode ? "materiais" : "diversos");
    const key = `${ptype}:${groupLabel}`;
    const existing = groups.get(key);
    const value = item.estimatedTotalPrice ?? 0;
    if (existing) {
      existing.itemIds.push(item.id);
      existing.totalQuantity += item.quantity;
      existing.totalValue = round2(existing.totalValue + value);
    } else {
      groups.set(key, {
        key,
        procurementType: ptype,
        itemIds:         [item.id],
        totalQuantity:   item.quantity,
        totalValue:      round2(value),
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key));
}

// ─── Quantity composition ─────────────────────────────────────────────────────

export interface QuantityComposition {
  totalItems:     number;
  totalQuantity:  number;
  totalValue:     number;
  byUnit:         Record<string, number>;
}

export function composeQuantities(items: ItemTR[]): QuantityComposition {
  const byUnit: Record<string, number> = {};
  let totalQuantity = 0;
  let totalValue = 0;
  for (const item of items) {
    const unit = item.canonicalUnit ?? item.unit ?? "UN";
    byUnit[unit] = (byUnit[unit] ?? 0) + item.quantity;
    totalQuantity += item.quantity;
    totalValue += item.estimatedTotalPrice ?? 0;
  }
  return {
    totalItems:    items.length,
    totalQuantity,
    totalValue:    round2(totalValue),
    byUnit,
  };
}

// ─── Item section composition ─────────────────────────────────────────────────

/**
 * Compõe a seção de itens do TR (lista de objetos). Determinística.
 */
export function composeItemSection(items: ItemTR[], order = 2): TRSection {
  const ordered = [...items].sort((a, b) => a.itemNumber - b.itemNumber || a.id.localeCompare(b.id));
  const clauses: TRClause[] = ordered.map(item => {
    const price = item.estimatedTotalPrice != null
      ? `R$ ${item.estimatedTotalPrice.toFixed(2)}`
      : "a definir";
    const content =
      `Item ${item.itemNumber}: ${item.normalizedDescription} — ` +
      `quantidade ${item.quantity} ${item.canonicalUnit ?? item.unit}` +
      (item.catmatCode ? ` (CATMAT ${item.catmatCode})` : "") +
      (item.catserCode ? ` (CATSER ${item.catserCode})` : "") +
      `. Valor estimado total: ${price}.`;
    return createClause("item_list", content, {
      clauseProvenance: item.provenance,
      isRequired:       true,
    });
  });

  return createSection(
    "Especificação dos Itens / Objeto",
    clauses.length > 0
      ? clauses
      : [createClause("item_list", "Nenhum item aprovado para composição.", { isRequired: false })],
    order,
  );
}

// ─── Specification enrichment ─────────────────────────────────────────────────

/**
 * Enriquece a especificação de um item com detalhes e unidade canônica.
 */
export function enrichSpecification(item: ItemTR): string {
  const parts: string[] = [item.normalizedDescription];
  if (item.detailedSpecification) parts.push(item.detailedSpecification);
  if (item.canonicalUnit) parts.push(`Unidade de fornecimento: ${item.canonicalUnit}.`);
  if (item.catmatCode) parts.push(`Código CATMAT de referência: ${item.catmatCode}.`);
  if (item.catserCode) parts.push(`Código CATSER de referência: ${item.catserCode}.`);
  return parts.join(" ");
}

// ─── Clause recommendation ────────────────────────────────────────────────────

/**
 * Recomenda cláusulas para o conjunto de itens, delegando a clauseIntelligence.
 * Deduplica por templateId mantendo a de maior prioridade/relevância. Determinístico.
 */
export function runRecommendationEngine(
  items:   ItemTR[],
  context: ClauseRecommendationContext,
): ClauseRecommendation[] {
  const byTemplate = new Map<string, ClauseRecommendation>();
  const ordered = [...items].sort((a, b) => a.itemNumber - b.itemNumber || a.id.localeCompare(b.id));
  for (const item of ordered) {
    const recs = recommendClauses(toClauseInput(item), context);
    for (const rec of recs) {
      const existing = byTemplate.get(rec.templateId);
      if (!existing || rec.relevanceScore > existing.relevanceScore) {
        byTemplate.set(rec.templateId, rec);
      }
    }
  }
  return Array.from(byTemplate.values()).sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (Math.abs(b.relevanceScore - a.relevanceScore) > 1e-9) return b.relevanceScore - a.relevanceScore;
    return a.id.localeCompare(b.id);
  });
}

// ─── Legal clause injection ───────────────────────────────────────────────────

/**
 * Injeta cláusulas legais base (Lei 14.133/2021) na seção de base legal.
 */
export function injectLegalClauses(processContext: TRProcessContext, order = 1): TRSection {
  const modality = processContext.modality ?? "pregão";
  const legalClause = createClause(
    "legal_basis",
    substituteTemplate(
      `O presente Termo de Referência observa a Lei nº 14.133/2021 e seus princípios ` +
      `(art. 5º), sendo a contratação processada na modalidade {{modality}}.`,
      { modality },
    ),
    { legalBasis: "Lei 14.133/2021, art. 5º e art. 6º", isRequired: true },
  );
  return createSection("Fundamentação Legal", [legalClause], order);
}

// ─── Section orchestration ────────────────────────────────────────────────────

/**
 * Orquestra todas as seções do TR em ordem. Determinístico.
 */
export function orchestrateSections(
  items:          ItemTR[],
  processContext: TRProcessContext,
): TRSection[] {
  const legal = injectLegalClauses(processContext, 1);
  const itemsSection = composeItemSection(items, 2);
  return [legal, itemsSection].sort((a, b) => a.order - b.order);
}

/**
 * Vincula cláusulas semânticas adicionais a partir dos grupos de itens (stub
 * determinístico — retorna grupos com tipo de contratação inferido).
 */
export function linkSemanticClauses(items: ItemTR[]): ItemGroup[] {
  return groupItems(items);
}

// ─── Main composition ─────────────────────────────────────────────────────────

/**
 * Compõe o TR a partir de itens aprovados e contexto. Fallback-safe.
 */
export function composeTR(
  input:          TRIntelligenceInput,
  clauseContext?: ClauseRecommendationContext,
): TRIntelligenceResult {
  const correlationId = nanoid();
  const replayKey = computeCompositionReplayKey(input);

  const items = input.items;
  const itemGroups = groupItems(items);
  const composedSections = orchestrateSections(items, input.processContext);

  // Determine dominant procurement type for default clause context.
  const dominantType: ProcurementType = itemGroups.length > 0
    ? [...itemGroups].sort((a, b) => b.totalValue - a.totalValue || a.key.localeCompare(b.key))[0].procurementType
    : "generico";

  const effectiveClauseContext: ClauseRecommendationContext = clauseContext ?? {
    procurementType:    dominantType,
    templates:          [],
    compositionContext: input.processContext,
  };

  const recommendedClauses = items.length > 0
    ? runRecommendationEngine(items, effectiveClauseContext)
    : [];

  const quantities = composeQuantities(items);
  const compositionRationale =
    items.length === 0
      ? `Composição vazia: nenhum item aprovado fornecido. TR gerado apenas com fundamentação legal base.`
      : `TR composto a partir de ${items.length} item(ns) aprovado(s), ` +
        `agrupados em ${itemGroups.length} grupo(s); tipo dominante "${dominantType}". ` +
        `Quantidade total ${quantities.totalQuantity}, valor estimado total R$ ${quantities.totalValue.toFixed(2)}. ` +
        `${recommendedClauses.length} cláusula(s) recomendada(s); ` +
        `${composedSections.length} seção(ões) compostas.`;

  return {
    composedSections,
    recommendedClauses,
    itemGroups,
    compositionRationale,
    replayKey,
    correlationId,
    organizationId: input.organizationId,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toClauseInput(item: ItemTR): ClauseItemInput {
  return {
    id:                    item.id,
    normalizedDescription: item.normalizedDescription,
    canonicalUnit:         item.canonicalUnit,
    catmatCode:            item.catmatCode,
    catserCode:            item.catserCode,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
