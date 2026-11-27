/**
 * PROMPT 08 / D-5 — valor estimado inexistente nunca vira "R$ 0,00". Verificado sobre os ARTEFATOS efetivamente produzidos:
 * o quadro autoritativo (o mesmo que TR, ETP canônico e Edital gravam), a prosa da seção de estimativa redigida pelo servidor e
 * o DOCX/PDF renderizados pelo conversor institucional a partir desse conteúdo. Cenários: sem preço, parcial, completo, zero
 * informado e preço sem quantidade.
 */
import { describe, expect, it } from "vitest";
import { computeItemEstimates, renderAuthoritativeItemsBlock, type AuthoritativeItemInput } from "../../domain/authoritativeItems";
import { serverEstimateProse } from "../../domain/aiNumericAuthority";
import { buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF, type InstitutionalMeta } from "../../services/documentConverter";
import { ESTIMATE_NO_QUANTITY_TEXT, ESTIMATE_UNAVAILABLE_TEXT, globalEstimateText } from "../../../shared/estimateLabel";
import { readZipEntry } from "../helpers/zipText";

const item = (id: string, over: Partial<AuthoritativeItemInput> = {}): AuthoritativeItemInput => ({
  id, description: `Item sintético ${id}`, quantity: 10, unit: "un", averagePriceCents: 0, quoteCount: 0,
  confirmedCatalogCode: null, suggestedCatalogCode: null, priceBlockedReason: null, ...over,
});

const META: InstitutionalMeta = {
  organizationName: "Município Sintético de Homologação", documentTitle: "TR — Termo de Referência", processNumber: "9999/2026",
  statusLabel: "RASCUNHO", isDraft: true, version: 1, emissionNumber: 0, exportedAtLabel: "27/11/2026 às 10:00",
};

async function pdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = (await import("pdf-parse")) as unknown as {
    PDFParse: new (o: { data: Uint8Array; verbosity?: number }) => { getText(): Promise<{ pages: Array<{ text: string }> }>; destroy?(): Promise<void> };
  };
  const parser = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  const res = await parser.getText();
  await parser.destroy?.();
  return res.pages.map((p) => p.text).join("\n");
}

const proseFor = (items: AuthoritativeItemInput[]) => {
  const e = computeItemEstimates(items, { preserveOrder: true });
  return serverEstimateProse({
    itemCount: e.itemCount, pricedItemCount: e.pricedItemCount, unpricedItemCount: e.unpricedItemCount, contributingItemCount: e.contributingItemCount,
    globalTotalCents: e.globalTotalCents, rows: e.rows, missingPlannedQuantity: 0, hasAuthoritativeBlock: true,
  });
};

describe("D-5 — sem nenhum preço de referência", () => {
  const items = [item("a"), item("b")];
  const estimate = computeItemEstimates(items, { preserveOrder: true });
  const block = renderAuthoritativeItemsBlock(estimate, { quantitySource: "canonical_planned" });

  it("quadro autoritativo: texto M8 (indisponível), nenhum R$ 0,00", () => {
    expect(block).toContain(ESTIMATE_UNAVAILABLE_TEXT);
    expect(block).not.toMatch(/R\$\s*0,00/);
    expect(globalEstimateText(estimate)).toEqual({ available: false, text: ESTIMATE_UNAVAILABLE_TEXT });
  });

  it("prosa da seção de estimativa (servidor): indisponível, sem valor inferido", () => {
    const prose = proseFor(items);
    expect(prose).toContain(ESTIMATE_UNAVAILABLE_TEXT);
    expect(prose).not.toMatch(/R\$/);
  });

  it("DOCX e PDF gerados do conteúdo: mesma semântica (sem R$ 0,00)", async () => {
    const content = ["# Termo de Referência — sintético", "", "## Estimativa", "", proseFor(items), "", block].join("\n");
    const model = buildInstitutionalModel(content, META);
    const xml = readZipEntry(await renderInstitutionalDOCX(model), "word/document.xml") ?? "";
    expect(xml).toContain("Valor estimado indisponível");
    expect(xml).not.toMatch(/R\$\s*0,00/);
    const pdf = await pdfText(await renderInstitutionalPDF(model));
    expect(pdf.replace(/\s+/g, " ")).toContain("Valor estimado indisponível");
    expect(pdf).not.toMatch(/R\$\s*0,00/);
  }, 60_000);
});

describe("D-5 — preços parciais, completos, zero informado e sem quantidade", () => {
  it("parcial: rotulado PARCIAL com o total dos itens precificados (nunca como global definitivo)", () => {
    const estimate = computeItemEstimates([item("a", { averagePriceCents: 1_000, quoteCount: 3 }), item("b")], { preserveOrder: true });
    const block = renderAuthoritativeItemsBlock(estimate, { quantitySource: "canonical_planned" });
    expect(block).toMatch(/Valor estimado global PARCIAL \(1 de 2 item\(ns\) sem preço de referência não entram no total\):\*\* R\$ 100,00/);
    expect(block).toContain("[REVISAR: 1 item(ns) sem preço de referência");
    expect(proseFor([item("a", { averagePriceCents: 1_000, quoteCount: 3 }), item("b")])).toMatch(/R\$ 100,00.*\[REVISAR: 1 item\(ns\) sem preço/);
  });

  it("completo: total calculado corretamente (quantidade × referência)", () => {
    const estimate = computeItemEstimates([item("a", { averagePriceCents: 1_000, quoteCount: 3 }), item("b", { quantity: 2, averagePriceCents: 2_550, quoteCount: 3 })], { preserveOrder: true });
    expect(estimate.globalTotalCents).toBe(10 * 1_000 + 2 * 2_550);
    expect(renderAuthoritativeItemsBlock(estimate, { quantitySource: "canonical_planned" })).toContain("**Valor estimado global:** R$ 151,00");
  });

  it("zero EFETIVAMENTE informado: é um valor (R$ 0,00), não confundido com ausência", () => {
    const zero = [item("a", { averagePriceCents: 0, priceInformed: true, quoteCount: 1 })];
    const estimate = computeItemEstimates(zero, { preserveOrder: true });
    expect(estimate.pricedItemCount).toBe(1);
    expect(globalEstimateText(estimate)).toEqual({ available: true, text: "Valor estimado global (calculado pelo sistema): R$ 0,00" });
    expect(renderAuthoritativeItemsBlock(estimate, { quantitySource: "canonical_planned" })).toContain("**Valor estimado global:** R$ 0,00");
    // Mesmo zero, mas sem a informação de que foi informado (fonte legada NOT NULL default 0) ⇒ ausência.
    expect(computeItemEstimates([item("a", { averagePriceCents: 0 })]).pricedItemCount).toBe(0);
    // Zero com preço SUSPENSO não vale como informado.
    expect(computeItemEstimates([item("a", { averagePriceCents: 0, priceInformed: true, priceBlockedReason: "FICTITIOUS_SOURCE" })]).pricedItemCount).toBe(0);
  });

  it("preço sem quantidade: indisponível por falta de quantidade (texto M8), sem R$ 0,00", () => {
    const estimate = computeItemEstimates([item("a", { quantity: Number.NaN, averagePriceCents: 1_000, quoteCount: 3 })], { preserveOrder: true });
    expect(globalEstimateText(estimate)).toEqual({ available: false, text: ESTIMATE_NO_QUANTITY_TEXT });
    expect(renderAuthoritativeItemsBlock(estimate, { quantitySource: "canonical_planned" })).not.toMatch(/R\$\s*0,00/);
  });
});
