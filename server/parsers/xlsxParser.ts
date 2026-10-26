/**
 * Sprint 2.8 — XLSX Parser (P0 piloto: mapeamento de colunas CONSOLIDADO em tabularExtraction).
 * Suporta seleção de planilha, inferência de cabeçalho, linhas esparsas, campos de cotação
 * (fornecedor/marca/modelo/obs./fonte) e mapa comparativo.
 *
 * SEC-AUD-07 — o tipo é decidido pelo CONTEÚDO e pela declaração, nunca só pela extensão:
 *   - XLSX (ZIP) → `exceljs` em worker isolado (xlsxReadIsolated.ts), com limites de bytes reais, células e abas;
 *   - XLS legado (OLE/CFB/BIFF) — inclusive renomeado para .xlsx — ou arquivo declarado .xls/`application/vnd.ms-excel`
 *     → UNSUPPORTED_FORMAT com a orientação de conversão (formato SUSPENSO por decisão do Owner; o SheetJS saiu
 *     do produto e das dependências);
 *   - outro conteúdo → CORRUPT_FILE.
 * Os dois códigos são determinísticos (importOutcome.ts): nenhum reprocessamento automático.
 * Fórmulas nunca são executadas: o leitor usa o valor em cache.
 */
import { BaseParser } from "./baseParser";
import { tableToRawItems, documentDeclarationWarnings, type TabularContext } from "./tabularExtraction";
import { DECLARATION_SCAN_PERFORMED, dedupeDocumentDeclarations } from "../domain/quoteProvenance";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";
import type { ImportError, ImportWarning } from "../domain/importTypes";
import { numberToDecimalString } from "../domain/money";
import type { WorkbookMatrices } from "./excelWorkbookMatrix";
import { detectSpreadsheetContainer, SpreadsheetLimitError } from "./spreadsheetLimits";
import { readXlsxIsolated, XlsxReaderUnavailableError } from "./xlsxReadIsolated";
import { isDeclaredLegacyXls, XLS_SUSPENDED_MESSAGE } from "@shared/spreadsheetFormats";

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ITEMS = 5000;
// 1.2.0: valor nativo de células numéricas preservado (rawTypedValues)
// 1.3.0: XLSX lido com exceljs + limites (mesma matriz — teste diferencial); XLS legado com limite de linhas
// 1.4.0: XLS suspenso (UNSUPPORTED_FORMAT com orientação de conversão); leitura em worker isolado com bytes reais
const PARSER_VERSION = "1.4.0";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Book = WorkbookMatrices & { engine: "exceljs" };

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
    supportedMimeTypes:    [XLSX_MIME],
    supportedExtensions:   ["xlsx"],
    maxFileSizeBytes:      MAX_SIZE,
    supportsStreaming:     false,
    supportsProgressEvents: false,
    parserVersion:         PARSER_VERSION,
    capabilityStatus:      "supported",
    supportsStructuredExtraction: true,
  };

  /**
   * Continua RECEBENDO `.xls`/`application/vnd.ms-excel` para responder com UNSUPPORTED_FORMAT e a orientação de
   * conversão (em vez de "sem parser"); a capacidade anunciada (acima e em ingestion.getCapabilities) é só XLSX.
   */
  canHandle(mimeType: string, extension: string): boolean {
    return [XLSX_MIME, "application/vnd.ms-excel"].includes(mimeType) || ["xlsx", "xls"].includes(extension.toLowerCase());
  }

  /** MIME `.xls` declarado: a mesma orientação de conversão do parse (não o genérico "Tipo MIME não suportado"). */
  override validate(buffer: Buffer, mimeType: string): ImportError | null {
    if (isDeclaredLegacyXls(null, mimeType) && buffer.length > 0) {
      return { code: "UNSUPPORTED_FORMAT", message: XLS_SUSPENDED_MESSAGE, fatal: true };
    }
    return super.validate(buffer, mimeType);
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

    const fail = (code: string, message: string, extra: Record<string, unknown> = {}): ParseResult => ({
      items: [], warnings: [],
      errors: [{ code, message, fatal: true }],
      summary: this.emptySummary(Date.now() - startMs),
      rawMetadata: { parserVersion: PARSER_VERSION, ...extra },
    });

    // XLS suspenso: pela declaração (extensão/MIME) OU pelo conteúdo OLE/CFB (XLS renomeado para .xlsx).
    const container = detectSpreadsheetContainer(buffer);
    if (container === "cfb" || isDeclaredLegacyXls(opts.sourceFileName, opts.sourceMimeType)) {
      return fail("UNSUPPORTED_FORMAT", XLS_SUSPENDED_MESSAGE, { detectedContainer: container, unsupportedFormat: "xls" });
    }
    if (container !== "zip") {
      return fail("CORRUPT_FILE", "Não foi possível ler a planilha: o conteúdo não é um arquivo .xlsx válido.", { detectedContainer: container });
    }

    let book: Book;
    try {
      book = { ...(await readXlsxIsolated(buffer)), engine: "exceljs" };
    } catch (err) {
      if (err instanceof SpreadsheetLimitError) {
        return err.code === "ZIP_INVALID"
          ? fail("CORRUPT_FILE", err.message, { limit: err.code })
          : fail("SIZE_EXCEEDED", err.message, { limit: err.code });
      }
      if (err instanceof XlsxReaderUnavailableError) {
        // Falha de infraestrutura (não do arquivo): código NÃO determinístico ⇒ retry/backoff já existente da fila.
        return fail("PARSE_ERROR", "Leitor de planilhas indisponível no momento. Tente novamente.");
      }
      return fail("CORRUPT_FILE", "Não foi possível ler a planilha (arquivo corrompido).");
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
