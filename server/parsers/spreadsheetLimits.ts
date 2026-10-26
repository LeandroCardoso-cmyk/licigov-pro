/**
 * SEC-AUD-2026-10 / xlsx — limites ANTES de abrir uma planilha enviada por usuário.
 *
 * O tamanho do upload já é limitado (MAX_FILE_SIZE_BYTES, 50 MB), mas um XLSX é um ZIP: 50 MB comprimidos podem
 * expandir para gigabytes (ZIP bomb) e travar o worker de ingestão (fila de um job por vez). Três camadas:
 *   1. `assertZipWithinLimits` — diretório central SEM descomprimir (entradas, tamanhos/taxa DECLARADOS): barato,
 *      mas metadado é declarado pelo arquivo e pode mentir;
 *   2. `scanZipRealContent` — descompressão REAL em stream, sem reter o conteúdo, abortando ao passar do orçamento
 *      de bytes; conta abas e células (`<c`) reais das worksheets ANTES do leitor (`exceljs`/JSZip, que
 *      descomprime tudo em memória sem teto);
 *   3. leitura em worker isolado (xlsxReadIsolated.ts) com teto de heap e tempo e término forçado — único jeito de
 *      cancelar um parser síncrono e conter memória (Promise.race com timeout não faz nenhum dos dois).
 * Depois de aberto, o intervalo usado por aba e o total da pasta são limitados antes de alocar a matriz.
 * Nenhum limite executa fórmula ou macro: o leitor usa só valores em cache.
 */
import { createInflateRaw } from "node:zlib";

export const SPREADSHEET_LIMITS = Object.freeze({
  /** Entradas no ZIP (um XLSX típico tem dezenas; abas e estilos somam poucas centenas). */
  maxZipEntries: 2_000,
  /** Soma dos tamanhos descomprimidos declarados. */
  maxUncompressedBytes: 250 * 1024 * 1024,
  /** Taxa de compressão máxima por entrada com mais de 1 MB descomprimido. */
  maxCompressionRatio: 200,
  /** Células (linhas × colunas do intervalo usado) por aba. */
  maxCellsPerSheet: 2_000_000,
  /** Abas por pasta de trabalho. */
  maxSheets: 100,
  /** Células REAIS (elementos `<c>` das worksheets) na pasta inteira, contadas antes do leitor (~340 B de heap cada). */
  maxCellsPerWorkbook: 1_000_000,
  /** Soma dos intervalos usados (linhas × colunas) de todas as abas — teto da matriz alocada (abas esparsas). */
  maxMatrixCellsPerWorkbook: 4_000_000,
  /** Worker de leitura: teto de heap (MB) e de tempo (ms); excedido ⇒ worker encerrado à força. */
  workerMaxOldGenerationMb: 768,
  workerTimeoutMs: 60_000,
});

export type SpreadsheetLimits = { readonly [K in keyof typeof SPREADSHEET_LIMITS]: number };

export type SpreadsheetLimitCode =
  | "ZIP_INVALID" | "ZIP_TOO_MANY_ENTRIES" | "ZIP_TOO_LARGE" | "ZIP_RATIO" | "ZIP64_UNSUPPORTED"
  | "TOO_MANY_CELLS" | "TOO_MANY_SHEETS" | "READ_TIMEOUT" | "READ_MEMORY";

export class SpreadsheetLimitError extends Error {
  constructor(readonly code: SpreadsheetLimitCode, message: string) {
    super(message);
    this.name = "SpreadsheetLimitError";
  }
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

/** Lê o diretório central do ZIP (sem descomprimir) e aplica os limites. Lança SpreadsheetLimitError. */
export function assertZipWithinLimits(buf: Buffer, limits: SpreadsheetLimits = SPREADSHEET_LIMITS): { entries: number; uncompressedBytes: number } {
  // EOCD fica nos últimos 22 bytes + comentário (≤ 65535).
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new SpreadsheetLimitError("ZIP_INVALID", "Arquivo XLSX inválido (estrutura ZIP não encontrada).");
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new SpreadsheetLimitError("ZIP64_UNSUPPORTED", "Planilha grande demais para importação (ZIP64).");
  }
  if (total > limits.maxZipEntries) {
    throw new SpreadsheetLimitError("ZIP_TOO_MANY_ENTRIES", `Planilha com estrutura interna excessiva (${total} partes).`);
  }
  if (cdOffset + cdSize > buf.length) throw new SpreadsheetLimitError("ZIP_INVALID", "Arquivo XLSX truncado ou inválido.");

  let p = cdOffset;
  let uncompressed = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) {
      throw new SpreadsheetLimitError("ZIP_INVALID", "Arquivo XLSX com diretório interno corrompido.");
    }
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
      throw new SpreadsheetLimitError("ZIP64_UNSUPPORTED", "Planilha grande demais para importação (ZIP64).");
    }
    uncompressed += uncompSize;
    if (uncompressed > limits.maxUncompressedBytes) {
      throw new SpreadsheetLimitError("ZIP_TOO_LARGE", "Planilha expande além do limite permitido para importação.");
    }
    if (uncompSize > 1024 * 1024 && uncompSize / Math.max(compSize, 1) > limits.maxCompressionRatio) {
      throw new SpreadsheetLimitError("ZIP_RATIO", "Planilha com compressão anômala (possível arquivo malicioso).");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries: total, uncompressedBytes: uncompressed };
}

export function assertSheetWithinLimits(sheet: string, rows: number, cols: number, limits: SpreadsheetLimits = SPREADSHEET_LIMITS): void {
  if (rows * cols > limits.maxCellsPerSheet) {
    throw new SpreadsheetLimitError("TOO_MANY_CELLS", `Aba "${sheet}" excede o limite de ${limits.maxCellsPerSheet} células para importação.`);
  }
}

const LFH_SIG = 0x04034b50;
/** Mesmo critério do `exceljs` 4.4.0 (lib/xlsx/xlsx.js) para reconhecer uma worksheet dentro do ZIP. */
const WORKSHEET_ENTRY = /xl\/worksheets\/sheet(\d+)[.]xml/;

export interface ZipRealContent { entries: number; realUncompressedBytes: number; worksheets: number; cells: number }

/**
 * Descomprime de verdade cada entrada (stream, conteúdo descartado) e aplica os limites aos bytes REAIS — os
 * tamanhos declarados no ZIP são ignorados aqui. Entradas sobrepostas contam uma vez por entrada (o leitor
 * também as descomprime uma vez cada). Lança SpreadsheetLimitError.
 */
export async function scanZipRealContent(buf: Buffer, limits: SpreadsheetLimits = SPREADSHEET_LIMITS): Promise<ZipRealContent> {
  const { entries } = assertZipWithinLimits(buf, limits);
  const eocd = findEocd(buf);
  let p = buf.readUInt32LE(eocd + 16);
  let real = 0;
  let worksheets = 0;
  let cells = 0;
  for (let n = 0; n < entries; n++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LFH_SIG) {
      throw new SpreadsheetLimitError("ZIP_INVALID", "Arquivo XLSX com entrada interna corrompida.");
    }
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compSize > buf.length) throw new SpreadsheetLimitError("ZIP_INVALID", "Arquivo XLSX truncado ou inválido.");
    const data = buf.subarray(dataStart, dataStart + compSize);

    const isSheet = WORKSHEET_ENTRY.test(name);
    if (isSheet && ++worksheets > limits.maxSheets) {
      throw new SpreadsheetLimitError("TOO_MANY_SHEETS", `Planilha com mais de ${limits.maxSheets} abas.`);
    }
    const budget = limits.maxUncompressedBytes - real;
    const counter = new CellCounter();
    if (method === 0) {
      if (data.length > budget) throw tooLarge();
      real += data.length;
      if (isSheet) counter.feed(data.toString("latin1"));
    } else if (method === 8) {
      real += await inflateCounting(data, budget, isSheet ? counter : null);
    } else {
      throw new SpreadsheetLimitError("ZIP_INVALID", "Planilha com compressão interna não suportada.");
    }
    cells += counter.count;
    if (cells > limits.maxCellsPerWorkbook) {
      throw new SpreadsheetLimitError("TOO_MANY_CELLS", `Planilha excede o limite de ${limits.maxCellsPerWorkbook} células para importação.`);
    }
  }
  return { entries, realUncompressedBytes: real, worksheets, cells };
}

function tooLarge(): SpreadsheetLimitError {
  return new SpreadsheetLimitError("ZIP_TOO_LARGE", "Planilha expande além do limite permitido para importação.");
}

function findEocd(buf: Buffer): number {
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minStart; i--) if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  throw new SpreadsheetLimitError("ZIP_INVALID", "Arquivo XLSX inválido (estrutura ZIP não encontrada).");
}

/** Conta elementos de célula `<c ` / `<c>` / `<c/` em texto recebido em pedaços (sem confundir com <col>, <cfRule>). */
class CellCounter {
  count = 0;
  private tail = "";
  feed(chunk: string): void {
    const text = this.tail + chunk;
    const re = /<c[\s>/]/g;
    while (re.exec(text)) this.count++;
    // Guarda os 2 últimos caracteres: um "<c" no fim do pedaço só fecha com o delimitador do próximo. Um match
    // completo (3 caracteres) nunca cabe nos 2 guardados, então nada é contado duas vezes.
    this.tail = text.slice(-2);
  }
}

/** Inflate em stream contando bytes de saída; aborta (destrói o stream) ao passar do orçamento. */
function inflateCounting(data: Buffer, budget: number, counter: CellCounter | null): Promise<number> {
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw();
    let out = 0;
    inflate.on("data", (chunk: Buffer) => {
      out += chunk.length;
      if (out > budget) { inflate.destroy(); reject(tooLarge()); return; }
      counter?.feed(chunk.toString("latin1"));
    });
    inflate.on("error", () => reject(new SpreadsheetLimitError("ZIP_INVALID", "Arquivo XLSX com dados internos corrompidos.")));
    inflate.on("end", () => resolve(out));
    inflate.end(data);
  });
}

/** Assinaturas: XLSX = ZIP ("PK\x03\x04"); XLS legado = OLE/CFB (D0 CF 11 E0 A1 B1 1A E1). */
export function detectSpreadsheetContainer(buf: Buffer): "zip" | "cfb" | "unknown" {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return "zip";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "cfb";
  return "unknown";
}
