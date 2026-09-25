/**
 * BLOCO AUTORITATIVO DE ITENS (TR / Edital) — renderizado pelo SERVIDOR, nunca pela IA.
 *
 * Descrição, quantidade, unidade, preço médio, valor estimado do item e valor estimado global são DADOS
 * ESTRUTURADOS AUTORITATIVOS. O provider escreve a PROSA das seções; estes números são calculados aqui
 * (centavos inteiros, half-up — ver `money.ts`) e inseridos no documento de forma determinística.
 *
 *     estimatedItemTotal    = quantidade × preço médio
 *     estimatedProcessTotal = Σ estimatedItemTotal
 *
 * Classificação de catálogo: só a DECISÃO HUMANA vigente (ledger `catmat_decisions`: confirmado/substituído)
 * é exibida como confirmada. Sugestão (matching/IA) NUNCA vira código oficial — aparece como "a revisar".
 * Puro e determinístico.
 */
import { formatBRL, multiplyQuantityCents, sumCents, type Cents } from "./money";
import { normalizeDescription } from "./priceQuoteConsolidation";

export const AUTHORITATIVE_ITEMS_CONTRACT_VERSION = "authoritative-items/1.0";
/** Marcadores HTML (invisíveis no render) que delimitam o bloco — permitem verificar integridade. */
export const AUTHORITATIVE_ITEMS_BEGIN = "<!-- licigov:itens-autoritativos:inicio -->";
export const AUTHORITATIVE_ITEMS_END = "<!-- licigov:itens-autoritativos:fim -->";

export interface AuthoritativeItemInput {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  /** Preço médio em CENTAVOS (lido de DECIMAL em reais via reaisToCents — nunca /100). */
  readonly averagePriceCents: Cents;
  /** Nº de cotações VÁLIDAS (com preço) que compõem o preço médio. */
  readonly quoteCount: number;
  /** Classificação CONFIRMADA por decisão humana vigente; null quando não há decisão confirmada. */
  readonly confirmedCatalogCode: string | null;
  /** Sugestão existente (não confirmada) — só sinaliza "a revisar". */
  readonly suggestedCatalogCode: string | null;
}

export interface AuthoritativeItemRow extends AuthoritativeItemInput {
  readonly index: number;
  readonly estimatedTotalCents: Cents;
}

export interface AuthoritativeItemsEstimate {
  readonly rows: readonly AuthoritativeItemRow[];
  readonly globalTotalCents: Cents;
  readonly itemCount: number;
  readonly pricedItemCount: number;
  readonly unpricedItemCount: number;
  readonly quoteCount: number;
  readonly confirmedClassificationCount: number;
  readonly pendingClassificationCount: number;
}

/** Ordem determinística: descrição normalizada, depois id. */
function sortItems(items: readonly AuthoritativeItemInput[]): AuthoritativeItemInput[] {
  return [...items].sort((a, b) => {
    const da = normalizeDescription(a.description), db = normalizeDescription(b.description);
    if (da !== db) return da < db ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Calcula as estimativas autoritativas (centavos, half-up). `preserveOrder` mantém a ORDEM OFICIAL recebida
 * (Itens da contratação: lote → ordinal); sem ele, ordem histórica por descrição (legado).
 */
export function computeItemEstimates(items: readonly AuthoritativeItemInput[], opts: { preserveOrder?: boolean } = {}): AuthoritativeItemsEstimate {
  const rows: AuthoritativeItemRow[] = (opts.preserveOrder ? [...items] : sortItems(items)).map((it, i) => ({
    ...it,
    index: i + 1,
    estimatedTotalCents: it.averagePriceCents > 0 ? multiplyQuantityCents(it.quantity, it.averagePriceCents) : 0,
  }));
  const priced = rows.filter((r) => r.averagePriceCents > 0);
  return {
    rows,
    globalTotalCents: sumCents(rows.map((r) => r.estimatedTotalCents)),
    itemCount: rows.length,
    pricedItemCount: priced.length,
    unpricedItemCount: rows.length - priced.length,
    quoteCount: rows.reduce((a, r) => a + r.quoteCount, 0),
    confirmedClassificationCount: rows.filter((r) => r.confirmedCatalogCode).length,
    pendingClassificationCount: rows.filter((r) => !r.confirmedCatalogCode).length,
  };
}

/** Quantidade pt-BR determinística (até 3 casas, sem zeros à direita): 10 → "10", 2.5 → "2,5". */
export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return "0";
  const fixed = quantity.toFixed(3).replace(/\.?0+$/, "");
  const [int, frac] = fixed.split(".");
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${intFmt},${frac}` : intFmt;
}

function cell(s: string): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/**
 * Renderiza o bloco markdown AUTORITATIVO (tabela + total global + origem). Determinístico: mesmos itens
 * ⇒ mesmo texto (bytes). Delimitado por marcadores para verificação de integridade.
 */
export function renderAuthoritativeItemsBlock(
  estimate: AuthoritativeItemsEstimate,
  opts: { heading?: string; quantitySource?: "canonical_planned" } = {},
): string {
  const heading = opts.heading ?? "Itens e estimativa de valor (dados autoritativos do processo)";
  const canonical = opts.quantitySource === "canonical_planned";
  const lines: string[] = [AUTHORITATIVE_ITEMS_BEGIN, `## ${heading}`, ""];
  if (estimate.itemCount === 0) {
    lines.push("> [REVISAR: nenhum Item Inteligente aprovado no processo — quantitativos e valores não foram definidos.]");
    lines.push("", AUTHORITATIVE_ITEMS_END);
    return lines.join("\n");
  }
  lines.push(
    canonical
      // Contexto Canônico: a quantidade é a PREVISTA (Itens da contratação); o preço é a referência da
      // Pesquisa vinculada ao item. A quantidade da cotação NUNCA entra aqui.
      ? "> Tabela gerada pelo sistema a partir dos Itens da contratação (quantidade PREVISTA) e do preço de " +
        "referência da Pesquisa de Preços vinculado a cada item. Os valores NÃO foram redigidos por IA. " +
        "Valor estimado do item = quantidade prevista × preço de referência."
      : "> Tabela gerada pelo sistema a partir dos Itens Inteligentes APROVADOS e da Pesquisa de Preços. " +
        "Os valores NÃO foram redigidos por IA. Valor estimado do item = quantidade × preço médio.",
    "",
    canonical
      ? "| Item | Descrição | Qtd. prevista | Unid. | Valor de referência (R$) | Valor estimado (R$) | CATMAT/CATSER | Cotações |"
      : "| Item | Descrição | Qtd. | Unid. | Valor médio (R$) | Valor estimado (R$) | CATMAT/CATSER | Cotações |",
    "|---:|---|---:|---|---:|---:|---|---:|",
  );
  for (const r of estimate.rows) {
    const catalog = r.confirmedCatalogCode
      ? cell(r.confirmedCatalogCode)
      : r.suggestedCatalogCode ? "a revisar (sugestão não confirmada)" : "a revisar";
    const avg = r.averagePriceCents > 0 ? formatBRL(r.averagePriceCents).replace(/^R\$ /, "") : "[REVISAR: sem preço]";
    const total = r.averagePriceCents > 0 ? formatBRL(r.estimatedTotalCents).replace(/^R\$ /, "") : "—";
    lines.push(`| ${r.index} | ${cell(r.description) || "[item sem descrição]"} | ${formatQuantity(r.quantity)} | ${cell(r.unit)} | ${avg} | ${total} | ${catalog} | ${r.quoteCount} |`);
  }
  lines.push("");
  lines.push(`**Valor estimado global:** ${formatBRL(estimate.globalTotalCents)}`);
  lines.push("");
  // Risco A (hardening P0): conta só cotações VÁLIDAS — as que entraram efetivamente na média.
  lines.push(`- Baseado em ${estimate.quoteCount} cotação(ões) válida(s) em ${estimate.itemCount} item(ns) ${canonical ? "da contratação" : "aprovado(s)"}.`);
  if (estimate.unpricedItemCount > 0) {
    lines.push(`- [REVISAR: ${estimate.unpricedItemCount} item(ns) sem preço de referência — excluído(s) do total.]`);
  }
  if (estimate.pendingClassificationCount > 0) {
    lines.push(`- Classificação de catálogo: ${estimate.confirmedClassificationCount} confirmada(s) · ${estimate.pendingClassificationCount} a revisar (sugestão automática não equivale a decisão).`);
  }
  lines.push("", AUTHORITATIVE_ITEMS_END);
  return lines.join("\n");
}

/** Extrai o bloco autoritativo de um documento (ou null) — usado para verificar integridade em testes/UI. */
export function extractAuthoritativeItemsBlock(content: string): string | null {
  const a = content.indexOf(AUTHORITATIVE_ITEMS_BEGIN);
  const b = content.indexOf(AUTHORITATIVE_ITEMS_END);
  if (a < 0 || b < 0 || b < a) return null;
  return content.slice(a, b + AUTHORITATIVE_ITEMS_END.length);
}
