/**
 * PR B.2.3 — Parser REAL de PDF (texto e tabelas) sobre pdf-parse v2 (pdfjs-dist/legacy).
 *
 * - Extrai texto por página e tabelas estruturadas (getTable) quando o PDF as expõe;
 *   caso contrário, reconstrói linhas de item a partir do texto (heurística determinística).
 * - Preserva proveniência por página/linha/tabela; confiança e avisos explícitos.
 * - Detecta PDF vazio, corrompido, protegido e composto só por imagem (escaneado → OCR_REQUIRED),
 *   SEM apresentar o escaneado como extraído. NÃO faz OCR. NÃO grava no domínio. NÃO inventa dados.
 * - Limites de segurança: tamanho, páginas, itens e tempo de processamento.
 */
import { BaseParser } from "./baseParser";
import { matrixToRawItems, linesToRawItems, type TabularContext } from "./tabularExtraction";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";
import type { ImportWarning, ImportError } from "../domain/importTypes";
import type { RawExtractedItem } from "../domain/importExtraction";

const MAX_SIZE   = 50 * 1024 * 1024; // 50 MB
const MAX_PAGES  = 500;
const MAX_ITEMS  = 5000;
const TIMEOUT_MS = 60_000;

const PARSER_VERSION = "2.0.0";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** Mapeia falhas conhecidas do pdfjs para códigos institucionais acionáveis. */
function mapError(err: unknown): ImportError {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (/^TIMEOUT:/.test(msg)) {
    return { code: "PROCESSING_TIMEOUT", message: "Tempo de processamento do PDF excedido.", fatal: true };
  }
  if (name === "PasswordException" || /password/i.test(msg)) {
    return { code: "PROTECTED_PDF", message: "PDF protegido por senha; não é possível extrair.", fatal: true };
  }
  if (name === "InvalidPDFException" || /invalid pdf/i.test(msg)) {
    return { code: "CORRUPT_FILE", message: "PDF inválido ou corrompido.", fatal: true };
  }
  return { code: "PARSER_FAILURE", message: msg, fatal: true };
}

interface PdfTextResult { pages: Array<{ num: number; text: string }>; total: number }
interface PdfTableResult { pages: Array<{ num: number; tables: string[][][] }>; total: number }

export class PdfParser extends BaseParser {
  readonly parserType = "pdf";
  readonly capabilities: ParserCapabilities = {
    supportedMimeTypes:    ["application/pdf"],
    supportedExtensions:   ["pdf"],
    maxFileSizeBytes:      MAX_SIZE,
    supportsStreaming:     false,
    supportsProgressEvents: false,
    parserVersion:         PARSER_VERSION,
    capabilityStatus:      "supported",
    supportsStructuredExtraction: true,
    limitations: [
      "PDF escaneado (somente imagem) não é extraído — requer OCR, não suportado nesta versão.",
      "Tabelas sem grade dependem de heurística de espaçamento; revise as colunas inferidas.",
      `Limite de ${MAX_PAGES} páginas e ${MAX_ITEMS} itens por importação.`,
    ],
  };

  canHandle(mimeType: string, extension: string): boolean {
    return mimeType === "application/pdf" || extension.toLowerCase() === "pdf";
  }

  async parse(buffer: Buffer, opts: ParseOptions): Promise<ParseResult> {
    const startMs = Date.now();
    const maxItems = Math.min(opts.maxItems ?? MAX_ITEMS, MAX_ITEMS);

    if (buffer.slice(0, 5).toString("ascii") !== "%PDF-") {
      return this.fail({ code: "CORRUPT_FILE", message: "Arquivo não é um PDF válido (assinatura %PDF ausente).", fatal: true }, startMs);
    }

    let PDFParseCtor: new (o: { data: Uint8Array; verbosity?: number }) => {
      getText(o?: unknown): Promise<PdfTextResult>;
      getTable(o?: unknown): Promise<PdfTableResult>;
      destroy?: () => Promise<void> | void;
    };
    try {
      ({ PDFParse: PDFParseCtor } = await import("pdf-parse") as unknown as { PDFParse: typeof PDFParseCtor });
    } catch {
      return this.fail({ code: "UNSUPPORTED_FORMAT", message: "Biblioteca de PDF indisponível.", fatal: true }, startMs);
    }

    const parser = new PDFParseCtor({ data: new Uint8Array(buffer), verbosity: 0 });
    try {
      const text = await withTimeout(parser.getText(), TIMEOUT_MS, "getText");

      if (text.total === 0 || text.pages.length === 0) {
        return this.empty([{ code: "EMPTY_DOCUMENT", message: "PDF sem páginas legíveis.", severity: "warning" }], startMs, 0);
      }

      const pageCount = text.pages.length;
      const warnings: ImportWarning[] = [];
      if (pageCount > MAX_PAGES) {
        warnings.push({ code: "PAGE_LIMIT", message: `PDF com ${pageCount} páginas; processando as primeiras ${MAX_PAGES}.`, severity: "warning" });
      }
      const pages = text.pages.slice(0, MAX_PAGES);

      // Tabelas estruturadas (best-effort — não derruba o parse se indisponível).
      let tablesByPage = new Map<number, string[][][]>();
      try {
        const tbl = await withTimeout(parser.getTable(), TIMEOUT_MS, "getTable");
        for (const p of tbl.pages) if (p.tables?.length) tablesByPage.set(p.num, p.tables);
      } catch {
        tablesByPage = new Map();
      }

      // Detecção de PDF escaneado: há páginas, mas nenhum texto e nenhuma tabela.
      const hasAnyText = pages.some(p => (p.text ?? "").trim().length > 0);
      if (!hasAnyText && tablesByPage.size === 0) {
        return this.empty([
          { code: "OCR_REQUIRED", message: "PDF parece ser escaneado (somente imagem). Extração requer OCR, não suportado nesta versão.", severity: "warning" },
          { code: "SCANNED_PDF_UNSUPPORTED", message: "Nenhum texto extraível encontrado; nenhum item foi extraído.", severity: "warning" },
        ], startMs, pageCount);
      }

      const ctx: TabularContext = {
        importSessionId: opts.importSessionId,
        parserType:      this.parserType,
        parserVersion:   PARSER_VERSION,
        sourceFileId:    opts.sourceFileId,
        sourceFileName:  opts.sourceFileName,
        sourceMimeType:  opts.sourceMimeType,
        sourceChecksum:  opts.sourceChecksum,
        maxItems,
      };

      const items: RawExtractedItem[] = [];
      let rowsRead = 0, skipped = 0;

      for (const page of pages) {
        if (items.length >= maxItems) break;
        ctx.maxItems = maxItems - items.length;
        const pageTables = tablesByPage.get(page.num);
        if (pageTables && pageTables.length) {
          pageTables.forEach((matrix, tableIndex) => {
            const out = matrixToRawItems(matrix, ctx, (r) => ({
              location: { page: page.num, row: r + 1 },
              extras:   { tableIndex },
            }));
            items.push(...out.items); warnings.push(...out.warnings); rowsRead += out.rowsRead; skipped += out.skipped;
            ctx.maxItems = maxItems - items.length;
          });
        } else {
          const lines = (page.text ?? "").split(/\r?\n/);
          const out = linesToRawItems(lines, ctx, (lineIdx) => ({
            location: { page: page.num, row: lineIdx + 1 },
            extras:   {},
          }));
          items.push(...out.items); warnings.push(...out.warnings); rowsRead += out.rowsRead; skipped += out.skipped;
        }
      }

      if (items.length === 0) {
        warnings.push({ code: "NO_ITEMS_EXTRACTED", message: "Texto extraído, mas nenhuma linha de item foi reconhecida. Revise o documento.", severity: "warning" });
      }

      const processingMs = Date.now() - startMs;
      const summary = this.buildSummary(rowsRead, items, skipped, warnings, [], processingMs, { pagesProcessed: pages.length });
      return { items, warnings, errors: [], summary, rawMetadata: { pageCount, pagesProcessed: pages.length, tablesDetected: tablesByPage.size, parserVersion: PARSER_VERSION } };
    } catch (err) {
      return this.fail(mapError(err), startMs);
    } finally {
      try { await parser.destroy?.(); } catch { /* noop */ }
    }
  }

  private fail(error: ImportError, startMs: number): ParseResult {
    return { items: [], warnings: [], errors: [error], summary: this.emptySummary(Date.now() - startMs), rawMetadata: {} };
  }

  private empty(warnings: ImportWarning[], startMs: number, pagesProcessed: number): ParseResult {
    const processingMs = Date.now() - startMs;
    return {
      items: [], warnings, errors: [],
      summary: { ...this.emptySummary(processingMs), totalErrors: 0, totalWarnings: warnings.length, pagesProcessed },
      rawMetadata: { pagesProcessed, parserVersion: PARSER_VERSION },
    };
  }
}

export const pdfParser = new PdfParser();
