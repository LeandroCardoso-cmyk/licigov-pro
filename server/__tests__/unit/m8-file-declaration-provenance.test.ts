/**
 * M8 — EMENDA DE INTEGRIDADE (PR #312, P1-B): declaração EXPLÍCITA de dados fictícios no cabeçalho/título/notas de um
 * ARQUIVO importado não pode desaparecer na promoção. Regras puras + extração real (CSV/linhas/tabela) — sem banco.
 * A propagação até a cotação persistida, o Item Inteligente e o bloqueio documental está no smoke MySQL
 * `m8-file-declaration-provenance-mysql-smoke.test.ts`. Numeração [n] = lista de testes da emenda.
 */
import { describe, it, expect } from "vitest";
import {
  classifyDocumentDeclaration, classifyIncomingQuote, dedupeDocumentDeclarations, documentFictitiousDeclaration,
  DOCUMENT_DECLARES_FICTITIOUS, DOCUMENT_PARTIAL_FICTITIOUS_DECLARATION,
} from "../../domain/quoteProvenance";
import { documentDeclarationWarnings, linesToRawItems, tableToRawItems, type TabularContext } from "../../parsers/tabularExtraction";
import { CsvParser } from "../../parsers/csvParser";
import { parsePriceResearchText } from "../../domain/priceResearchParser";
import { extractItemsFromText } from "../../domain/priceResearch";
import { XlsxParser } from "../../parsers/xlsxParser";
import { xlsxBuffer } from "../helpers/xlsxFixture";

const ctx: TabularContext = {
  importSessionId: 1, parserType: "csv", parserVersion: "t", sourceFileId: "f", sourceFileName: "p.csv", sourceMimeType: "text/csv", sourceChecksum: "c", maxItems: 100,
};
const loc = (r: number) => ({ location: { row: r + 1 }, extras: {} });
const codes = (ws: ReadonlyArray<{ code: string }>) => ws.map((w) => w.code).filter((c) => c.startsWith("DOCUMENT_"));
const csv = (text: string) => new CsvParser().parse(Buffer.from(text, "utf8"), {
  importSessionId: 1, organizationId: 7, sourceFileId: "f", sourceFileName: "pesquisa.csv", sourceMimeType: "text/csv", sourceChecksum: "c",
});

describe("M8 emenda — declaração do DOCUMENTO: escopo, negação e ambiguidade", () => {
  it("declarações explícitas do CONJUNTO ⇒ global", () => {
    for (const t of [
      "Todos os preços desta planilha são fictícios.", "Dados fictícios para homologação.",
      "Valores demonstrativos, sem correspondência com pesquisa real.", "Cotações fictícias utilizadas exclusivamente para testes.",
      "PESQUISA DE PREÇOS — DADOS FICTÍCIOS PARA HOMOLOGAÇÃO",
    ]) expect(classifyDocumentDeclaration(t), t).toBe("global");
  });

  it("[5][6][7][8] termos genéricos, negação e cabeçalho ambíguo ⇒ nada declarado", () => {
    for (const t of [
      "Teste de qualidade dos produtos", "Homologação de fornecedor", "Exemplo de especificação técnica",
      "Pesquisa sintética de mercado", "Não foram utilizadas cotações fictícias.", "Papelaria Teste & Cia",
      "Pesquisa de preços — homologação 2026",
    ]) expect(classifyDocumentDeclaration(t), t).toBeNull();
  });

  it("[auditoria P2-2] rótulo isolado e cotação singular desconsiderada ⇒ só revisão (parcial), nunca o conjunto", () => {
    for (const t of [
      "Fornecedor Fictício A", "Desconsiderada a cotação da empresa X por ser proposta fictícia",
      "Fornecedores consultados: Fornecedor Fictício A; Comercial Real Ltda",
    ]) expect(classifyDocumentDeclaration(t), t).toBe("partial");
  });

  it("[auditoria P1-1] títulos/notas explícitos do conjunto continuam globais (arquivo e colagem)", () => {
    for (const t of ["EXEMPLO FICTÍCIO", "ITENS FICTÍCIOS PARA HOMOLOGAÇÃO", "Observação: empresas fictícias, uso em treinamento", "Observação: tudo fictício"]) {
      expect(classifyDocumentDeclaration(t), t).toBe("global");
      const p = parsePriceResearchText([t, "Caneta azul;10;UN;R$ 1,50;Papelaria Alfa"].join("\n"));
      expect(p.items[0].quotes[0].fictitious, t).toBe(true);
    }
  });

  it("[9] documento parcialmente demonstrativo ⇒ só revisão (parcial), nunca o conjunto", () => {
    expect(classifyDocumentDeclaration("Os valores dos itens 3 e 4 são fictícios.")).toBe("partial");
    expect(classifyDocumentDeclaration("Algumas cotações são fictícias.")).toBe("partial");
    expect(documentFictitiousDeclaration([{ code: DOCUMENT_PARTIAL_FICTITIOUS_DECLARATION }])).toBe("suspected");
  });

  it("[10] OCR de baixa confiança ⇒ declaração lida não é confirmada (suspeita)", () => {
    expect(documentFictitiousDeclaration([{ code: DOCUMENT_DECLARES_FICTITIOUS }])).toBe("global");
    expect(documentFictitiousDeclaration([{ code: DOCUMENT_DECLARES_FICTITIOUS }, { code: "OCR_LOW_CONFIDENCE" }])).toBe("global"); // texto nativo
    expect(documentFictitiousDeclaration([{ code: DOCUMENT_DECLARES_FICTITIOUS, field: "ocr" }, { code: "OCR_LOW_CONFIDENCE" }])).toBe("suspected");
    expect(documentFictitiousDeclaration([{ code: DOCUMENT_DECLARES_FICTITIOUS, field: "ocr" }])).toBe("global");
    // [auditoria P2-1] PDF misto: declaração no texto NATIVO não é rebaixada por um anexo OCR de baixa confiança.
    expect(documentFictitiousDeclaration([{ code: DOCUMENT_DECLARES_FICTITIOUS, field: "ocr" }, { code: DOCUMENT_DECLARES_FICTITIOUS }, { code: "OCR_LOW_CONFIDENCE" }])).toBe("global");
    expect(documentFictitiousDeclaration(null)).toBeNull();
    expect(documentFictitiousDeclaration([{ code: "HEADER_INFERENCE" }])).toBeNull(); // [20] legado sem declaração
  });

  it("[3][4] declaração na OBSERVAÇÃO da cotação e nome 'Fornecedor Fictício A' continuam por cotação", () => {
    expect(classifyIncomingQuote({ supplier: "Alfa", notes: "valor fictício" })).toBe("ficticia");
    expect(classifyIncomingQuote({ supplier: "Fornecedor Fictício A" })).toBe("ficticia");
    expect(classifyIncomingQuote({ supplier: "Alfa" })).toBe("declarada");
    expect(classifyIncomingQuote({ supplier: "Alfa", documentDeclaresFictitious: true })).toBe("ficticia");
  });
});

describe("M8 emenda — extração real preserva a declaração do arquivo", () => {
  it("[1][2] CSV com título 'DADOS FICTÍCIOS' acima do cabeçalho e fornecedores de aparência real ⇒ aviso global estruturado", async () => {
    const r = await csv([
      "PESQUISA DE PREÇOS — DADOS FICTÍCIOS PARA HOMOLOGAÇÃO", "",
      "Descrição;Quantidade;Unidade;Valor unitário;Fornecedor",
      "Caneta azul;10;UN;1,50;Empresa Alfa", "Caneta azul;10;UN;1,70;Empresa Beta",
    ].join("\n"));
    expect(r.items.length).toBe(2);
    const w = r.warnings.find((x) => x.code === DOCUMENT_DECLARES_FICTITIOUS);
    expect(w?.raw).toContain("DADOS FICTÍCIOS");
    expect(documentFictitiousDeclaration(r.warnings)).toBe("global");
  });

  it("nota no fim da planilha (linha sem número) também declara; linha de dado com fornecedor fictício NÃO vira declaração global", () => {
    const note = tableToRawItems([
      ["Descrição", "Quantidade", "Valor unitário", "Fornecedor"],
      ["Caneta azul", "10", "1,50", "Empresa Alfa"],
      ["Observação: todos os valores são demonstrativos", "", "", ""],
    ], ctx, { positionalFallback: "description_only" }, loc);
    expect(codes(note.warnings)).toEqual([DOCUMENT_DECLARES_FICTITIOUS]);
    const row = tableToRawItems([
      ["Descrição", "Quantidade", "Valor unitário", "Fornecedor"],
      ["Caneta azul", "10", "1,50", "Fornecedor Fictício A"],
      ["Caneta azul", "10", "1,70", "Empresa Beta"],
    ], ctx, { positionalFallback: "description_only" }, loc);
    expect(codes(row.warnings)).toEqual([]);
  });

  it("[5][6][7] arquivo legítimo com 'teste'/'homologação'/negação ⇒ nenhum aviso de declaração", async () => {
    const r = await csv([
      "Pesquisa de preços — homologação de fornecedor 2026", "Não foram utilizadas cotações fictícias.",
      "Descrição;Quantidade;Unidade;Valor unitário;Fornecedor",
      "Kit teste de qualidade;10;UN;15,00;Papelaria Teste & Cia",
    ].join("\n"));
    expect(codes(r.warnings)).toEqual([]);
    expect(documentFictitiousDeclaration(r.warnings)).toBeNull();
  });

  it("texto de PDF/OCR por linhas: título e nota sem valor declaram; linhas de preço ficam de fora", () => {
    const out = linesToRawItems([
      "Mapa de preços — cotações fictícias para treinamento",
      "Caneta azul  10  UN  1,50  15,00",
    ], { ...ctx, parserType: "pdf" }, (i) => ({ location: { page: 1, line: i + 1 }, extras: {} }));
    expect(codes(out.warnings)).toEqual([DOCUMENT_DECLARES_FICTITIOUS]);
  });

  it("um aviso por tipo, mesmo com várias fontes no mesmo arquivo (tabela + texto)", () => {
    const ws = [...documentDeclarationWarnings(["Dados fictícios."]), ...documentDeclarationWarnings(["Valores fictícios para teste."])];
    expect(codes(dedupeDocumentDeclarations(ws))).toEqual([DOCUMENT_DECLARES_FICTITIOUS]);
  });

  it("colagem: nota parcial não marca o conjunto (só suspeita); nota global marca", () => {
    const partial = parsePriceResearchText(["Observação: os itens 3 e 4 têm valores fictícios", "Caneta azul;10;UN;R$ 1,50;Papelaria Alfa"].join("\n"));
    expect(partial.synthetic).toBe(false);
    expect(partial.suspected).toBe(true);
    const global = parsePriceResearchText(["Observação: todos os valores são fictícios", "Caneta azul;10;UN;R$ 1,50;Papelaria Alfa"].join("\n"));
    expect(global.items[0].quotes[0].fictitious).toBe(true);
  });
});

describe("M8 emenda — auditoria: Contratação Direta e XLSX com várias abas", () => {
  it("[auditoria P1-1] importação direta (colagem) com título 'EXEMPLO FICTÍCIO' grava as cotações como fictícias", () => {
    const items = extractItemsFromText(["EXEMPLO FICTÍCIO", "Caneta azul;10;un;1,00;Papelaria Alfa", "Caneta azul;10;un;2,00;Comercial Beta"].join("\n"),
      { researchId: "r", processId: "ws", organizationId: 7 });
    expect(items.map((i) => i.provenanceKind)).toEqual(["ficticia", "ficticia"]);
  });

  it("[auditoria P2-3] declaração numa aba de capa ('Leia-me') de XLSX é lida", async () => {
    const buf = await xlsxBuffer([
      ["Cotações", [["Descrição", "Quantidade", "Valor unitário", "Fornecedor"], ["Caneta azul", 10, 1.5, "Empresa Alfa"]]],
      ["Leia-me", [["Leia-me"], ["Todos os valores desta planilha são fictícios."]]],
    ]);
    const r = await new XlsxParser().parse(buf, {
      importSessionId: 1, organizationId: 7, sourceFileId: "f", sourceFileName: "p.xlsx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceChecksum: "c",
    });
    expect(r.items.length).toBe(1);
    expect(documentFictitiousDeclaration(r.warnings)).toBe("global");
  });
});
