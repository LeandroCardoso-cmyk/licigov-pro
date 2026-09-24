/**
 * U2A-OCR — Geradores de fixtures de PDF para testes (sem arquivo binário no repositório).
 *
 * "Digitalizado" é produzido como na vida real: o PDF TEXTUAL é impresso (rasterizado pelo próprio pdf-parse,
 * dependência de produção) e a IMAGEM é embutida num PDF novo SEM camada de texto (pdfkit). Nenhum dado real.
 */
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";

export type TableSpec = { title?: string; header: string[]; rows: string[][]; colX: number[]; fontSize?: number };

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function drawTable(doc: PDFKit.PDFDocument, t: TableSpec): void {
  const fs = t.fontSize ?? 11;
  doc.fontSize(fs);
  let y = 50;
  if (t.title) { doc.fontSize(fs + 3).text(t.title, 40, y, { lineBreak: false }); doc.fontSize(fs); y += 36; }
  const line = (cells: string[]) => { cells.forEach((c, i) => doc.text(c, t.colX[i], y, { lineBreak: false })); y += fs * 2; };
  line(t.header);
  t.rows.forEach(line);
}

/** PDF TEXTUAL (camada de texto nativa) — uma tabela por página. */
export async function textTablePdf(pages: TableSpec[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const done = collect(doc);
  pages.forEach((p, i) => { if (i > 0) doc.addPage(); drawTable(doc, p); });
  doc.end();
  return done;
}

/** Rasteriza as páginas de um PDF (PNG) — "impressão" usada para simular a digitalização. */
export async function rasterize(pdf: Buffer, width = 1700): Promise<Array<{ png: Buffer; width: number; height: number }>> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    const shot = await parser.getScreenshot({ desiredWidth: width, imageBuffer: true, imageDataUrl: false });
    return shot.pages.map((p) => ({ png: Buffer.from(p.data), width: p.width, height: p.height }));
  } finally {
    await parser.destroy();
  }
}

/** Página de PDF: `native` (texto) ou `scanned` (somente imagem, sem camada de texto). */
export type PageSpec = { kind: "native"; table: TableSpec } | { kind: "scanned"; table: TableSpec } | { kind: "blank_scan" };

/** PDF com páginas nativas e/ou digitalizadas (misto). Página digitalizada = imagem A4 sem texto. */
export async function mixedPdf(pages: PageSpec[]): Promise<Buffer> {
  const images = new Map<number, Buffer>();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.kind === "scanned") images.set(i, (await rasterize(await textTablePdf([p.table])))[0].png);
  }
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const done = collect(doc);
  pages.forEach((p, i) => {
    if (i > 0) doc.addPage({ size: "A4", margin: 0 });
    if (p.kind === "native") drawTable(doc, p.table);
    else if (p.kind === "scanned") doc.image(images.get(i)!, 0, 0, { width: doc.page.width, height: doc.page.height });
    else doc.rect(0, 0, doc.page.width, doc.page.height).fill("#f4f4f4");
  });
  doc.end();
  return done;
}

export const scannedPdf = (tables: TableSpec[]) => mixedPdf(tables.map((table) => ({ kind: "scanned" as const, table })));

export const PRICE_TABLE: TableSpec = {
  title: "Pesquisa de precos - Mapa de cotacoes",
  header: ["Item", "Descricao", "Unidade", "Quantidade", "Valor Unitario", "Valor Total"],
  rows: [
    ["1", "Cadeira giratoria", "UN", "10", "1.234,56", "12.345,60"],
    ["2", "Mesa de reuniao", "UN", "2", "850,00", "1.700,00"],
    ["3", "Papel A4 resma", "CX", "12,5", "R$ 23,90", "R$ 298,75"],
  ],
  colX: [40, 75, 245, 310, 390, 480],
};
