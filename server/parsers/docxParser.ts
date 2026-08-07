/**
 * PR B.2.3 — Parser REAL de DOCX (tabelas e parágrafos) sobre mammoth.
 *
 * - Prioriza TABELAS para dados estruturados (converte para HTML e segmenta linhas/células);
 *   sem tabela, extrai parágrafos como itens de descrição (baixa confiança, revisáveis).
 * - Preserva proveniência por tabela/linha/bloco; confiança e avisos explícitos.
 * - Proteção contra zip-bomb: inspeciona o diretório central do container OOXML (sem descompactar)
 *   e recusa arquivos com expansão/quantidade de entradas excessiva.
 * - Rejeita arquivo inválido/corrompido e .doc legado (binário, não-OOXML). NÃO grava no domínio.
 */
import { BaseParser } from "./baseParser";
import { matrixToRawItems, type TabularContext } from "./tabularExtraction";
import { createRawItem } from "../domain/importExtraction";
import { buildProvenance } from "../domain/importProvenance";
import { aggregateConfidence, buildFieldConfidence } from "../domain/importConfidence";
import type { ParserCapabilities, ParseOptions, ParseResult } from "./baseParser";
import type { ImportWarning, ImportError } from "../domain/importTypes";
import type { RawExtractedItem } from "../domain/importExtraction";

const MAX_SIZE          = 50 * 1024 * 1024;   // 50 MB compactado
const MAX_UNCOMPRESSED  = 300 * 1024 * 1024;  // 300 MB expandido (guarda zip-bomb)
const MAX_ENTRIES       = 10_000;
const MAX_RATIO         = 500;                 // expansão máxima total
const MAX_ITEMS         = 5000;
const PARSER_VERSION    = "2.0.0";

// ─── Guarda de zip-bomb: soma tamanhos descompactados via diretório central ─────

function inspectDocxZip(buf: Buffer): { ok: boolean; error?: ImportError } {
  const EOCD_SIG = 0x06054b50;
  // Procura o End Of Central Directory a partir do fim (comentário até 65535 bytes).
  const minEocd = 22;
  if (buf.length < minEocd) return { ok: false, error: { code: "CORRUPT_FILE", message: "DOCX truncado.", fatal: true } };
  let eocd = -1;
  const from = Math.max(0, buf.length - (minEocd + 65535));
  for (let i = buf.length - minEocd; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return { ok: false, error: { code: "CORRUPT_FILE", message: "DOCX inválido (EOCD ausente).", fatal: true } };

  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset     = buf.readUInt32LE(eocd + 16);
  if (totalEntries > MAX_ENTRIES) {
    return { ok: false, error: { code: "ZIP_BOMB", message: `DOCX com ${totalEntries} entradas excede o limite de segurança.`, fatal: true } };
  }

  const CD_SIG = 0x02014b50;
  let p = cdOffset, totalUncompressed = 0, seen = 0, zip64 = false;
  while (p + 46 <= buf.length && buf.readUInt32LE(p) === CD_SIG) {
    const compressed   = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen      = buf.readUInt16LE(p + 28);
    const extraLen     = buf.readUInt16LE(p + 30);
    const commentLen   = buf.readUInt16LE(p + 32);
    if (uncompressed === 0xffffffff || compressed === 0xffffffff) zip64 = true;
    else totalUncompressed += uncompressed;
    seen++;
    if (seen > MAX_ENTRIES) return { ok: false, error: { code: "ZIP_BOMB", message: "Excesso de entradas no DOCX.", fatal: true } };
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (!zip64) {
    if (totalUncompressed > MAX_UNCOMPRESSED) {
      return { ok: false, error: { code: "ZIP_BOMB", message: `Conteúdo descompactado (${Math.round(totalUncompressed / 1024 / 1024)}MB) excede o limite de segurança.`, fatal: true } };
    }
    if (buf.length > 0 && totalUncompressed / buf.length > MAX_RATIO) {
      return { ok: false, error: { code: "ZIP_BOMB", message: "Taxa de expansão do DOCX excede o limite de segurança.", fatal: true } };
    }
  }
  return { ok: true };
}

// ─── HTML → tabelas/parágrafos ──────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}
function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function parseHtmlTables(html: string): string[][][] {
  const tables: string[][][] = [];
  for (const tm of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows: string[][] = [];
    for (const rm of tm[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = [];
      for (const cm of rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) cells.push(stripHtml(cm[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

export class DocxParser extends BaseParser {
  readonly parserType = "docx";
  readonly capabilities: ParserCapabilities = {
    supportedMimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ],
    supportedExtensions:   ["docx"],
    maxFileSizeBytes:      MAX_SIZE,
    supportsStreaming:     false,
    supportsProgressEvents: false,
    parserVersion:         PARSER_VERSION,
    capabilityStatus:      "supported",
    supportsStructuredExtraction: true,
    limitations: [
      "Prioriza tabelas; documentos sem tabela extraem parágrafos como itens de baixa confiança para revisão.",
      ".doc legado (binário, não-OOXML) não é suportado — converta para .docx.",
      `Limite de ${MAX_ITEMS} itens por importação; proteção contra zip-bomb ativa.`,
    ],
  };

  canHandle(mimeType: string, extension: string): boolean {
    return this.capabilities.supportedMimeTypes.includes(mimeType) || extension.toLowerCase() === "docx";
  }

  async parse(buffer: Buffer, opts: ParseOptions): Promise<ParseResult> {
    const startMs = Date.now();
    const maxItems = Math.min(opts.maxItems ?? MAX_ITEMS, MAX_ITEMS);

    // DOCX é um container ZIP (PK\x03\x04). .doc legado (D0CF11E0 OLE) não é suportado.
    const magic = buffer.slice(0, 4);
    if (!(magic[0] === 0x50 && magic[1] === 0x4b)) {
      const isOle = magic[0] === 0xd0 && magic[1] === 0xcf;
      return this.fail({
        code: "UNSUPPORTED_FORMAT",
        message: isOle ? "Formato .doc legado não suportado; converta para .docx." : "Arquivo não é um DOCX válido.",
        fatal: true,
      }, startMs);
    }

    const guard = inspectDocxZip(buffer);
    if (!guard.ok && guard.error) return this.fail(guard.error, startMs);

    let mammoth: typeof import("mammoth");
    try {
      mammoth = await import("mammoth");
    } catch {
      return this.fail({ code: "UNSUPPORTED_FORMAT", message: "Biblioteca de DOCX indisponível.", fatal: true }, startMs);
    }

    const warnings: ImportWarning[] = [];
    let html: string;
    try {
      const res = await mammoth.convertToHtml({ buffer });
      html = res.value;
      for (const m of res.messages.slice(0, 20)) {
        warnings.push({ code: "HEADER_INFERENCE", message: `DOCX: ${m.message}`, severity: m.type === "error" ? "warning" : "info" });
      }
    } catch (err) {
      return this.fail({ code: "CORRUPT_FILE", message: `DOCX inválido ou corrompido: ${err instanceof Error ? err.message : String(err)}`, fatal: true }, startMs);
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

    const tables = parseHtmlTables(html);
    if (tables.length) {
      tables.forEach((matrix, tableIndex) => {
        if (items.length >= maxItems) return;
        ctx.maxItems = maxItems - items.length;
        const out = matrixToRawItems(matrix, ctx, (r) => ({
          location: { row: r + 1 }, extras: { tableIndex },
        }));
        items.push(...out.items); warnings.push(...out.warnings); rowsRead += out.rowsRead; skipped += out.skipped;
      });
    } else {
      // Sem tabela: extrai parágrafos como itens de descrição (baixa confiança, revisáveis).
      warnings.push({ code: "NO_TABLE_FOUND", message: "Nenhuma tabela encontrada; parágrafos extraídos como itens de descrição para revisão.", severity: "warning" });
      let raw: Awaited<ReturnType<typeof mammoth.extractRawText>>;
      try {
        raw = await mammoth.extractRawText({ buffer });
      } catch (err) {
        return this.fail({ code: "CORRUPT_FILE", message: `DOCX inválido: ${err instanceof Error ? err.message : String(err)}`, fatal: true }, startMs);
      }
      const paras = raw.value.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0);
      for (let i = 0; i < paras.length && items.length < maxItems; i++) {
        rowsRead++;
        const confidence = aggregateConfidence([
          buildFieldConfidence("description", 0.5),
          buildFieldConfidence("quantity", 0.2), buildFieldConfidence("unit", 0.2),
          buildFieldConfidence("unit_price", 0.2), buildFieldConfidence("total_price", 0.2),
        ]);
        const provenance = buildProvenance(
          opts.sourceFileId, opts.sourceFileName, opts.sourceMimeType, opts.sourceChecksum,
          this.parserType, PARSER_VERSION, { row: i + 1 }, { rawRowData: [paras[i]] },
        );
        items.push(createRawItem(
          opts.importSessionId,
          { rawDescription: paras[i], rawQuantity: null, rawUnit: null, rawUnitPrice: null, rawTotalPrice: null },
          provenance,
          { parserType: this.parserType, parserVersion: PARSER_VERSION, processingMs: 0, rawCellValues: { paragraph: paras[i] } },
          confidence,
        ));
      }
    }

    if (items.length === 0 && !warnings.some(w => w.code === "NO_TABLE_FOUND")) {
      warnings.push({ code: "NO_ITEMS_EXTRACTED", message: "Nenhum item reconhecido no DOCX. Revise o documento.", severity: "warning" });
    }

    const processingMs = Date.now() - startMs;
    const summary = this.buildSummary(rowsRead, items, skipped, warnings, [], processingMs);
    return { items, warnings, errors: [], summary, rawMetadata: { tablesDetected: tables.length, parserVersion: PARSER_VERSION } };
  }

  private fail(error: ImportError, startMs: number): ParseResult {
    return { items: [], warnings: [], errors: [error], summary: this.emptySummary(Date.now() - startMs), rawMetadata: {} };
  }
}

export const docxParser = new DocxParser();
