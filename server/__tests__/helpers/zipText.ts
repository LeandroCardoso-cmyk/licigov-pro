/** Leitor mínimo de ZIP (só para testes): devolve o texto de um arquivo STORED/DEFLATE do pacote (ex.: word/document.xml). */
import { inflateRawSync } from "zlib";

export function readZipEntry(buf: Buffer, name: string): string | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nlen);
    if (entryName === name) {
      const lnlen = buf.readUInt16LE(lho + 26);
      const lelen = buf.readUInt16LE(lho + 28);
      const data = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}
