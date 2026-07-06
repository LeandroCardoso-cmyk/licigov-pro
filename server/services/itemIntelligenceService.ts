/**
 * Sprint 5.1 — Item Intelligence Service (principal diferencial)
 *
 * Transforma itens da pesquisa de preços em Itens Inteligentes: sugere CATMAT
 * (ranking, nunca automático), especificações, riscos e recomendações — cada uma
 * com reasoning, explainability, provenance, confidence e possibilidade de rejeição.
 * Acesso ao Kernel (RAG/KG) exclusivamente via kernelAccessService. Graceful sem DB.
 */

import { createHash } from "crypto";
import { assertKernelAccess } from "./kernelAccessService";
import { searchKnowledgeNodes } from "../db/knowledgeGraph";
import type { PriceResearchItem } from "../domain/priceResearch";
import { averageValue } from "../domain/priceResearch";
import {
  createIntelligentItem,
  type IntelligentProcurementItem,
} from "../domain/intelligentItem";
import { rankCATMAT, suggestedAndAlternatives, type CATMATMatch } from "../domain/catmatMatching";
import {
  createItemRecommendation,
  createItemRisk,
  detectPriceOutlier,
  type ItemRecommendation,
  type ItemRisk,
} from "../domain/itemRecommendation";
import {
  insertIntelligentItem,
  insertCatmatMatch,
  insertItemRecommendation,
  insertItemRisk,
  getIntelligentItem,
  listCatmatMatches,
  listRecommendations,
  listItemRisks,
  listItemHistory,
} from "../db/procurement";

const DOMAIN = "processo_licitatorio" as const;

/**
 * Gera candidatos CATMAT determinísticos para a descrição (stub — integração real
 * é do Kernel/CATMAT Engine em sprint futura). Nunca escolhe automaticamente.
 */
export function catmatCandidates(description: string): Array<{ code: string; description: string }> {
  const base = createHash("sha256").update(description.toLowerCase().trim()).digest("hex");
  const codeFrom = (salt: string) => (parseInt(createHash("sha256").update(`${base}:${salt}`).digest("hex").slice(0, 8), 16) % 900000 + 100000).toString();
  const words = description.trim().split(/\s+/).slice(0, 4).join(" ");
  return [
    { code: codeFrom("a"), description: `${words} — especificação padrão` },
    { code: codeFrom("b"), description: `${words} — especificação alternativa` },
    { code: codeFrom("c"), description: `${words} — especificação equivalente` },
  ];
}

/** Sugere especificações mínimas/equivalentes de forma determinística. */
export function suggestSpecifications(description: string): string[] {
  return [
    `Especificação mínima: ${description} conforme padrão de mercado.`,
    `Alternativa equivalente: aceitar ${description} de qualidade e função equivalentes.`,
    `Evitar excesso de especificação que restrinja a competitividade.`,
  ];
}

export interface EnrichedItem {
  readonly item: IntelligentProcurementItem;
  readonly catmatMatches: CATMATMatch[];
  readonly recommendations: ItemRecommendation[];
  readonly risks: ItemRisk[];
}

/** Cria e enriquece um Item Inteligente a partir de itens de pesquisa. */
export async function enrichItem(params: {
  organizationId: number;
  processId: string;
  researchId: string;
  description: string;
  quantity: number;
  unit: string;
  supplierValues: Array<{ name: string; value: number }>;
  correlationId: string;
}): Promise<EnrichedItem> {
  assertKernelAccess(DOMAIN, "procurement_knowledge_graph");

  const avg = averageValue(params.supplierValues.map((s, i) => ({
    id: String(i), researchId: params.researchId, processId: params.processId,
    organizationId: params.organizationId, description: params.description, quantity: params.quantity,
    unit: params.unit, supplier: s.name, brand: "", model: "", value: s.value, observations: "", source: "", createdAt: "",
  } as PriceResearchItem)));

  // CATMAT ranking (sugerido, nunca automático)
  const matches = rankCATMAT({
    itemId: "pending", organizationId: params.organizationId, description: params.description,
    candidates: catmatCandidates(params.description), correlationId: params.correlationId,
  });
  const { suggested, alternatives } = suggestedAndAlternatives(matches);

  // Riscos: preço fora da curva
  const risks: ItemRisk[] = [];
  const outlier = detectPriceOutlier(params.supplierValues.map(s => s.value));
  if (outlier.outlier) {
    risks.push(createItemRisk({
      itemId: "pending", organizationId: params.organizationId, type: "preco_fora_da_curva",
      severity: "alto", description: "Um dos preços desvia mais de 50% da média.",
      explanation: `Média ${outlier.average.toFixed(2)}. Verifique a fonte antes de usar.`,
      correlationId: params.correlationId,
    }));
  }
  if (params.supplierValues.length < 3) {
    risks.push(createItemRisk({
      itemId: "pending", organizationId: params.organizationId, type: "baixa_competitividade",
      severity: "medio", description: "Menos de 3 fornecedores na pesquisa.",
      explanation: "Amostra pequena pode comprometer a estimativa. Recomenda-se ampliar as fontes.",
      correlationId: params.correlationId,
    }));
  }

  const specifications = suggestSpecifications(params.description);

  const item = createIntelligentItem({
    processId: params.processId, organizationId: params.organizationId, sourceResearchId: params.researchId,
    description: params.description, quantity: params.quantity, unit: params.unit, averagePrice: avg,
    suppliers: params.supplierValues, suggestedCATMAT: suggested?.catmatCode ?? null,
    alternativeCATMAT: alternatives.map(a => a.catmatCode), specifications,
    risks: risks.map(r => r.description), recommendations: [], correlationId: params.correlationId,
  });

  // Recomendações fundamentadas (reasoning/explainability/provenance/confidence/rejectable)
  const recommendations: ItemRecommendation[] = [];
  if (suggested) {
    recommendations.push(createItemRecommendation({
      itemId: item.id, organizationId: params.organizationId, type: "catmat",
      summary: `Sugestão de CATMAT ${suggested.catmatCode}.`,
      reasoning: `Maior aderência de descrição (score ${suggested.score.toFixed(2)}) entre os candidatos.`,
      explainability: "Ranking por interseção de tokens; o servidor decide aceitar/rejeitar/pesquisar/informar manual.",
      provenance: "catmat_matching", confidence: suggested.score, correlationId: params.correlationId,
    }));
  }
  recommendations.push(createItemRecommendation({
    itemId: item.id, organizationId: params.organizationId, type: "especificacao",
    summary: "Usar especificação mínima com equivalentes.",
    reasoning: "Reduz risco de direcionamento e amplia competitividade.",
    explainability: "Baseado em boas práticas da Lei 14.133/2021.",
    provenance: "kernel", confidence: 0.7, correlationId: params.correlationId,
  }));

  // Persistência (graceful)
  const finalMatches = matches.map(m => ({ ...m, itemId: item.id }));
  const finalRisks = risks.map(r => ({ ...r, itemId: item.id }));
  await insertIntelligentItem(item);
  for (const m of finalMatches) await insertCatmatMatch(m);
  for (const rec of recommendations) await insertItemRecommendation(rec);
  for (const r of finalRisks) await insertItemRisk(r);

  return { item, catmatMatches: finalMatches, recommendations, risks: finalRisks };
}

/**
 * Monta o Item Panel (os 13 blocos): pesquisa, histórico, CATMAT sugerido +
 * alternativas, especificações, riscos, recomendações (reasoning/explainability), etc.
 */
export async function getItemPanel(itemId: string, organizationId: number): Promise<{
  item: IntelligentProcurementItem | null;
  catmat: Array<{ id: string; catmatCode: string; catmatDescription: string; score: number; rank: number; decision: string }>;
  recommendations: Array<{ id: string; type: string; summary: string; reasoning: string; explainability: string; provenance: string; confidence: number; accepted: boolean | null }>;
  risks: Array<{ id: string; type: string; severity: string; description: string; explanation: string }>;
  history: Array<{ id: string; object: string; year: number; winningSupplier: string; homologatedPrice: number; catmatUsed: string; outcome: string }>;
  graphNodeIds: string[];
}> {
  const item = await getIntelligentItem(itemId, organizationId);
  const [catmat, recommendations, risks] = await Promise.all([
    listCatmatMatches(itemId, organizationId),
    listRecommendations(itemId, organizationId),
    listItemRisks(itemId, organizationId),
  ]);
  const history = item ? await listItemHistory(item.processId, organizationId) : [];
  const graphNodes = item ? await searchKnowledgeNodes(organizationId, { query: item.description, limit: 8 }) : [];
  return { item, catmat, recommendations, risks, history, graphNodeIds: graphNodes.map(n => n.id) };
}
