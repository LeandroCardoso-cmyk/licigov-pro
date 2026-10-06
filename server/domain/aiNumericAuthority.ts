/**
 * R9 / SEM-080 — AUTORIDADE NUMÉRICA nos textos de ETP/TR redigidos pela IA (regra pura).
 *
 *  - A seção obrigatória "Estimativa do valor da contratação" (ETP art. 18, §1º, VI; TR art. 6º, XXIII, i) é
 *    redigida pelo SERVIDOR a partir do quadro autoritativo (Pesquisa de Preços aprovada × quantidade prevista),
 *    nunca pela IA. A prosa do provider para essa seção é descartada.
 *  - Em qualquer outra seção, todo valor monetário escrito pela IA (`R$ …`) que NÃO coincide com um valor do quadro
 *    autoritativo (preço unitário, total por item ou total global) recebe a marca
 *    `[REVISAR: valor não conferido com o quadro do sistema]` — a IA não cria autoridade numérica.
 */
import { formatBRL } from "./money";

export const ESTIMATE_SECTION_KEY = "estimativa_valor";
export const UNVERIFIED_AMOUNT_MARK = "[REVISAR: valor não conferido com o quadro do sistema]";

/** "R$ 1.234,56" | "R$1234,5" | "R$ 1.234" ⇒ centavos; null quando não é um valor legível. */
export function parseBRLAmount(text: string): number | null {
  const m = /^R\$\s*([\d.]+)(?:,(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const reais = Number(m[1].replace(/\./g, ""));
  if (!Number.isFinite(reais)) return null;
  const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return reais * 100 + cents;
}

const AMOUNT = /R\$\s*\d[\d.]*(?:,\d{1,2})?/g;

/** Marca todo valor monetário não presente no conjunto autoritativo. Idempotente (não marca duas vezes). */
export function flagUnverifiedAmounts(prose: string, allowedCents: ReadonlySet<number>): { prose: string; flagged: number } {
  let flagged = 0;
  const out = prose.replace(AMOUNT, (match: string, offset: number, whole: string) => {
    const cents = parseBRLAmount(match);
    if (cents !== null && allowedCents.has(cents)) return match;
    if (whole.slice(offset + match.length).trimStart().startsWith(UNVERIFIED_AMOUNT_MARK)) return match;
    flagged += 1;
    return `${match} ${UNVERIFIED_AMOUNT_MARK}`;
  });
  return { prose: out, flagged };
}

export interface EstimateAuthorityInput {
  readonly itemCount: number;
  readonly pricedItemCount: number;
  readonly unpricedItemCount: number;
  readonly globalTotalCents: number;
  readonly rows: ReadonlyArray<{ readonly averagePriceCents: number; readonly estimatedTotalCents: number }>;
  /** Há itens sem quantidade prevista (estimativa não calculável). */
  readonly missingPlannedQuantity: number;
  /** O documento traz o quadro autoritativo? (TR sempre; ETP no modo canônico). */
  readonly hasAuthoritativeBlock: boolean;
}

/** Valores que a IA pode citar sem marca: os do quadro autoritativo. */
export function authoritativeAmounts(e: EstimateAuthorityInput): Set<number> {
  const s = new Set<number>();
  for (const r of e.rows) {
    if (r.averagePriceCents > 0) s.add(r.averagePriceCents);
    if (r.estimatedTotalCents > 0) s.add(r.estimatedTotalCents);
  }
  if (e.globalTotalCents > 0 && e.missingPlannedQuantity === 0) s.add(e.globalTotalCents);
  return s;
}

/** Prosa da seção de estimativa redigida PELO SERVIDOR. */
export function serverEstimateProse(e: EstimateAuthorityInput): string {
  if (e.itemCount === 0) {
    return "[REVISAR: nenhum Item aprovado com Pesquisa de Preços — a estimativa do valor da contratação ainda não pode ser calculada.]";
  }
  if (e.missingPlannedQuantity > 0) {
    return `[REVISAR: ${e.missingPlannedQuantity} item(ns) sem quantidade prevista — a estimativa global não foi calculada; nenhum valor foi inferido.]`;
  }
  const where = e.hasAuthoritativeBlock ? " Os valores unitários e totais por item constam do quadro autoritativo deste documento." : "";
  const unpriced = e.unpricedItemCount > 0 ? ` [REVISAR: ${e.unpricedItemCount} item(ns) sem preço de referência não entram no total.]` : "";
  return `Valor estimado da contratação, calculado pelo sistema a partir da Pesquisa de Preços aprovada e das quantidades previstas: ${formatBRL(e.globalTotalCents)} (${e.pricedItemCount} item(ns) com preço de referência).${where}${unpriced}`;
}
