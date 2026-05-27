/**
 * Sprint 2.8 — CSV Parser Foundation.
 * Parse puro sem dependências externas. Suporta delimitadores auto-detectados,
 * encoding UTF-8/Latin-1, headers inferidos, células com aspas.
 */
import { BaseParser } from "./baseParser";
import { createRawItem } from "../domain/importExtraction";
import { buildProvenance } from "../domain/importProvenance";
import {
  buildFieldConfidence, aggregateConfidence,
} from "../domain/importConfidence";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";
import type { ImportWarning } from "../domain/importTypes";
import type { RawExtractedItem } from "../domain/importExtraction";

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB for CSV

// ─── CSV utilities ────────────────────────────────────────────────────────────

function detectDelimiter(sample: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  for (const ch of Object.keys(counts)) {
    counts[ch] = (sample.match(new RegExp(`\\${ch}`, "g")) ?? []).length;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function inferHeaders(rows: string[][]): { headers: string[]; dataStartRow: number } {
  // Heurística: primeira linha não-vazia com maioria de strings não-numéricas
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    if (row.length < 2) continue;
    const numericCount = row.filter(c => c && !isNaN(Number(c.replace(/[R$.,]/g, "")))).length;
    if (numericCount / row.length < 0.5) {
      return { headers: row.map(h => h.toUpperCase()), dataStartRow: i + 1 };
    }
  }
  return { headers: [], dataStartRow: 0 };
}

// ─── Column matching ──────────────────────────────────────────────────────────

const DESCRIPTION_PATTERNS = ["DESCRIÇÃO", "DESCRICAO", "DESCRIPTION", "OBJETO", "ITEM", "MATERIAL", "PRODUTO", "ESPECIFICAÇÃO", "ESPECIFICACAO", "NOME"];
const QUANTITY_PATTERNS     = ["QTDE", "QTD", "QT", "QUANTIDADE", "QUANT", "QUANTITY", "QNT"];
const UNIT_PATTERNS         = ["UNID", "UN", "UNIDADE", "UNIT", "UM"];
const UNIT_PRICE_PATTERNS   = ["PRECO UNIT", "PREÇO UNIT", "V.UNIT", "VL.UNIT", "VALOR UNIT", "UNIT PRICE", "P.UNIT", "PRECO UNI"];
const TOTAL_PRICE_PATTERNS  = ["TOTAL", "PRECO TOTAL", "PREÇO TOTAL", "VL TOTAL", "VALOR TOTAL", "TOTAL PRICE", "V.TOTAL"];

function matchColumn(headers: string[], patterns: string[]): number {
  for (const pattern of patterns) {
    const idx = headers.findIndex(h => h.includes(pattern));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export class CsvParser extends BaseParser {
  readonly parserType = "csv";
  readonly capabilities: ParserCapabilities = {
    supportedMimeTypes:    ["text/csv", "application/csv", "text/plain"],
    supportedExtensions:   ["csv", "txt"],
    maxFileSizeBytes:      MAX_SIZE,
    supportsStreaming:     false,
    supportsProgressEvents: false,
    parserVersion:         "1.0.0",
  };

  canHandle(mimeType: string, extension: string): boolean {
    return this.capabilities.supportedMimeTypes.includes(mimeType) ||
           ["csv", "txt"].includes(extension.toLowerCase());
  }

  async parse(buffer: Buffer, opts: ParseOptions): Promise<ParseResult> {
    const startMs = Date.now();
    const text    = buffer.toString("utf8");
    const lines   = text.split(/\r?\n/).filter(l => l.trim() !== "");
    const sample  = lines.slice(0, 5).join("\n");
    const delim   = detectDelimiter(sample);

    const rows    = lines.map(l => parseCSVLine(l, delim));
    const { headers, dataStartRow } = inferHeaders(rows);
    const warnings: ImportWarning[] = [];
    const items: RawExtractedItem[] = [];
    let skipped = 0;

    const descIdx  = matchColumn(headers, DESCRIPTION_PATTERNS);
    const qtyIdx   = matchColumn(headers, QUANTITY_PATTERNS);
    const unitIdx  = matchColumn(headers, UNIT_PATTERNS);
    const upIdx    = matchColumn(headers, UNIT_PRICE_PATTERNS);
    const totalIdx = matchColumn(headers, TOTAL_PRICE_PATTERNS);

    if (headers.length === 0) {
      warnings.push({ code: "HEADER_INFERENCE", message: "Cabeçalhos não detectados. Usando posição das colunas.", severity: "warning" });
    }

    for (let rowIdx = dataStartRow; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      if (row.every(c => c === "")) { skipped++; continue; }

      const rawDescription = descIdx >= 0 ? row[descIdx] ?? null : row[0] ?? null;
      const rawQuantity    = qtyIdx  >= 0 ? row[qtyIdx]  ?? null : null;
      const rawUnit        = unitIdx >= 0 ? row[unitIdx]  ?? null : null;
      const rawUnitPrice   = upIdx   >= 0 ? row[upIdx]   ?? null : null;
      const rawTotalPrice  = totalIdx >= 0 ? row[totalIdx] ?? null : null;

      const rowWarnings: import("../domain/importConfidence").ExtractionWarning[] = [];
      if (!rawDescription || rawDescription.trim() === "") {
        rowWarnings.push({ code: "EMPTY_FIELD", message: "Descrição vazia.", severity: "warning", field: "description" });
        skipped++;
        continue;
      }

      const fieldConfs = [
        buildFieldConfidence("description", rawDescription ? 0.9 : 0.2),
        buildFieldConfidence("quantity",    rawQuantity    ? 0.85 : 0.3),
        buildFieldConfidence("unit",        rawUnit        ? 0.80 : 0.3),
        buildFieldConfidence("unit_price",  rawUnitPrice   ? 0.85 : 0.3),
        buildFieldConfidence("total_price", rawTotalPrice  ? 0.85 : 0.3),
      ];

      const confidence  = aggregateConfidence(fieldConfs);
      const provenance  = buildProvenance(
        opts.sourceFileId, opts.sourceFileName, opts.sourceMimeType, "",
        this.parserType, this.capabilities.parserVersion,
        { row: rowIdx + 1 },
        { rawRowData: row },
      );
      const parserMeta = {
        parserType:    this.parserType,
        parserVersion: this.capabilities.parserVersion,
        processingMs:  0,
        rawCellValues: Object.fromEntries(headers.map((h, i) => [h || `col${i}`, row[i]])),
        inferredHeaders: headers,
      };

      items.push(createRawItem(
        opts.importSessionId,
        { rawDescription, rawQuantity, rawUnit, rawUnitPrice, rawTotalPrice },
        provenance, parserMeta, confidence, rowWarnings,
      ));
    }

    const processingMs = Date.now() - startMs;
    const summary = this.buildSummary(rows.length - dataStartRow, items, skipped, warnings, [], processingMs);

    return { items, warnings, errors: [], summary, rawMetadata: { delimiter: delim, headers } };
  }
}

export const csvParser = new CsvParser();
