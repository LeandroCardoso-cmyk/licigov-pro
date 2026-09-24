/**
 * U2A-OCR — Heurística DETERMINÍSTICA de "texto útil" por página (decide texto nativo × OCR). Sem LLM.
 *
 * `text.length > 0` NÃO basta: PDFs digitalizados costumam carregar um carimbo, número de página ou lixo
 * de 1–2 caracteres na camada de texto. Uma página tem texto nativo ÚTIL quando, após remover marcadores
 * de página e espaços, possui ao menos:
 *   - MIN_USEFUL_CHARS (30) caracteres alfanuméricos, E
 *   - MIN_WORDS (4) "palavras" (tokens com ≥ 2 caracteres alfanuméricos);
 * OU quando o PDF expõe ao menos uma TABELA estruturada (getTable) naquela página.
 *
 * Versão (`NATIVE_TEXT_HEURISTIC_VERSION`) entra no fingerprint de replay: mudar os limiares muda a versão.
 */

export const NATIVE_TEXT_HEURISTIC_VERSION = "1";
export const MIN_USEFUL_CHARS = 30;
export const MIN_WORDS = 4;

export interface PageTextAssessment {
  pageNumber:  number;
  usefulChars: number;
  words:       number;
  hasTables:   boolean;
  useful:      boolean;
  reason:      "tables" | "text" | "insufficient_text" | "no_text";
}

const PAGE_MARKER_RE = /^\s*-{1,3}\s*\d+\s*(?:of|de)\s*\d+\s*-{1,3}\s*$/gim;
const ALNUM_RE = /[\p{L}\p{N}]/gu;

export function assessPageText(pageNumber: number, text: string, hasTables: boolean): PageTextAssessment {
  const cleaned = (text ?? "").replace(PAGE_MARKER_RE, " ");
  const usefulChars = (cleaned.match(ALNUM_RE) ?? []).length;
  const words = cleaned.split(/\s+/).filter((t) => (t.match(ALNUM_RE) ?? []).length >= 2).length;
  if (hasTables) return { pageNumber, usefulChars, words, hasTables, useful: true, reason: "tables" };
  if (usefulChars >= MIN_USEFUL_CHARS && words >= MIN_WORDS) return { pageNumber, usefulChars, words, hasTables, useful: true, reason: "text" };
  return { pageNumber, usefulChars, words, hasTables, useful: false, reason: usefulChars === 0 ? "no_text" : "insufficient_text" };
}

export interface DocumentTextAssessment {
  heuristicVersion:  string;
  pages:             PageTextAssessment[];
  pagesWithUseful:   number;
  pagesWithout:      number;
  /** Documento inteiro atende pelo texto nativo (nenhuma página precisa de OCR). */
  sufficient:        boolean;
}

export function assessDocumentText(pages: Array<{ num: number; text: string }>, tablesByPage: ReadonlyMap<number, unknown[]>): DocumentTextAssessment {
  const assessed = pages.map((p) => assessPageText(p.num, p.text ?? "", (tablesByPage.get(p.num)?.length ?? 0) > 0));
  const pagesWithUseful = assessed.filter((a) => a.useful).length;
  return {
    heuristicVersion: NATIVE_TEXT_HEURISTIC_VERSION,
    pages: assessed,
    pagesWithUseful,
    pagesWithout: assessed.length - pagesWithUseful,
    sufficient: assessed.length > 0 && pagesWithUseful === assessed.length,
  };
}
