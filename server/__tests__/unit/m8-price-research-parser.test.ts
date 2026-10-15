/**
 * M8-PRICE-IMPORT-001 — leitura estruturada da Pesquisa de Preços (homologação real: 1 item com 3 cotações virou
 * 36 itens / 46 cotações porque cada LINHA era tratada como item).
 */
import { describe, expect, it } from "vitest";
import { parsePriceResearchText } from "../../domain/priceResearchParser";
import { extractItemsFromText } from "../../domain/priceResearch";
import { consolidateQuotes } from "../../domain/priceQuoteConsolidation";
import { isCatalogItemCandidate } from "../../domain/priceResearchParser";

const CTX = { researchId: "r1", processId: "p1", organizationId: 2 };

/** Formato documental típico (o colado na homologação real do processo sintético 2026/0001). */
const DOCUMENTAL = `PESQUISA DE PREÇOS — [HOMOLOGAÇÃO SINTÉTICA]
Prefeitura Sintética — Homologação
Processo: 2026/0001
Objeto: Aquisição de 10 computadores desktop completos para a Secretaria de Administração
Data da pesquisa: 10/10/2026
Responsável: Servidor de Homologação

Item 1 — Computador desktop completo
Descrição: processador de 8 núcleos, 16 GB de RAM, SSD 512 GB, monitor 23,8", teclado e mouse
Quantidade: 10
Unidade: UN

Cotação 1 — Alfa Informática Ltda (fictícia) — R$ 3.900,00 — 05/10/2026
Cotação 2 — Beta Tecnologia ME (fictícia) — R$ 4.100,00 — 06/10/2026
Cotação 3 — Gama Computadores (fictícia) — R$ 4.000,00 — 07/10/2026

Preço médio: R$ 4.000,00
Valor total estimado: R$ 40.000,00
Observação: dados fictícios, exclusivamente para homologação.
Aviso: esta pesquisa não substitui a pesquisa oficial (art. 23 da Lei 14.133/2021).`;

describe("M8-PRICE-IMPORT-001 — leitor estruturado", () => {
  it("1 item lógico, 3 cotações, média R$ 4.000,00, total R$ 40.000,00 — cabeçalho/metadados/avisos não viram itens", () => {
    const p = parsePriceResearchText(DOCUMENTAL);
    expect(p.blocking).toEqual([]);
    expect(p.format).toBe("documental");
    expect(p.items).toHaveLength(1);
    const [item] = p.items;
    expect(item.description).toBe("Computador desktop completo");
    expect(item.specification).toContain("16 GB de RAM");
    expect(item.quantity).toBe(10);
    expect(item.unit).toBe("UN");
    expect(item.quotes.map((q) => q.valueCents)).toEqual([390000, 410000, 400000]);
    expect(item.quotes.map((q) => q.supplier)).toEqual(["Alfa Informática Ltda (fictícia)", "Beta Tecnologia ME (fictícia)", "Gama Computadores (fictícia)"]);
    expect(item.quotes.map((q) => q.date)).toEqual(["05/10/2026", "06/10/2026", "07/10/2026"]);
    expect(item.averageCents).toBe(400000);
    expect(item.totalCents).toBe(4000000);
    expect(p.quoteCount).toBe(3);
    // Resumos declarados batem com o cálculo ⇒ sem aviso de divergência.
    expect(p.warnings.map((w) => w.code)).not.toContain("DECLARED_SUMMARY_MISMATCH");
    // Fonte fictícia e dado sintético SINALIZADOS (nunca tratados como pesquisa válida em silêncio).
    expect(p.synthetic).toBe(true);
    expect(item.quotes.every((q) => q.fictitious)).toBe(true);
    expect(p.warnings.map((w) => w.code)).toContain("FICTITIOUS_SOURCE");
    // Cada linha classificada: nenhum metadado/aviso/resumo virou cotação.
    const kinds = p.lines.map((l) => l.kind);
    expect(kinds.filter((k) => k === "quote")).toHaveLength(3);
    expect(kinds).toContain("metadata");
    expect(kinds).toContain("summary");
    expect(kinds).toContain("note");
    expect(kinds).not.toContain("unrecognized");
  });

  it("vira 3 cotações do MESMO item lógico na consolidação (não 36 itens / 46 cotações)", () => {
    const quotes = extractItemsFromText(DOCUMENTAL, CTX);
    expect(quotes).toHaveLength(3);
    const consolidated = consolidateQuotes(quotes.map((q) => ({
      quoteId: q.id, researchId: q.researchId, description: q.description, quantity: q.quantity, unit: q.unit,
      supplier: q.supplier, brand: q.brand, model: q.model, source: q.source, valueCents: Math.round(q.value * 100),
    })));
    expect(consolidated).toHaveLength(1);
    expect(consolidated[0].pricedQuoteCount).toBe(3);
    expect(consolidated[0].averageCents).toBe(400000);
    expect(quotes[0].observations).toContain("Fonte fictícia/sintética");
  });

  it("reimportar o mesmo texto gera as MESMAS identidades (idempotente)", () => {
    expect(extractItemsFromText(DOCUMENTAL, CTX).map((q) => q.id)).toEqual(extractItemsFromText(DOCUMENTAL, CTX).map((q) => q.id));
  });

  it("blocos de cotação em várias linhas (Fornecedor:/Valor unitário:/Data:) e quantidade no título", () => {
    const p = parsePriceResearchText(`Item 1 — Computador desktop completo — 10 unidades
Cotação 1
Fornecedor: Alfa Informática Ltda
Valor unitário: R$ 3.900,00
Data: 05/10/2026
Cotação 2
Fornecedor: Beta Tecnologia
Valor unitário: R$ 4.100,00
Cotação 3
Fornecedor: Gama Computadores
Valor unitário: R$ 4.000,00`);
    expect(p.blocking).toEqual([]);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ description: "Computador desktop completo", quantity: 10, unit: "UN", averageCents: 400000, totalCents: 4000000 });
    expect(p.items[0].quotes.map((q) => [q.supplier, q.date])).toEqual([["Alfa Informática Ltda", "05/10/2026"], ["Beta Tecnologia", ""], ["Gama Computadores", ""]]);
    expect(p.synthetic).toBe(false);
  });

  it("valor antes de qualquer item ⇒ AMBÍGUO (bloqueia; nada é criado por presunção)", () => {
    const p = parsePriceResearchText("Fornecedor Alfa — R$ 3.900,00\nFornecedor Beta — R$ 4.100,00");
    expect(p.blocking.map((b) => b.code)).toContain("QUOTE_WITHOUT_ITEM");
  });

  it("dois valores na linha sem indicar o unitário ⇒ AMBÍGUO; com rótulo de unitário ⇒ usa o unitário", () => {
    const amb = parsePriceResearchText("Item 1 — Computador\nQuantidade: 10\nAlfa — R$ 3.900,00 — R$ 39.000,00");
    expect(amb.blocking.map((b) => b.code)).toContain("MULTIPLE_PRICES");
    const ok = parsePriceResearchText("Item 1 — Computador\nQuantidade: 10\nAlfa — R$ 3.900,00 (unitário) — R$ 39.000,00 (total)");
    expect(ok.blocking).toEqual([]);
    expect(ok.items[0].quotes[0].valueCents).toBe(390000);
  });

  it("item sem preço no formato documental ⇒ bloqueia; quantidade ausente fica pendente (nunca inventada)", () => {
    expect(parsePriceResearchText("Item 1 — Computador\nQuantidade: 10").blocking.map((b) => b.code)).toContain("ITEM_WITHOUT_PRICE");
    const noQty = parsePriceResearchText("Item 1 — Computador\nAlfa — R$ 3.900,00");
    expect(noQty.blocking).toEqual([]);
    expect(noQty.items[0].quantity).toBeNull();
    expect(noQty.items[0].totalCents).toBeNull();
    expect(noQty.warnings.map((w) => w.code)).toContain("QUANTITY_MISSING");
    expect(extractItemsFromText("Item 1 — Computador\nAlfa — R$ 3.900,00", CTX)[0].quantity).toBe(0); // 0 = não informada (R10)
  });

  it("resumo declarado divergente do cálculo ⇒ aviso (prevalece o cálculo)", () => {
    const p = parsePriceResearchText("Item 1 — Computador\nQuantidade: 10\nAlfa — R$ 3.900,00\nBeta — R$ 4.100,00\nPreço médio: R$ 4.500,00");
    expect(p.items[0].averageCents).toBe(400000);
    expect(p.warnings.map((w) => w.code)).toContain("DECLARED_SUMMARY_MISMATCH");
  });

  it("texto sem nenhum item ⇒ EMPTY (bloqueia)", () => {
    expect(parsePriceResearchText("Processo: 2026/0001\nObjeto: Aquisição de computadores").blocking.map((b) => b.code)).toEqual(["EMPTY"]);
  });
});

describe("M8-PRICE-IMPORT-001 — formato delimitado legado preservado", () => {
  it("uma linha = uma cotação; mesma descrição/unidade/quantidade agrupa no mesmo item", () => {
    const p = parsePriceResearchText("Caneta azul;100;un;1,50;Fornecedor A\nCaneta azul;100;un;1,80;Fornecedor B\nPapel A4;50;resma;25,00");
    expect(p.format).toBe("delimited");
    expect(p.blocking).toEqual([]);
    expect(p.items.map((i) => [i.description, i.quotes.length])).toEqual([["Caneta azul", 2], ["Papel A4", 1]]);
    expect(p.items[0].averageCents).toBe(165);
  });

  it("identidade por linha igual à do leitor anterior (índice entre linhas não vazias)", () => {
    const items = extractItemsFromText("Caneta azul;100;un;1,50\nPapel A4;50;resma;25,00", CTX);
    expect(items.map((i) => [i.description, i.quantity, i.unit, i.value])).toEqual([["Caneta azul", 100, "un", 1.5], ["Papel A4", 50, "resma", 25]]);
  });

  it("cabeçalho da planilha não vira item e reordena colunas pelo nome", () => {
    const p = parsePriceResearchText("Fornecedor\tDescrição\tQtd\tUnidade\tValor unitário\nAlfa\tComputador desktop\t10\tUN\tR$ 3.900,00\nBeta\tComputador desktop\t10\tUN\tR$ 4.100,00");
    expect(p.lines[0].kind).toBe("header");
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ description: "Computador desktop", quantity: 10, unit: "UN", averageCents: 400000 });
    expect(p.items[0].quotes.map((q) => q.supplier)).toEqual(["Alfa", "Beta"]);
  });

  it("linha 'Fornecedor; R$ valor; data' não é confundida com linha delimitada (quantidade ≠ preço)", () => {
    const p = parsePriceResearchText("Item 1 — Computador\nQuantidade: 10\nAlfa; R$ 3.900,00; 05/10/2026");
    expect(p.items[0].quotes).toHaveLength(1);
    expect(p.items[0].quantity).toBe(10);
    expect(p.items[0].quotes[0].valueCents).toBe(390000);
  });
});

describe("M8-PRICE-IMPORT-001 — guarda do CATMAT", () => {
  it("só sugere catálogo para item real (descrição de bem/serviço com preço), nunca para fragmento administrativo", () => {
    expect(isCatalogItemCandidate({ description: "Computador desktop completo", pricedQuotes: 3 })).toBe(true);
    expect(isCatalogItemCandidate({ description: "Processo: 2026/0001", pricedQuotes: 1 })).toBe(false);
    expect(isCatalogItemCandidate({ description: "Observação: dados fictícios", pricedQuotes: 1 })).toBe(false);
    expect(isCatalogItemCandidate({ description: "Quantidade: 10", pricedQuotes: 0 })).toBe(false);
    expect(isCatalogItemCandidate({ description: "Computador desktop completo", pricedQuotes: 0 })).toBe(false);
    expect(isCatalogItemCandidate({ description: "R$ 3.900,00", pricedQuotes: 1 })).toBe(false);
  });
});
