/**
 * R9 / SEM-081 — um valor estimado global PARCIAL (itens sem preço de referência fora da soma) nunca é apresentado
 * como global: o rótulo diz "PARCIAL (N de M item(ns) sem preço)" no bloco autoritativo, no contexto de ETP/TR/Edital e na UI.
 */
import { describe, it, expect } from "vitest";
import { globalEstimateLabel } from "../../../shared/estimateLabel";
import { computeItemEstimates, renderAuthoritativeItemsBlock } from "../../domain/authoritativeItems";

describe("SEM-081 — rótulo do valor estimado global", () => {
  it("todos com preço ⇒ rótulo global; algum sem preço ⇒ PARCIAL com contagem", () => {
    expect(globalEstimateLabel({ unpricedItemCount: 0, itemCount: 3 })).toBe("Valor estimado global (calculado pelo sistema)");
    expect(globalEstimateLabel({ unpricedItemCount: 2, itemCount: 5 })).toBe("Valor estimado global PARCIAL (2 de 5 item(ns) sem preço de referência não entram no total)");
    expect(globalEstimateLabel({ unpricedItemCount: 2, itemCount: 0 })).toContain("2 de 2");
  });
  it("o bloco autoritativo do TR rotula o total parcial (e não o chama de global)", () => {
    const items = [
      { id: "a", description: "Com preço", quantity: 10, unit: "UN", averagePriceCents: 1_000, quoteCount: 3, confirmedCatalogCode: null, suggestedCatalogCode: null },
      { id: "b", description: "Sem preço", quantity: 5, unit: "UN", averagePriceCents: 0, quoteCount: 0, confirmedCatalogCode: null, suggestedCatalogCode: null },
    ];
    const estimate = computeItemEstimates(items, { preserveOrder: true });
    const block = renderAuthoritativeItemsBlock(estimate, { quantitySource: "canonical_planned" });
    expect(block).toContain("**Valor estimado global PARCIAL (1 de 2 item(ns) sem preço de referência não entram no total):** R$ 100,00");
    expect(block).not.toContain("**Valor estimado global:**");
    const complete = renderAuthoritativeItemsBlock(computeItemEstimates([items[0]], { preserveOrder: true }), { quantitySource: "canonical_planned" });
    expect(complete).toContain("**Valor estimado global:** R$ 100,00");
  });
});
