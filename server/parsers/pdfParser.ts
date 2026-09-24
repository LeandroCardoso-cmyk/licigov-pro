/**
 * PR B.2.3 — Parser REAL de PDF (texto e tabelas) sobre pdf-parse v2 (pdfjs-dist/legacy).
 *
 * - Extrai texto por página e tabelas estruturadas (getTable) quando o PDF as expõe;
 *   caso contrário, reconstrói linhas de item a partir do texto (heurística determinística).
 * - Preserva proveniência por página/linha/tabela; confiança e avisos explícitos.
 * - Detecta PDF vazio, corrompido, protegido e composto só por imagem, SEM apresentar o escaneado como
 *   extraído. NÃO grava no domínio. NÃO inventa dados.
 * - U2A-OCR (modo de linhas): texto nativo SEMPRE primeiro; páginas sem texto útil (heurística determinística,
 *   nativeTextAssessment.ts) seguem para OCR pela porta `OcrPort` injetada (`opts.ocr`) e o texto reconhecido
 *   passa pelo MESMO parser tabular canônico. Sem `opts.ocr` ⇒ aviso OCR_REQUIRED (desfecho explícito). Modo
 *   documento (DFD/ETP/TR) não usa OCR. Linhagem (`extraction`) registra modo por página, motor e fingerprint.
 * - Layout v2 (2.3.0): no modo de linhas o texto nativo NÃO é linearizado antes da reconstrução — os itens de
 *   texto do pdfjs (transform/width/height) viram `PositionedTextToken` e a reconstrução GEOMÉTRICA
 *   (`layout/tableLayoutReconstructor.ts`, a MESMA usada pelo OCR) produz a matriz linha × coluna entregue ao
 *   extrator canônico. Páginas sem tabela de itens (assinatura, identificação) não geram itens
 *   (`pageHasNoItemTable`). Só quando NENHUMA página tem tabela posicional o caminho anterior (getTable/linhas
 *   do getText) é usado — compatibilidade com PDFs de texto corrido.
 * - Limites de segurança: tamanho, páginas, itens e tempo de processamento (inclusive orçamento de OCR).
 */
import { BaseParser } from "./baseParser";
import { matrixToRawItems, linesToRawItems, type TabularContext } from "./tabularExtraction";
import { buildDocumentProjection, pageTextToBlocks, type DocumentBlock } from "../domain/documentProjection";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";
import type { ImportWarning, ImportError } from "../domain/importTypes";
import type { RawExtractedItem } from "../domain/importExtraction";
import { assessDocumentText } from "./nativeTextAssessment";
import { extractItemsFromOcrPage, reconstructOcrPage } from "./ocrExtraction";
import { OcrError, type OcrPageImage } from "../domain/ocr";
import {
  EXTRACTION_LINEAGE_VERSION, computeExtractionFingerprint, deriveExtractionMode, sha256Hex,
  type ExtractionLineage, type LayoutLineageInfo, type LayoutValidationSummary, type OcrLineageInfo, type PageExtractionMode,
} from "../domain/extractionLineage";
import { tokensFromPdfTextItems, type PdfTextItemLike } from "./layout/positionedText";
import { PDF_LAYOUT_VERSION, reconstructPageTable, type CarriedHeader, type PageLayoutResult } from "./layout/tableLayoutReconstructor";
import { extractItemsFromLayoutTable, layoutWarningsToImport, type LayoutTableValidation } from "./layout/layoutExtraction";

const MAX_SIZE   = 50 * 1024 * 1024; // 50 MB
const MAX_PAGES  = 500;
const MAX_ITEMS  = 5000;
const TIMEOUT_MS = 60_000;

/**
 * 2.2.0 — U2A-OCR: fallback de OCR governado por página no modo de linhas + linhagem da extração.
 * 2.3.0 — Layout v2: reconstrução tabular GEOMÉTRICA do texto nativo (tokens posicionados), convergente com o OCR.
 */
export const PDF_PARSER_VERSION = "2.3.0";
const PARSER_VERSION = PDF_PARSER_VERSION;

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
interface PdfScreenshotResult { pages: Array<{ pageNumber: number; data: Uint8Array; width: number; height: number }> }
/** Subconjunto do documento/página do pdfjs usado para ler o texto POSICIONADO (getTextContent). */
interface PdfPageLike {
  getViewport(o: { scale: number }): { convertToViewportPoint(x: number, y: number): number[] };
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?: () => void;
}
interface PdfDocumentLike { getPage(n: number): Promise<PdfPageLike> }
interface PdfParseInstance {
  getText(o?: unknown): Promise<PdfTextResult>;
  getTable(o?: unknown): Promise<PdfTableResult>;
  getScreenshot(o?: unknown): Promise<PdfScreenshotResult>;
  load?: () => Promise<PdfDocumentLike>;
  destroy?: () => Promise<void> | void;
}

interface LayoutRun { pages: PageLayoutResult[]; durationMs: number; failed: boolean }

const isTextItem = (i: unknown): i is PdfTextItemLike =>
  !!i && typeof (i as PdfTextItemLike).str === "string" && Array.isArray((i as PdfTextItemLike).transform);

interface OcrRunOutcome {
  items:          RawExtractedItem[];
  warnings:       ImportWarning[];
  rowsRead:       number;
  skipped:        number;
  pagesProcessed: number[];
  info:           OcrLineageInfo;
  artifact?:      { pages: Array<{ pageNumber: number; confidence: number; text: string }> };
  layouts:        PageLayoutResult[];
  validations:    LayoutTableValidation[];
}

/** Consolida a conferência (média/total impressos × calculados) de todas as tabelas. */
function summarizeValidation(v: LayoutTableValidation[]): LayoutValidationSummary | null {
  if (v.length === 0) return null;
  const docs = v.map((t) => t.documentTotalCents).filter((c): c is number => c !== null);
  const documentTotalCents = docs.length ? docs.reduce((a, b) => a + b, 0) : null;
  const matches = v.map((t) => t.totalMatches).filter((m): m is boolean => m !== null);
  return {
    itemRows:             v.reduce((a, t) => a + t.itemRows, 0),
    validQuotes:          v.reduce((a, t) => a + t.validQuotes, 0),
    documentTotalCents,
    calculatedTotalCents: v.reduce((a, t) => a + t.calculatedTotalCents, 0),
    totalMatches:         matches.length ? matches.every(Boolean) : null,
    averageChecks:        v.reduce((a, t) => a + t.averageChecks, 0),
    averageMismatches:    v.reduce((a, t) => a + t.averageMismatches, 0),
  };
}

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
      "PDF digitalizado (somente imagem): reconhecido por OCR local (Tesseract, português) na Pesquisa de Preços — revisão humana obrigatória; sem OCR disponível ⇒ OCR_REQUIRED.",
      "Importação de DOCUMENTO (DFD/ETP/TR) digitalizado não usa OCR nesta versão (OCR_REQUIRED).",
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

    let PDFParseCtor: new (o: { data: Uint8Array; verbosity?: number }) => PdfParseInstance;
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

      // Heurística determinística de texto ÚTIL por página (decide texto nativo × OCR no modo de linhas).
      const assessment = assessDocumentText(pages, tablesByPage);

      // Detecção de PDF escaneado no modo DOCUMENTO (DFD/ETP/TR): há páginas, mas nenhum texto e nenhuma
      // tabela. Documento importado não usa OCR nesta versão (desfecho explícito OCR_REQUIRED).
      const hasAnyText = pages.some(p => (p.text ?? "").trim().length > 0);
      if (opts.extractionMode === "document" && !hasAnyText && tablesByPage.size === 0) {
        return this.empty([
          { code: "OCR_REQUIRED", message: "PDF parece ser escaneado (somente imagem). Extração requer OCR, não suportado nesta versão.", severity: "warning" },
          { code: "SCANNED_PDF_UNSUPPORTED", message: "Nenhum texto extraível encontrado; nenhum item foi extraído.", severity: "warning" },
        ], startMs, pageCount);
      }

      // PROJEÇÃO DOCUMENTAL (DFD/ETP/TR): texto em ordem de páginas → títulos/parágrafos/listas com
      // proveniência por página. Mesmo texto real do getText (sem OCR, sem geração). Tabelas já aparecem
      // no texto da página — não são duplicadas como bloco separado.
      if (opts.extractionMode === "document") {
        const blocks: DocumentBlock[] = [];
        for (const page of pages) blocks.push(...pageTextToBlocks(page.text ?? "", page.num, blocks.length));
        const projection = buildDocumentProjection(blocks, { pages: pages.length });
        if (projection.stats.truncated) {
          warnings.push({ code: "DOCUMENT_TRUNCATED", message: "Documento excede o limite de caracteres; conteúdo truncado para revisão.", severity: "warning" });
        }
        if (blocks.length === 0) {
          warnings.push({ code: "NO_TEXT_EXTRACTED", message: "Nenhum texto legível foi extraído do documento.", severity: "warning" });
        }
        const processingMs = Date.now() - startMs;
        const summary = { ...this.buildSummary(blocks.length, [], 0, warnings, [], processingMs, { pagesProcessed: pages.length }) };
        return {
          items: [], warnings, errors: [], summary, documentProjection: projection,
          rawMetadata: { pageCount, pagesProcessed: pages.length, parserVersion: PARSER_VERSION, mode: "document" },
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
        maxItems,
      };

      const items: RawExtractedItem[] = [];
      let rowsRead = 0, skipped = 0;
      const pageModes: Record<string, PageExtractionMode> = {};
      const itemsPerPage = new Map<number, number>();
      const validations: LayoutTableValidation[] = [];

      // 0) GEOMETRIA do texto nativo (tokens posicionados → reconstrução linha × coluna), sem linearizar.
      const layoutRun = await this.reconstructNativeLayout(parser, pages.map((p) => p.num));
      const layoutByPage = new Map(layoutRun.pages.map((l) => [l.page, l]));
      const positioned = !layoutRun.failed && layoutRun.pages.some((l) => l.table !== null);
      if (layoutRun.failed) {
        warnings.push({ code: "LAYOUT_RECONSTRUCTION_UNAVAILABLE", message: "Texto posicionado indisponível neste PDF; extração pelas linhas de texto.", severity: "info" });
      }

      // 1) TEXTO NATIVO (sempre primeiro): tabela reconstruída pela geometria; sem tabela posicional em
      //    nenhuma página → tabelas estruturadas (getTable) ou linhas do getText (comportamento anterior).
      for (const page of pages) {
        if (items.length >= maxItems) break;
        ctx.maxItems = maxItems - items.length;
        const before = items.length;
        const pageTables = tablesByPage.get(page.num);
        const lp = layoutByPage.get(page.num);
        if (positioned && !lp?.columnsUnresolved) {
          if (lp) warnings.push(...layoutWarningsToImport(lp));
          if (lp?.table) {
            const out = extractItemsFromLayoutTable(lp.table, ctx, { tableIndex: 0, source: "native" });
            items.push(...out.items); warnings.push(...out.warnings); rowsRead += out.rowsRead; skipped += out.skipped;
            validations.push(out.validation);
          }
          // Página sem tabela de itens (identificação/assinatura/rodapé): nenhum item é gerado dela.
        } else if (pageTables && pageTables.length) {
          if (lp?.columnsUnresolved) warnings.push(...layoutWarningsToImport(lp));
          pageTables.forEach((matrix, tableIndex) => {
            const out = matrixToRawItems(matrix, ctx, (r) => ({
              location: { page: page.num, row: r + 1 },
              extras:   { tableIndex },
            }));
            items.push(...out.items); warnings.push(...out.warnings); rowsRead += out.rowsRead; skipped += out.skipped;
            ctx.maxItems = maxItems - items.length;
          });
        } else {
          if (lp?.columnsUnresolved) warnings.push(...layoutWarningsToImport(lp));
          const lines = (page.text ?? "").split(/\r?\n/);
          const out = linesToRawItems(lines, ctx, (lineIdx) => ({
            location: { page: page.num, row: lineIdx + 1 },
            extras:   {},
          }));
          items.push(...out.items); warnings.push(...out.warnings); rowsRead += out.rowsRead; skipped += out.skipped;
        }
        itemsPerPage.set(page.num, items.length - before);
        pageModes[String(page.num)] = (page.text ?? "").trim() !== "" || (pageTables?.length ?? 0) > 0 ? "native_text" : "skipped";
      }

      // 2) CANDIDATAS A OCR (heurística determinística — ver nativeTextAssessment.ts): páginas SEM texto útil
      //    que não renderam item; se o documento inteiro não rendeu item, todas as páginas.
      const noUseful = assessment.pages.filter((a) => !a.useful && (itemsPerPage.get(a.pageNumber) ?? 0) === 0).map((a) => a.pageNumber);
      let ocrReason: ExtractionLineage["ocrReason"] = null;
      let ocrTargets: number[] = [];
      if (noUseful.length > 0) { ocrReason = "no_useful_text"; ocrTargets = items.length === 0 ? pages.map((p) => p.num) : noUseful; }
      else if (items.length === 0) { ocrReason = "native_text_without_items"; ocrTargets = pages.map((p) => p.num); }

      let ocrInfo: OcrLineageInfo | null = null;
      let ocrArtifact: ParseResult["ocrArtifact"];
      if (ocrTargets.length > 0 && ocrReason === "no_useful_text" && !opts.ocr) {
        // Sem OCR disponível (desligado): desfecho EXPLÍCITO — nunca sucesso vazio.
        warnings.push(items.length === 0
          ? { code: "OCR_REQUIRED", message: "PDF parece ser digitalizado (somente imagem). A extração requer OCR, indisponível nesta instalação.", severity: "warning" }
          : { code: "OCR_REQUIRED_PARTIAL", message: `${noUseful.length} página(s) digitalizada(s) não processada(s) (OCR indisponível); somente as páginas com texto foram extraídas.`, severity: "warning" });
        if (items.length === 0) warnings.push({ code: "SCANNED_PDF_UNSUPPORTED", message: "Nenhum texto extraível encontrado; nenhum item foi extraído.", severity: "warning" });
      } else if (ocrTargets.length > 0 && opts.ocr) {
        const r = await this.runOcr(parser, ocrTargets, opts, ctx, maxItems - items.length, positioned);
        ocrInfo = r.info; ocrArtifact = r.artifact;
        warnings.push(...r.warnings);
        rowsRead += r.rowsRead; skipped += r.skipped;
        if (r.info.failure === null || r.info.failure === undefined) {
          // Página reconhecida por OCR substitui a leitura nativa (que não rendeu item).
          for (const n of r.pagesProcessed) pageModes[String(n)] = "ocr";
          items.push(...r.items);
          for (const l of r.layouts) layoutByPage.set(l.page, l);
          validations.push(...r.validations);
        }
      }

      if (items.length === 0 && !warnings.some((w) => w.code === "OCR_REQUIRED" || w.code === "OCR_FAILED")) {
        warnings.push({ code: "NO_ITEMS_EXTRACTED", message: "Nenhuma linha de item foi reconhecida no PDF. Revise o documento.", severity: "warning" });
      }

      const ocrIdentity = opts.ocr ? opts.ocr.port.identity() : null;
      const layoutPages = [...layoutByPage.values()].sort((a, b) => a.page - b.page);
      const layoutInfo: LayoutLineageInfo = {
        layoutVersion:      PDF_LAYOUT_VERSION,
        mode:               positioned || Object.values(pageModes).includes("ocr") ? "positioned" : "legacy_text",
        durationMs:         layoutRun.durationMs,
        pageCount:          layoutPages.length,
        tokenCount:         layoutPages.reduce((a, l) => a + l.tokenCount, 0),
        rowCount:           layoutPages.reduce((a, l) => a + l.rowCount, 0),
        columnCount:        Math.max(0, ...layoutPages.map((l) => l.columnCount)),
        candidateItemCount: layoutPages.reduce((a, l) => a + l.candidateRowCount, 0),
        validItemCount:     layoutPages.reduce((a, l) => a + l.itemRowCount, 0),
        warningsCount:      layoutPages.reduce((a, l) => a + l.warnings.length, 0),
        pagesWithoutItemTable: layoutPages.filter((l) => l.pageHasNoItemTable).map((l) => l.page),
        pages: layoutPages.map((l) => ({
          page: l.page, tokenCount: l.tokenCount, rowCount: l.rowCount, columnCount: l.columnCount,
          candidateRowCount: l.candidateRowCount, itemRowCount: l.itemRowCount, pageHasNoItemTable: l.pageHasNoItemTable,
        })),
        validation:         summarizeValidation(validations),
      };
      const lineage: ExtractionLineage = {
        lineageVersion:   EXTRACTION_LINEAGE_VERSION,
        extractionMode:   deriveExtractionMode(pageModes),
        pageModes,
        sourceChecksum:   opts.sourceChecksum,
        parserType:       this.parserType,
        parserVersion:    PARSER_VERSION,
        heuristicVersion: assessment.heuristicVersion,
        layoutVersion:    PDF_LAYOUT_VERSION,
        layout:           layoutInfo,
        pageCount,
        nativePages:      Object.values(pageModes).filter((m) => m === "native_text").length,
        ocrPages:         Object.values(pageModes).filter((m) => m === "ocr").length,
        ocrReason,
        ocr:              ocrInfo,
        fingerprint:      computeExtractionFingerprint({
          sourceChecksum: opts.sourceChecksum, parserType: this.parserType, parserVersion: PARSER_VERSION,
          heuristicVersion: assessment.heuristicVersion, layoutVersion: PDF_LAYOUT_VERSION, pageModes,
          ocr: ocrInfo && ocrIdentity ? { ...ocrIdentity, renderWidth: opts.ocr!.renderWidth, layoutVersion: PDF_LAYOUT_VERSION } : null,
        }),
      };

      const processingMs = Date.now() - startMs;
      const summary = this.buildSummary(rowsRead, items, skipped, warnings, [], processingMs, { pagesProcessed: pages.length });
      return {
        items, warnings, errors: [], summary, extraction: lineage, ocrArtifact,
        rawMetadata: {
          pageCount, pagesProcessed: pages.length, tablesDetected: tablesByPage.size, parserVersion: PARSER_VERSION,
          extractionMode: lineage.extractionMode, layoutVersion: PDF_LAYOUT_VERSION, layoutMode: layoutInfo.mode,
        },
      };
    } catch (err) {
      return this.fail(mapError(err), startMs);
    } finally {
      try { await parser.destroy?.(); } catch { /* noop */ }
    }
  }

  /**
   * OCR governado das páginas-alvo: renderiza UMA página por vez (memória limitada) com o pdf-parse já
   * carregado (@napi-rs/canvas, dependência existente), reconhece pela porta `OcrPort` e converte cada página
   * pelo parser tabular canônico. Limites: páginas (maxPages), orçamento TOTAL de tempo (render + OCR) e
   * itens. Falha do motor/tempo ⇒ `info.failure` (o chamador decide o desfecho; nada é fingido).
   */
  private async runOcr(parser: PdfParseInstance, targets: number[], opts: ParseOptions, ctx: TabularContext, itemBudget: number, nativeHasTable: boolean): Promise<OcrRunOutcome> {
    const cfg = opts.ocr!;
    const id = cfg.port.identity();
    const t0 = Date.now();
    const warnings: ImportWarning[] = [];
    const selected = targets.slice(0, cfg.maxPages);
    if (targets.length > selected.length) {
      warnings.push({ code: "OCR_PAGE_LIMIT", message: `${targets.length} páginas digitalizadas; o OCR processou as primeiras ${selected.length} (limite configurado).`, severity: "warning" });
    }
    const info: OcrLineageInfo = {
      engine: id.engine, engineVersion: id.engineVersion, coreVersion: id.coreVersion, language: id.language,
      languageDataVersion: id.languageDataVersion, config: id.config, renderWidth: cfg.renderWidth,
      layoutVersion: PDF_LAYOUT_VERSION, pagesRequested: targets.length, pagesProcessed: 0, meanConfidence: 0,
      durationMs: 0, warningsCount: 0, outputDigest: null, nondeterministic: true, failure: null,
    };
    const remaining = () => cfg.timeoutMs - (Date.now() - t0);

    await opts.onStage?.("ocr_processing");
    try {
      const images: OcrPageImage[] = [];
      for (const n of selected) {
        if (remaining() <= 0) throw new OcrError("OCR_TIMEOUT", `Tempo de OCR excedido (${cfg.timeoutMs} ms) na renderização.`);
        const shot = await withTimeout(
          parser.getScreenshot({ partial: [n], desiredWidth: cfg.renderWidth, imageBuffer: true, imageDataUrl: false }),
          Math.max(1, remaining()), "render",
        );
        const img = shot.pages[0];
        if (img?.data?.length) images.push({ pageNumber: n, image: Buffer.from(img.data), width: img.width, height: img.height });
      }
      if (remaining() <= 0) throw new OcrError("OCR_TIMEOUT", `Tempo de OCR excedido (${cfg.timeoutMs} ms).`);
      const result = await cfg.port.recognize(images, { timeoutMs: Math.max(1, remaining()) });

      const items: RawExtractedItem[] = [];
      const layouts: PageLayoutResult[] = [];
      const validations: LayoutTableValidation[] = [];
      let rowsRead = 0, skipped = 0;
      // Mesma decisão por DOCUMENTO do texto nativo: havendo tabela de itens (nativa ou reconhecida), páginas
      // sem tabela (assinatura, identificação) não geram itens pelo fallback de linhas.
      const geometric = result.pages.map((p) => reconstructOcrPage(p));
      const documentHasTable = nativeHasTable || geometric.some((g) => g.table !== null);
      for (const [k, page] of result.pages.entries()) {
        ctx.maxItems = Math.max(0, itemBudget - items.length);
        if (ctx.maxItems === 0) break;
        const out = extractItemsFromOcrPage(page, ctx, { minConfidence: cfg.minConfidence, engine: result.engine, engineVersion: result.engineVersion }, {
          geometric: geometric[k], allowLinesFallback: !documentHasTable,
        });
        items.push(...out.items); warnings.push(...out.warnings); rowsRead += out.rowsRead; skipped += out.skipped;
        layouts.push(out.layout);
        if (out.validation) validations.push(out.validation);
      }
      const lowConfidencePages = result.pages.filter((p) => p.confidence < cfg.minConfidence).map((p) => p.pageNumber);
      if (lowConfidencePages.length) {
        warnings.push({ code: "OCR_LOW_CONFIDENCE", message: `Confiança do OCR baixa na(s) página(s) ${lowConfidencePages.join(", ")} — confira cada valor com o documento original.`, severity: "warning" });
      }
      if (items.length === 0) {
        warnings.push({ code: "OCR_NO_ITEMS", message: "O OCR leu o documento, mas nenhuma linha de item (descrição + valor) foi reconhecida.", severity: "warning" });
      }
      info.pagesProcessed = result.pages.length;
      info.meanConfidence = Math.round(result.confidence * 100) / 100;
      info.durationMs = Date.now() - t0;
      info.warningsCount = result.warnings.length + items.reduce((a, i) => a + i.extractionWarnings.filter((w) => w.code !== "OCR_EXTRACTED").length, 0);
      info.outputDigest = sha256Hex(result.text);
      return {
        items, warnings, rowsRead, skipped, pagesProcessed: result.pages.map((p) => p.pageNumber), info,
        artifact: { pages: result.pages.map((p) => ({ pageNumber: p.pageNumber, confidence: p.confidence, text: p.text })) },
        layouts, validations,
      };
    } catch (err) {
      const code = err instanceof OcrError ? err.code : /^TIMEOUT:/.test(err instanceof Error ? err.message : "") ? "OCR_TIMEOUT" : "OCR_RENDER_FAILED";
      const message = err instanceof Error ? err.message : String(err);
      info.durationMs = Date.now() - t0;
      info.failure = { code, message: message.slice(0, 300) };
      warnings.push({ code: "OCR_FAILED", message: `OCR não concluído (${code}).`, severity: "warning" });
      return { items: [], warnings, rowsRead: 0, skipped: 0, pagesProcessed: [], info, layouts: [], validations: [] };
    }
  }

  /**
   * Layout v2 — lê o texto POSICIONADO de cada página (pdfjs `getTextContent`: transform/width/height, na ordem
   * original) e reconstrói a tabela pela geometria. Custo ≈ O(n log n) por página — ordens de grandeza abaixo do
   * OCR. Falha em obter o texto posicionado não derruba o parse: o chamador usa o caminho de linhas anterior.
   */
  private async reconstructNativeLayout(parser: PdfParseInstance, pageNums: number[]): Promise<LayoutRun> {
    const t0 = Date.now();
    if (typeof parser.load !== "function") return { pages: [], durationMs: 0, failed: true };
    try {
      const doc = await withTimeout(parser.load(), TIMEOUT_MS, "layout");
      const pages: PageLayoutResult[] = [];
      let carried: CarriedHeader | null = null;
      for (const n of pageNums) {
        const page = await withTimeout(doc.getPage(n), TIMEOUT_MS, "layout");
        const viewport = page.getViewport({ scale: 1 });
        const content = await withTimeout(page.getTextContent(), TIMEOUT_MS, "layout");
        const tokens = tokensFromPdfTextItems(content.items.filter(isTextItem), n, (x, y) => {
          const [vx, vy] = viewport.convertToViewportPoint(x, y);
          return [vx, vy];
        });
        const result = reconstructPageTable(tokens, { page: n, carriedHeader: carried });
        if (result.table?.header) carried = { header: result.table.header, headerSynthesized: result.table.headerSynthesized, columnGroups: result.table.columnGroups };
        pages.push(result);
        try { page.cleanup?.(); } catch { /* noop */ }
      }
      return { pages, durationMs: Date.now() - t0, failed: false };
    } catch {
      return { pages: [], durationMs: Date.now() - t0, failed: true };
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
