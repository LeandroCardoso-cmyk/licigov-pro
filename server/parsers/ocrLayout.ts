/**
 * U2A-OCR — Reconstrução DETERMINÍSTICA de layout a partir das palavras do OCR (caixa delimitadora +
 * confiança). Converte uma página reconhecida em:
 *   - MATRIZ de células (quando há linha de cabeçalho reconhecível) → consumida pelo MESMO parser tabular
 *     canônico (`matrixToRawItems`), exatamente como uma tabela de PDF textual/DOCX; ou
 *   - LINHAS de texto com colunas separadas por espaços largos → `linesToRawItems` (mesma heurística do
 *     texto nativo).
 * Não existe "parser de OCR": só a GEOMETRIA é tratada aqui. Nada é corrigido, inferido ou inventado:
 * o texto de cada célula é o texto reconhecido; a confiança por célula (mínimo das palavras) e o texto
 * bruto da linha seguem como metadado para revisão. Puro (sem I/O), testável sem o motor de OCR.
 */
import type { OcrBBox, OcrPageResult, OcrWord } from "../domain/ocr";
import { looksLikeHeaderCells, mapHeaderColumns, normalizeHeader } from "./tabularExtraction";

export const OCR_LAYOUT_VERSION = "1";

/** Espaço entre palavras maior que `CELL_GAP_CHARS` larguras médias de caractere ⇒ nova célula. */
const CELL_GAP_CHARS = 1.8;
/** Linha de continuação: distância vertical até a linha anterior menor que `CONTINUATION_GAP` alturas. */
const CONTINUATION_GAP = 0.9;
/** Fração mínima de sobreposição vertical para duas palavras pertencerem à mesma linha. */
const ROW_OVERLAP = 0.5;
/** Linhas iniciais examinadas em busca do cabeçalho. */
const HEADER_SCAN_ROWS = 12;

export interface OcrCell { text: string; confidence: number; bbox: OcrBBox }

export interface OcrRowMeta {
  /** Texto bruto reconhecido da(s) linha(s) física(s) que compõem a linha lógica. */
  lineText:     string;
  /** Confiança mínima (0–100) por coluna da matriz (null = célula vazia). */
  confidence:   Array<number | null>;
  /** Descrição continuada anexada a partir de linha(s) seguinte(s). */
  mergedContinuation: boolean;
  /** Alguma célula física cobre mais de uma coluna do cabeçalho (estrutura ambígua). */
  spansColumns: boolean;
  bbox:         OcrBBox;
}

export type OcrPageLayout =
  | { kind: "table"; pageNumber: number; matrix: string[][]; rowMeta: OcrRowMeta[]; headerRowIndex: 0; preambleLines: string[] }
  | { kind: "lines"; pageNumber: number; lines: string[]; rowMeta: OcrRowMeta[] }
  | { kind: "empty"; pageNumber: number };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const height = (b: OcrBBox) => Math.max(1, b.y1 - b.y0);
const union = (a: OcrBBox, b: OcrBBox): OcrBBox => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/** Agrupa palavras em linhas físicas por sobreposição vertical (independe da segmentação do motor). */
export function groupWordsIntoRows(words: OcrWord[]): OcrWord[][] {
  const sorted = [...words].sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1) || a.bbox.x0 - b.bbox.x0);
  const rows: Array<{ bbox: OcrBBox; words: OcrWord[] }> = [];
  for (const w of sorted) {
    let target: { bbox: OcrBBox; words: OcrWord[] } | undefined;
    // Examina apenas as últimas linhas (as palavras vêm ordenadas por centro vertical).
    for (let i = rows.length - 1; i >= Math.max(0, rows.length - 3); i--) {
      const r = rows[i];
      const overlap = Math.min(r.bbox.y1, w.bbox.y1) - Math.max(r.bbox.y0, w.bbox.y0);
      if (overlap >= ROW_OVERLAP * Math.min(height(r.bbox), height(w.bbox))) { target = r; break; }
    }
    if (target) { target.words.push(w); target.bbox = union(target.bbox, w.bbox); }
    else rows.push({ bbox: { ...w.bbox }, words: [w] });
  }
  return rows.map((r) => r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

/** Divide uma linha física em células pelo espaçamento horizontal entre palavras. */
export function splitRowIntoCells(row: OcrWord[], charWidth: number): OcrCell[] {
  const cells: OcrCell[] = [];
  const gap = Math.max(1, CELL_GAP_CHARS * charWidth);
  for (const w of row) {
    const last = cells[cells.length - 1];
    if (last && w.bbox.x0 - last.bbox.x1 <= gap) {
      last.text = `${last.text} ${w.text}`;
      last.confidence = Math.min(last.confidence, w.confidence);
      last.bbox = union(last.bbox, w.bbox);
    } else {
      cells.push({ text: w.text, confidence: w.confidence, bbox: { ...w.bbox } });
    }
  }
  return cells;
}

function estimateCharWidth(words: OcrWord[]): number {
  return median(words.map((w) => (w.bbox.x1 - w.bbox.x0) / Math.max(1, [...w.text].length)));
}

/** Converte a página reconhecida em matriz (com cabeçalho) ou linhas (sem cabeçalho). */
export function buildOcrPageLayout(page: OcrPageResult): OcrPageLayout {
  const words = page.lines.flatMap((l) => l.words).filter((w) => w.text.trim() !== "");
  if (words.length === 0) return { kind: "empty", pageNumber: page.pageNumber };

  const charWidth = estimateCharWidth(words);
  const physical = groupWordsIntoRows(words).map((r) => {
    const cells = splitRowIntoCells(r, charWidth);
    const bbox = cells.reduce((b, c) => union(b, c.bbox), cells[0].bbox);
    return { cells, bbox, text: r.map((w) => w.text).join(" ") };
  });
  const rowHeight = median(physical.map((r) => height(r.bbox)));

  const headerIdx = physical.slice(0, HEADER_SCAN_ROWS).findIndex((r) => r.cells.length >= 3 && looksLikeHeaderCells(r.cells.map((c) => c.text)));

  if (headerIdx < 0) {
    // Sem cabeçalho: linhas com colunas separadas por espaços largos (o parser de linhas decide).
    return {
      kind: "lines", pageNumber: page.pageNumber,
      lines: physical.map((r) => r.cells.map((c) => c.text).join("   ")),
      rowMeta: physical.map((r) => ({
        lineText: r.text, confidence: r.cells.map((c) => c.confidence), mergedContinuation: false, spansColumns: false, bbox: r.bbox,
      })),
    };
  }

  // Com cabeçalho: fronteiras de coluna = pontos médios entre células adjacentes do cabeçalho; cada
  // célula de dado vai para a coluna do seu CENTRO horizontal (funciona para texto à esquerda/direita).
  const header = physical[headerIdx];
  const cols = header.cells.length;
  const bounds: number[] = [];
  for (let i = 0; i < cols - 1; i++) bounds.push((header.cells[i].bbox.x1 + header.cells[i + 1].bbox.x0) / 2);
  const colOf = (x: number) => { let c = 0; while (c < bounds.length && x > bounds[c]) c++; return c; };
  const descCol = mapHeaderColumns(header.cells.map((c) => normalizeHeader(c.text))).description;

  const matrix: string[][] = [header.cells.map((c) => c.text)];
  const rowMeta: OcrRowMeta[] = [{
    lineText: header.text, confidence: header.cells.map((c) => c.confidence), mergedContinuation: false, spansColumns: false, bbox: header.bbox,
  }];

  for (const r of physical.slice(headerIdx + 1)) {
    const cells: string[] = Array(cols).fill("");
    const conf: Array<number | null> = Array(cols).fill(null);
    let spans = false;
    for (const c of r.cells) {
      const col = colOf((c.bbox.x0 + c.bbox.x1) / 2);
      if (colOf(c.bbox.x0 + 1) !== colOf(c.bbox.x1 - 1)) spans = true;
      cells[col] = cells[col] ? `${cells[col]} ${c.text}` : c.text;
      conf[col] = conf[col] === null ? c.confidence : Math.min(conf[col]!, c.confidence);
    }
    const prevMeta = rowMeta[rowMeta.length - 1];
    const onlyDescription = descCol >= 0 && cells[descCol] !== "" && cells.every((v, i) => i === descCol || v === "");
    const close = r.bbox.y0 - prevMeta.bbox.y1 < CONTINUATION_GAP * rowHeight;
    if (onlyDescription && close && matrix.length > 1) {
      // Continuação da descrição da linha anterior (célula quebrada em duas linhas físicas).
      const prev = matrix[matrix.length - 1];
      prev[descCol] = prev[descCol] ? `${prev[descCol]} ${cells[descCol]}` : cells[descCol];
      prevMeta.confidence[descCol] = prevMeta.confidence[descCol] === null ? conf[descCol] : Math.min(prevMeta.confidence[descCol]!, conf[descCol]!);
      prevMeta.lineText = `${prevMeta.lineText}\n${r.text}`;
      prevMeta.mergedContinuation = true;
      prevMeta.bbox = union(prevMeta.bbox, r.bbox);
      continue;
    }
    matrix.push(cells);
    rowMeta.push({ lineText: r.text, confidence: conf, mergedContinuation: false, spansColumns: spans, bbox: r.bbox });
  }

  return {
    kind: "table", pageNumber: page.pageNumber, matrix, rowMeta, headerRowIndex: 0,
    preambleLines: physical.slice(0, headerIdx).map((r) => r.text),
  };
}

/** Caractere NÃO numérico dentro de um token que, fora ele, é numérico (ex.: "1.2O4,56", "l0,00"). */
const SUSPICIOUS_IN_NUMBER = /^(?:R\$\s?)?[\d.,]*[OoIlSsBZ][\d.,]*$/;
export function isSuspiciousNumericToken(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v || !/\d/.test(v)) return false;
  return v.split(/\s+/).some((t) => /\d/.test(t) && SUSPICIOUS_IN_NUMBER.test(t));
}
