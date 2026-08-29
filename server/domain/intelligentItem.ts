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

/**
 * Erro DETERMINÍSTICO de transição de estado do Item Inteligente (ex.: aprovar item já
 * aprovado, clique duplicado, estado desatualizado). É um erro de domínio ESPERADO — não
 * uma falha inesperada — e por isso deve virar um 4xx tipado no router (CONFLICT), nunca um
 * 500. Carrega os estados envolvidos para observabilidade e para uma mensagem institucional.
 */
export class ItemTransitionError extends Error {
  readonly code = "ITEM_TRANSITION_INVALID" as const;
  constructor(
    readonly from: ItemStatus,
    readonly to: ItemStatus,
    message?: string,
  ) {
    super(message ?? `Não é possível levar o item do estado "${from}" para "${to}".`);
    this.name = "ItemTransitionError";
  }
}

/** True para o erro determinístico de transição de item (mapeável a CONFLICT no router). */
export function isItemTransitionError(err: unknown): err is ItemTransitionError {
  return err instanceof ItemTransitionError;
}

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

/**
 * Estados de ORIGEM a partir dos quais `to` é uma transição válida. Usado para o
 * compare-and-set atômico no banco (UPDATE … WHERE status IN (<origens>)), garantindo
 * que apenas UMA requisição concorrente aplique a transição e registre o evento.
 */
export function itemTransitionSources(to: ItemStatus): ItemStatus[] {
  return (Object.keys(ITEM_TRANSITIONS) as ItemStatus[]).filter((from) => canTransitionItem(from, to));
}

export function approveItem(item: IntelligentProcurementItem, userId: number, at?: string): IntelligentProcurementItem {
  if (!canTransitionItem(item.status, "aprovado")) {
    throw new ItemTransitionError(item.status, "aprovado", `Não é possível aprovar um item no estado "${item.status}".`);
  }
  return { ...item, status: "aprovado", approvedBy: userId, updatedAt: at ?? new Date().toISOString() };
}

export function rejectItem(item: IntelligentProcurementItem, at?: string): IntelligentProcurementItem {
  if (!canTransitionItem(item.status, "rejeitado")) {
    throw new ItemTransitionError(item.status, "rejeitado", `Não é possível rejeitar um item no estado "${item.status}".`);
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
