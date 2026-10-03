/**
 * R9 / SEM-054 — Portão de APROVAÇÃO de um Item Inteligente (regra única, servidor + cliente).
 *
 * Um item só pode ser aprovado quando a sua fonte está VIGENTE (`sourceState = "current"`):
 *   - `source_changed`  — a Pesquisa de Preços mudou depois da decisão; o conjunto novo de cotações
 *                         aguarda decisão humana explícita (aplicar com confirmação). Aprovar agora
 *                         confirmaria números que o servidor sabe estarem desatualizados.
 *   - `review_required` — identidade ambígua (legado × nova pesquisa); a resolução humana
 *                         (`resolveItemIdentity`) precisa acontecer antes.
 *   - qualquer outro estado não reconhecido — fail-closed.
 *
 * O SERVIDOR aplica a regra (compare-and-set condicionado a `source_state = 'current'`); o cliente usa a
 * mesma função só para desabilitar o botão e explicar o motivo.
 *
 * Também concentra a detecção de cotações FORA DA CURVA (mesma regra de `detectPriceOutlier`:
 * desvio > 50% da média das cotações válidas), em CENTAVOS inteiros e sem ponto flutuante.
 */

export const ITEM_APPROVAL_BLOCK_CODES = {
  sourceChanged: "ITEM_SOURCE_CHANGED",
  identityReview: "ITEM_IDENTITY_REVIEW_REQUIRED",
  sourceNotCurrent: "ITEM_SOURCE_NOT_CURRENT",
} as const;

export type ItemApprovalBlockCode = (typeof ITEM_APPROVAL_BLOCK_CODES)[keyof typeof ITEM_APPROVAL_BLOCK_CODES];

export interface ItemApprovalBlock {
  readonly code: ItemApprovalBlockCode;
  /** Frase institucional exibida ao usuário (sem o código). */
  readonly reason: string;
}

/** `null` ⇒ aprovação permitida; caso contrário, o motivo (código estável + frase). */
export function itemApprovalBlock(sourceState: string | null | undefined): ItemApprovalBlock | null {
  const state = sourceState ?? "current";
  if (state === "current") return null;
  if (state === "source_changed") {
    return {
      code: ITEM_APPROVAL_BLOCK_CODES.sourceChanged,
      reason: "A pesquisa de preços mudou depois da decisão. Revise e aplique as cotações atualizadas antes de aprovar.",
    };
  }
  if (state === "review_required") {
    return {
      code: ITEM_APPROVAL_BLOCK_CODES.identityReview,
      reason: "A identidade deste item precisa ser revisada (legado × nova pesquisa) antes da aprovação.",
    };
  }
  return {
    code: ITEM_APPROVAL_BLOCK_CODES.sourceNotCurrent,
    reason: "A fonte deste item não está vigente; a aprovação fica bloqueada até a revisão.",
  };
}

/** Mensagem de erro do servidor: `CODIGO: frase` (padrão lido por `domainErrorMessage`). */
export function itemApprovalBlockMessage(block: ItemApprovalBlock): string {
  return `${block.code}: ${block.reason}`;
}

/** Desvio relativo acima do qual uma cotação é "fora da curva" (mesma regra de `detectPriceOutlier`). */
export const PRICE_OUTLIER_THRESHOLD_PERCENT = 50;

export interface PriceOutlierInput {
  readonly name: string;
  /** Valor da cotação em CENTAVOS inteiros (≤ 0 ou nulo = cotação sem preço, fora da média). */
  readonly valueCents: number | null;
}

export interface PriceOutlier {
  readonly name: string;
  readonly valueCents: number;
  /** Desvio assinado em relação à média, em pontos percentuais inteiros (ex.: +80, -60). */
  readonly deviationPercent: number;
}

/**
 * Cotações válidas cujo desvio em relação à média das válidas é > 50%. Com menos de 2 cotações válidas não
 * há referência (nenhum outlier) — igual a `detectPriceOutlier`. Aritmética inteira:
 * |v − soma/n| / (soma/n) > 50%  ⇔  100·|n·v − soma| > 50·soma.
 */
export function findPriceOutliers(quotes: readonly PriceOutlierInput[]): PriceOutlier[] {
  const valid = quotes.filter((q): q is PriceOutlierInput & { valueCents: number } =>
    typeof q.valueCents === "number" && Number.isFinite(q.valueCents) && q.valueCents > 0);
  if (valid.length < 2) return [];
  const n = valid.length;
  const sum = valid.reduce((acc, q) => acc + Math.trunc(q.valueCents), 0);
  if (sum <= 0) return [];
  const out: PriceOutlier[] = [];
  for (const q of valid) {
    const v = Math.trunc(q.valueCents);
    const diff = n * v - sum; // n·(v − média)
    if (Math.abs(diff) * 100 > PRICE_OUTLIER_THRESHOLD_PERCENT * sum) {
      out.push({ name: q.name, valueCents: v, deviationPercent: Math.round((diff * 100) / sum) });
    }
  }
  return out;
}
