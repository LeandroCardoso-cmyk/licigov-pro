/**
 * U2A-OCR — PdfParser com OCR REAL (tesseract.js local + português empacotado; offline, sem credencial).
 *
 * Fixtures geradas em tempo de teste (ver fixtures/ocrPdfFixtures.ts — "digitalizado" = PDF textual
 * rasterizado e reembutido como imagem, sem camada de texto):
 *   A digital tabular · B digitalizado tabular · C digitalizado vazio/ilegível · D páginas mistas ·
 *   E valores BRL (1.234,56 / 1234,56 / R$ 1.234,56) · F quantidade decimal · G multi-fornecedor (mapa
 *   comparativo) · H erro/ambiguidade de OCR (motor falha; valor com caractere suspeito; baixa confiança).
 * Valida: detecção nativa (OCR não é chamado), fallback, MESMO parser tabular, texto bruto preservado,
 * avisos, linhagem/fingerprint, limites, contrato monetário (nada inferido silenciosamente).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { PdfParser } from "../../parsers/pdfParser";
import { TesseractOcrAdapter } from "../../providers/ocr/tesseractOcrAdapter";
import { OcrError, type OcrPort, type OcrResult } from "../../domain/ocr";
import type { ParseOptions } from "../../parsers/baseParser";
import { parseBRLDetailed } from "../../domain/money";
import { classifyRowsOutcome } from "../../domain/importOutcome";
import { mixedPdf, scannedPdf, textTablePdf, PRICE_TABLE, type TableSpec } from "../fixtures/ocrPdfFixtures";

const parser = new PdfParser();
const tesseract = new TesseractOcrAdapter({ maxConcurrency: 1 });

/** Porta real instrumentada (conta chamadas) — prova quando o OCR NÃO é acionado. */
function spyPort(inner: OcrPort = tesseract): OcrPort & { calls: number } {
  const p = { calls: 0, identity: () => inner.identity(), recognize: async (...a: Parameters<OcrPort["recognize"]>) => { p.calls++; return inner.recognize(...a); } };
  return p;
}

const opts = (port: OcrPort | null, over: Partial<ParseOptions> = {}): ParseOptions => ({
  importSessionId: 7, organizationId: 42, sourceFileId: "imports/42/x.pdf", sourceFileName: "cotacoes.pdf",
  sourceMimeType: "application/pdf", sourceChecksum: "c".repeat(64),
  ...(port ? { ocr: { port, maxPages: 5, timeoutMs: 90_000, renderWidth: 2000, minConfidence: 75 } } : {}),
  ...over,
});

const row = (i: { rawDescription: string | null; rawUnit: string | null; rawQuantity: string | null; rawUnitPrice: string | null; rawTotalPrice: string | null }) =>
  [i.rawDescription, i.rawUnit, i.rawQuantity, i.rawUnitPrice, i.rawTotalPrice];

const BRL_TABLE: TableSpec = {
  header: ["Descricao", "Unidade", "Quantidade", "Valor Unitario"],
  rows: [["Grampeador de mesa", "UN", "3", "1.234,56"], ["Toner laser preto", "UN", "4", "1234,56"], ["Cadeira fixa", "UN", "5", "R$ 1.234,56"]],
  colX: [40, 260, 340, 440],
};
const WIDE_TABLE: TableSpec = {
  header: ["Item", "Descricao", "Unidade", "Qtd", "Empresa Alfa", "Empresa Beta"],
  rows: [["1", "Cadeira giratoria", "UN", "10", "1.198,00", "1.250,00"], ["2", "Mesa de reuniao", "UN", "2", "850,00", "910,50"]],
  colX: [40, 75, 250, 320, 380, 480],
};

let A: Buffer, B: Buffer, C: Buffer, D: Buffer, E: Buffer, G: Buffer;
beforeAll(async () => {
  [A, B, C, D, E, G] = await Promise.all([
    textTablePdf([PRICE_TABLE]),
    scannedPdf([PRICE_TABLE]),
    mixedPdf([{ kind: "blank_scan" }]),
    mixedPdf([{ kind: "native", table: PRICE_TABLE }, { kind: "scanned", table: { ...PRICE_TABLE, title: undefined, rows: [["4", "Armario de aco", "UN", "1", "2.100,00", "2.100,00"]] } }]),
    scannedPdf([BRL_TABLE]),
    scannedPdf([WIDE_TABLE]),
  ]);
}, 60_000);

describe("A — PDF digital tabular (texto nativo)", () => {
  it("extrai pelo texto nativo e NÃO aciona o OCR", async () => {
    const port = spyPort();
    const r = await parser.parse(A, opts(port));
    expect(port.calls).toBe(0);
    expect(r.items.length).toBe(3);
    expect(r.extraction).toMatchObject({ extractionMode: "native_text", ocr: null, ocrPages: 0, ocrReason: null });
    expect(r.items.every((i) => i.parserMetadata.extractionMode === undefined)).toBe(true);
  });
});

describe("B — PDF digitalizado tabular (OCR)", () => {
  it("fallback de OCR → MESMO parser tabular → itens com valores brutos exatos", async () => {
    const r = await parser.parse(B, opts(tesseract));
    expect(r.extraction?.extractionMode).toBe("ocr");
    expect(r.extraction?.ocrReason).toBe("no_useful_text");
    expect(r.items.map(row)).toEqual([
      ["Cadeira giratoria", "UN", "10", "1.234,56", "12.345,60"],
      ["Mesa de reuniao", "UN", "2", "850,00", "1.700,00"],
      ["Papel A4 resma", "CX", "12,5", "R$ 23,90", "R$ 298,75"],
    ]);
  }, 60_000);

  it("preserva texto bruto (artefato por página + linha em cada item), avisos e linhagem completa", async () => {
    const r = await parser.parse(B, opts(tesseract));
    expect(r.ocrArtifact?.pages[0].text).toMatch(/Cadeira giratoria/);
    const it0 = r.items[0];
    expect(it0.parserMetadata).toMatchObject({ extractionMode: "ocr", ocr: { engine: "tesseract.js", engineVersion: "7.0.0" } });
    expect((it0.rawMetadata.ocr as { lineText: string; pageNumber: number }).lineText).toMatch(/Cadeira giratoria/);
    expect((it0.rawMetadata.ocr as { pageNumber: number }).pageNumber).toBe(1);
    expect(it0.extractionWarnings.map((w) => w.code)).toContain("OCR_EXTRACTED");
    expect(it0.confidenceMetadata.requiresReview).toBe(true);
    expect(r.extraction?.ocr).toMatchObject({
      engine: "tesseract.js", language: "por", pagesProcessed: 1, nondeterministic: true, failure: null, layoutVersion: "3",
    });
    expect(r.extraction?.ocr?.outputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(r.extraction?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(classifyRowsOutcome({ itemCount: r.items.length, warningCodes: r.warnings.map((w) => w.code), itemsNeedAttention: true })).toBe("REVIEW_REQUIRED");
  }, 60_000);

  it("replay: mesmo arquivo + mesma configuração ⇒ mesmo fingerprint e mesmos valores", async () => {
    const [r1, r2] = [await parser.parse(B, opts(tesseract)), await parser.parse(B, opts(tesseract))];
    expect(r1.extraction?.fingerprint).toBe(r2.extraction?.fingerprint);
    expect(r1.items.map(row)).toEqual(r2.items.map(row));
    const other = await parser.parse(B, opts(tesseract, { sourceChecksum: "d".repeat(64) }));
    expect(other.extraction?.fingerprint).not.toBe(r1.extraction?.fingerprint);
  }, 90_000);

  it("sem porta de OCR (kill-switch) ⇒ OCR_REQUIRED explícito, zero itens", async () => {
    const r = await parser.parse(B, opts(null));
    expect(r.items).toHaveLength(0);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["OCR_REQUIRED", "SCANNED_PDF_UNSUPPORTED"]));
    expect(classifyRowsOutcome({ itemCount: 0, warningCodes: r.warnings.map((w) => w.code), itemsNeedAttention: false })).toBe("OCR_REQUIRED");
  });
});

describe("C — PDF digitalizado vazio/ilegível", () => {
  it("OCR roda, nenhum item ⇒ NO_VALID_ITEMS (não é sucesso vazio)", async () => {
    const r = await parser.parse(C, opts(tesseract));
    expect(r.items).toHaveLength(0);
    expect(r.warnings.map((w) => w.code)).toContain("OCR_NO_ITEMS");
    expect(classifyRowsOutcome({ itemCount: 0, warningCodes: r.warnings.map((w) => w.code), itemsNeedAttention: false })).toBe("NO_VALID_ITEMS");
  }, 60_000);
});

describe("D — páginas mistas (nativa + digitalizada)", () => {
  it("página nativa pelo texto, página digitalizada por OCR; modo mixed por página", async () => {
    const port = spyPort();
    const r = await parser.parse(D, opts(port));
    expect(port.calls).toBe(1);
    expect(r.extraction).toMatchObject({ extractionMode: "mixed", pageModes: { "1": "native_text", "2": "ocr" }, nativePages: 1, ocrPages: 1 });
    const p1 = r.items.filter((i) => i.sourceLocation.location.page === 1);
    const p2 = r.items.filter((i) => i.sourceLocation.location.page === 2);
    expect(p1).toHaveLength(3);
    expect(p1.every((i) => i.parserMetadata.extractionMode === undefined)).toBe(true);
    expect(p2.map(row)).toEqual([["Armario de aco", "UN", "1", "2.100,00", "2.100,00"]]);
    expect(p2[0].parserMetadata.extractionMode).toBe("ocr");
  }, 60_000);
});

describe("E — valores BRL e F — quantidade decimal (contrato monetário)", () => {
  it("1.234,56 / 1234,56 / R$ 1.234,56 preservados BRUTOS e todos resolvem para 123456 centavos", async () => {
    const r = await parser.parse(E, opts(tesseract));
    expect(r.items.map((i) => i.rawUnitPrice)).toEqual(["1.234,56", "1234,56", "R$ 1.234,56"]);
    for (const i of r.items) expect(parseBRLDetailed(i.rawUnitPrice)).toMatchObject({ cents: 123456 });
  }, 60_000);
  it("quantidade decimal 12,5 preservada (B)", async () => {
    const r = await parser.parse(B, opts(tesseract));
    expect(r.items[2].rawQuantity).toBe("12,5");
  }, 60_000);
});

describe("G — multi-fornecedor (mapa comparativo digitalizado)", () => {
  it("expande uma cotação por fornecedor pelo MESMO parser tabular (WIDE_FORMAT_EXPANDED)", async () => {
    const r = await parser.parse(G, opts(tesseract));
    expect(r.warnings.map((w) => w.code)).toContain("WIDE_FORMAT_EXPANDED");
    expect(r.items.map((i) => [i.rawDescription, i.rawSupplier, i.rawUnitPrice])).toEqual([
      ["Cadeira giratoria", "Empresa Alfa", "1.198,00"], ["Cadeira giratoria", "Empresa Beta", "1.250,00"],
      ["Mesa de reuniao", "Empresa Alfa", "850,00"], ["Mesa de reuniao", "Empresa Beta", "910,50"],
    ]);
  }, 60_000);
});

describe("H — erro e ambiguidade de OCR", () => {
  it("motor falha ⇒ OCR_FAILED (não fingido; linhagem registra a falha)", async () => {
    const failing: OcrPort = { identity: () => tesseract.identity(), recognize: async () => { throw new OcrError("OCR_ENGINE_FAILURE", "boom"); } };
    const r = await parser.parse(B, opts(failing));
    expect(r.items).toHaveLength(0);
    expect(r.warnings.map((w) => w.code)).toContain("OCR_FAILED");
    expect(r.extraction?.ocr?.failure).toMatchObject({ code: "OCR_ENGINE_FAILURE" });
    expect(classifyRowsOutcome({ itemCount: 0, warningCodes: r.warnings.map((w) => w.code), itemsNeedAttention: false })).toBe("OCR_FAILED");
  });

  it("tempo esgotado ⇒ OCR_TIMEOUT registrado como OCR_FAILED", async () => {
    const slow: OcrPort = { identity: () => tesseract.identity(), recognize: () => new Promise((_, rej) => setTimeout(() => rej(new OcrError("OCR_TIMEOUT", "t")), 5)) };
    const r = await parser.parse(B, opts(slow));
    expect(r.extraction?.ocr?.failure?.code).toBe("OCR_TIMEOUT");
  });

  it("valor com caractere suspeito e baixa confiança ⇒ avisos; valor NÃO corrigido; promoção bloquearia", async () => {
    // Porta determinística que devolve uma leitura "ruim" (simula O no lugar de 0 e baixa confiança).
    const w = (text: string, x0: number, y0: number, confidence = 95) => ({ text, confidence, bbox: { x0, y0, x1: x0 + text.length * 12, y1: y0 + 22 } });
    const header = ["Descricao", "Unidade", "Quantidade", "Valor", "Total"].map((t, i) => w(t, [40, 300, 420, 620, 780][i], 100));
    const data = [w("Cadeira", 40, 140), w("UN", 300, 140), w("10", 420, 140), w("1.2O4,56", 620, 140, 38), w("12.345,60", 780, 140)];
    const fake: OcrResult = {
      text: "Descricao Unidade Quantidade Valor Total\nCadeira UN 10 1.2O4,56 12.345,60", confidence: 62,
      pages: [{ pageNumber: 1, text: "…", confidence: 62, width: 1700, height: 2200, lines: [{ text: "", confidence: 62, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: [...header, ...data] }], durationMs: 1, warnings: [] }],
      warnings: [], engine: "tesseract.js", engineVersion: "7.0.0", language: "por", durationMs: 1, metadata: {},
    };
    const port: OcrPort = { identity: () => tesseract.identity(), recognize: vi.fn(async () => fake) };
    const r = await parser.parse(B, opts(port));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].rawUnitPrice).toBe("1.2O4,56"); // bruto, NUNCA "corrigido"
    const codes = r.items[0].extractionWarnings.map((x) => `${x.code}:${x.field ?? ""}`);
    expect(codes).toEqual(expect.arrayContaining(["OCR_AMBIGUOUS_VALUE:unit_price", "OCR_LOW_CONFIDENCE:unit_price"]));
    expect(r.warnings.map((x) => x.code)).toContain("OCR_LOW_CONFIDENCE"); // página abaixo do limiar
    expect(parseBRLDetailed(r.items[0].rawUnitPrice).cents).toBeNull(); // contrato monetário não aceita
    const up = r.items[0].confidenceMetadata.fieldConfidences.find((f) => f.field === "unit_price");
    expect(up?.score).toBeLessThanOrEqual(0.38);
  });

  it("limite de páginas de OCR respeitado (OCR_PAGE_LIMIT)", async () => {
    const two = await scannedPdf([PRICE_TABLE, PRICE_TABLE]);
    const port = spyPort();
    const r = await parser.parse(two, { ...opts(port), ocr: { port, maxPages: 1, timeoutMs: 90_000, renderWidth: 1600, minConfidence: 75 } });
    expect(r.warnings.map((w) => w.code)).toContain("OCR_PAGE_LIMIT");
    expect(r.extraction?.ocr).toMatchObject({ pagesRequested: 2, pagesProcessed: 1 });
  }, 60_000);
});

describe("modo DOCUMENTO (DFD/ETP/TR) não usa OCR", () => {
  it("PDF digitalizado em modo documento continua OCR_REQUIRED (porta ignorada)", async () => {
    const port = spyPort();
    const r = await parser.parse(B, opts(port, { extractionMode: "document" }));
    expect(port.calls).toBe(0);
    expect(r.warnings.map((w) => w.code)).toContain("OCR_REQUIRED");
    expect(r.documentProjection).toBeUndefined();
  });
});
