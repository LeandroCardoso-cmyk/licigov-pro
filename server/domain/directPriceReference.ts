/**
 * R9 / SEM-042 — LINHAGEM do valor da justificativa de preço da Contratação Direta (domínio puro, determinístico,
 * sem IA/rede/banco).
 *
 * Problema corrigido: o valor de referência vinha do CLIENTE e a "recomendação" afirmava "Baseado na Pesquisa de
 * Preços… confiança 0,85" (texto e número FIXOS — nunca derivados de nada). Agora:
 *   - o valor é CALCULADO pelo servidor a partir das cotações persistidas da importação governada (PR-04A), pelo
 *     método que a PESSOA escolhe (média | mediana | menor preço) — o sistema não decide a metodologia;
 *   - o valor do cliente é no máximo uma PROPOSTA, comparada com o do servidor (divergência ⇒ recusa);
 *   - a justificativa registra a LINHAGEM verificável: id da pesquisa (importId), contentHash (recomputável a partir
 *     das cotações persistidas), versão do algoritmo de hash, nº de cotações, método e valor calculado.
 *   Nenhuma "confiança" é inventada: só fatos verificáveis.
 *
 * Cálculo por ITEM (descrição+unidade normalizadas): estatística dos valores unitários cotados × quantidade do item;
 * o valor de referência é a soma dos itens (centavos inteiros, arredondamento "meio para cima" no total do item).
 * Quantidades divergentes dentro do mesmo item ⇒ pesquisa INCONSISTENTE (recusa — nunca escolhe uma quantidade).
 */

import { DIRECT_PRICE_IMPORT_HASH_VERSION } from "./directPriceImport";

export const PRICE_REFERENCE_METHODS = ["media", "mediana", "menor_preco"] as const;
export type PriceReferenceMethod = (typeof PRICE_REFERENCE_METHODS)[number];

export const PRICE_METHOD_LABELS: Record<PriceReferenceMethod, string> = {
  media: "média", mediana: "mediana", menor_preco: "menor preço",
};

/** Códigos estáveis (mensagem inclui o código; testes/cliente usam o token). */
export const PRICE_RESEARCH_REQUIRED = "PRICE_RESEARCH_REQUIRED";
export const PRICE_RESEARCH_AMBIGUOUS = "PRICE_RESEARCH_AMBIGUOUS";
export const PRICE_RESEARCH_NOT_FOUND = "PRICE_RESEARCH_NOT_FOUND";
export const PRICE_RESEARCH_INTEGRITY = "PRICE_RESEARCH_INTEGRITY";
export const PRICE_RESEARCH_INCONSISTENT = "PRICE_RESEARCH_INCONSISTENT";
export const PRICE_METHOD_REQUIRED = "PRICE_METHOD_REQUIRED";
export const PRICE_REFERENCE_DIVERGES = "PRICE_REFERENCE_DIVERGES";
export const PRICE_LINEAGE_NOT_ALLOWED = "PRICE_LINEAGE_NOT_ALLOWED";

export interface PriceQuoteRow {
  readonly description: string;
  readonly unit: string;
  readonly quantity: number | string;
  readonly value: number | string;
}

export interface PriceItemSummary {
  readonly description: string;
  readonly unit: string;
  readonly quantity: number;
  readonly quoteCount: number;
  readonly unitMin: number;
  readonly unitMax: number;
  readonly unitMean: number;
  readonly unitMedian: number;
}

export interface PriceResearchSummary {
  readonly quoteCount: number;
  readonly itemCount: number;
  /** Menor nº de cotações entre os itens (FATO — o sistema não impõe mínimo legal). */
  readonly minQuotesPerItem: number;
  readonly items: readonly PriceItemSummary[];
  /** Valor de referência por método, em R$ com 2 casas. */
  readonly values: Readonly<Record<PriceReferenceMethod, number>>;
}

const norm = (s: string): string => String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

const round2 = (cents: number): number => Math.round(cents) / 100;

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type SummarizeResult =
  | { readonly ok: true; readonly summary: PriceResearchSummary }
  | { readonly ok: false; readonly code: typeof PRICE_RESEARCH_INCONSISTENT; readonly detail: string };

/**
 * Resume as cotações de UMA importação. `ok:false` quando o conteúdo não permite um valor sem decisão arbitrária
 * (quantidades diferentes para o mesmo item, valor/quantidade não numéricos ou não positivos).
 */
export function summarizePriceResearch(quotes: readonly PriceQuoteRow[]): SummarizeResult {
  if (quotes.length === 0) return { ok: false, code: PRICE_RESEARCH_INCONSISTENT, detail: "pesquisa sem cotações" };
  const groups = new Map<string, { description: string; unit: string; quantities: Set<string>; values: number[] }>();
  for (const q of quotes) {
    const qty = Number(q.quantity);
    const val = Number(q.value);
    if (!Number.isFinite(qty) || !Number.isFinite(val) || qty <= 0 || val <= 0) {
      return { ok: false, code: PRICE_RESEARCH_INCONSISTENT, detail: `cotação com quantidade/valor inválido em "${q.description}"` };
    }
    const unit = norm(q.unit || "un");
    const key = `${norm(q.description)}|${unit}`;
    const g = groups.get(key) ?? { description: String(q.description).trim(), unit, quantities: new Set<string>(), values: [] };
    g.quantities.add(qty.toFixed(3));
    g.values.push(val);
    groups.set(key, g);
  }
  const items: PriceItemSummary[] = [];
  for (const g of groups.values()) {
    if (g.quantities.size > 1) {
      return { ok: false, code: PRICE_RESEARCH_INCONSISTENT, detail: `quantidades divergentes para o item "${g.description}"` };
    }
    const sorted = [...g.values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    items.push({
      description: g.description, unit: g.unit, quantity: Number([...g.quantities][0]), quoteCount: sorted.length,
      unitMin: sorted[0], unitMax: sorted[sorted.length - 1], unitMean: sum / sorted.length, unitMedian: median(sorted),
    });
  }
  items.sort((a, b) => a.description.localeCompare(b.description) || a.unit.localeCompare(b.unit));
  const total = (pick: (i: PriceItemSummary) => number): number =>
    round2(items.reduce((acc, i) => acc + Math.round(i.quantity * pick(i) * 100 + 1e-9), 0));
  return {
    ok: true,
    summary: {
      quoteCount: quotes.length, itemCount: items.length, minQuotesPerItem: Math.min(...items.map((i) => i.quoteCount)), items,
      values: { media: total((i) => i.unitMean), mediana: total((i) => i.unitMedian), menor_preco: total((i) => i.unitMin) },
    },
  };
}

/** A proposta do cliente coincide com o valor do servidor (tolerância de meio centavo). */
export function proposalMatchesServerValue(proposed: number, serverValue: number): boolean {
  return Math.abs(proposed - serverValue) < 0.005;
}

// ─── Linhagem registrada na justificativa ─────────────────────────────────────

/** Prefixo RESERVADO nas referências documentais: só o servidor o emite (o cliente não pode forjá-lo). */
export const PRICE_LINEAGE_PREFIX = "price-lineage/v1:";

export interface ResearchLineage {
  readonly kind: "pesquisa";
  readonly researchId: string;
  readonly contentHash: string;
  readonly hashVersion: string;
  readonly importedAt: string;
  readonly importSource: string;
  readonly quoteCount: number;
  readonly itemCount: number;
  readonly method: PriceReferenceMethod;
  /** Valor calculado PELO SERVIDOR (R$). É o valor de referência registrado. */
  readonly computedValue: number;
  /** Proposta do cliente (null = não enviada). Só é aceita quando coincide com o valor do servidor. */
  readonly proposedValue: number | null;
}

export interface DeclaredLineage {
  readonly kind: "declarado";
  /** Valor declarado pela pessoa (sem pesquisa vinculada) — não verificável pelo sistema. */
  readonly declaredValue: number;
  readonly declaredByUserId: number | null;
}

export type PriceLineage = ResearchLineage | DeclaredLineage;

export function buildResearchLineage(p: {
  researchId: string; contentHash: string; importedAt: string; importSource: string; summary: PriceResearchSummary;
  method: PriceReferenceMethod; proposedValue: number | null;
}): ResearchLineage {
  return {
    kind: "pesquisa", researchId: p.researchId, contentHash: p.contentHash, hashVersion: DIRECT_PRICE_IMPORT_HASH_VERSION,
    importedAt: p.importedAt, importSource: p.importSource, quoteCount: p.summary.quoteCount, itemCount: p.summary.itemCount,
    method: p.method, computedValue: p.summary.values[p.method], proposedValue: p.proposedValue,
  };
}

export function encodeLineage(l: PriceLineage): string {
  return `${PRICE_LINEAGE_PREFIX}${JSON.stringify(l)}`;
}

export function isLineageToken(ref: string): boolean {
  return typeof ref === "string" && ref.startsWith(PRICE_LINEAGE_PREFIX);
}

/** Separa a linhagem (se houver) das referências documentais comuns. Linhagem malformada ⇒ null (nunca inventada). */
export function splitLineage(refs: readonly string[]): { lineage: PriceLineage | null; references: string[] } {
  let lineage: PriceLineage | null = null;
  const references: string[] = [];
  for (const r of refs) {
    if (!isLineageToken(r)) { references.push(r); continue; }
    try {
      const v = JSON.parse(r.slice(PRICE_LINEAGE_PREFIX.length)) as PriceLineage;
      if (v && (v.kind === "pesquisa" || v.kind === "declarado")) lineage = v;
    } catch { /* token malformado: ignorado (não há linhagem verificável) */ }
  }
  return { lineage, references };
}

/** Frase FACTUAL da linhagem (sem "confiança", sem afirmação além do que foi registrado). */
export function describeLineage(l: PriceLineage): string {
  if (l.kind === "pesquisa") {
    return `Pesquisa de preços ${l.researchId} (conteúdo sha256 ${l.contentHash.slice(0, 12)}…, ${l.hashVersion}, importada em ${l.importedAt}), ${l.quoteCount} cotação(ões) em ${l.itemCount} item(ns); método: ${PRICE_METHOD_LABELS[l.method]}; valor calculado pelo sistema: R$ ${l.computedValue.toFixed(2)}.`;
  }
  return `Valor declarado pelo servidor (R$ ${l.declaredValue.toFixed(2)}), sem pesquisa de preços vinculada — não verificado pelo sistema.`;
}
