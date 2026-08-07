/**
 * PR B.2.3 — Extração tabular compartilhada pelos parsers reais de PDF e DOCX.
 *
 * Converte tanto MATRIZES de células (tabelas de DOCX / getTable do PDF) quanto LINHAS de texto
 * (getText do PDF) em `RawExtractedItem[]`, preservando os valores BRUTOS (nunca normaliza aqui —
 * normalização/correção ocorre no staging) e anexando confiança, avisos e proveniência por item.
 *
 * Determinístico e puro (sem I/O). Não inventa dados: campos ausentes ficam null.
 */
import { createRawItem } from "../domain/importExtraction";
import { buildProvenance } from "../domain/importProvenance";
import { buildFieldConfidence, aggregateConfidence } from "../domain/importConfidence";
import type { CellLocation, ExtractionProvenance } from "../domain/importProvenance";
import type { RawExtractedItem } from "../domain/importExtraction";
import type { ImportWarning } from "../domain/importTypes";

// ─── Padrões de coluna (alinhados com csvParser/xlsxParser) ─────────────────────

const DESCRIPTION_PATTERNS = ["DESCRIÇÃO", "DESCRICAO", "DESCRIPTION", "OBJETO", "ITEM", "MATERIAL", "PRODUTO", "ESPECIFICAÇÃO", "ESPECIFICACAO", "NOME"];
const QUANTITY_PATTERNS    = ["QTDE", "QTD", "QT", "QUANTIDADE", "QUANT", "QUANTITY", "QNT"];
const UNIT_PATTERNS        = ["UNID", "UN", "UNIDADE", "UNIT", "UM"];
const UNIT_PRICE_PATTERNS  = ["PRECO UNIT", "PREÇO UNIT", "V.UNIT", "VL.UNIT", "VALOR UNIT", "UNIT PRICE", "P.UNIT", "PRECO UNI", "VUNIT"];
const TOTAL_PRICE_PATTERNS = ["TOTAL", "PRECO TOTAL", "PREÇO TOTAL", "VL TOTAL", "VALOR TOTAL", "TOTAL PRICE", "V.TOTAL"];

function matchColumn(headers: string[], patterns: string[]): number {
  for (const pattern of patterns) {
    const idx = headers.findIndex(h => h.toUpperCase().includes(pattern));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ─── Heurísticas de valor ───────────────────────────────────────────────────────

/** Token que parece um valor monetário/decimal pt-BR ou en-US (aceita R$, milhar e centavos). */
const MONEY_RE = /^R?\$?\s?-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^R?\$?\s?-?\d+(\.\d{1,2})?$/;
/** Token puramente numérico (quantidade): inteiro ou decimal simples. */
const NUMERIC_RE = /^-?\d+([.,]\d+)?$/;
/** Unidade: token curto, alfabético (aceita acentos, barra e ponto), ex.: UN, RESMA, CX, M², KG. */
const UNIT_RE = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9./²³ºª]{0,9}$/;

export function isMoneyLike(t: string): boolean { return MONEY_RE.test(t.trim()); }
export function isNumericLike(t: string): boolean { return NUMERIC_RE.test(t.trim()); }
export function isUnitLike(t: string): boolean {
  const s = t.trim();
  return UNIT_RE.test(s) && !isMoneyLike(s) && !/^\d+$/.test(s);
}

/**
 * Heurística "ancorada à direita" para uma LINHA de texto de tabela de preços cujos tokens não têm
 * separador de coluna confiável (caso comum em PDF textual): da direita p/ a esquerda captura até dois
 * valores monetários (total, unitário), uma unidade e uma quantidade; o restante inicial é a descrição.
 * Retorna null se não houver ao menos descrição + um valor monetário (não força estrutura inexistente).
 */
export function parsePriceRowTokens(tokens: string[]): {
  rawDescription: string | null; rawQuantity: string | null; rawUnit: string | null;
  rawUnitPrice: string | null; rawTotalPrice: string | null;
} | null {
  const toks = tokens.slice();
  let rawTotalPrice: string | null = null;
  let rawUnitPrice:  string | null = null;
  let rawUnit:       string | null = null;
  let rawQuantity:   string | null = null;

  // total (mais à direita)
  if (toks.length && isMoneyLike(toks[toks.length - 1])) rawTotalPrice = toks.pop()!.trim();
  // unitário
  if (toks.length && isMoneyLike(toks[toks.length - 1])) rawUnitPrice = toks.pop()!.trim();
  // unidade
  if (toks.length && isUnitLike(toks[toks.length - 1])) rawUnit = toks.pop()!.trim();
  // quantidade
  if (toks.length && isNumericLike(toks[toks.length - 1])) rawQuantity = toks.pop()!.trim();

  const rawDescription = toks.join(" ").trim() || null;
  // Exige descrição + ao menos um valor monetário; senão a linha não é uma linha de item confiável.
  if (!rawDescription || (rawTotalPrice === null && rawUnitPrice === null)) return null;
  return { rawDescription, rawQuantity, rawUnit, rawUnitPrice, rawTotalPrice };
}

// ─── Detecção de cabeçalho em matriz ────────────────────────────────────────────

/** Uma linha é cabeçalho se casa ≥2 padrões conhecidos, ou se tem ≥3 células não-numéricas não vazias. */
export function looksLikeHeaderCells(cells: string[]): boolean {
  const up = cells.map(c => c.toUpperCase());
  const patternHits = [DESCRIPTION_PATTERNS, QUANTITY_PATTERNS, UNIT_PATTERNS, UNIT_PRICE_PATTERNS, TOTAL_PRICE_PATTERNS]
    .filter(pats => matchColumn(up, pats) >= 0).length;
  if (patternHits >= 2) return true;
  const nonEmpty = cells.filter(c => c.trim() !== "");
  return nonEmpty.length >= 3 && nonEmpty.every(c => !isMoneyLike(c) && !isNumericLike(c));
}

// ─── Contexto de extração ───────────────────────────────────────────────────────

export interface TabularContext {
  importSessionId: number;
  parserType:      string;
  parserVersion:   string;
  sourceFileId:    string;
  sourceFileName:  string;
  sourceMimeType:  string;
  sourceChecksum:  string;
  maxItems:        number;
}

function confidenceFor(desc: string | null, qty: string | null, unit: string | null, up: string | null, total: string | null) {
  return aggregateConfidence([
    buildFieldConfidence("description", desc  ? 0.82 : 0.2),
    buildFieldConfidence("quantity",    qty   ? 0.78 : 0.3),
    buildFieldConfidence("unit",        unit  ? 0.75 : 0.3),
    buildFieldConfidence("unit_price",  up    ? 0.80 : 0.3),
    buildFieldConfidence("total_price", total ? 0.80 : 0.3),
  ]);
}

/** Constrói item bruto com proveniência, aplicando o limite de itens. */
function pushItem(
  items: RawExtractedItem[], ctx: TabularContext,
  raw: { rawDescription: string | null; rawQuantity: string | null; rawUnit: string | null; rawUnitPrice: string | null; rawTotalPrice: string | null },
  location: CellLocation, extras: Partial<Pick<ExtractionProvenance, "sectionTitle" | "tableIndex" | "rawRowData">>,
  rawCellValues: Record<string, unknown>,
): boolean {
  if (items.length >= ctx.maxItems) return false;
  const confidence = confidenceFor(raw.rawDescription, raw.rawQuantity, raw.rawUnit, raw.rawUnitPrice, raw.rawTotalPrice);
  const provenance = buildProvenance(
    ctx.sourceFileId, ctx.sourceFileName, ctx.sourceMimeType, ctx.sourceChecksum,
    ctx.parserType, ctx.parserVersion, location, extras,
  );
  items.push(createRawItem(
    ctx.importSessionId, raw, provenance,
    { parserType: ctx.parserType, parserVersion: ctx.parserVersion, processingMs: 0, rawCellValues, pageNumber: location.page },
    confidence,
  ));
  return true;
}

export interface TabularOutcome {
  items:    RawExtractedItem[];
  warnings: ImportWarning[];
  rowsRead: number;
  skipped:  number;
}

/**
 * Converte uma MATRIZ de células (tabela já segmentada: DOCX/PDF-getTable) em itens brutos.
 * `locate(dataRowIdx)` fornece a localização/proveniência de cada linha de dado.
 */
export function matrixToRawItems(
  matrix: string[][], ctx: TabularContext,
  locate: (dataRowIdx: number) => { location: CellLocation; extras: Partial<Pick<ExtractionProvenance, "sectionTitle" | "tableIndex" | "rawRowData">> },
): TabularOutcome {
  const items: RawExtractedItem[] = [];
  const warnings: ImportWarning[] = [];
  let skipped = 0, rowsRead = 0;
  if (matrix.length === 0) return { items, warnings, rowsRead, skipped };

  // Cabeçalho entre as 3 primeiras linhas.
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(3, matrix.length); i++) {
    if (looksLikeHeaderCells(matrix[i])) { headerRowIdx = i; break; }
  }
  const headers = headerRowIdx >= 0 ? matrix[headerRowIdx].map(c => c.toUpperCase()) : [];
  if (headerRowIdx < 0) warnings.push({ code: "HEADER_INFERENCE", message: "Cabeçalho não identificado; usando ordem posicional das colunas.", severity: "warning" });

  const descIdx  = headers.length ? matchColumn(headers, DESCRIPTION_PATTERNS) : 0;
  const qtyIdx   = headers.length ? matchColumn(headers, QUANTITY_PATTERNS)    : 1;
  const unitIdx  = headers.length ? matchColumn(headers, UNIT_PATTERNS)        : 2;
  const upIdx    = headers.length ? matchColumn(headers, UNIT_PRICE_PATTERNS)  : 3;
  const totalIdx = headers.length ? matchColumn(headers, TOTAL_PRICE_PATTERNS) : 4;

  const startRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r].map(c => (c ?? "").trim());
    rowsRead++;
    if (row.every(c => c === "")) { skipped++; continue; }
    const at = (idx: number) => (idx >= 0 && idx < row.length ? (row[idx] || null) : null);
    const rawDescription = at(descIdx);
    if (!rawDescription) { skipped++; continue; }
    const raw = {
      rawDescription,
      rawQuantity:   at(qtyIdx),
      rawUnit:       at(unitIdx),
      rawUnitPrice:  at(upIdx),
      rawTotalPrice: at(totalIdx),
    };
    const { location, extras } = locate(r);
    const rawCellValues = Object.fromEntries(row.map((c, i) => [(headers[i] || `col${i}`), c]));
    if (!pushItem(items, ctx, raw, location, { ...extras, rawRowData: row }, rawCellValues)) {
      warnings.push({ code: "TRUNCATED_VALUE", message: `Limite de ${ctx.maxItems} itens atingido; linhas adicionais ignoradas.`, severity: "warning" });
      break;
    }
  }
  return { items, warnings, rowsRead, skipped };
}

/**
 * Converte LINHAS de texto (getText do PDF) em itens brutos via heurística de linha de preço.
 * `locate(lineIdx)` fornece a localização (página/linha). Linhas de cabeçalho e não-itens são puladas.
 */
export function linesToRawItems(
  lines: string[], ctx: TabularContext,
  locate: (lineIdx: number) => { location: CellLocation; extras: Partial<Pick<ExtractionProvenance, "sectionTitle" | "tableIndex" | "rawRowData">> },
): TabularOutcome {
  const items: RawExtractedItem[] = [];
  const warnings: ImportWarning[] = [];
  let skipped = 0, rowsRead = 0;
  let headerSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    rowsRead++;
    const cells = line.split(/\s{2,}/).map(c => c.trim()).filter(c => c !== "");
    // Cabeçalho: pula (registra que houve).
    if ((cells.length >= 2 && looksLikeHeaderCells(cells)) || looksLikeHeaderCells(line.split(/\s+/))) {
      headerSeen = true; skipped++; continue;
    }
    // Caminho A: colunas separadas por 2+ espaços (PDF preserva alinhamento).
    let raw: ReturnType<typeof parsePriceRowTokens> = null;
    if (cells.length >= 3) {
      raw = {
        rawDescription: cells[0] || null,
        rawQuantity:    cells[1] ?? null,
        rawUnit:        cells[2] ?? null,
        rawUnitPrice:   cells[3] ?? null,
        rawTotalPrice:  cells[4] ?? null,
      };
      if (!raw.rawDescription) raw = null;
    }
    // Caminho B: heurística ancorada à direita sobre tokens simples.
    if (!raw) raw = parsePriceRowTokens(line.split(/\s+/));
    if (!raw) { skipped++; continue; }

    const { location, extras } = locate(i);
    if (!pushItem(items, ctx, raw, location, { ...extras, rawRowData: [line] }, { line })) {
      warnings.push({ code: "TRUNCATED_VALUE", message: `Limite de ${ctx.maxItems} itens atingido; linhas adicionais ignoradas.`, severity: "warning" });
      break;
    }
  }
  if (!headerSeen && items.length > 0) {
    warnings.push({ code: "HEADER_INFERENCE", message: "Nenhum cabeçalho de tabela identificado no texto; colunas inferidas por heurística.", severity: "warning" });
  }
  return { items, warnings, rowsRead, skipped };
}
