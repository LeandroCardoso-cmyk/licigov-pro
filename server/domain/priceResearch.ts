/**
 * Sprint 5.1 — Pesquisa de Preços (Workspace próprio, entidade viva)
 *
 * A pesquisa de preços NÃO é anexo — é um workspace que importa fontes variadas
 * (PDF/DOCX/XLSX/CSV/colar/manual), extrai itens estruturados e os persiste
 * individualmente. Cada item vira base para um Item Inteligente. Determinístico.
 */

import { createHash } from "crypto";
import { parseBRL, averageCents, centsToReais } from "./money";
import { parsePriceResearchText, type PriceResearchParse } from "./priceResearchParser";
import type { QuoteProvenanceKind } from "./quoteProvenance";

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
  /** M8 — proveniência estruturada (`server/domain/quoteProvenance.ts`). Novas cotações: `ficticia` | `declarada`. */
  readonly provenanceKind: QuoteProvenanceKind;
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
  /** Default `declarada` (informada/importada, sem verificação). Nunca `verificada` por inferência. */
  provenanceKind?: QuoteProvenanceKind;
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
    provenanceKind: params.provenanceKind ?? "declarada",
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}


/**
 * Nota legível gravada nas observações da cotação FICTÍCIA. A fonte da verdade é a coluna `provenance_kind`; o texto
 * só serve de leitura humana e de fallback LEGADO (linhas anteriores à 0319 ⇒ estado "suspeita", nunca bloqueio).
 */
export const FICTITIOUS_QUOTE_MARKER = "Fonte fictícia/sintética — não constitui cotação válida para fins oficiais";

/**
 * Extração determinística das COTAÇÕES (uma `PriceResearchItem` por cotação, agrupáveis pelo item) a partir de
 * texto colado/CSV/extraído. M8-PRICE-IMPORT-001: a leitura é ESTRUTURADA (`parsePriceResearchText`) — cabeçalho,
 * metadados, quantidade, unidade, fornecedor e avisos nunca viram itens; o formato delimitado legado
 * ("descrição;quantidade;unidade;valor[;fornecedor]") continua aceito com a mesma identidade por linha.
 *
 * P0 piloto — CONTRATO MONETÁRIO: o valor usa `parseBRL`. Valor ambíguo/inválido fica 0 (sem preço) — nunca um
 * número inventado; quantidade não informada fica 0 (= "não informada" na consolidação, R10/SEM-090).
 * Valor em REAIS com 2 casas (coluna DECIMAL(14,2)).
 */
export function extractItemsFromText(
  text: string,
  ctx: { researchId: string; processId: string; organizationId: number },
  parsed: PriceResearchParse = parsePriceResearchText(text),
): PriceResearchItem[] {
  const items: PriceResearchItem[] = [];
  for (const it of parsed.items) {
    for (const q of it.quotes) {
      // O marcador de fonte fictícia vem PRIMEIRO: o corte de 1.000 caracteres nunca o remove (M8 hardening).
      const observations = [
        q.fictitious && FICTITIOUS_QUOTE_MARKER,
        it.specification && `Especificação: ${it.specification}`,
        q.date && `Data: ${q.date}`,
        q.notes,
      ].filter(Boolean).join(" | ");
      items.push(createPriceResearchItem({
        researchId: ctx.researchId,
        processId: ctx.processId,
        organizationId: ctx.organizationId,
        description: it.description,
        quantity: it.quantity ?? 0,
        unit: it.unit,
        value: q.valueCents !== null ? centsToReais(q.valueCents) : 0,
        supplier: q.supplier,
        observations: observations.slice(0, 1000),
        source: "colar",
        provenanceKind: q.fictitious ? "ficticia" : "declarada",
        index: q.index,
      }));
    }
  }
  return items;
}

/** Preço médio (reais, 2 casas) a partir de itens de mesma descrição — calculado em centavos (half-up). */
export function averageValue(items: readonly PriceResearchItem[]): number {
  const cents = items.map(i => parseBRL(i.value)).filter((c): c is number => c !== null && c > 0);
  if (cents.length === 0) return 0;
  return centsToReais(averageCents(cents));
}

/**
 * PR-04 (SEM-005) — cotação JÁ REGISTRADA que uma nova importação pelo caminho legado (colar/manual) substituiria.
 * A identidade da cotação legada é (pesquisa por fonte, linha, descrição): uma 2ª colagem com o mesmo item na mesma
 * linha ATUALIZA a cotação anterior (correção por reimportação). Substituir conteúdo só com confirmação explícita;
 * reimportação idêntica continua convergindo sem pedir nada.
 */
export interface QuoteReplacement {
  readonly id: string;
  readonly description: string;
  readonly before: { readonly supplier: string; readonly valueCents: number };
  readonly after: { readonly supplier: string; readonly valueCents: number };
}

/** Linha persistida de `price_research_items` (decimais chegam como string do MySQL). */
export interface StoredResearchQuote {
  readonly id: string;
  readonly description: string | null;
  readonly quantity: string | number;
  readonly unit: string;
  readonly supplier: string;
  readonly brand: string;
  readonly model: string;
  readonly value: string | number;
  readonly observations: string | null;
}

const toCents = (v: string | number): number => Math.round(Number(v) * 100);
const toMilli = (v: string | number): number => Math.round(Number(v) * 1000);
const norm = (s: string | null | undefined): string => (s ?? "").trim();

/** Cotações existentes (mesmo id) cujo conteúdo a importação mudaria. Puro e determinístico. */
export function findQuoteReplacements(
  existing: readonly StoredResearchQuote[],
  incoming: readonly PriceResearchItem[],
): QuoteReplacement[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const out: QuoteReplacement[] = [];
  for (const it of incoming) {
    const e = byId.get(it.id);
    if (!e) continue;
    const changed =
      toCents(e.value) !== toCents(it.value) ||
      toMilli(e.quantity) !== toMilli(it.quantity) ||
      norm(e.unit) !== norm(it.unit) ||
      norm(e.supplier) !== norm(it.supplier) ||
      norm(e.brand) !== norm(it.brand) ||
      norm(e.model) !== norm(it.model) ||
      norm(e.observations) !== norm(it.observations);
    if (changed) {
      out.push({
        id: it.id,
        description: it.description,
        before: { supplier: norm(e.supplier), valueCents: toCents(e.value) },
        after: { supplier: norm(it.supplier), valueCents: toCents(it.value) },
      });
    }
  }
  return out;
}

export class PriceQuoteReplacementRequiresConfirmationError extends Error {
  readonly code = "QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED";
  constructor(readonly replacements: readonly QuoteReplacement[]) {
    const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const sample = replacements.slice(0, 3)
      .map((r) => `${r.description}: ${r.before.supplier || "sem fornecedor"} ${brl(r.before.valueCents)} → ${r.after.supplier || "sem fornecedor"} ${brl(r.after.valueCents)}`)
      .join("; ");
    super(
      `QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED: esta importação substituiria ${replacements.length} cotação(ões) já registrada(s) ` +
      `(${sample}${replacements.length > 3 ? "; …" : ""}). Nada foi gravado. Para ACRESCENTAR cotações, cole a pesquisa completa — ` +
      `as cotações anteriores e, abaixo delas, as novas — numa única importação. Para CORRIGIR as cotações, confirme a substituição.`,
    );
    this.name = "PriceQuoteReplacementRequiresConfirmationError";
  }
}
