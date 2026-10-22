/**
 * PR-04 (SEM-005) — detecção pura das cotações já registradas que uma colagem legada SUBSTITUIRIA.
 * Identidade legada = (pesquisa da fonte, linha, descrição): mesma linha + mesmo item com outro fornecedor/valor
 * é substituição (exige confirmação); conteúdo idêntico é replay (converge sem pedir nada); id novo é acréscimo.
 */
import { describe, it, expect } from "vitest";
import {
  createPriceResearchWorkspace, extractItemsFromText, findQuoteReplacements,
  PriceQuoteReplacementRequiresConfirmationError, type StoredResearchQuote, type PriceResearchItem,
} from "../domain/priceResearch";

const research = createPriceResearchWorkspace({ processId: "p1", organizationId: 7, source: "colar", correlationId: "c" });
const extract = (text: string) => extractItemsFromText(text, { researchId: research.id, processId: "p1", organizationId: 7 });
/** Como o MySQL devolve a linha gravada (decimais como string). */
const stored = (it: PriceResearchItem): StoredResearchQuote => ({
  id: it.id, description: it.description, quantity: it.quantity.toFixed(3), unit: it.unit, supplier: it.supplier,
  brand: it.brand, model: it.model, value: it.value.toFixed(2), observations: it.observations,
});

const FIRST = "Notebook;10;un;R$ 4.000,00;Fornecedor A\nNotebook;10;un;R$ 4.100,00;Fornecedor B\nNotebook;10;un;R$ 3.900,00;Fornecedor C";
const SECOND = "Notebook;10;un;R$ 4.200,00;Fornecedor D\nNotebook;10;un;R$ 4.050,00;Fornecedor E\nNotebook;10;un;R$ 3.950,00;Fornecedor F";

describe("PR-04 · findQuoteReplacements", () => {
  it("2ª colagem com o mesmo item nas mesmas linhas e outros fornecedores ⇒ 3 substituições (o defeito SEM-005)", () => {
    const first = extract(FIRST);
    const second = extract(SECOND);
    expect(second.map((q) => q.id)).toEqual(first.map((q) => q.id)); // identidade colide: mesma linha + descrição
    const r = findQuoteReplacements(first.map(stored), second);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({
      description: "Notebook",
      before: { supplier: "Fornecedor A", valueCents: 400000 },
      after: { supplier: "Fornecedor D", valueCents: 420000 },
    });
  });

  it("reimportação idêntica ⇒ nenhuma substituição (replay converge, decimais do MySQL normalizados)", () => {
    const first = extract(FIRST);
    expect(findQuoteReplacements(first.map(stored), extract(FIRST))).toEqual([]);
  });

  it("pesquisa completa (anteriores + novas abaixo) ⇒ nenhuma substituição: as 3 novas são acréscimo", () => {
    const first = extract(FIRST);
    const combined = extract(`${FIRST}\n${SECOND}`);
    expect(combined).toHaveLength(6);
    expect(new Set(combined.map((q) => q.id)).size).toBe(6);
    expect(findQuoteReplacements(first.map(stored), combined)).toEqual([]);
  });

  it("qualquer campo de conteúdo alterado é substituição; id inexistente nunca é", () => {
    const [q] = extract("Papel A4;10;resma;R$ 100,00;Papelaria X");
    const base = stored(q);
    for (const patch of [{ value: "100.01" }, { supplier: "Outra" }, { quantity: "11.000" }, { unit: "cx" }, { brand: "M" }, { model: "Z" }, { observations: "Data: 01/01/2026" }]) {
      expect(findQuoteReplacements([{ ...base, ...patch }], [q]), JSON.stringify(patch)).toHaveLength(1);
    }
    expect(findQuoteReplacements([{ ...base, id: "outro" }], [q])).toEqual([]);
    expect(findQuoteReplacements([{ ...base, observations: null }], [{ ...q, observations: "" }])).toEqual([]);
  });

  it("erro de confirmação: código estável, contagem e orientação acrescentar × corrigir", () => {
    const r = findQuoteReplacements(extract(FIRST).map(stored), extract(SECOND));
    const err = new PriceQuoteReplacementRequiresConfirmationError(r);
    expect(err.code).toBe("QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED");
    expect(err.message.startsWith("QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED:")).toBe(true);
    expect(err.message).toContain("substituiria 3 cotação(ões)");
    expect(err.message).toContain("Nada foi gravado");
    expect(err.message).toContain("Fornecedor A");
    expect(err.message).toMatch(/ACRESCENTAR[\s\S]*CORRIGIR/);
  });

  it("mesma fonte e mesmo valor, outro campo alterado ⇒ mensagem diz o que mudou (nunca 'X → X')", () => {
    const [q] = extract("Papel A4;10;resma;R$ 100,00;Papelaria X");
    const err = new PriceQuoteReplacementRequiresConfirmationError(findQuoteReplacements([{ ...stored(q), quantity: "12.000" }], [q]));
    expect(err.message).toContain("quantidade, unidade, marca, modelo ou observações alteradas");
    expect(err.message).not.toContain("→");
  });
});
