/**
 * Sprint 5.1 — Pesquisa de Preços (Workspace próprio, entidade viva)
 *
 * A pesquisa de preços NÃO é anexo — é um workspace que importa fontes variadas
 * (PDF/DOCX/XLSX/CSV/colar/manual), extrai itens estruturados e os persiste
 * individualmente. Cada item vira base para um Item Inteligente. Determinístico.
 */

import { createHash } from "crypto";
import { parseBRL, averageCents, centsToReais } from "./money";
import { normalizeDecimal } from "./importCorrectionFields";

export type PriceResearchSource = "pdf" | "docx" | "xlsx" | "csv" | "colar" | "manual";

export interface PriceResearchWorkspace {
  readonly id: string;
  readonly processId: string;
  readonly organizationId: number;
  readonly source: PriceResearchSource;
  readonly itemCount: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface PriceResearchItem {
  readonly id: string;
  readonly researchId: string;
  readonly processId: string;
  readonly organizationId: number;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly supplier: string;
  readonly brand: string;
  readonly model: string;
  readonly value: number;
  readonly observations: string;
  readonly source: string;
  readonly createdAt: string;
}

export function createPriceResearchWorkspace(params: {
  processId: string;
  organizationId: number;
  source: PriceResearchSource;
  itemCount?: number;
  correlationId: string;
  createdAt?: string;
}): PriceResearchWorkspace {
  const id = createHash("sha256")
    .update(`prw:${params.organizationId}:${params.processId}:${params.source}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    processId: params.processId,
    organizationId: params.organizationId,
    source: params.source,
    itemCount: params.itemCount ?? 0,
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

export function createPriceResearchItem(params: {
  researchId: string;
  processId: string;
  organizationId: number;
  description: string;
  quantity?: number;
  unit?: string;
  supplier?: string;
  brand?: string;
  model?: string;
  value?: number;
  observations?: string;
  source?: string;
  index: number;
  createdAt?: string;
}): PriceResearchItem {
  const id = createHash("sha256")
    .update(`pri:${params.organizationId}:${params.researchId}:${params.index}:${params.description.toLowerCase().trim()}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    researchId: params.researchId,
    processId: params.processId,
    organizationId: params.organizationId,
    description: params.description,
    quantity: params.quantity ?? 0,
    unit: params.unit ?? "un",
    supplier: params.supplier ?? "",
    brand: params.brand ?? "",
    model: params.model ?? "",
    value: params.value ?? 0,
    observations: params.observations ?? "",
    source: params.source ?? "",
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Extração determinística de itens a partir de texto colado/CSV simples
 * (uma linha por item: "descrição;quantidade;unidade;valor[;fornecedor]"). Base para itens.
 *
 * P0 piloto — CONTRATO MONETÁRIO: o valor usa `parseBRL` (antes "R$ 18,90" e "1.234,56" viravam 0 em
 * silêncio). Valor ambíguo/inválido fica 0 (sem preço) — nunca um número inventado. Quantidade aceita
 * decimal pt-BR ("1,5"). Valor em REAIS com 2 casas (coluna DECIMAL(14,2)).
 */
export function extractItemsFromText(
  text: string,
  ctx: { researchId: string; processId: string; organizationId: number },
): PriceResearchItem[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items: PriceResearchItem[] = [];
  lines.forEach((line, index) => {
    const parts = line.split(/[;\t]/).map(p => p.trim());
    if (parts.length === 0 || !parts[0]) return;
    const qty = parts[1] ? normalizeDecimal(parts[1]) : null;
    const cents = parts[3] ? parseBRL(parts[3]) : null;
    items.push(createPriceResearchItem({
      researchId: ctx.researchId,
      processId: ctx.processId,
      organizationId: ctx.organizationId,
      description: parts[0],
      quantity: qty !== null ? Number(qty) : 0,
      unit: parts[2] || "un",
      value: cents !== null && cents > 0 ? centsToReais(cents) : 0,
      supplier: parts[4] || "",
      source: "colar",
      index,
    }));
  });
  return items;
}

/** Preço médio (reais, 2 casas) a partir de itens de mesma descrição — calculado em centavos (half-up). */
export function averageValue(items: readonly PriceResearchItem[]): number {
  const cents = items.map(i => parseBRL(i.value)).filter((c): c is number => c !== null && c > 0);
  if (cents.length === 0) return 0;
  return centsToReais(averageCents(cents));
}
