/**
 * U2A-OCR — Resolução do adapter de OCR (infraestrutura). Fonte única: `OCR_CONFIG` (server/config/ocr.ts).
 * `null` = OCR desligado (kill-switch) → o PDF digitalizado termina em OCR_REQUIRED explícito.
 */
import { OCR_CONFIG } from "../../config/ocr";
import type { OcrPort } from "../../domain/ocr";
import { TesseractOcrAdapter } from "./tesseractOcrAdapter";

let singleton: OcrPort | null = null;
let override: { port: OcrPort | null } | null = null;

export function getOcrAdapter(): OcrPort | null {
  if (override) return override.port;
  if (!OCR_CONFIG.enabled) return null;
  if (!singleton) singleton = new TesseractOcrAdapter({ maxConcurrency: OCR_CONFIG.maxConcurrency });
  return singleton;
}

/** Somente testes: injeta um adapter (ou `null` para simular OCR desligado); `undefined` restaura. */
export function setOcrAdapterForTesting(port: OcrPort | null | undefined): void {
  override = port === undefined ? null : { port };
}

export { TesseractOcrAdapter } from "./tesseractOcrAdapter";
