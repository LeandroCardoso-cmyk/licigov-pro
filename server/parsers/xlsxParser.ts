/**
 * Sprint 2.8 — XLSX/XLS Parser (P0 piloto: mapeamento de colunas CONSOLIDADO em tabularExtraction).
 * Suporta seleção de planilha, inferência de cabeçalho, linhas esparsas, campos de cotação
 * (fornecedor/marca/modelo/obs./fonte) e mapa comparativo.
 *
 * SEC-AUD-2026-10 — leitor escolhido pelo CONTEÚDO (não pela extensão):
 *   - XLSX (ZIP) → `exceljs` (excelWorkbookMatrix.ts), com limites de descompressão e de células;
 *   - XLS legado (OLE/CFB) → SheetJS 0.18.5, o único leitor de BIFF disponível no npm. As advisories
 *     GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9 continuam aplicáveis SÓ a esse caminho, com limite de linhas,
 *     até a decisão de produto registrada em docs/security/incident-2026-10/XLSX_REMEDIATION.md;
 *   - qualquer outro conteúdo → UNSUPPORTED_FORMAT explícito (nada é removido em silêncio).
 * Fórmulas nunca são executadas: os dois leitores usam o valor em cache.
 */
import { BaseParser } from "./baseParser";
import { tableToRawItems, documentDeclarationWarnings, type TabularContext } from "./tabularExtraction";
import { DECLARATION_SCAN_PERFORMED, dedupeDocumentDeclarations } from "../domain/quoteProvenance";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";
import type { ImportWarning } from "../domain/importTypes";
import { numberToDecimalString } from "../domain/money";
import { readXlsxMatrices, type MatrixCell } from "./excelWorkbookMatrix";
import { detectSpreadsheetContainer, SpreadsheetLimitError } from "./spreadsheetLimits";

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ITEMS = 5000;
// 1.2.0: valor nativo de células numéricas preservado (rawTypedValues)
// 1.3.0: XLSX lido com exceljs + limites (mesma matriz — teste diferencial); XLS legado com limite de linhas
const PARSER_VERSION = "1.3.0";
/** XLS legado: teto de linhas lidas por aba (o SheetJS não tem limite de descompressão aplicável ao BIFF). */
const LEGACY_XLS_MAX_ROWS = 100_000;

type Matrices = { sheetNames: string[]; matrices: Map<string, MatrixCell[][]>; engine: "exceljs" | "sheetjs-legacy-xls" };

async function readLegacyXls(buffer: Buffer): Promise<Matrices> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, sheetRows: LEGACY_XLS_MAX_ROWS });
  const matrices = new Map<string, MatrixCell[][]>();
  for (const name of workbook.SheetNames) {
    matrices.set(name, XLSX.utils.sheet_to_json<MatrixCell[]>(workbook.Sheets[name], { header: 1, defval: "" }) as MatrixCell[][]);
  }
  return { sheetNames: workbook.SheetNames, matrices, engine: "sheetjs-legacy-xls" };
}

async function readWorkbook(buffer: Buffer): Promise<Matrices> {
  const kind = detectSpreadsheetContainer(buffer);
  if (kind === "zip") return { ...(await readXlsxMatrices(buffer)), engine: "exceljs" };
  if (kind === "cfb") return readLegacyXls(buffer);
  throw new SpreadsheetLimitError("ZIP_INVALID", "Conteúdo não é uma planilha XLSX nem XLS.");
}

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

    if (buffer.length > MAX_SIZE) {
      return {
        items: [], warnings: [],
        errors: [{ code: "SIZE_EXCEEDED", message: `Planilha excede ${MAX_SIZE / 1024 / 1024}MB.`, fatal: true }],
        summary: this.emptySummary(Date.now() - startMs),
        rawMetadata: {},
      };
    }

    let book: Matrices;
    try {
      book = await readWorkbook(buffer);
    } catch (err) {
      const limit = err instanceof SpreadsheetLimitError;
      return {
        items: [], warnings: [],
        errors: [{
          code: limit && err.code !== "ZIP_INVALID" ? "SIZE_EXCEEDED" : "CORRUPT_FILE",
          message: limit ? err.message : "Não foi possível ler a planilha (arquivo corrompido ou formato não suportado).",
          fatal: true,
        }],
        summary: this.emptySummary(Date.now() - startMs),
        rawMetadata: { parserVersion: PARSER_VERSION, ...(limit ? { limit: err.code } : {}) },
      };
    }
    const sheetNames = book.sheetNames;

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

    const rawData = book.matrices.get(targetSheet) ?? [];
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

    // M8 — declaração do documento nas DEMAIS abas (capa, "Leia-me"): só texto não-cotação; um aviso por tipo.
    const otherSheets = sheetNames.filter((n) => n !== targetSheet).flatMap((n) =>
      ((book.matrices.get(n) ?? []) as unknown[][])
        .map((r, i) => ({ text: r.map(cellToString).filter((c) => c !== "").join(" "), location: `sheet:${n}, row:${i + 1}` })));
    const allWarnings = dedupeDocumentDeclarations([...warnings, ...out.warnings, ...documentDeclarationWarnings(otherSheets)]);
    const processingMs = Date.now() - startMs;
    const summary = this.buildSummary(out.rowsRead, out.items, out.skipped, allWarnings, [], processingMs, { sheetsProcessed: 1 });
    return { items: out.items, warnings: allWarnings, errors: [], summary, declarationScan: DECLARATION_SCAN_PERFORMED, rawMetadata: { sheetNames, processedSheet: targetSheet, parserVersion: PARSER_VERSION, engine: book.engine } };
  }
}

export const xlsxParser = new XlsxParser();
