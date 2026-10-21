/**
 * M8 — EMENDA FINAL DE CLASSIFICAÇÃO DOCUMENTAL (PR #312): declaração GLOBAL explícita de dados fictícios acompanhada de
 * número (ano em célula separada, ano no título) não pode ser ignorada — antes, qualquer token "com cara de valor" (ex.:
 * "2026") excluía a linha da análise. Parsers REAIS (CSV, XLSX, DOCX, PDF) e colagem.
 *
 * Casos negativos: cotação legítima com números, nota de UMA cotação (com preço), declaração parcial com números, negação
 * e termos genéricos NÃO viram declaração global.
 */
import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, Table, TableRow, TableCell } from "docx";
import { CsvParser } from "../../parsers/csvParser";
import { XlsxParser } from "../../parsers/xlsxParser";
import { DocxParser } from "../../parsers/docxParser";
import { PdfParser } from "../../parsers/pdfParser";
import { isPriceToken } from "../../parsers/tabularExtraction";
import type { ParseOptions } from "../../parsers/baseParser";
import { parsePriceResearchText } from "../../domain/priceResearchParser";
import { documentFictitiousDeclaration } from "../../domain/quoteProvenance";

const opts = (mime: string): ParseOptions => ({ importSessionId: 1, organizationId: 42, sourceFileId: "x", sourceFileName: "x", sourceMimeType: mime, sourceChecksum: "a".repeat(64) });
const HEAD = "Descrição;Quantidade;Unidade;Valor unitário;Fornecedor";
const QUOTES = ["Caneta azul;10;UN;1,50;Empresa Alfa", "Caneta azul;10;UN;1,70;Empresa Beta"];
const csv = async (lines: string[]) => {
  const r = await new CsvParser().safeParse(Buffer.from(lines.join("\n")), opts("text/csv"));
  return { r, decl: documentFictitiousDeclaration(r.warnings) };
};
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("isPriceToken — só moeda/centavos é preço", () => {
  it("ano, número de item e quantidade não são preço; valores com centavos/moeda são", () => {
    for (const t of ["2026", "3", "10", "1.500"]) expect(isPriceToken(t)).toBe(false);
    for (const t of ["1,50", "945,00", "R$ 2", "R$2", "18.90"]) expect(isPriceToken(t)).toBe(true);
  });
});

describe("declaração GLOBAL com número é reconhecida", () => {
  it("CSV — ano em célula separada (linha sem preço após as cotações)", async () => {
    const { r, decl } = await csv([HEAD, ...QUOTES, "DADOS FICTÍCIOS PARA HOMOLOGAÇÃO;2026;;;"]);
    expect(decl).toBe("global");
    expect(r.items.map((i) => i.rawSupplier)).toEqual(["Empresa Alfa", "Empresa Beta"]); // só as cotações reais; a nota não vira item
  });
  it("CSV — ano no título acima do cabeçalho", async () => {
    expect((await csv(["DADOS FICTÍCIOS PARA HOMOLOGAÇÃO — 2026", "", HEAD, ...QUOTES])).decl).toBe("global");
  });
  it("CSV — sem número (detecção existente preservada)", async () => {
    expect((await csv(["PESQUISA DE PREÇOS — DADOS FICTÍCIOS PARA HOMOLOGAÇÃO", "", HEAD, ...QUOTES])).decl).toBe("global");
  });
  it("XLSX — ano em célula numérica separada", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Descrição", "Quantidade", "Unidade", "Valor unitário", "Fornecedor"],
      ["Caneta azul", 10, "UN", 1.5, "Empresa Alfa"], ["Caneta azul", 10, "UN", 1.7, "Empresa Beta"],
      ["DADOS FICTÍCIOS PARA HOMOLOGAÇÃO", 2026],
    ]), "Cotações");
    const r = await new XlsxParser().safeParse(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer, opts(XLSX_MIME));
    expect(documentFictitiousDeclaration(r.warnings)).toBe("global");
    expect(r.items.length).toBe(2);
  });
  it("DOCX — título com ano", async () => {
    const cell = (t: string) => new TableCell({ children: [new Paragraph(t)] });
    const buf = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph("DADOS FICTÍCIOS PARA HOMOLOGAÇÃO — 2026"),
      new Table({ rows: [["Descrição", "Qtd", "Unid", "V.Unit", "Fornecedor"], ["Caneta azul", "10", "UN", "1,50", "Empresa Alfa"]].map((r) => new TableRow({ children: r.map(cell) })) }),
    ] }] }));
    const r = await new DocxParser().safeParse(buf, opts("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    expect(documentFictitiousDeclaration(r.warnings)).toBe("global");
  });
  it("PDF nativo — título com ano (mesmo contrato compartilhado)", async () => {
    const buf = await new Promise<Buffer>((res) => {
      const d = new PDFDocument({ margin: 40 }); const c: Buffer[] = [];
      d.on("data", (x: Buffer) => c.push(x)); d.on("end", () => res(Buffer.concat(c))); d.fontSize(10);
      d.text("DADOS FICTÍCIOS PARA HOMOLOGAÇÃO — 2026");
      d.text("Descrição               Qtd      Unid     V.Unit       Total");
      d.text("Caneta azul             100      UN       1,50         150,00");
      d.end();
    });
    const r = await new PdfParser().safeParse(buf, opts("application/pdf"));
    expect(r.items.length).toBeGreaterThan(0);
    expect(documentFictitiousDeclaration(r.warnings)).toBe("global");
  });
  it("Colagem — ano no título e ano em célula separada", () => {
    expect(parsePriceResearchText(["DADOS FICTÍCIOS PARA HOMOLOGAÇÃO — 2026", HEAD, ...QUOTES].join("\n")).synthetic).toBe(true);
    const p = parsePriceResearchText([HEAD, ...QUOTES, "DADOS FICTÍCIOS PARA HOMOLOGAÇÃO;2026;;;"].join("\n"));
    expect(p.synthetic).toBe(true);
    expect(p.quoteCount).toBe(2); // a declaração virou nota, não cotação
  });
});

describe("sem falso positivo", () => {
  it("cotações legítimas com números, ano e 'homologação' no título ⇒ nada declarado", async () => {
    const { decl } = await csv(["Pesquisa de preços — homologação de fornecedor 2026", HEAD, "Lápis HB;20;UN;0,90;Papelaria Central", "Lápis HB;20;UN;1,10;Comercial Beta"]);
    expect(decl).toBeNull();
  });
  it("nota de UMA cotação (com preço) não vira declaração do documento nem deixa de ser cotação", async () => {
    const { r, decl } = await csv(["Descrição;Quantidade;Unidade;Valor unitário;Fornecedor;Observação", "Caneta azul;10;UN;1,50;Empresa Alfa;valores fictícios", "Caneta azul;10;UN;1,70;Empresa Beta;"]);
    expect(decl).not.toBe("global");
    expect(r.items.length).toBe(2);
  });
  it("linha sem preço mas COM fornecedor é cotação (revisão): não vira declaração do documento", async () => {
    const { r, decl } = await csv([HEAD, ...QUOTES, "DADOS FICTÍCIOS PARA HOMOLOGAÇÃO;2026;;;Empresa Gama"]);
    expect(decl).toBeNull();
    expect(r.items.map((i) => i.rawSupplier)).toEqual(["Empresa Alfa", "Empresa Beta", "Empresa Gama"]);
  });
  it("declaração PARCIAL com números ⇒ só revisão (suspected), nunca global", async () => {
    expect((await csv([HEAD, ...QUOTES, "Somente os itens 3 e 4 são fictícios.;;;;"])).decl).toBe("suspected");
    expect(parsePriceResearchText([HEAD, ...QUOTES, "Somente os itens 3 e 4 são fictícios.;;;;"].join("\n")).synthetic).toBe(false);
  });
  it("negação com número ⇒ nada declarado", async () => {
    expect((await csv([HEAD, ...QUOTES, "Não foram utilizadas cotações fictícias em 2026.;;;;"])).decl).toBeNull();
    expect((await csv(["Nenhum preço demonstrativo foi considerado — 2026", HEAD, ...QUOTES])).decl).toBeNull();
    expect(parsePriceResearchText([HEAD, ...QUOTES, "Não foram utilizadas cotações fictícias em 2026.;;;;"].join("\n")).synthetic).toBe(false);
  });
  it("termos genéricos (teste/exemplo/homologação/simulado) com número ⇒ nada declarado", async () => {
    for (const t of ["Teste de homologação 2026", "Exemplo 1 — simulado", "Homologação 2026"]) {
      expect((await csv([t, HEAD, ...QUOTES])).decl).toBeNull();
    }
  });
});

describe("auditoria — cotação com preço inteiro/moeda separada/número nativo nunca vira declaração do documento", () => {
  it("PDF: linha de cotação com preço INTEIRO e nota coletiva ⇒ não global", async () => {
    const buf = await new Promise<Buffer>((res) => {
      const d = new PDFDocument({ margin: 40 }); const c: Buffer[] = [];
      d.on("data", (x: Buffer) => c.push(x)); d.on("end", () => res(Buffer.concat(c))); d.fontSize(10);
      d.text("Descrição               Qtd      Unid     V.Unit       Total");
      d.text("Caneta azul             100      UN       2            200      valores demonstrativos");
      d.end();
    });
    const r = await new PdfParser().safeParse(buf, opts("application/pdf"));
    expect(documentFictitiousDeclaration(r.warnings)).not.toBe("global");
  });
  it("texto com 'R$ 2' separado por espaço e nota coletiva ⇒ não global", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Descrição", "Quantidade", "Unidade", "Valor unitário", "Fornecedor"], ["Caneta azul", 10, "UN", 1.5, "Empresa Alfa"]]), "Cotações");
    // Outra aba (varrida como texto): cotação com moeda separada e número nativo + nota coletiva de UMA cotação.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Caneta azul", 10, "UN", "R$ 2", "R$ 20", "Empresa Alfa — valores fictícios"], ["Lápis", 20, "UN", 1.5, 30, "preços demonstrativos"]]), "Rascunho");
    const r = await new XlsxParser().safeParse(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer, opts(XLSX_MIME));
    expect(documentFictitiousDeclaration(r.warnings)).not.toBe("global");
  });
  it("tabela SEM coluna de preço reconhecida: cotação com preço inteiro e nota coletiva ⇒ não global e item preservado", async () => {
    const { r, decl } = await csv(["Descrição;Quantidade;Unidade;Vlr ofertado;Obs", "Caneta;10;UN;2;valores demonstrativos", "Lápis;20;UN;3;"]);
    expect(decl).not.toBe("global");
    expect(r.items.length).toBe(2);
  });
  it("item sem preço com nota PARCIAL/singular é preservado (não descartado) e não vira global", async () => {
    const { r, decl } = await csv(["Descrição;Quantidade;Unidade;Valor unitário;Fornecedor;Observação", "Caneta azul;10;UN;1,50;Empresa Alfa;", "Grampeador;5;UN;;;cotação fictícia descartada"]);
    expect(decl).not.toBe("global");
    expect(r.items.map((i) => i.rawDescription)).toEqual(["Caneta azul", "Grampeador"]);
  });
  it("colagem: linha singular/rótulo sem valor NÃO torna o documento fictício", () => {
    for (const l of ["Fantasia de personagem fictício;10;UN;;", "Cotação fictícia desconsiderada;;;;", "Fornecedor fictício X foi excluído;;;;"]) {
      expect(parsePriceResearchText([HEAD, ...QUOTES, l].join("\n")).synthetic).toBe(false);
    }
  });
});

