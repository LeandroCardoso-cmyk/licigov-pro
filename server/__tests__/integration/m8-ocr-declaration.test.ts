/**
 * M8 — EMENDA (auditoria P1-2): PDF DIGITALIZADO com o título "DADOS FICTICIOS PARA HOMOLOGACAO" acima da tabela de
 * cotações. O texto nativo é vazio; a declaração só existe no texto lido pelo OCR REAL (tesseract.js local, offline).
 * Ela precisa chegar aos avisos estruturados da extração (origem OCR) — e, com OCR de boa confiança, valer para o conjunto.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { PdfParser } from "../../parsers/pdfParser";
import { TesseractOcrAdapter } from "../../providers/ocr/tesseractOcrAdapter";
import { DECLARATION_FROM_OCR, DOCUMENT_DECLARES_FICTITIOUS, documentFictitiousDeclaration } from "../../domain/quoteProvenance";
import { scannedPdf, PRICE_TABLE } from "../fixtures/ocrPdfFixtures";

const tesseract = new TesseractOcrAdapter({ maxConcurrency: 1 });
let SCANNED: Buffer;
beforeAll(async () => {
  SCANNED = await scannedPdf([{ ...PRICE_TABLE, title: "DADOS FICTICIOS PARA HOMOLOGACAO" }]);
}, 60_000);

describe("M8 emenda — declaração no título de PDF escaneado (OCR real)", () => {
  it("o título lido por OCR gera o aviso DOCUMENT_DECLARES_FICTITIOUS (origem OCR) e as cotações continuam extraídas", async () => {
    const r = await new PdfParser().parse(SCANNED, {
      importSessionId: 7, organizationId: 42, sourceFileId: "imports/42/x.pdf", sourceFileName: "cotacoes.pdf",
      sourceMimeType: "application/pdf", sourceChecksum: "c".repeat(64),
      ocr: { port: tesseract, maxPages: 5, timeoutMs: 90_000, renderWidth: 2000, minConfidence: 75 },
    });
    expect(r.items.length).toBeGreaterThan(0);
    const decl = r.warnings.find((w) => w.code === DOCUMENT_DECLARES_FICTITIOUS);
    expect(decl?.field).toBe(DECLARATION_FROM_OCR);
    expect(decl?.raw ?? "").toMatch(/FICTICIOS/i);
    const lowOcr = r.warnings.some((w) => w.code === "OCR_LOW_CONFIDENCE");
    expect(documentFictitiousDeclaration(r.warnings)).toBe(lowOcr ? "suspected" : "global");
  }, 180_000);
});
