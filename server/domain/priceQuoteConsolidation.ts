/**
 * CONSOLIDAÇÃO DETERMINÍSTICA de cotações → Itens Inteligentes.
 *
 * Várias cotações (fornecedores diferentes) do MESMO item lógico viram UM Item Inteligente. A equivalência
 * é decidida por uma CHAVE LÓGICA DETERMINÍSTICA — nunca por similaridade/fuzzy:
 *
 *     chave = descrição normalizada | unidade canônica | quantidade (milésimos exatos)
 *
 * Normalização é MECÂNICA (caixa, acentos, espaços, pontuação final, sinônimos fechados de unidade). Itens
 * parecidos mas não idênticos por essa regra PERMANECEM SEPARADOS (o servidor trata depois, no polimento).
 * Puro e determinístico: mesma entrada (na mesma ordem) ⇒ mesma saída.
 */
import { createHash } from "crypto";
import { averageCents, type Cents } from "./money";

/** Uma cotação canônica (linha de `price_research_items`), já com valor em centavos. */
export interface PriceQuote {
  readonly quoteId: string;
  readonly researchId: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly supplier: string;
  readonly brand: string;
  readonly model: string;
  readonly source: string;
  /** Valor unitário em centavos; `null` quando ausente/ambíguo (não entra na média). */
  readonly valueCents: Cents | null;
  /**
   * Hardening P0 — identidade de CONTEÚDO da cotação (ver `quoteContentHash`). O mesmo `quoteId` com conteúdo
   * diferente (ex.: preço corrigido de R$ 100 → R$ 200) é uma cotação ALTERADA, nunca "inalterada".
   * Calculada quando ausente.
   */
  readonly contentHash?: string;
}

/** Versão da fórmula do hash de conteúdo (compõe o hash; mudar a fórmula ⇒ mudar a versão). */
export const QUOTE_CONTENT_VERSION = "quote-content/1";

/**
 * Hash DETERMINÍSTICO do conteúdo da cotação: descrição, quantidade (milésimos), unidade canônica,
 * fornecedor, marca, modelo, valor (centavos) e fonte. Não inclui ids nem timestamps.
 */
export function quoteContentHash(q: Omit<PriceQuote, "contentHash" | "quoteId" | "researchId">): string {
  return createHash("sha256").update(JSON.stringify([
    QUOTE_CONTENT_VERSION,
    (q.description ?? "").replace(/\s+/g, " ").trim(),
    quantityMilli(q.quantity),
    canonicalUnit(q.unit),
    (q.supplier ?? "").trim(), (q.brand ?? "").trim(), (q.model ?? "").trim(),
    q.valueCents,
    (q.source ?? "").trim(),
  ])).digest("hex");
}

/** A cotação com `contentHash` garantido. */
export function withContentHash(q: PriceQuote): PriceQuote & { contentHash: string } {
  return { ...q, contentHash: q.contentHash ?? quoteContentHash(q) };
}

/** Assinatura do CONJUNTO de cotações (id + conteúdo), ordenada — igualdade ⇔ nada mudou. */
export function quoteSetSignature(quotes: readonly PriceQuote[]): string {
  return quotes.map((q) => `${q.quoteId}:${withContentHash(q).contentHash}`).sort().join("|");
}

/** Cotações VÁLIDAS (com preço > 0) — as únicas que entram na média e na contagem "Baseado em N". */
export function validQuotes(quotes: readonly PriceQuote[]): PriceQuote[] {
  return quotes.filter((q) => q.valueCents !== null && q.valueCents > 0);
}

/** Sinônimos FECHADOS de unidade → forma canônica (lista explícita; nada inferido). */
const UNIT_SYNONYMS: Readonly<Record<string, string>> = {
  UN: "UN", UND: "UN", UNID: "UN", UNIDADE: "UN", UNIDADES: "UN", "UN.": "UN", U: "UN",
  CX: "CX", CAIXA: "CX", CAIXAS: "CX",
  PCT: "PCT", PACOTE: "PCT", PACOTES: "PCT", PC: "PC", PECA: "PC", PECAS: "PC",
  KG: "KG", QUILO: "KG", QUILOS: "KG", QUILOGRAMA: "KG", G: "G", GRAMA: "G", GRAMAS: "G",
  L: "L", LT: "L", LITRO: "L", LITROS: "L", ML: "ML",
  M: "M", METRO: "M", METROS: "M", M2: "M2", "M²": "M2", M3: "M3", "M³": "M3",
  RESMA: "RESMA", RESMAS: "RESMA", DZ: "DZ", DUZIA: "DZ", PAR: "PAR", PARES: "PAR",
  FR: "FR", FRASCO: "FR", GL: "GL", GALAO: "GL", ROLO: "RL", RL: "RL", KIT: "KIT", SV: "SV", SERVICO: "SV",
  MES: "MES", MESES: "MES", HORA: "H", HORAS: "H", H: "H",
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Descrição normalizada (mecânica): minúsculas, sem acentos, espaços colapsados, sem pontuação final. */
export function normalizeDescription(description: string): string {
  return stripAccents(description ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,:]+$/g, "")
    .trim();
}

/** Unidade canônica (sinônimo fechado) ou a própria unidade normalizada em caixa alta. Vazio → "UN". */
export function canonicalUnit(unit: string | null | undefined): string {
  // Ponto final de abreviação ("Unid.", "Pç.") não distingue unidades.
  const u = stripAccents((unit ?? "").trim()).toUpperCase().replace(/\s+/g, "").replace(/\.+$/, "");
  if (!u) return "UN";
  return UNIT_SYNONYMS[u] ?? u;
}

/** Quantidade em milésimos exatos (DECIMAL(14,3)) — parte da chave lógica. */
export function quantityMilli(quantity: number): number {
  return Number.isFinite(quantity) ? Math.round(quantity * 1000) : 0;
}

/** Chave lógica determinística do Item Inteligente. */
export function intelligentItemLogicalKey(p: { description: string; unit: string | null | undefined; quantity: number }): string {
  return `${normalizeDescription(p.description)}|${canonicalUnit(p.unit)}|${quantityMilli(p.quantity)}`;
}

/** Id determinístico (v2, por chave lógica) do Item Inteligente — tenant + processo no escopo. */
export function intelligentItemIdForKey(organizationId: number, processId: string, logicalKey: string): string {
  return createHash("sha256").update(`iitem:v2:${organizationId}:${processId}:${logicalKey}`).digest("hex").slice(0, 20);
}

/** Um item lógico consolidado com TODAS as cotações que o compõem. */
export interface ConsolidatedItem {
  readonly logicalKey: string;
  /** Descrição de exibição = a da PRIMEIRA cotação (não reescrita). */
  readonly description: string;
  readonly unit: string;
  readonly quantity: number;
  /** Cotações ordenadas por quoteId (determinístico). */
  readonly quotes: readonly PriceQuote[];
  /** Média HALF-UP apenas das cotações com valor. 0 quando nenhuma tem preço. */
  readonly averageCents: Cents;
  readonly pricedQuoteCount: number;
}

/**
 * Agrupa cotações por chave lógica (sem fuzzy). A ordem dos itens segue a PRIMEIRA aparição da chave;
 * cotações dentro do item são ordenadas por `quoteId`. Cotações duplicadas (mesmo quoteId) contam uma vez.
 */
export function consolidateQuotes(quotes: readonly PriceQuote[]): ConsolidatedItem[] {
  const order: string[] = [];
  const groups = new Map<string, Map<string, PriceQuote>>();
  for (const q of quotes) {
    if (!normalizeDescription(q.description)) continue; // não fabrica item sem descrição
    const key = intelligentItemLogicalKey(q);
    let g = groups.get(key);
    if (!g) { g = new Map(); groups.set(key, g); order.push(key); }
    // Mesmo quoteId repetido no lote: a ÚLTIMA ocorrência vence (mais recente).
    g.set(q.quoteId, withContentHash(q));
  }
  return order.map((key) => {
    const g = groups.get(key)!;
    const first = [...g.values()][0];
    const sorted = [...g.values()].sort((a, b) => (a.quoteId < b.quoteId ? -1 : a.quoteId > b.quoteId ? 1 : 0));
    const priced = sorted.map((q) => q.valueCents).filter((v): v is Cents => v !== null && v > 0);
    return {
      logicalKey: key,
      description: first.description.trim(),
      unit: first.unit.trim() || "un",
      quantity: first.quantity,
      quotes: sorted,
      averageCents: averageCents(priced),
      pricedQuoteCount: priced.length,
    };
  });
}

/**
 * Merge de conjuntos de cotações (união por quoteId), ordenado — base da atualização idempotente. A
 * cotação ENTRANTE substitui a existente de mesmo quoteId (o conteúdo novo vence; detectar mudança é
 * responsabilidade de `quoteSetSignature`, que compara id + contentHash).
 */
export function mergeQuotes(existing: readonly PriceQuote[], incoming: readonly PriceQuote[]): PriceQuote[] {
  const byId = new Map<string, PriceQuote>();
  for (const q of existing) byId.set(q.quoteId, withContentHash(q));
  for (const q of incoming) byId.set(q.quoteId, withContentHash(q));
  return [...byId.values()].sort((a, b) => (a.quoteId < b.quoteId ? -1 : a.quoteId > b.quoteId ? 1 : 0));
}
