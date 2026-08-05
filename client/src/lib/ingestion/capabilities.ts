/**
 * PR B.2.2 — Lógica PURA de capacidades de ingestão (testável sem DOM).
 *
 * A capacidade real vem do backend (ingestion.getCapabilities), que deriva `supported` do
 * parserRegistry. Aqui só transformamos essa capacidade em regras de UI: `accept` do seletor,
 * validação de arquivo (tamanho/formato) e checagem de disponibilidade — NUNCA apresentando
 * como funcional um formato cujo parser é stub (PDF/DOCX até a B.2.3).
 */

export interface IngestionFormat {
  key: string;
  label: string;
  extensions: string[];   // ex.: [".csv", ".txt"]
  mimeTypes: string[];
  supported: boolean;     // derivado do parserRegistry no backend (stub ⇒ false)
}

export interface IngestionCapabilities {
  enabled: boolean;
  maxFileSizeBytes: number;
  formats: IngestionFormat[];
  supportedFormats: IngestionFormat[];
}

/** Atributo `accept` do <input type="file">, só com formatos realmente suportados. */
export function acceptAttr(caps: Pick<IngestionCapabilities, "supportedFormats">): string {
  const exts = caps.supportedFormats.flatMap(f => f.extensions);
  const mimes = caps.supportedFormats.flatMap(f => f.mimeTypes);
  return Array.from(new Set([...exts, ...mimes])).join(",");
}

/** Rótulo humano dos formatos suportados (ex.: "CSV, Excel (XLSX), Excel (XLS)"). */
export function supportedFormatsLabel(caps: Pick<IngestionCapabilities, "supportedFormats">): string {
  return caps.supportedFormats.map(f => f.label).join(", ");
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i >= 0 ? fileName.slice(i).toLowerCase() : "";
}

export interface FileLike { name: string; size: number; type: string }
export type FileValidation = { ok: true; format: IngestionFormat } | { ok: false; code: string; message: string };

/**
 * Valida um arquivo contra a capacidade REAL, antes de enviar (o servidor revalida).
 * Aceita apenas formatos `supported` (não-stub); rejeita vazio, acima do limite e não suportado.
 */
export function validateFile(file: FileLike, caps: IngestionCapabilities): FileValidation {
  if (file.size <= 0) {
    return { ok: false, code: "EMPTY", message: "Arquivo vazio." };
  }
  if (file.size > caps.maxFileSizeBytes) {
    return { ok: false, code: "TOO_LARGE", message: `Arquivo excede o limite de ${formatBytes(caps.maxFileSizeBytes)}.` };
  }
  const ext = extOf(file.name);
  const byExt = caps.supportedFormats.find(f => f.extensions.includes(ext));
  const byMime = file.type ? caps.supportedFormats.find(f => f.mimeTypes.includes(file.type)) : undefined;
  const format = byExt ?? byMime;
  if (!format) {
    const known = caps.formats.find(f => f.extensions.includes(ext) || (file.type && f.mimeTypes.includes(file.type)));
    if (known && !known.supported) {
      return { ok: false, code: "STUB_FORMAT", message: `${known.label} ainda não é processável (disponível na B.2.3).` };
    }
    return { ok: false, code: "UNSUPPORTED", message: "Formato não suportado. Use um dos formatos permitidos." };
  }
  return { ok: true, format };
}

/** MIME a declarar para conteúdo colado (texto) — roteia para o parser CSV/texto real. */
export const PASTED_CONTENT_MIME = "text/csv";
export const PASTED_CONTENT_FILENAME = "conteudo-colado.csv";
