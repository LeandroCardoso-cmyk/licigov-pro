/**
 * Sprint 2.8 — PDF/DOCX Parser Foundation (Stub).
 *
 * Foundation com contratos completos e extração básica de texto.
 * Sprint 3 implementará extração avançada com biblioteca dedicada.
 *
 * PDF:  extrai texto bruto por página, tabelas via heurística de espaçamento
 * DOCX: extrai parágrafos e tabelas (requer mammoth — sprint 3)
 */
import { BaseParser } from "./baseParser";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";

const MAX_SIZE = 50 * 1024 * 1024;

// ─── PDF Parser ────────────────────────────────────────────────────────────────

export class PdfParser extends BaseParser {
  readonly parserType = "pdf";
  readonly capabilities: ParserCapabilities = {
    supportedMimeTypes:    ["application/pdf"],
    supportedExtensions:   ["pdf"],
    maxFileSizeBytes:      MAX_SIZE,
    supportsStreaming:     false,
    supportsProgressEvents: false,
    parserVersion:         "1.0.0-stub",
    capabilityStatus:      "stub",
    supportsStructuredExtraction: false,
    limitations:           ["Extração real de PDF disponível na B.2.3 (requer pdf-parse)."],
    requiresExternalLib:   "pdf-parse",
  };

  canHandle(mimeType: string, extension: string): boolean {
    return mimeType === "application/pdf" || extension.toLowerCase() === "pdf";
  }

  async parse(buffer: Buffer, _opts: ParseOptions): Promise<ParseResult> {
    const startMs = Date.now();

    // Stub: detecta se é PDF pelo magic bytes %PDF
    const header = buffer.slice(0, 4).toString("ascii");
    if (header !== "%PDF") {
      return {
        items: [], warnings: [],
        errors: [{ code: "CORRUPT_FILE", message: "Arquivo não é um PDF válido.", fatal: true }],
        summary: this.emptySummary(Date.now() - startMs),
        rawMetadata: {},
      };
    }

    // Foundation stub: retorna metadados do arquivo sem extração real
    // Sprint 3 integrará pdf-parse para extração de texto/tabelas
    const processingMs = Date.now() - startMs;
    return {
      items: [],
      warnings: [{
        code:     "HEADER_INFERENCE",
        message:  "Parser PDF em modo stub. Extração completa disponível na Sprint 3.",
        severity: "warning",
      }],
      errors: [],
      summary: {
        totalRowsRead:       0,
        totalItemsExtracted: 0,
        totalItemsSkipped:   0,
        totalWarnings:       1,
        totalErrors:         0,
        averageConfidence:   0,
        processingMs,
        parserType:          this.parserType,
        parserVersion:       this.capabilities.parserVersion,
        pagesProcessed:      0,
      },
      rawMetadata: {
        pdfVersion: header,
        fileSize:   buffer.length,
        stubMode:   true,
      },
    };
  }
}

// ─── DOCX Parser ───────────────────────────────────────────────────────────────

export class DocxParser extends BaseParser {
  readonly parserType = "docx";
  readonly capabilities: ParserCapabilities = {
    supportedMimeTypes:    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ],
    supportedExtensions:   ["docx", "doc"],
    maxFileSizeBytes:      MAX_SIZE,
    supportsStreaming:     false,
    supportsProgressEvents: false,
    parserVersion:         "1.0.0-stub",
    capabilityStatus:      "stub",
    supportsStructuredExtraction: false,
    limitations:           ["Extração real de DOCX disponível na B.2.3 (requer mammoth)."],
    requiresExternalLib:   "mammoth",
  };

  canHandle(mimeType: string, extension: string): boolean {
    return this.capabilities.supportedMimeTypes.includes(mimeType) ||
           ["docx", "doc"].includes(extension.toLowerCase());
  }

  async parse(buffer: Buffer, _opts: ParseOptions): Promise<ParseResult> {
    const startMs = Date.now();

    // Stub: detecta ZIP magic bytes (DOCX é um ZIP)
    const magic = buffer.slice(0, 4);
    const isZip = magic[0] === 0x50 && magic[1] === 0x4B;

    if (!isZip) {
      return {
        items: [], warnings: [],
        errors: [{ code: "CORRUPT_FILE", message: "Arquivo não é um DOCX válido.", fatal: true }],
        summary: this.emptySummary(Date.now() - startMs),
        rawMetadata: {},
      };
    }

    const processingMs = Date.now() - startMs;
    return {
      items: [],
      warnings: [{
        code:     "HEADER_INFERENCE",
        message:  "Parser DOCX em modo stub. Extração completa disponível na Sprint 3.",
        severity: "warning",
      }],
      errors: [],
      summary: {
        totalRowsRead:       0,
        totalItemsExtracted: 0,
        totalItemsSkipped:   0,
        totalWarnings:       1,
        totalErrors:         0,
        averageConfidence:   0,
        processingMs,
        parserType:          this.parserType,
        parserVersion:       this.capabilities.parserVersion,
      },
      rawMetadata: { isZip, fileSize: buffer.length, stubMode: true },
    };
  }
}

export const pdfParser  = new PdfParser();
export const docxParser = new DocxParser();
