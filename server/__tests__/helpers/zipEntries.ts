/**
 * R9 / SEM-072 — leitor mínimo de ZIP para testes (sem dependência extra): percorre o diretório central e devolve
 * nome + bytes descomprimidos (store/deflate) de cada entrada. Só para inspecionar pacotes gerados nos testes.
 */
import { inflateRawSync } from "zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function readZipEntries(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue; // cabeçalho do diretório central
    const method = buf.readUInt16LE(i + 10);
    const compressedSize = buf.readUInt32LE(i + 20);
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    const localOffset = buf.readUInt32LE(i + 42);
    const name = buf.subarray(i + 46, i + 46 + nameLen).toString("utf-8");
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    i += 45 + nameLen + extraLen + commentLen;
  }
  return entries;
}
