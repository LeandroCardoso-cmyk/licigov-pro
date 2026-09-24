/**
 * GOLDEN E — mapa de apuração multiprovedor (PDF DIGITAL, fixture sanitizada gerada em tempo de teste).
 *
 * Contrato: EXATAMENTE 5 itens · 30 cotações válidas · unidades Tambor/Un/Tambor/Fardo/Tambor · quantidades 1,00 ·
 * médias 950,31 / 67,23 / 1.134,28 / 145,29 / 1.052,82 · total 3.349,93.
 * Invariantes negativas: "R$", título, cabeçalhos, fontes, média, total, percentual, rodapé, número de página,
 * assinatura e identificação institucional NUNCA viram item. OCR NÃO roda (texto nativo útil).
 * Diferencial: o caminho anterior (v1: getTable/linhas do getText) erra no MESMO arquivo; o v2 acerta.
 * Generalização: variantes geométricas do mesmo mapa (sem grade, cabeçalho horizontal, tabela densa, 3 fontes,
 * sem linha "R$") e convergência OCR (palavras com a MESMA geometria → mesmos itens).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { PDFParse } from "pdf-parse";
import PDFDocument from "pdfkit";
import { PdfParser } from "../../parsers/pdfParser";
import { linesToRawItems, matrixToRawItems, type TabularContext } from "../../parsers/tabularExtraction";
import { tokensFromPdfTextItems, type PdfTextItemLike } from "../../parsers/layout/positionedText";
import { PDF_LAYOUT_VERSION } from "../../parsers/layout/tableLayoutReconstructor";
import { averageCents, parseBRL, sumCents } from "../../domain/money";
import { classifyRowsOutcome } from "../../domain/importOutcome";
import type { OcrPort, OcrResult, OcrWord } from "../../domain/ocr";
import type { ParseOptions, ParseResult } from "../../parsers/baseParser";
import type { RawExtractedItem } from "../../domain/importExtraction";
import { GOLDEN_E, GOLDEN_E_ITEMS, PLACEHOLDER, goldenEPdf, mapPdf } from "../fixtures/layoutPdfFixtures";
import { rasterize } from "../fixtures/ocrPdfFixtures";
import { TesseractOcrAdapter } from "../../providers/ocr/tesseractOcrAdapter";

const parser = new PdfParser();
const opts = (over: Partial<ParseOptions> = {}): ParseOptions => ({
  importSessionId: 11, organizationId: 1, sourceFileId: "imports/1/mapa.pdf", sourceFileName: "mapa.pdf",
  sourceMimeType: "application/pdf", sourceChecksum: "e".repeat(64), ...over,
});
const spyPort = (): OcrPort & { calls: number } => {
  const p = {
    calls: 0,
    identity: () => ({ engine: "spy", engineVersion: "0", coreVersion: "0", language: "por", languageDataVersion: "0", config: {} }),
    recognize: async (): Promise<OcrResult> => { p.calls++; throw new Error("OCR não deveria rodar"); },
  };
  return p;
};
const ocrCfg = (port: OcrPort) => ({ port, maxPages: 5, timeoutMs: 120_000, renderWidth: 2200, minConfidence: 75 });

/** Itens lógicos (descrição + unidade + quantidade) na ordem do documento, com as cotações de cada um. */
function logicalItems(items: RawExtractedItem[]) {
  const out: Array<{ description: string; unit: string | null; quantity: string | null; quotes: string[]; suppliers: Array<string | null> }> = [];
  for (const i of items) {
    const last = out[out.length - 1];
    if (last && last.description === i.rawDescription) { last.quotes.push(i.rawUnitPrice ?? ""); last.suppliers.push(i.rawSupplier ?? null); continue; }
    out.push({ description: i.rawDescription ?? "", unit: i.rawUnit, quantity: i.rawQuantity, quotes: [i.rawUnitPrice ?? ""], suppliers: [i.rawSupplier ?? null] });
  }
  return out;
}
const avgOf = (quotes: string[]) => averageCents(quotes.map((q) => parseBRL(q)!));

const EXPECTED = {
  units: ["Tambor", "Un", "Tambor", "Fardo", "Tambor"],
  quantities: ["1,00", "1,00", "1,00", "1,00", "1,00"],
  quoteCounts: [7, 7, 5, 5, 6],
  averagesCents: [95031, 6723, 113428, 14529, 105282],
  totalCents: 334993,
};

function assertGoldenEContract(r: ParseResult) {
  const logical = logicalItems(r.items);
  expect(logical).toHaveLength(5);
  expect(r.items).toHaveLength(30);
  expect(logical.map((l) => l.description)).toEqual(GOLDEN_E_ITEMS.map((i) => i.description));
  expect(logical.map((l) => l.unit)).toEqual(EXPECTED.units);
  expect(logical.map((l) => l.quantity)).toEqual(EXPECTED.quantities);
  expect(logical.map((l) => l.quotes.length)).toEqual(EXPECTED.quoteCounts);
  expect(logical.map((l) => avgOf(l.quotes))).toEqual(EXPECTED.averagesCents);
  expect(sumCents(logical.map((l) => avgOf(l.quotes)))).toBe(EXPECTED.totalCents);
  expect(logical.map((l) => l.quotes)).toEqual(GOLDEN_E_ITEMS.map((i) => i.quotes.filter((q) => q !== PLACEHOLDER)));
}

let E: Buffer;
beforeAll(async () => { E = await goldenEPdf(); }, 60_000);

describe("GOLDEN E — contrato (PDF digital)", () => {
  it("EXATAMENTE 5 itens, 30 cotações válidas, unidades/quantidades/médias/total do contrato", async () => {
    const r = await parser.parse(E, opts());
    expect(r.errors).toHaveLength(0);
    assertGoldenEContract(r);
    expect(r.extraction?.layout?.validation).toEqual({
      itemRows: 5, validQuotes: 30, documentTotalCents: 334993, calculatedTotalCents: 334993, totalMatches: true,
      averageChecks: 5, averageMismatches: 0,
    });
  });

  it("identidade de fonte preservada por cotação (cabeçalho VERTICAL → fornecedor/portal)", async () => {
    const r = await parser.parse(E, opts());
    const [first] = logicalItems(r.items);
    expect(first.suppliers).toEqual(["Fornecedor A", "Fornecedor B", "Fornecedor C", "Fornecedor E", "Portal Público 1", "Portal Público 2", "Contratação Similar"]);
    expect(r.items.every((i) => i.rawSupplier !== null)).toBe(true);
    expect(r.items.some((i) => i.extractionWarnings.some((w) => w.code === "SOURCE_IDENTITY_UNRESOLVED"))).toBe(false);
  });

  it("média impressa é só CONFERÊNCIA (bate com o cálculo em centavos half-up); nenhuma cotação é a média", async () => {
    const r = await parser.parse(E, opts());
    for (const it of r.items) {
      const recon = (it.rawMetadata.layout as { reconciliation: { averageMatches: boolean; documentAverageCents: number } }).reconciliation;
      expect(recon.averageMatches).toBe(true);
    }
    expect(r.items.some((i) => i.extractionWarnings.some((w) => w.code === "DOCUMENT_AVERAGE_MISMATCH"))).toBe(false);
    // Nenhuma cotação veio da coluna de média/total/percentual.
    const rowCells = (i: RawExtractedItem) => (i.rawMetadata.layout as { row: number }).row;
    expect(r.items.every((i) => rowCells(i) >= 1)).toBe(true);
    expect(r.items.map((i) => i.rawUnitPrice)).not.toContain("12,25%");
  });

  it("OCR NÃO roda: PDF digital com texto útil ⇒ extractionMode = native_text (porta de OCR nunca chamada)", async () => {
    const port = spyPort();
    const r = await parser.parse(E, opts({ ocr: ocrCfg(port) }));
    expect(port.calls).toBe(0);
    expect(r.extraction).toMatchObject({ extractionMode: "native_text", ocr: null, ocrPages: 0, ocrReason: null, layoutVersion: PDF_LAYOUT_VERSION });
    expect(r.extraction?.layout).toMatchObject({ mode: "positioned", pagesWithoutItemTable: [2], candidateItemCount: 5, validItemCount: 5 });
    assertGoldenEContract(r);
  });

  it("desfecho READY_FOR_REVIEW (revisão humana continua obrigatória; nada é aprovado automaticamente)", async () => {
    const r = await parser.parse(E, opts());
    const attention = r.items.some((i) => i.extractionWarnings.some((w) => w.severity === "warning"));
    expect(attention).toBe(false);
    expect(classifyRowsOutcome({ itemCount: r.items.length, warningCodes: r.warnings.map((w) => w.code), itemsNeedAttention: attention })).toBe("READY_FOR_REVIEW");
  });
});

describe("GOLDEN E — invariantes negativas (nunca viram item)", () => {
  let r: ParseResult;
  beforeAll(async () => { r = await parser.parse(E, opts()); });
  const texts = () => r.items.flatMap((i) => [i.rawDescription, i.rawUnit, i.rawQuantity, i.rawUnitPrice, i.rawSupplier].map((v) => (v ?? "").toString()));
  const descriptions = () => r.items.map((i) => (i.rawDescription ?? "").toUpperCase());

  it("nenhuma linha/célula \"R$\" como item ou valor", () => {
    expect(texts()).not.toContain("R$");
    expect(r.items.every((i) => !/^R\$$/.test((i.rawUnitPrice ?? "").trim()))).toBe(true);
  });
  it("nenhum título (MAPA DE APURAÇÃO DE PREÇOS) nem fragmento dele", () => {
    expect(descriptions().some((d) => d.includes("MAPA DE APURA") || d === "PREÇOS")).toBe(false);
  });
  it("nenhum cabeçalho (Item/Descrição/Unid./Qtde/FONTES DE PESQUISA/MÉDIA/VALOR TOTAL/% DIF.)", () => {
    for (const h of ["ITEM", "DESCRIÇÃO", "UNID.", "QTDE", "FONTES DE PESQUISA", "MÉDIA ARITMÉTICA", "MÉDIA", "ARITMÉTICA", "VALOR TOTAL", "% DIF."]) {
      expect(descriptions()).not.toContain(h);
    }
  });
  it("nenhum nome de fornecedor/portal/fonte como DESCRIÇÃO de item", () => {
    for (const s of GOLDEN_E.sources) expect(descriptions()).not.toContain(s.toUpperCase());
  });
  it("nenhum total (VALOR TOTAL ESTIMADO / 3.349,93) nem percentual como item ou preço", () => {
    expect(descriptions().some((d) => d.includes("TOTAL ESTIMADO"))).toBe(false);
    expect(texts()).not.toContain("3.349,93");
    expect(r.items.some((i) => /%$/.test(i.rawUnitPrice ?? ""))).toBe(false);
  });
  it("nenhum rodapé, número de página, assinatura ou identificação institucional; página 2 não gera itens", () => {
    for (const t of ["PÁGINA", "VALORES EM REAIS", "SERVIDOR RESPONSÁVEL", "MATRÍCULA", "ENTE PÚBLICO EXEMPLO", "CNPJ", "PROCESSO ADMINISTRATIVO", "OBSERVAÇÕES", "LOCAL E DATA", "____"]) {
      expect(descriptions().some((d) => d.includes(t))).toBe(false);
    }
    expect(r.items.every((i) => i.sourceLocation.location.page === 1)).toBe(true);
    expect(r.extraction?.layout?.pages.find((p) => p.page === 2)).toMatchObject({ pageHasNoItemTable: true, itemRowCount: 0 });
  });
  it('"/////" nunca vira preço nem 0 (célula descartada e registrada)', () => {
    expect(texts()).not.toContain(PLACEHOLDER);
    expect(r.items.some((i) => (parseBRL(i.rawUnitPrice) ?? -1) <= 0)).toBe(false);
    const discarded = r.items.map((i) => (i.rawMetadata.layout as { discardedCells: unknown[] }).discardedCells.length);
    expect(discarded.every((n) => n >= 1)).toBe(true);
  });
});

describe("GOLDEN E — diferencial v1 (antes) × v2 (reconstrução geométrica)", () => {
  const ctx: TabularContext = { importSessionId: 1, parserType: "pdf", parserVersion: "2.2.0", sourceFileId: "k", sourceFileName: "m.pdf", sourceMimeType: "application/pdf", sourceChecksum: "e".repeat(64), maxItems: 5000 };
  /** Caminho v1 (parser 2.2.0): tabelas do getTable ou linhas LINEARIZADAS do getText. */
  async function legacyV1(buf: Buffer): Promise<RawExtractedItem[]> {
    const p = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const text = await p.getText();
      const tables = await p.getTable().catch(() => ({ pages: [] as Array<{ num: number; tables: string[][][] }> }));
      const out: RawExtractedItem[] = [];
      for (const page of text.pages) {
        const t = tables.pages.find((x) => x.num === page.num)?.tables ?? [];
        if (t.length) for (const m of t) out.push(...matrixToRawItems(m, ctx, (r) => ({ location: { page: page.num, row: r + 1 }, extras: {} })).items);
        else out.push(...linesToRawItems(page.text.split(/\r?\n/), ctx, (i) => ({ location: { page: page.num, row: i + 1 }, extras: {} })).items);
      }
      return out;
    } finally { await p.destroy(); }
  }

  it("com grade (getTable): v1 perde as 30 cotações e cria item da página de assinatura; v2 acerta", async () => {
    const v1 = await legacyV1(E);
    expect(v1.filter((i) => i.rawUnitPrice && parseBRL(i.rawUnitPrice)).length).toBeLessThan(30);
    expect(v1.some((i) => i.sourceLocation.location.page === 2)).toBe(true);
    assertGoldenEContract(await parser.parse(E, opts()));
  });

  it("sem grade (linhas do getText): v1 transforma cabeçalho/rodapé em itens; v2 acerta", async () => {
    const gridless = await mapPdf({ ...GOLDEN_E, drawGrid: false });
    const v1 = await legacyV1(gridless);
    const junk = v1.filter((i) => /Portal|Página|MAPA|R\$|PREÇOS/i.test(i.rawDescription ?? ""));
    expect(junk.length).toBeGreaterThan(0);
    expect(logicalItems(v1).length).not.toBe(5);
    assertGoldenEContract(await parser.parse(gridless, opts()));
  });
});

describe("GOLDEN E — replay / determinismo", () => {
  it("mesmo arquivo + mesma versão ⇒ mesma ordem item → cotações e mesmo fingerprint (com versão de layout)", async () => {
    const [a, b] = [await parser.parse(E, opts()), await parser.parse(E, opts())];
    const seq = (r: ParseResult) => r.items.map((i) => [i.rawDescription, i.rawSupplier, i.rawUnitPrice]);
    expect(seq(a)).toEqual(seq(b));
    expect(a.extraction?.fingerprint).toBe(b.extraction?.fingerprint);
    expect(a.extraction).toMatchObject({ lineageVersion: "2", layoutVersion: PDF_LAYOUT_VERSION, parserVersion: "2.3.0" });
    expect(a.items[0].parserMetadata).toMatchObject({ layoutVersion: PDF_LAYOUT_VERSION, textSource: "native" });
  });
});

describe("generalização — variantes geométricas do mapa (não passa só no Golden E)", () => {
  it.each([
    ["sem grade (sem réguas)", { drawGrid: false }],
    ["cabeçalhos HORIZONTAIS", { verticalSources: false, sourceWidth: 60 }],
    ["valores alinhados ao TOPO", { centerValues: false }],
    ["tabela DENSA (sem espaço interno)", { cellPadding: 0, centerValues: false }],
    ["sem linha \"R$\" sob o cabeçalho", { currencyRow: false }],
    ["descrição mais larga (menos linhas)", { descriptionWidth: 260 }],
  ])("%s ⇒ mesmo contrato do Golden E", async (_label, over) => {
    const buf = await mapPdf({ ...GOLDEN_E, ...over });
    assertGoldenEContract(await parser.parse(buf, opts()));
  });

  it("3 fontes (número variável de colunas de preço) ⇒ uma cotação por valor válido, sem inventar fonte", async () => {
    const items = GOLDEN_E_ITEMS.map((i) => ({ ...i, quotes: i.quotes.slice(0, 3) }));
    const buf = await mapPdf({ ...GOLDEN_E, sources: GOLDEN_E.sources.slice(0, 3), items });
    const r = await parser.parse(buf, opts());
    const logical = logicalItems(r.items);
    expect(logical).toHaveLength(5);
    expect(logical.map((l) => l.quotes)).toEqual(items.map((i) => i.quotes.filter((q) => q !== PLACEHOLDER)));
    expect(logical[0].suppliers).toEqual(["Fornecedor A", "Fornecedor B", "Fornecedor C"]);
    // As médias impressas (de 8 fontes) não batem com 3 fontes ⇒ divergência sinalizada, nada ajustado.
    expect(r.warnings.map((w) => w.code)).toContain("DOCUMENT_AVERAGE_MISMATCH");
  });
});

describe("convergência OCR — palavras com a MESMA geometria ⇒ os MESMOS itens (mesma reconstrução)", () => {
  /** "Digitaliza" o Golden E e devolve, como OCR, as palavras do próprio texto nativo (determinístico). */
  async function syntheticOcr(nativePdf: Buffer, renderWidth: number): Promise<OcrPort> {
    const p = new PDFParse({ data: new Uint8Array(nativePdf) });
    const pages: OcrResult["pages"] = [];
    try {
      const doc = await (p as unknown as { load(): Promise<{ numPages: number; getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] }; getTextContent(): Promise<{ items: unknown[] }> }> }> }).load();
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const k = renderWidth / vp.width;
        const tc = await page.getTextContent();
        const toks = tokensFromPdfTextItems(tc.items as PdfTextItemLike[], n, (x, y) => vp.convertToViewportPoint(x, y) as [number, number]);
        const words: OcrWord[] = toks.flatMap((t) => {
          if (t.orientation === "vertical") return [{ text: t.text, confidence: 88, bbox: { x0: t.x * k, y0: t.y * k, x1: (t.x + t.width) * k, y1: (t.y + t.height) * k } }];
          const parts = t.text.split(" ");
          const unit = t.width / Math.max(1, t.text.length);
          let x = t.x;
          return parts.map((w) => { const box = { x0: x * k, y0: t.y * k, x1: (x + w.length * unit) * k, y1: (t.y + t.height) * k }; x += (w.length + 1) * unit; return { text: w, confidence: 88, bbox: box }; });
        });
        pages.push({ pageNumber: n, text: toks.map((t) => t.text).join("\n"), confidence: 88, width: renderWidth, height: vp.height * k, lines: [{ text: "", confidence: 88, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words }], durationMs: 1, warnings: [] });
      }
    } finally { await p.destroy(); }
    return {
      identity: () => ({ engine: "synthetic", engineVersion: "1", coreVersion: "1", language: "por", languageDataVersion: "1", config: {} }),
      recognize: async (imgs) => ({
        text: "", pages: pages.filter((pg) => imgs.some((i) => i.pageNumber === pg.pageNumber)), warnings: [], confidence: 88,
        engine: "synthetic", engineVersion: "1", language: "por", durationMs: 1, metadata: {},
      }),
    };
  }
  async function scannedOf(nativePdf: Buffer): Promise<Buffer> {
    const imgs = await rasterize(nativePdf, 1400);
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
    imgs.forEach((im, i) => { if (i) doc.addPage({ size: "A4", layout: "landscape", margin: 0 }); doc.image(im.png, 0, 0, { width: doc.page.width, height: doc.page.height }); });
    doc.end();
    return done;
  }

  it("PDF digitalizado do Golden E + OCR (palavras com a geometria do original) ⇒ contrato idêntico ao nativo", async () => {
    const scanned = await scannedOf(E);
    const port = await syntheticOcr(E, 2200);
    const r = await parser.parse(scanned, opts({ ocr: ocrCfg(port) }));
    expect(r.extraction?.extractionMode).toBe("ocr");
    assertGoldenEContract(r);
    expect(logicalItems(r.items)[0].suppliers).toEqual(["Fornecedor A", "Fornecedor B", "Fornecedor C", "Fornecedor E", "Portal Público 1", "Portal Público 2", "Contratação Similar"]);
    expect(r.items.every((i) => i.parserMetadata.extractionMode === "ocr" && i.parserMetadata.textSource === "ocr")).toBe(true);
    expect(r.items.every((i) => i.confidenceMetadata.requiresReview)).toBe(true);
    // Página de assinatura digitalizada também não gera item (mesma decisão por documento do texto nativo).
    expect(r.items.every((i) => i.sourceLocation.location.page === 1)).toBe(true);
  }, 60_000);

  it("OCR REAL (Tesseract) no Golden E digitalizado: ruído de leitura nunca vira item-lixo; tudo vai para revisão", async () => {
    const scanned = await scannedOf(E);
    const r = await parser.parse(scanned, opts({ ocr: ocrCfg(new TesseractOcrAdapter({ maxConcurrency: 1 })) }));
    expect(r.extraction?.extractionMode).toBe("ocr");
    const desc = r.items.map((i) => (i.rawDescription ?? "").toUpperCase());
    expect(desc.some((d) => /P[ÁA]GINA|MAPA DE APURA|R\$|FONTES DE PESQUISA|TOTAL ESTIMADO|SERVIDOR|MATR[ÍI]CULA/.test(d))).toBe(false);
    expect(r.items.every((i) => i.sourceLocation.location.page === 1)).toBe(true);
    expect(r.items.every((i) => i.confidenceMetadata.requiresReview)).toBe(true);
    expect(r.items.some((i) => /%/.test(i.rawUnitPrice ?? ""))).toBe(false);
  }, 120_000);
});
