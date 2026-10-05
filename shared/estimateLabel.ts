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
