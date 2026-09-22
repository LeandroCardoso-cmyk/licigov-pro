/**
 * PROJEÇÃO DOCUMENTAL do Import Engine — DFD / ETP / TR importados como DOCUMENTOS (não como linhas).
 *
 * O Import Engine é orientado a linhas (RawExtractedItem). DFD/ETP/TR são documentos: transformá-los em
 * "itens" destruiria a estrutura. Esta projeção roda DENTRO do mesmo motor (mesma sessão, upload, storage,
 * checksum, parser e proveniência) e produz:
 *
 *     blocos ordenados (título / parágrafo / item de lista / tabela) + proveniência (página / bloco / tabela)
 *     → conteúdo markdown determinístico + contentHash
 *
 * Regras: EXTRAÇÃO + ORGANIZAÇÃO — nunca geração. Nada é inventado nem completado por IA. Sem OCR: PDF só
 * imagem não gera projeção (o parser sinaliza OCR_REQUIRED). Puro e determinístico (sem IO).
 */
import { draftContentHash } from "./generatedDocument";

export const DOCUMENT_PROJECTION_VERSION = "document-projection/1.0";
/** Limite de segurança do conteúdo projetado (caracteres). Excedente é truncado COM aviso explícito. */
export const MAX_DOCUMENT_CHARS = 1_500_000;

/** Tipos de documento importável e o importType canônico de cada um (o kind é intrínseco ao tipo). */
export type DocumentImportKind = "dfd" | "etp" | "tr";
export const DOCUMENT_IMPORT_TYPES = {
  document_dfd: "dfd",
  document_etp: "etp",
  document_tr: "tr",
} as const satisfies Record<string, DocumentImportKind>;
export type DocumentImportType = keyof typeof DOCUMENT_IMPORT_TYPES;

export function isDocumentImportType(importType: string): importType is DocumentImportType {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_IMPORT_TYPES, importType);
}
export function documentKindForImportType(importType: string): DocumentImportKind | null {
  return isDocumentImportType(importType) ? DOCUMENT_IMPORT_TYPES[importType] : null;
}
export function importTypeForDocumentKind(kind: DocumentImportKind): DocumentImportType {
  return `document_${kind}` as DocumentImportType;
}

export type DocumentBlockType = "heading" | "paragraph" | "list_item" | "table";

export interface DocumentBlock {
  readonly index: number;
  readonly type: DocumentBlockType;
  /** Nível do título (1–6); só para `heading`. */
  readonly level?: number;
  /** Texto do bloco (tabela: vazio — o conteúdo está em `rows`). */
  readonly text: string;
  /** Linhas da tabela (primeira = cabeçalho); só para `table`. */
  readonly rows?: readonly (readonly string[])[];
  /** Proveniência: página (PDF) e/ou índice de tabela (DOCX/PDF). */
  readonly page?: number;
  readonly tableIndex?: number;
}

export interface DocumentProjection {
  readonly contractVersion: typeof DOCUMENT_PROJECTION_VERSION;
  readonly content: string;
  readonly contentHash: string;
  readonly blocks: readonly DocumentBlock[];
  readonly stats: {
    readonly blocks: number; readonly headings: number; readonly paragraphs: number;
    readonly listItems: number; readonly tables: number; readonly characters: number;
    readonly pages?: number; readonly truncated: boolean;
  };
}

const NUMBERED_HEADING = /^((?:\d+\.)*\d+)[.)]?\s+(\S.*)$/;
const KEYWORD_HEADING = /^(CAP[ÍI]TULO|SE[ÇC][ÃA]O|ANEXO|T[ÍI]TULO|PARTE)\b/i;

/**
 * Heurística DETERMINÍSTICA de título para linhas de texto (PDF e parágrafos DOCX sem estilo):
 *   - numerado ("1. OBJETO", "3.2 Requisitos") curto → nível pela profundidade;
 *   - palavra-chave (CAPÍTULO/SEÇÃO/ANEXO/TÍTULO/PARTE) curta → nível 1;
 *   - linha curta TODA EM MAIÚSCULAS (≥ 2 letras) → nível 2.
 * Retorna o nível ou null. Não reescreve o texto.
 */
export function detectHeadingLevel(line: string): number | null {
  const t = line.trim();
  if (t.length === 0 || t.length > 120) return null;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const isUpper = letters.length >= 2 && letters === letters.toUpperCase();
  const numbered = NUMBERED_HEADING.exec(t);
  if (numbered) {
    const depth = numbered[1].split(".").length;
    const rest = numbered[2];
    // "1. O objeto é ..." (frase longa) é parágrafo numerado, não título.
    if (rest.length <= 90 && !/[.;:]$/.test(rest) && (isUpper || rest.split(/\s+/).length <= 10)) {
      return Math.min(depth + 1, 4);
    }
    return null;
  }
  if (KEYWORD_HEADING.test(t) && t.length <= 90) return 1;
  if (isUpper && t.length <= 90 && !/[.;,]$/.test(t)) return 2;
  return null;
}

/**
 * Converte o texto de UMA página (PDF) em blocos: linhas de título viram `heading`; linhas contíguas viram
 * um `paragraph` (quebra em linha vazia, título, item de lista ou linha anterior terminada em pontuação
 * final seguida de maiúscula). Itens com marcador ("-", "•", "a)") viram `list_item`.
 */
export function pageTextToBlocks(text: string, page: number, startIndex: number): DocumentBlock[] {
  const out: DocumentBlock[] = [];
  let buf: string[] = [];
  let idx = startIndex;
  const flush = () => {
    const joined = buf.join(" ").replace(/\s+/g, " ").trim();
    if (joined) out.push({ index: idx++, type: "paragraph", text: joined, page });
    buf = [];
  };
  const lines = (text ?? "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "") { flush(); continue; }
    const level = detectHeadingLevel(line);
    if (level !== null) { flush(); out.push({ index: idx++, type: "heading", level, text: line, page }); continue; }
    const bullet = /^([-•▪◦*]|[a-z]\)|[ivx]+\))\s+(.+)$/i.exec(line);
    if (bullet) { flush(); out.push({ index: idx++, type: "list_item", text: bullet[2].trim(), page }); continue; }
    const prev = buf[buf.length - 1];
    if (prev && /[.:;!?]$/.test(prev) && /^[A-ZÀ-Ý"“(]/.test(line)) flush();
    buf.push(line);
  }
  flush();
  return out;
}

function mdCell(s: string): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Renderiza blocos em markdown determinístico (blocos separados por linha vazia). */
export function renderBlocksToMarkdown(blocks: readonly DocumentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        parts.push(`${"#".repeat(Math.max(1, Math.min(6, b.level ?? 2)))} ${b.text.trim()}`);
        break;
      case "list_item":
        parts.push(`- ${b.text.trim()}`);
        break;
      case "table": {
        const rows = (b.rows ?? []).filter((r) => r.some((c) => (c ?? "").trim() !== ""));
        if (rows.length === 0) break;
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: readonly string[]) => Array.from({ length: width }, (_, i) => mdCell(r[i] ?? ""));
        const lines = [`| ${pad(rows[0]).join(" | ")} |`, `|${" --- |".repeat(width)}`];
        for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
        parts.push(lines.join("\n"));
        break;
      }
      default:
        parts.push(b.text.trim());
    }
  }
  // Itens de lista consecutivos ficam em linhas adjacentes (lista markdown contínua).
  const md: string[] = [];
  blocks.forEach((b, i) => {
    const part = parts[i];
    if (part === undefined) return;
    const prevList = i > 0 && blocks[i - 1].type === "list_item" && b.type === "list_item";
    md.push(prevList ? `\n${part}` : `\n\n${part}`);
  });
  return md.join("").trim();
}

/** Monta a projeção final (conteúdo + hash + estatísticas), truncando com aviso no limite de segurança. */
export function buildDocumentProjection(blocks: readonly DocumentBlock[], meta: { pages?: number } = {}): DocumentProjection {
  let content = renderBlocksToMarkdown(blocks);
  let truncated = false;
  if (content.length > MAX_DOCUMENT_CHARS) {
    content = `${content.slice(0, MAX_DOCUMENT_CHARS)}\n\n[REVISAR: documento truncado no limite de ${MAX_DOCUMENT_CHARS} caracteres]`;
    truncated = true;
  }
  return {
    contractVersion: DOCUMENT_PROJECTION_VERSION,
    content,
    contentHash: draftContentHash(content),
    blocks,
    stats: {
      blocks: blocks.length,
      headings: blocks.filter((b) => b.type === "heading").length,
      paragraphs: blocks.filter((b) => b.type === "paragraph").length,
      listItems: blocks.filter((b) => b.type === "list_item").length,
      tables: blocks.filter((b) => b.type === "table").length,
      characters: content.length,
      pages: meta.pages,
      truncated,
    },
  };
}
