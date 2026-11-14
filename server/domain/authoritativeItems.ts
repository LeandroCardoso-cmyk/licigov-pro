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
import { globalEstimateLabel } from "../../shared/estimateLabel";

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
  /**
   * R9 / SEM-028, SEM-031 — preço vinculado suspenso (`SOURCE_NOT_CURRENT` | `UNIT_MISMATCH`); M8 — `FICTITIOUS_SOURCE`
   * (cotação fictícia não constitui pesquisa de preços oficial). null/ausente = sem bloqueio.
   */
  readonly priceBlockedReason?: string | null;
  /** M8 hardening — das `quoteCount`, quantas são de fonte FICTÍCIA (demonstrativas); ausente/0 ⇒ nenhuma. */
  readonly fictitiousQuoteCount?: number;
  /** M8 — cotações LEGADAS possivelmente demonstrativas (marcador antigo, sem declaração): só [REVISAR]; ausente/0 ⇒ nenhuma. */
  readonly suspectedQuoteCount?: number;
}

export interface AuthoritativeItemRow extends AuthoritativeItemInput {
  readonly index: number;
  readonly estimatedTotalCents: Cents;
}

/**
 * R10 / SEM-090 — quantidade NÃO INFORMADA ≠ 0. `0`/ausente/negativa/NaN não é quantidade (as colunas do banco são NOT NULL
 * e guardam 0 para "não informada"): nunca é exibida como "0" nem entra em valor estimado.
 */
export function isQuantityInformed(quantity: number | null | undefined): quantity is number {
  return typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0;
}

export const QUANTITY_NOT_INFORMED_TEXT = "[REVISAR: quantidade não informada]";

/** Quantidade para exibição em documento/prompt: número pt-BR, ou o marcador de revisão quando não informada. */
export function formatQuantityOrReview(quantity: number | null | undefined): string {
  return isQuantityInformed(quantity) ? formatQuantity(quantity) : QUANTITY_NOT_INFORMED_TEXT;
}

export interface AuthoritativeItemsEstimate {
  readonly rows: readonly AuthoritativeItemRow[];
  readonly globalTotalCents: Cents;
  readonly itemCount: number;
  readonly pricedItemCount: number;
  readonly unpricedItemCount: number;
  /** R10 / SEM-090 — itens sem quantidade informada (excluídos do total estimado; sinalizados [REVISAR]). */
  readonly unknownQuantityItemCount: number;
  readonly quoteCount: number;
  /** M8 hardening — cotações de fonte fictícia entre as `quoteCount` (0 ⇒ bloco byte-idêntico ao anterior). */
  readonly fictitiousQuoteCount: number;
  /** M8 — cotações legadas possivelmente demonstrativas (0 ⇒ bloco byte-idêntico ao anterior). */
  readonly suspectedQuoteCount: number;
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
/** M8 hardening — marcação documental de cotações de fonte fictícia (nunca apresentadas como pesquisa de preços válida). */
export function fictitiousQuotesReviewText(n: number): string {
  return `[REVISAR: ${n} cotação(ões) de fonte fictícia/sintética — valor demonstrativo, não constitui pesquisa de preços válida.]`;
}

/** M8 — célula de preço suspenso por fonte fictícia (documento de órgão real nunca exibe o valor demonstrativo). */
export const FICTITIOUS_PRICE_CELL_TEXT = "[REVISAR: preço suspenso — cotação fictícia não constitui pesquisa de preços oficial]";

/** M8 — cotação LEGADA marcada pelo leitor antigo como fictícia/sintética, sem declaração explícita: revisão humana. */
export function suspectedQuotesReviewText(n: number): string {
  return `[REVISAR: ${n} cotação(ões) possivelmente demonstrativa(s) (marcação de importação anterior) — confira a fonte antes de usar o valor.]`;
}

/**
 * Pós-M8 — texto da CONTAGEM de cotações. Sem fonte fictícia/suspeita, mantém exatamente o texto histórico ("N cotação(ões)
 * válida(s)" = com preço, as que compõem a média). Com fonte fictícia/sintética ou suspeita, a contagem é de cotações REGISTRADAS
 * e a natureza delas é dita (nunca chamadas de "válidas"): a média continua calculada como antes; só a descrição muda.
 */
export function quoteCountText(quoteCount: number, fictitiousQuoteCount = 0, suspectedQuoteCount = 0): string {
  if (fictitiousQuoteCount <= 0 && suspectedQuoteCount <= 0) return `${quoteCount} cotação(ões) válida(s)`;
  const kinds = [
    fictitiousQuoteCount > 0 ? `${fictitiousQuoteCount} de fonte fictícia/sintética (demonstrativa)` : null,
    suspectedQuoteCount > 0 ? `${suspectedQuoteCount} possivelmente demonstrativa(s)` : null,
  ].filter(Boolean).join(" e ");
  return `${quoteCount} cotação(ões) registrada(s), das quais ${kinds}`;
}

export function computeItemEstimates(items: readonly AuthoritativeItemInput[], opts: { preserveOrder?: boolean } = {}): AuthoritativeItemsEstimate {
  const rows: AuthoritativeItemRow[] = (opts.preserveOrder ? [...items] : sortItems(items)).map((it, i) => ({
    ...it,
    index: i + 1,
    estimatedTotalCents: it.averagePriceCents > 0 && isQuantityInformed(it.quantity) ? multiplyQuantityCents(it.quantity, it.averagePriceCents) : 0,
  }));
  const priced = rows.filter((r) => r.averagePriceCents > 0);
  return {
    rows,
    globalTotalCents: sumCents(rows.map((r) => r.estimatedTotalCents)),
    itemCount: rows.length,
    pricedItemCount: priced.length,
    unpricedItemCount: rows.length - priced.length,
    unknownQuantityItemCount: rows.filter((r) => !isQuantityInformed(r.quantity)).length,
    quoteCount: rows.reduce((a, r) => a + r.quoteCount, 0),
    fictitiousQuoteCount: rows.reduce((a, r) => a + (r.fictitiousQuoteCount ?? 0), 0),
    suspectedQuoteCount: rows.reduce((a, r) => a + (r.suspectedQuoteCount ?? 0), 0),
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
      // R6 / PR-13 (SEM-008, INV-09): sem Itens da contratação a única quantidade é a da COTAÇÃO (evidência) —
      // rotulada como tal e nunca como necessidade; TR/Edital nem chegam aqui (fail-closed no serviço).
      : "> Tabela gerada pelo sistema a partir dos Itens Inteligentes APROVADOS e da Pesquisa de Preços. " +
        "Os valores NÃO foram redigidos por IA. [REVISAR: a quantidade é a da COTAÇÃO — não é a quantidade da " +
        "contratação; cadastre os Itens da contratação com a quantidade prevista.] Valor indicativo do item = " +
        "quantidade cotada × preço médio.",
    "",
    canonical
      ? "| Item | Descrição | Qtd. prevista | Unid. | Valor de referência (R$) | Valor estimado (R$) | CATMAT/CATSER | Cotações |"
      : "| Item | Descrição | Qtd. cotada (não confirmada) | Unid. | Valor médio (R$) | Valor indicativo (R$) | CATMAT/CATSER | Cotações |",
    "|---:|---|---:|---|---:|---:|---|---:|",
  );
  for (const r of estimate.rows) {
    const catalog = r.confirmedCatalogCode
      ? cell(r.confirmedCatalogCode)
      : r.suggestedCatalogCode ? "a revisar (sugestão não confirmada)" : "a revisar";
    const avg = r.averagePriceCents > 0 ? formatBRL(r.averagePriceCents).replace(/^R\$ /, "")
      : r.priceBlockedReason === "FICTITIOUS_SOURCE" ? FICTITIOUS_PRICE_CELL_TEXT
      : r.priceBlockedReason === "SOURCE_NOT_CURRENT" ? "[REVISAR: preço suspenso — fonte da pesquisa alterada]"
        : r.priceBlockedReason === "UNIT_MISMATCH" ? "[REVISAR: unidade da cotação incompatível com o item]"
          : "[REVISAR: sem preço]";
    const total = r.averagePriceCents > 0 && isQuantityInformed(r.quantity) ? formatBRL(r.estimatedTotalCents).replace(/^R\$ /, "") : "—";
    lines.push(`| ${r.index} | ${cell(r.description) || "[item sem descrição]"} | ${formatQuantityOrReview(r.quantity)} | ${cell(r.unit)} | ${avg} | ${total} | ${catalog} | ${r.quoteCount} |`);
  }
  lines.push("");
  lines.push(canonical
    // SEM-081: total PARCIAL (itens sem preço ficam fora da soma) nunca aparece como "global".
    ? (estimate.unpricedItemCount > 0
      ? `**${globalEstimateLabel(estimate)}:** ${formatBRL(estimate.globalTotalCents)}`
      : `**Valor estimado global:** ${formatBRL(estimate.globalTotalCents)}`)
    : `**Valor indicativo (quantidade cotada, não confirmada):** ${formatBRL(estimate.globalTotalCents)}`);
  lines.push("");
  // Risco A (hardening P0): cotações com preço (as que entram na média). Pós-M8: com fonte fictícia/suspeita, "registradas" e a
  // natureza explícita — uma cotação fictícia nunca é chamada de válida (texto inalterado sem elas).
  lines.push(`- Baseado em ${quoteCountText(estimate.quoteCount, estimate.fictitiousQuoteCount, estimate.suspectedQuoteCount)} em ${estimate.itemCount} item(ns) ${canonical ? "da contratação" : "aprovado(s)"}.`);
  if (estimate.fictitiousQuoteCount > 0) {
    lines.push(`- ${fictitiousQuotesReviewText(estimate.fictitiousQuoteCount)}`);
  }
  if (estimate.suspectedQuoteCount > 0) {
    lines.push(`- ${suspectedQuotesReviewText(estimate.suspectedQuoteCount)}`);
  }
  if (estimate.unpricedItemCount > 0) {
    lines.push(`- [REVISAR: ${estimate.unpricedItemCount} item(ns) sem preço de referência — excluído(s) do total.]`);
  }
  if (estimate.unknownQuantityItemCount > 0) {
    lines.push(`- [REVISAR: ${estimate.unknownQuantityItemCount} item(ns) sem quantidade informada — valor estimado não calculado e excluído(s) do total.]`);
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
