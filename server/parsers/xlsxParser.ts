/**
 * Sprint 2.8 — XLSX/XLS Parser (P0 piloto: mapeamento de colunas CONSOLIDADO em tabularExtraction).
 * Usa a biblioteca 'xlsx' (SheetJS). Suporta seleção de planilha, inferência de cabeçalho, linhas
 * esparsas, campos de cotação (fornecedor/marca/modelo/obs./fonte) e mapa comparativo.
 */
import { BaseParser } from "./baseParser";
import { tableToRawItems, type TabularContext } from "./tabularExtraction";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";
import type { ImportWarning } from "../domain/importTypes";
import { numberToDecimalString } from "../domain/money";

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ITEMS = 5000;
const PARSER_VERSION = "1.2.0"; // 1.2.0: valor nativo de células numéricas preservado (rawTypedValues)

/**
 * Hardening P0 — célula NUMÉRICA: exibição pt-BR SEM milhar ("1,234", "1234,5") só para o revisor; o valor
 * autoritativo vai na matriz tipada (decimal canônico exato). Antes, `1.234` virava a string "1.234", que o
 * contrato de texto pt-BR lia como milhar (R$ 1.234,00 em vez de R$ 1,23).
 */
function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") return (numberToDecimalString(val) ?? "").replace(".", ",");
  if (typeof val === "boolean") return val ? "true" : "false";
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).trim();
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export class XlsxParser extends BaseParser {
  readonly parserType = "xlsx";
  readonly capabilities: ParserCapabilities = {
    supportedMimeTypes:    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
    supportedExtensions:   ["xlsx", "xls"],
    maxFileSizeBytes:      MAX_SIZE,
    supportsStreaming:     false,
    supportsProgressEvents: false,
    parserVersion:         PARSER_VERSION,
    capabilityStatus:      "supported",
    supportsStructuredExtraction: true,
  };

  canHandle(mimeType: string, extension: string): boolean {
    return this.capabilities.supportedMimeTypes.includes(mimeType) ||
           ["xlsx", "xls"].includes(extension.toLowerCase());
  }

  async parse(buffer: Buffer, opts: ParseOptions): Promise<ParseResult> {
    const startMs  = Date.now();
    const warnings: ImportWarning[] = [];

    let XLSX: typeof import("xlsx");
    try {
      XLSX = await import("xlsx");
    } catch {
      return {
        items: [], warnings: [],
        errors: [{ code: "UNSUPPORTED_FORMAT", message: "Biblioteca xlsx não disponível.", fatal: true }],
        summary: this.emptySummary(Date.now() - startMs),
        rawMetadata: {},
      };
    }

    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetNames = workbook.SheetNames;

    if (sheetNames.length === 0) {
      return {
        items: [], warnings: [],
        errors: [{ code: "SHEET_NOT_FOUND", message: "Planilha sem sheets.", fatal: true }],
        summary: this.emptySummary(Date.now() - startMs),
        rawMetadata: {},
      };
    }

    const targetSheet = opts.sheetName
      ? (sheetNames.includes(opts.sheetName) ? opts.sheetName : sheetNames[0])
      : sheetNames[0];

    if (opts.sheetName && !sheetNames.includes(opts.sheetName)) {
      warnings.push({ code: "HEADER_INFERENCE", message: `Sheet "${opts.sheetName}" não encontrada. Usando "${targetSheet}".`, severity: "warning" });
    }
    if (sheetNames.length > 1 && !opts.sheetName) {
      warnings.push({ code: "MULTIPLE_SHEETS", message: `Planilha com ${sheetNames.length} abas; processada apenas "${targetSheet}".`, severity: "info" });
    }

    const sheet   = workbook.Sheets[targetSheet];
    const rawData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    const rows    = (rawData as unknown[][]).map((r) => r.map(cellToString));
    // Valores NATIVOS numéricos (sheet_to_json raw=true preserva `number`), paralelos a `rows`.
    const typed   = (rawData as unknown[][]).map((r) => r.map((v) => (typeof v === "number" ? numberToDecimalString(v) : null)));

    if (rows.length === 0) {
      return {
        items: [], warnings: [...warnings, { code: "HEADER_INFERENCE", message: "Sheet vazia.", severity: "warning" }],
        errors: [], summary: this.emptySummary(Date.now() - startMs), rawMetadata: {},
      };
    }

    const ctx: TabularContext = {
      importSessionId: opts.importSessionId,
      parserType:      this.parserType,
      parserVersion:   PARSER_VERSION,
      sourceFileId:    opts.sourceFileId,
      sourceFileName:  opts.sourceFileName,
      sourceMimeType:  opts.sourceMimeType,
      sourceChecksum:  opts.sourceChecksum,
      maxItems:        Math.min(opts.maxItems ?? MAX_ITEMS, MAX_ITEMS),
    };
    const out = tableToRawItems(rows, ctx, { positionalFallback: "description_only", headerRow: opts.headerRow, sheetName: targetSheet }, (r, col) => ({
      location: { sheet: targetSheet, row: r + 1, ...(col !== undefined ? { column: col + 1 } : {}) },
      extras: {},
    }), typed);

    const allWarnings = [...warnings, ...out.warnings];
    const processingMs = Date.now() - startMs;
    const summary = this.buildSummary(out.rowsRead, out.items, out.skipped, allWarnings, [], processingMs, { sheetsProcessed: 1 });
    return { items: out.items, warnings: allWarnings, errors: [], summary, rawMetadata: { sheetNames, processedSheet: targetSheet, parserVersion: PARSER_VERSION } };
  }
}

export const xlsxParser = new XlsxParser();
