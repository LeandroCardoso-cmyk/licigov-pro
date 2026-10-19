/**
 * M8 hardening — cotações de fonte FICTÍCIA no consumo documental (ETP/TR/Edital): o bloco autoritativo marca
 * [REVISAR] quando há cotação fictícia; sem ela, o bloco é BYTE-IDÊNTICO ao anterior (replay preservado).
 */
import { describe, it, expect } from "vitest";
import { computeItemEstimates, renderAuthoritativeItemsBlock, fictitiousQuotesReviewText } from "../../domain/authoritativeItems";
import { extractItemsFromText, FICTITIOUS_QUOTE_MARKER } from "../../domain/priceResearch";

const base = { id: "a", description: "Caneta esferográfica azul", quantity: 10, unit: "UN", averagePriceCents: 15_000, quoteCount: 2, confirmedCatalogCode: null, suggestedCatalogCode: null };

describe("M8 hardening — documento nunca apresenta cotação fictícia como pesquisa válida", () => {
  it("com cotação fictícia ⇒ linha [REVISAR] explícita no bloco autoritativo", () => {
    const block = renderAuthoritativeItemsBlock(computeItemEstimates([{ ...base, fictitiousQuoteCount: 2 }]));
    expect(block).toContain(fictitiousQuotesReviewText(2));
    expect(block).toContain("não constitui pesquisa de preços válida");
  });

  it("sem cotação fictícia (0/ausente) ⇒ bloco byte-idêntico", () => {
    const legacy = renderAuthoritativeItemsBlock(computeItemEstimates([base]));
    expect(renderAuthoritativeItemsBlock(computeItemEstimates([{ ...base, fictitiousQuoteCount: 0 }]))).toBe(legacy);
    expect(legacy).not.toContain("fonte fictícia");
  });

  it("marcador do parser sobrevive ao limite de 1.000 caracteres das observações", () => {
    const spec = "x".repeat(1500);
    const text = [
      "Item 1 — Caneta esferográfica azul", `Descrição: ${spec}`, "Quantidade: 10", "Unidade: UN", "",
      "Cotação 1 — Fornecedor Fictício A — R$ 100,00 — 05/10/2026",
    ].join("\n");
    const items = extractItemsFromText(text, { researchId: "r1", processId: "p1", organizationId: 1 });
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect((it.observations ?? "").length).toBeLessThanOrEqual(1000);
      expect(it.observations ?? "").toContain(FICTITIOUS_QUOTE_MARKER);
    }
  });
});
