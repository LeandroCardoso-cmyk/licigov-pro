/**
 * Sprint 2.8 — XLSX/XLS Parser Foundation.
 * Usa biblioteca 'xlsx' (SheetJS) já disponível no projeto.
 * Suporta: sheet detection, header inference, merged cells, sparse rows.
 */
import { BaseParser } from "./baseParser";
import { createRawItem } from "../domain/importExtraction";
import { buildProvenance } from "../domain/importProvenance";
import { buildFieldConfidence, aggregateConfidence } from "../domain/importConfidence";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";
import type { ImportWarning } from "../domain/importTypes";
import type { RawExtractedItem } from "../domain/importExtraction";

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

// ─── Column patterns (same as CSV) ────────────────────────────────────────────

const DESCRIPTION_PATTERNS = ["DESCRIÇÃO", "DESCRICAO", "DESCRIPTION", "OBJETO", "ITEM", "MATERIAL", "PRODUTO", "ESPECIFICAÇÃO", "ESPECIFICACAO", "NOME"];
const QUANTITY_PATTERNS     = ["QTDE", "QTD", "QT", "QUANTIDADE", "QUANT", "QUANTITY", "QNT"];
const UNIT_PATTERNS         = ["UNID", "UN", "UNIDADE", "UNIT", "UM"];
const UNIT_PRICE_PATTERNS   = ["PRECO UNIT", "PREÇO UNIT", "V.UNIT", "VL.UNIT", "VALOR UNIT", "UNIT PRICE", "P.UNIT", "PRECO UNI"];
const TOTAL_PRICE_PATTERNS  = ["TOTAL", "PRECO TOTAL", "PREÇO TOTAL", "VL TOTAL", "VALOR TOTAL", "TOTAL PRICE", "V.TOTAL"];

function matchColumn(headers: string[], patterns: string[]): number {
  for (const pattern of patterns) {
    const idx = headers.findIndex(h => h.toUpperCase().includes(pattern));
    if (idx >= 0) return idx;
  }
  return -1;
}

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") return val.toString();
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
    parserVersion:         "1.0.0",
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
    const items:    RawExtractedItem[] = [];
    let   skipped  = 0;
    let   totalRowsRead = 0;

    // Dynamic require — xlsx is optional at module level to avoid test errors
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

    const sheet     = workbook.Sheets[targetSheet];
    const rawData   = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
    const rows      = rawData as string[][];

    if (rows.length === 0) {
      return {
        items: [], warnings: [{ code: "HEADER_INFERENCE", message: "Sheet vazia.", severity: "warning" }],
        errors: [], summary: this.emptySummary(Date.now() - startMs), rawMetadata: {},
      };
    }

    // Header inference
    let headerRow  = opts.headerRow ?? 0;
    let headers:    string[] = [];
    for (let i = headerRow; i < Math.min(headerRow + 5, rows.length); i++) {
      const row = rows[i];
      const numericCount = row.filter(c => c && !isNaN(Number(String(c).replace(/[R$.,\s]/g, "")))).length;
      if (numericCount / row.length < 0.5) {
        headers  = row.map(c => cellToString(c).toUpperCase());
        headerRow = i;
        break;
      }
    }

    if (headers.length === 0) {
      warnings.push({ code: "HEADER_INFERENCE", message: "Cabeçalhos não inferidos. Usando índices.", severity: "warning" });
    }

    const descIdx  = matchColumn(headers, DESCRIPTION_PATTERNS);
    const qtyIdx   = matchColumn(headers, QUANTITY_PATTERNS);
    const unitIdx  = matchColumn(headers, UNIT_PATTERNS);
    const upIdx    = matchColumn(headers, UNIT_PRICE_PATTERNS);
    const totalIdx = matchColumn(headers, TOTAL_PRICE_PATTERNS);

    for (let rowIdx = headerRow + 1; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx].map(cellToString);
      totalRowsRead++;

      if (row.every(c => c === "")) { skipped++; continue; }

      const rawDescription = descIdx >= 0 ? row[descIdx] || null : row[0] || null;
      const rawQuantity    = qtyIdx  >= 0 ? row[qtyIdx]  || null : null;
      const rawUnit        = unitIdx >= 0 ? row[unitIdx]  || null : null;
      const rawUnitPrice   = upIdx   >= 0 ? row[upIdx]   || null : null;
      const rawTotalPrice  = totalIdx >= 0 ? row[totalIdx] || null : null;

      if (!rawDescription || rawDescription.trim() === "") {
        skipped++;
        continue;
      }

      const isSparse = row.filter(c => c !== "").length < Math.max(2, row.length / 2);
      if (isSparse) {
        warnings.push({ code: "SPARSE_ROW", message: `Linha ${rowIdx + 1} é esparsa.`, severity: "info", location: `row:${rowIdx + 1}` });
      }

      const fieldConfs = [
        buildFieldConfidence("description", rawDescription ? 0.9 : 0.2),
        buildFieldConfidence("quantity",    rawQuantity    ? 0.85 : 0.3),
        buildFieldConfidence("unit",        rawUnit        ? 0.80 : 0.3),
        buildFieldConfidence("unit_price",  rawUnitPrice   ? 0.85 : 0.3),
        buildFieldConfidence("total_price", rawTotalPrice  ? 0.85 : 0.3),
      ];
      const confidence = aggregateConfidence(fieldConfs);

      const provenance = buildProvenance(
        opts.sourceFileId, opts.sourceFileName, opts.sourceMimeType, "",
        this.parserType, this.capabilities.parserVersion,
        { sheet: targetSheet, row: rowIdx + 1 },
        { rawRowData: row },
      );
      const parserMeta = {
        parserType:      this.parserType,
        parserVersion:   this.capabilities.parserVersion,
        processingMs:    0,
        rawCellValues:   Object.fromEntries(headers.map((h, i) => [h || `col${i}`, row[i]])),
        inferredHeaders: headers,
        sheetName:       targetSheet,
      };

      items.push(createRawItem(
        opts.importSessionId,
        { rawDescription, rawQuantity, rawUnit, rawUnitPrice, rawTotalPrice },
        provenance, parserMeta, confidence,
      ));
    }

    const processingMs = Date.now() - startMs;
    const summary = this.buildSummary(totalRowsRead, items, skipped, warnings, [], processingMs, { sheetsProcessed: 1 });

    return { items, warnings, errors: [], summary, rawMetadata: { sheetNames, processedSheet: targetSheet, headers } };
  }
}

export const xlsxParser = new XlsxParser();
