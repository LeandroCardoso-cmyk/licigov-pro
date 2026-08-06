/**
 * PR B.2.3 — Extração REAL de PDF e DOCX (parsers de produção).
 *
 * Gera fixtures em tempo de teste (pdfkit / docx) e valida: PDF textual simples, PDF multipágina,
 * PDF escaneado (só imagem → OCR_REQUIRED), PDF inválido; DOCX com tabela, texto+tabela, múltiplas
 * tabelas, DOCX inválido; replay determinístico (mesmos valores/versão), isolamento (parser puro,
 * sem estado compartilhado) e limites de segurança (maxItems, zip-bomb). Ambiente node, sem DB.
 */
import { describe, it, expect, beforeAll } from "vitest";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun } from "docx";
import { PdfParser } from "../../parsers/pdfParser";
import { DocxParser } from "../../parsers/docxParser";
import type { ParseOptions } from "../../parsers/baseParser";

const pdf = new PdfParser();
const docx = new DocxParser();

const opts = (over: Partial<ParseOptions> = {}): ParseOptions => ({
  importSessionId: 1, organizationId: 42, sourceFileId: "imports/x/1-f",
  sourceFileName: "f", sourceMimeType: "application/pdf", sourceChecksum: "a".repeat(64), ...over,
});

// ─── Geradores de fixtures ──────────────────────────────────────────────────────

function textPdf(pages: string[][]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(10);
    pages.forEach((lines, i) => {
      if (i > 0) doc.addPage();
      lines.forEach(l => doc.text(l));
    });
    doc.end();
  });
}

function graphicsOnlyPdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.rect(60, 60, 300, 200).fill("#cccccc");
    doc.circle(200, 400, 60).fill("#999999");
    doc.end();
  });
}

function cell(t: string) { return new TableCell({ children: [new Paragraph(t)] }); }
function tableOf(rows: string[][]): Table {
  return new Table({ rows: rows.map(r => new TableRow({ children: r.map(cell) })) });
}
async function docxWith(children: Array<Paragraph | Table>): Promise<Buffer> {
  return await Packer.toBuffer(new Document({ sections: [{ children }] }));
}

const HEADER = ["Descrição", "Qtd", "Unid", "V.Unit", "Total"];

let pdfSimple: Buffer, pdfMulti: Buffer, pdfScanned: Buffer;
let docxTable: Buffer, docxTextAndTable: Buffer, docxMultiTable: Buffer, docxTextOnly: Buffer;

beforeAll(async () => {
  pdfSimple = await textPdf([[
    "Descrição               Qtd      Unid     V.Unit       Total",
    "Caneta azul             100      UN       1,50         150,00",
    "Papel A4 resma          50       RESMA    18,90        945,00",
  ]]);
  pdfMulti = await textPdf([
    ["Descrição   Qtd   Unid   V.Unit   Total", "Caneta azul 100 UN 1,50 150,00"],
    ["Grampeador metal 10 UN 25,00 250,00"],
    ["Tesoura inox 5 UN 12,00 60,00"],
  ]);
  pdfScanned = await graphicsOnlyPdf();

  docxTable = await docxWith([tableOf([HEADER, ["Caneta azul", "100", "UN", "1,50", "150,00"], ["Papel A4", "50", "RESMA", "18,90", "945,00"]])]);
  docxTextAndTable = await docxWith([
    new Paragraph({ children: [new TextRun("Termo de Referência — Itens")] }),
    tableOf([HEADER, ["Grampeador", "10", "UN", "25,00", "250,00"]]),
  ]);
  docxMultiTable = await docxWith([
    tableOf([HEADER, ["Item A", "1", "UN", "10,00", "10,00"]]),
    new Paragraph({ children: [new TextRun("Segunda tabela")] }),
    tableOf([HEADER, ["Item B", "2", "CX", "20,00", "40,00"]]),
  ]);
  docxTextOnly = await docxWith([
    new Paragraph({ children: [new TextRun("Objeto: aquisição de material de escritório.")] }),
    new Paragraph({ children: [new TextRun("Justificativa: reposição de estoque.")] }),
  ]);
}, 60_000);

// ─── PDF ─────────────────────────────────────────────────────────────────────────

describe("PdfParser (real)", () => {
  it("extrai itens de PDF textual com colunas (desc/qtd/unid/preços)", async () => {
    const r = await pdf.parse(pdfSimple, opts({ sourceMimeType: "application/pdf" }));
    expect(r.errors).toHaveLength(0);
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    const first = r.items.find(i => (i.rawDescription ?? "").includes("Caneta"));
    expect(first?.rawDescription).toContain("Caneta");
    expect(first?.rawQuantity).toBe("100");
    expect(first?.rawUnit).toBe("UN");
    expect(first?.rawUnitPrice).toBe("1,50");
    expect(first?.rawTotalPrice).toBe("150,00");
    // Proveniência real: página + versão do parser.
    expect(first?.sourceLocation.location.page).toBeGreaterThanOrEqual(1);
    expect(first?.parserMetadata.parserVersion).toBe("2.0.0");
  });

  it("PDF multipágina: provenance cobre mais de uma página", async () => {
    const r = await pdf.parse(pdfMulti, opts());
    expect(r.errors).toHaveLength(0);
    const pagesSeen = new Set(r.items.map(i => i.sourceLocation.location.page));
    expect(pagesSeen.size).toBeGreaterThanOrEqual(2);
    expect(r.summary.pagesProcessed).toBeGreaterThanOrEqual(3);
  });

  it("PDF escaneado (só imagem) → OCR_REQUIRED e nenhum item (não apresenta como extraído)", async () => {
    const r = await pdf.parse(pdfScanned, opts());
    expect(r.items).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.map(w => w.code)).toContain("OCR_REQUIRED");
  });

  it("PDF inválido (assinatura ausente) → CORRUPT_FILE", async () => {
    const r = await pdf.parse(Buffer.from("isto não é um PDF"), opts());
    expect(r.items).toHaveLength(0);
    expect(r.errors[0].code).toBe("CORRUPT_FILE");
  });

  it("replay determinístico: mesmos valores e versão em duas execuções", async () => {
    const a = await pdf.parse(pdfSimple, opts());
    const b = await pdf.parse(pdfSimple, opts());
    const vals = (x: typeof a) => x.items.map(i => [i.rawDescription, i.rawQuantity, i.rawUnit, i.rawUnitPrice, i.rawTotalPrice]);
    expect(vals(a)).toEqual(vals(b));
    expect(a.summary.parserVersion).toBe(b.summary.parserVersion);
  });

  it("limite de segurança: maxItems trunca e avisa", async () => {
    const r = await pdf.parse(pdfSimple, opts({ maxItems: 1 }));
    expect(r.items).toHaveLength(1);
    expect(r.warnings.map(w => w.code)).toContain("TRUNCATED_VALUE");
  });

  it("capabilityStatus supported, sem sufixo stub", () => {
    expect(pdf.capabilities.capabilityStatus).toBe("supported");
    expect(pdf.capabilities.parserVersion).not.toContain("stub");
  });
});

// ─── DOCX ──────────────────────────────────────────────────────────────────────

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("DocxParser (real)", () => {
  it("extrai itens de tabela DOCX com colunas mapeadas", async () => {
    const r = await docx.parse(docxTable, opts({ sourceMimeType: DOCX_MIME, sourceFileName: "t.docx" }));
    expect(r.errors).toHaveLength(0);
    expect(r.items.length).toBe(2);
    const caneta = r.items.find(i => (i.rawDescription ?? "").includes("Caneta"));
    expect(caneta?.rawQuantity).toBe("100");
    expect(caneta?.rawUnit).toBe("UN");
    expect(caneta?.rawUnitPrice).toBe("1,50");
    expect(caneta?.rawTotalPrice).toBe("150,00");
    expect(caneta?.sourceLocation.tableIndex).toBe(0);
    expect(caneta?.parserMetadata.parserVersion).toBe("2.0.0");
  });

  it("texto + tabela: prioriza a tabela para dados estruturados", async () => {
    const r = await docx.parse(docxTextAndTable, opts({ sourceMimeType: DOCX_MIME, sourceFileName: "t.docx" }));
    expect(r.errors).toHaveLength(0);
    expect(r.items.length).toBe(1);
    expect(r.items[0].rawDescription).toContain("Grampeador");
  });

  it("múltiplas tabelas: itens de ambas com tableIndex distinto", async () => {
    const r = await docx.parse(docxMultiTable, opts({ sourceMimeType: DOCX_MIME, sourceFileName: "m.docx" }));
    expect(r.errors).toHaveLength(0);
    expect(r.items.length).toBe(2);
    expect(new Set(r.items.map(i => i.sourceLocation.tableIndex))).toEqual(new Set([0, 1]));
  });

  it("DOCX só texto: sem tabela → parágrafos como itens de descrição + aviso", async () => {
    const r = await docx.parse(docxTextOnly, opts({ sourceMimeType: DOCX_MIME, sourceFileName: "p.docx" }));
    expect(r.errors).toHaveLength(0);
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    expect(r.items.every(i => i.rawDescription && i.rawUnitPrice === null)).toBe(true);
    expect(r.warnings.map(w => w.code)).toContain("NO_TABLE_FOUND");
  });

  it(".doc legado (OLE) → UNSUPPORTED_FORMAT", async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const r = await docx.parse(ole, opts({ sourceMimeType: DOCX_MIME, sourceFileName: "legacy.doc" }));
    expect(r.errors[0].code).toBe("UNSUPPORTED_FORMAT");
  });

  it("DOCX inválido (ZIP sem diretório central) → CORRUPT_FILE", async () => {
    const r = await docx.parse(Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from("lixo")]), opts({ sourceMimeType: DOCX_MIME, sourceFileName: "x.docx" }));
    expect(r.errors[0].code).toBe("CORRUPT_FILE");
  });

  it("proteção zip-bomb: diretório central declara expansão gigante → ZIP_BOMB", async () => {
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); // PK\x03\x04 local header
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(1000, 20);         // compressed
    cd.writeUInt32LE(0xf0000000, 24);   // uncompressed ~4GB (não 0xFFFFFFFF p/ não sinalizar zip64)
    const cdOffset = local.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46, 12); eocd.writeUInt32LE(cdOffset, 16);
    const bomb = Buffer.concat([local, cd, eocd]);
    const r = await docx.parse(bomb, opts({ sourceMimeType: DOCX_MIME, sourceFileName: "bomb.docx" }));
    expect(r.errors[0].code).toBe("ZIP_BOMB");
  });

  it("replay + isolamento: parses concorrentes de orgs distintas não interferem", async () => {
    const [ra, rb] = await Promise.all([
      docx.parse(docxTable, opts({ organizationId: 111, sourceMimeType: DOCX_MIME, sourceFileName: "t.docx" })),
      docx.parse(docxMultiTable, opts({ organizationId: 222, sourceMimeType: DOCX_MIME, sourceFileName: "m.docx" })),
    ]);
    expect(ra.items.length).toBe(2);
    expect(rb.items.length).toBe(2);
    expect(ra.items.map(i => i.rawDescription)).toContain("Caneta azul");
  });
});
