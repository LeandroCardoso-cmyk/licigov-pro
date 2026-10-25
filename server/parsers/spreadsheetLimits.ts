/**
 * SEC-AUD-2026-10 / xlsx — limites ANTES de abrir uma planilha enviada por usuário.
 *
 * O tamanho do upload já é limitado (MAX_FILE_SIZE_BYTES, 50 MB), mas um XLSX é um ZIP: 50 MB comprimidos podem
 * expandir para gigabytes (ZIP bomb) e travar o worker de ingestão (fila de um job por vez). Aqui o diretório
 * central do ZIP é lido SEM descomprimir nada: número de entradas, tamanho total descomprimido e taxa de
 * compressão por entrada. Depois de aberto, o número de células do intervalo usado de cada aba é limitado.
 * Nenhum limite executa fórmula ou macro: o leitor usa só valores em cache.
 */

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
});

export type SpreadsheetLimitCode = "ZIP_INVALID" | "ZIP_TOO_MANY_ENTRIES" | "ZIP_TOO_LARGE" | "ZIP_RATIO" | "ZIP64_UNSUPPORTED";

export class SpreadsheetLimitError extends Error {
  constructor(readonly code: SpreadsheetLimitCode | "TOO_MANY_CELLS" | "TOO_MANY_SHEETS", message: string) {
    super(message);
    this.name = "SpreadsheetLimitError";
  }
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

/** Lê o diretório central do ZIP (sem descomprimir) e aplica os limites. Lança SpreadsheetLimitError. */
export function assertZipWithinLimits(buf: Buffer, limits = SPREADSHEET_LIMITS): { entries: number; uncompressedBytes: number } {
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

export function assertSheetWithinLimits(sheet: string, rows: number, cols: number, limits = SPREADSHEET_LIMITS): void {
  if (rows * cols > limits.maxCellsPerSheet) {
    throw new SpreadsheetLimitError("TOO_MANY_CELLS", `Aba "${sheet}" excede o limite de ${limits.maxCellsPerSheet} células para importação.`);
  }
}

/** Assinaturas: XLSX = ZIP ("PK\x03\x04"); XLS legado = OLE/CFB (D0 CF 11 E0 A1 B1 1A E1). */
export function detectSpreadsheetContainer(buf: Buffer): "zip" | "cfb" | "unknown" {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return "zip";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "cfb";
  return "unknown";
}
