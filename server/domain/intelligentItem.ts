/**
 * Sprint 5.1 — Item Intelligence (principal diferencial do Business Domain)
 *
 * Cada item da pesquisa de preços torna-se um Item Inteligente: enriquecido com
 * CATMAT sugerido, especificações, riscos, recomendações e histórico — analisado,
 * padronizado, rastreado e APROVADO INDIVIDUALMENTE antes de consolidar o TR.
 *
 * O servidor SEMPRE decide (aceitar/rejeitar). Nada é escolhido automaticamente.
 */

import { createHash } from "crypto";

export type ItemStatus = "pendente" | "em_analise" | "aprovado" | "rejeitado";

export interface IntelligentItemSupplier {
  readonly name: string;
  readonly value: number;
}

export interface IntelligentProcurementItem {
  readonly id: string;
  readonly processId: string;
  readonly organizationId: number;
  readonly sourceResearchId: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly averagePrice: number;
  readonly suppliers: readonly IntelligentItemSupplier[];
  readonly suggestedCATMAT: string | null;
  readonly alternativeCATMAT: readonly string[];
  readonly specifications: readonly string[];
  readonly risks: readonly string[];
  readonly recommendations: readonly string[];
  readonly status: ItemStatus;
  readonly approvedBy: number | null;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  pendente: ["em_analise", "aprovado", "rejeitado"],
  em_analise: ["aprovado", "rejeitado", "pendente"],
  aprovado: ["em_analise"],
  rejeitado: ["em_analise"],
};

export function createIntelligentItem(params: {
  processId: string;
  organizationId: number;
  sourceResearchId: string;
  description: string;
  quantity: number;
  unit: string;
  averagePrice?: number;
  suppliers?: IntelligentItemSupplier[];
  suggestedCATMAT?: string | null;
  alternativeCATMAT?: string[];
  specifications?: string[];
  risks?: string[];
  recommendations?: string[];
  correlationId: string;
  createdAt?: string;
}): IntelligentProcurementItem {
  const id = createHash("sha256")
    .update(`iitem:${params.organizationId}:${params.processId}:${params.description.toLowerCase().trim()}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    processId: params.processId,
    organizationId: params.organizationId,
    sourceResearchId: params.sourceResearchId,
    description: params.description,
    quantity: params.quantity,
    unit: params.unit,
    averagePrice: params.averagePrice ?? 0,
    suppliers: params.suppliers ?? [],
    suggestedCATMAT: params.suggestedCATMAT ?? null,
    alternativeCATMAT: params.alternativeCATMAT ?? [],
    specifications: params.specifications ?? [],
    risks: params.risks ?? [],
    recommendations: params.recommendations ?? [],
    status: "pendente",
    approvedBy: null,
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function canTransitionItem(from: ItemStatus, to: ItemStatus): boolean {
  return ITEM_TRANSITIONS[from].includes(to);
}

export function approveItem(item: IntelligentProcurementItem, userId: number, at?: string): IntelligentProcurementItem {
  if (!canTransitionItem(item.status, "aprovado")) {
    throw new Error(`Não é possível aprovar item no estado ${item.status}`);
  }
  return { ...item, status: "aprovado", approvedBy: userId, updatedAt: at ?? new Date().toISOString() };
}

export function rejectItem(item: IntelligentProcurementItem, at?: string): IntelligentProcurementItem {
  if (!canTransitionItem(item.status, "rejeitado")) {
    throw new Error(`Não é possível rejeitar item no estado ${item.status}`);
  }
  return { ...item, status: "rejeitado", updatedAt: at ?? new Date().toISOString() };
}

/** Aplica um CATMAT escolhido pelo servidor (nunca automático). */
export function applyCATMAT(item: IntelligentProcurementItem, catmat: string, at?: string): IntelligentProcurementItem {
  return { ...item, suggestedCATMAT: catmat, updatedAt: at ?? new Date().toISOString() };
}

/** Somente itens aprovados entram na consolidação do TR. */
export function isReadyForTR(item: IntelligentProcurementItem): boolean {
  return item.status === "aprovado";
}
