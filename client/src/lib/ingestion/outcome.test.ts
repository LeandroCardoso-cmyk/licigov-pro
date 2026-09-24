/**
 * U2A / U2A-OCR — o desfecho persistido vira uma explicação com PRÓXIMO PASSO (nunca genérica).
 */
import { describe, it, expect } from "vitest";
import { describeOutcome } from "./outcome";

describe("describeOutcome — estados distinguíveis e acionáveis", () => {
  it("OCR em andamento é explicado (sem ação)", () => {
    expect(describeOutcome({ status: "parsing", stage: "ocr_processing" })).toMatchObject({ kind: "ocr_processing", canRetry: false });
  });
  it("OCR_REQUIRED ⇒ enviar outro arquivo (reprocessar não muda)", () => {
    const o = describeOutcome({ status: "failed", stage: "ocr_required", errors: [{ code: "OCR_REQUIRED", message: "Envie o PDF original com texto." }] });
    expect(o).toMatchObject({ kind: "ocr_required", canRetry: false, suggestNewFile: true, message: "Envie o PDF original com texto." });
  });
  it("OCR_FAILED ⇒ reprocessar OU enviar outro arquivo", () => {
    expect(describeOutcome({ status: "failed", stage: "ocr_failed", errors: [{ code: "OCR_FAILED" }] })).toMatchObject({ kind: "ocr_failed", canRetry: true, suggestNewFile: true });
  });
  it("NO_VALID_ITEMS ⇒ não há o que revisar nem aprovar", () => {
    const o = describeOutcome({ status: "failed", stage: "no_items", errors: [{ code: "NO_VALID_ITEMS" }] });
    expect(o).toMatchObject({ kind: "no_items", canRetry: false, suggestNewFile: true });
    expect(o.message).toMatch(/revisar nem aprovar/);
  });
  it("PARSER_FAILED determinístico ⇒ sem retry; retry esgotado (PARSE_ERROR) ⇒ retry permitido", () => {
    expect(describeOutcome({ status: "failed", stage: "parser_failed", errors: [{ code: "CORRUPT_FILE" }] }).canRetry).toBe(false);
    expect(describeOutcome({ status: "failed", stage: "parser_failed", errors: [{ code: "PARSE_ERROR" }] }).canRetry).toBe(true);
  });
  it("revisão de itens lidos por OCR pede conferência com o original (e informa a confiança)", () => {
    const o = describeOutcome({ status: "awaiting_review", stage: "review_required", extraction: { mode: "ocr", ocrPages: 1, meanConfidence: 91.4 } });
    expect(o.kind).toBe("review_required_ocr");
    expect(o.message).toMatch(/Nenhum valor foi corrigido automaticamente/);
    expect(o.message).toMatch(/91%/);
    expect(describeOutcome({ status: "awaiting_review", extraction: { mode: "mixed" } }).title).toMatch(/Parte dos itens/);
  });
  it("texto nativo e estados comuns não geram alerta extra", () => {
    expect(describeOutcome({ status: "awaiting_review", extraction: { mode: "native_text" } }).kind).toBe("none");
    expect(describeOutcome({ status: "failed", stage: "failed", errors: [{ code: "PARSE_ERROR" }] }).kind).toBe("none");
    expect(describeOutcome(null).kind).toBe("none");
  });
});
