import { formatCentsBRL } from "./money";

/**
 * R9 / SEM-081 — rótulo do "Valor estimado global": um total PARCIAL (itens sem preço de referência ficam fora da soma)
 * nunca é apresentado como global. Função pura, compartilhada pelo servidor (contextos de ETP/TR/Edital) e pela UI.
 */
export function globalEstimateLabel(input: { readonly unpricedItemCount: number; readonly itemCount: number }): string {
  const unpriced = Math.max(0, Math.trunc(input.unpricedItemCount) || 0);
  if (unpriced === 0) return "Valor estimado global (calculado pelo sistema)";
  const total = Math.max(unpriced, Math.trunc(input.itemCount) || 0);
  return `Valor estimado global PARCIAL (${unpriced} de ${total} item(ns) sem preço de referência não entram no total)`;
}

/**
 * PROMPT 08 / D-5 — decisão M8 (antes só na UI, `authoringSourcesView.ts`): a AUSÊNCIA de preço de referência nunca vira
 * "R$ 0,00". Fonte ÚNICA do texto e da regra para UI, contexto de IA, quadro autoritativo (ETP/TR/Edital) e prosa do servidor
 * — e, por consequência, DOCX/PDF (que renderizam o conteúdo gerado).
 */
export const ESTIMATE_UNAVAILABLE_TEXT = "Valor estimado indisponível — nenhum item possui preço de referência válido";
export const ESTIMATE_NO_QUANTITY_TEXT = "Valor estimado indisponível — nenhum item com preço de referência tem quantidade informada";

export interface GlobalEstimateFacts {
  readonly itemCount: number;
  /** Itens com preço de referência válido (inclui zero EFETIVAMENTE informado, quando o produtor o distingue da ausência). */
  readonly pricedItemCount: number;
  readonly unpricedItemCount: number;
  /** Itens que de fato compõem o total (preço válido E quantidade informada). */
  readonly contributingItemCount: number;
  readonly globalTotalCents: number;
}

/**
 * Linha do valor estimado global: indisponível (sem nenhum preço / nenhum item precificado com quantidade) ⇒ texto M8, nunca
 * valor; parcial ⇒ rótulo PARCIAL (`globalEstimateLabel`); completo ⇒ total calculado. Zero informado e precificado continua
 * sendo um valor (não é confundido com ausência).
 */
export function globalEstimateText(e: GlobalEstimateFacts): { readonly available: boolean; readonly text: string } {
  if ((Math.trunc(e.pricedItemCount) || 0) <= 0) return { available: false, text: ESTIMATE_UNAVAILABLE_TEXT };
  if ((Math.trunc(e.contributingItemCount) || 0) <= 0) return { available: false, text: ESTIMATE_NO_QUANTITY_TEXT };
  return { available: true, text: `${globalEstimateLabel(e)}: ${formatCentsBRL(e.globalTotalCents)}` };
}
