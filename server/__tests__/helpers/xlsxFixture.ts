/**
 * SEC-AUD-07 — fixtures XLSX sintéticas sem o SheetJS (removido das dependências): escritas com `exceljs`
 * (o mesmo pacote do leitor) ou montadas byte a byte (ZIP mínimo) para entradas adversariais.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/spreadsheets");

/** Equivalente a `aoa_to_sheet` + `write(bookType:"xlsx")`: uma aba por par [nome, linhas]. */
export async function xlsxBuffer(sheets: ReadonlyArray<readonly [string, ReadonlyArray<ReadonlyArray<unknown>>]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of sheets) {
    const ws = wb.addWorksheet(name);
    for (const row of rows) ws.addRow([...row] as ExcelJS.CellValue[]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function fixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, name));
}

/** Conteúdo (texto) de uma entrada do ZIP — para conferir o XML gerado sem depender de um leitor de planilha. */
export function zipEntryText(buf: Buffer, entryName: string): string | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name !== entryName) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + comp);
    return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
  }
  return null;
}

export interface RawZipEntry { name: string; data: Buffer; /** Tamanho descomprimido DECLARADO (pode mentir). */ declaredSize?: number; stored?: boolean }

/** ZIP mínimo montado à mão (local headers + diretório central + EOCD), para metadado inconsistente e afins. */
export function rawZip(entries: RawZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const body = e.stored ? e.data : deflateRawSync(e.data);
    const size = e.declaredSize ?? e.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.stored ? 0 : 8, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.stored ? 0 : 8, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
