/**
 * Sprint 2.8 — CSV Parser (P0 piloto: mapeamento de colunas CONSOLIDADO em tabularExtraction).
 * Parse puro sem dependências externas. Suporta delimitadores auto-detectados, células com aspas,
 * cabeçalhos inferidos, campos de cotação (fornecedor/marca/modelo/obs./fonte) e mapa comparativo.
 */
import { BaseParser } from "./baseParser";
import { tableToRawItems, type TabularContext } from "./tabularExtraction";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB for CSV
const MAX_ITEMS = 5000;
const PARSER_VERSION = "1.1.0";

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

// ─── Parser ───────────────────────────────────────────────────────────────────

export class CsvParser extends BaseParser {
  readonly parserType = "csv";
  readonly capabilities: ParserCapabilities = {
    supportedMimeTypes:    ["text/csv", "application/csv", "text/plain"],
    supportedExtensions:   ["csv", "txt"],
    maxFileSizeBytes:      MAX_SIZE,
    supportsStreaming:     false,
    supportsProgressEvents: false,
    parserVersion:         PARSER_VERSION,
    capabilityStatus:      "supported",
    supportsStructuredExtraction: true,
  };

  canHandle(mimeType: string, extension: string): boolean {
    return this.capabilities.supportedMimeTypes.includes(mimeType) ||
           ["csv", "txt"].includes(extension.toLowerCase());
  }

  async parse(buffer: Buffer, opts: ParseOptions): Promise<ParseResult> {
    const startMs = Date.now();
    const text    = buffer.toString("utf8").replace(/^﻿/, "");
    const lines   = text.split(/\r?\n/).filter(l => l.trim() !== "");
    const sample  = lines.slice(0, 5).join("\n");
    const delim   = detectDelimiter(sample);
    const rows    = lines.map(l => parseCSVLine(l, delim));

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
    const out = tableToRawItems(rows, ctx, { positionalFallback: "description_only", headerRow: opts.headerRow }, (r, col) => ({
      location: { row: r + 1, ...(col !== undefined ? { column: col + 1 } : {}) },
      extras: {},
    }));

    const processingMs = Date.now() - startMs;
    const summary = this.buildSummary(out.rowsRead, out.items, out.skipped, out.warnings, [], processingMs);
    return { items: out.items, warnings: out.warnings, errors: [], summary, rawMetadata: { delimiter: delim, parserVersion: PARSER_VERSION } };
  }
}

export const csvParser = new CsvParser();
