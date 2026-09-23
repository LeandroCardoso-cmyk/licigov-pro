/**
 * Extração tabular COMPARTILHADA pelos parsers reais (CSV, XLS/XLSX, PDF, DOCX) — fonte ÚNICA do
 * mapeamento de colunas (antes duplicado em csvParser/xlsxParser/tabularExtraction).
 *
 * Converte MATRIZES de células (planilha / tabela DOCX / getTable do PDF) e LINHAS de texto (getText do
 * PDF) em `RawExtractedItem[]`, preservando os valores BRUTOS (nunca normaliza aqui — normalização e
 * correção ocorrem no staging) e anexando confiança, avisos e proveniência por item.
 *
 * P0 piloto:
 *   - campos de COTAÇÃO de 1ª classe: fornecedor, marca, modelo, observações, fonte;
 *   - atribuição EXCLUSIVA de colunas por prioridade (ex.: "Preço Unitário" nunca vira "Unidade");
 *   - MAPA COMPARATIVO (wide format: um item por linha, um fornecedor por coluna de preço) reconhecido de
 *     forma DETERMINÍSTICA e expandido em uma cotação por fornecedor. Estrutura ambígua → NÃO adivinha:
 *     mantém o formato longo e emite aviso para revisão humana.
 *
 * Determinístico e puro (sem I/O). Não inventa dados: campos ausentes ficam null.
 */
import { createRawItem } from "../domain/importExtraction";
import { buildProvenance } from "../domain/importProvenance";
import { buildFieldConfidence, aggregateConfidence } from "../domain/importConfidence";
import type { CellLocation, ExtractionProvenance } from "../domain/importProvenance";
import type { RawExtractedItem, RawTypedValues } from "../domain/importExtraction";
import type { ImportWarning } from "../domain/importTypes";

// ─── Normalização de cabeçalho ──────────────────────────────────────────────────

/** Cabeçalho normalizado para casamento: caixa alta, sem acentos, espaços colapsados. */
export function normalizeHeader(h: string): string {
  return (h ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

// ─── Padrões de coluna (normalizados: sem acento) ───────────────────────────────

const DESCRIPTION_PATTERNS = ["DESCRICAO", "DESCRIPTION", "ESPECIFICACAO", "OBJETO", "MATERIAL", "PRODUTO", "SERVICO", "NOME", "ITEM"];
const QUANTITY_PATTERNS    = ["QUANTIDADE", "QTDE", "QTD", "QUANT", "QNT", "QT", "QUANTITY"];
const UNIT_PATTERNS        = ["UNIDADE", "UNID", "UND", "UN", "UNIT", "UM", "U.M."];
const UNIT_PRICE_PATTERNS  = ["PRECO UNIT", "VALOR UNIT", "VL. UNIT", "VL.UNIT", "VL UNIT", "V.UNIT", "V. UNIT", "P.UNIT", "P. UNIT", "PRECO UNI", "UNIT PRICE", "VUNIT", "UNITARIO", "VALOR COTADO", "PRECO COTADO", "VALOR (R$)", "PRECO (R$)", "VALOR", "PRECO"];
const TOTAL_PRICE_PATTERNS = ["VALOR TOTAL", "PRECO TOTAL", "VL TOTAL", "VL. TOTAL", "V.TOTAL", "TOTAL PRICE", "TOTAL"];
const SUPPLIER_PATTERNS    = ["FORNECEDOR", "EMPRESA", "PROPONENTE", "COTANTE", "RAZAO SOCIAL", "LICITANTE", "SUPPLIER"];
const BRAND_PATTERNS       = ["MARCA", "FABRICANTE", "BRAND"];
const MODEL_PATTERNS       = ["MODELO", "REFERENCIA", "MODEL"];
const NOTES_PATTERNS       = ["OBSERVACOES", "OBSERVACAO", "OBS", "NOTES", "NOTAS"];
const SOURCE_PATTERNS      = ["FONTE", "ORIGEM", "LINK", "URL", "SOURCE"];
/** Colunas ESTATÍSTICAS de mapa comparativo (nunca são preço de fornecedor). */
const STAT_PATTERNS        = ["MEDIA", "MEDIANA", "MENOR", "MAIOR", "MINIMO", "MAXIMO", "ESTIMADO", "DESVIO", "COEFICIENTE", "CV", "PRECO MEDIO", "VALOR MEDIO", "PRECO DE REFERENCIA", "VALOR DE REFERENCIA"];
/** Colunas de índice/código (nunca são preço nem descrição quando numéricas). */
const INDEX_PATTERNS       = ["ITEM", "#", "N°", "Nº", "NO.", "N", "SEQ", "LOTE", "CODIGO", "COD", "CATMAT", "CATSER"];

/** Casa um cabeçalho normalizado com um padrão: igualdade, prefixo, ou palavra inteira. */
function headerMatches(h: string, p: string): boolean {
  if (!h) return false;
  if (h === p || h.startsWith(p)) return true;
  return ` ${h} `.includes(` ${p} `);
}

function matchColumn(headers: string[], patterns: string[], taken: Set<number> = new Set()): number {
  for (const pattern of patterns) {
    const idx = headers.findIndex((h, i) => !taken.has(i) && headerMatches(h, pattern));
    if (idx >= 0) return idx;
  }
  return -1;
}

function isStatHeader(h: string): boolean { return STAT_PATTERNS.some((p) => headerMatches(h, p)); }
function isIndexHeader(h: string): boolean { return INDEX_PATTERNS.some((p) => headerMatches(h, p)); }

// ─── Heurísticas de valor ───────────────────────────────────────────────────────

/** Token que parece um valor monetário/decimal pt-BR ou en-US (aceita R$, milhar e centavos). */
const MONEY_RE = /^R?\$?\s?-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^R?\$?\s?-?\d+(\.\d{1,2})?$|^R?\$?\s?-?\d+(,\d{1,2})?$/;
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
function isPriceCell(t: string): boolean {
  const s = (t ?? "").trim();
  return s !== "" && (isMoneyLike(s) || isNumericLike(s));
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

  if (toks.length && isMoneyLike(toks[toks.length - 1])) rawTotalPrice = toks.pop()!.trim();
  if (toks.length && isMoneyLike(toks[toks.length - 1])) rawUnitPrice = toks.pop()!.trim();
  if (toks.length && isUnitLike(toks[toks.length - 1])) rawUnit = toks.pop()!.trim();
  if (toks.length && isNumericLike(toks[toks.length - 1])) rawQuantity = toks.pop()!.trim();

  const rawDescription = toks.join(" ").trim() || null;
  if (!rawDescription || (rawTotalPrice === null && rawUnitPrice === null)) return null;
  return { rawDescription, rawQuantity, rawUnit, rawUnitPrice, rawTotalPrice };
}

// ─── Mapeamento de colunas ──────────────────────────────────────────────────────

export interface ColumnMap {
  description: number; quantity: number; unit: number; unitPrice: number; totalPrice: number;
  supplier: number; brand: number; model: number; notes: number; source: number;
}

/**
 * Mapeia cabeçalhos (normalizados) a papéis, com atribuição EXCLUSIVA por prioridade: preço unitário e
 * total antes de unidade/quantidade (evita "PREÇO UNITÁRIO" → unidade); colunas estatísticas nunca viram
 * preço de cotação. Retorna -1 para papéis ausentes.
 */
export function mapHeaderColumns(headersNorm: string[]): ColumnMap {
  const taken = new Set<number>();
  // Colunas estatísticas ficam RESERVADAS (não são preço unitário de cotação).
  headersNorm.forEach((h, i) => { if (isStatHeader(h)) taken.add(i); });
  const pick = (patterns: string[]) => { const i = matchColumn(headersNorm, patterns, taken); if (i >= 0) taken.add(i); return i; };
  const totalPrice  = pick(TOTAL_PRICE_PATTERNS);
  const unitPrice   = pick(UNIT_PRICE_PATTERNS);
  const quantity    = pick(QUANTITY_PATTERNS);
  const brand       = pick(BRAND_PATTERNS);
  const model       = pick(MODEL_PATTERNS);
  const notes       = pick(NOTES_PATTERNS);
  const source      = pick(SOURCE_PATTERNS);
  const supplier    = pick(SUPPLIER_PATTERNS);
  const description = pick(DESCRIPTION_PATTERNS);
  const unit        = pick(UNIT_PATTERNS);
  return { description, quantity, unit, unitPrice, totalPrice, supplier, brand, model, notes, source };
}

/** Uma linha é cabeçalho se casa ≥2 papéis conhecidos, ou se tem ≥3 células não-numéricas não vazias. */
export function looksLikeHeaderCells(cells: string[]): boolean {
  const norm = cells.map(normalizeHeader);
  const m = mapHeaderColumns(norm);
  const roleHits = Object.values(m).filter((i) => i >= 0).length;
  if (roleHits >= 2) return true;
  const nonEmpty = cells.filter(c => (c ?? "").trim() !== "");
  return nonEmpty.length >= 3 && nonEmpty.every(c => !isMoneyLike(c) && !isNumericLike(c));
}

/** Nome do fornecedor a partir do cabeçalho de coluna de preço ("Empresa A (R$)" → "Empresa A"). */
function supplierNameFromHeader(raw: string): string {
  return (raw ?? "").replace(/\(?\s*R\$\s*\)?/gi, "").replace(/\s+/g, " ").trim();
}

export type WideDetection =
  | { kind: "long" }
  | { kind: "wide"; supplierColumns: number[] }
  | { kind: "ambiguous"; candidateColumns: number[]; reason: string };

/**
 * Detecção DETERMINÍSTICA de mapa comparativo. Candidatas = colunas não atribuídas a descrição/
 * quantidade/unidade/marca/modelo/obs./fonte, não estatísticas, não índice, com cabeçalho não vazio e
 * TODOS os valores não vazios numéricos/monetários (≥1 valor). Uma coluna casada como "fornecedor" mas
 * cujos valores são preços também é candidata (ex.: "Fornecedor A" = coluna de preço).
 *   - ≥ 2 candidatas e SEM preço unitário explícito → wide (uma cotação por fornecedor);
 *   - ≥ 2 candidatas e COM preço unitário explícito → ambíguo (não adivinha);
 *   - caso contrário → long.
 */
export function detectWideFormat(headersRaw: string[], dataRows: string[][], map: ColumnMap): WideDetection {
  const headersNorm = headersRaw.map(normalizeHeader);
  const structural = new Set([map.description, map.quantity, map.unit, map.brand, map.model, map.notes, map.source, map.totalPrice].filter((i) => i >= 0));
  const candidates: number[] = [];
  headersNorm.forEach((h, i) => {
    if (!h || structural.has(i) || isStatHeader(h) || isIndexHeader(h)) return;
    if (i === map.unitPrice) return;
    const values = dataRows.map((r) => (r[i] ?? "").trim()).filter((v) => v !== "");
    if (values.length === 0) return;
    if (values.every(isPriceCell)) candidates.push(i);
  });
  if (candidates.length < 2) return { kind: "long" };
  if (map.unitPrice >= 0) {
    return { kind: "ambiguous", candidateColumns: candidates, reason: "Há coluna de preço unitário E múltiplas colunas de preço por fornecedor." };
  }
  return { kind: "wide", supplierColumns: candidates };
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

type RawFields = {
  rawDescription: string | null; rawQuantity: string | null; rawUnit: string | null;
  rawUnitPrice: string | null; rawTotalPrice: string | null;
  rawSupplier?: string | null; rawBrand?: string | null; rawModel?: string | null;
  rawNotes?: string | null; rawSource?: string | null;
  rawTypedValues?: RawTypedValues;
};

/**
 * Matriz PARALELA de valores nativos: para cada célula, o decimal canônico exato quando a célula de origem
 * é NUMÉRICA (XLSX), ou null (texto). CSV/PDF/DOCX não fornecem (tudo é texto localizado).
 */
export type TypedCellMatrix = ReadonlyArray<ReadonlyArray<string | null>>;

function confidenceFor(raw: RawFields) {
  return aggregateConfidence([
    buildFieldConfidence("description", raw.rawDescription ? 0.82 : 0.2),
    buildFieldConfidence("quantity",    raw.rawQuantity    ? 0.78 : 0.3),
    buildFieldConfidence("unit",        raw.rawUnit        ? 0.75 : 0.3),
    buildFieldConfidence("unit_price",  raw.rawUnitPrice   ? 0.80 : 0.3),
    buildFieldConfidence("total_price", raw.rawTotalPrice  ? 0.80 : 0.3),
  ]);
}

/** Constrói item bruto com proveniência, aplicando o limite de itens. */
function pushItem(
  items: RawExtractedItem[], ctx: TabularContext, raw: RawFields,
  location: CellLocation, extras: Partial<Pick<ExtractionProvenance, "sectionTitle" | "tableIndex" | "rawRowData">>,
  rawCellValues: Record<string, unknown>,
  extra: { sheetName?: string; inferredHeaders?: string[]; warnings?: import("../domain/importConfidence").ExtractionWarning[] } = {},
): boolean {
  if (items.length >= ctx.maxItems) return false;
  const provenance = buildProvenance(
    ctx.sourceFileId, ctx.sourceFileName, ctx.sourceMimeType, ctx.sourceChecksum,
    ctx.parserType, ctx.parserVersion, location, extras,
  );
  items.push(createRawItem(
    ctx.importSessionId, raw, provenance,
    {
      parserType: ctx.parserType, parserVersion: ctx.parserVersion, processingMs: 0, rawCellValues,
      pageNumber: location.page, sheetName: extra.sheetName, inferredHeaders: extra.inferredHeaders,
    },
    confidenceFor(raw), extra.warnings ?? [],
  ));
  return true;
}

export interface TabularOutcome {
  items:    RawExtractedItem[];
  warnings: ImportWarning[];
  rowsRead: number;
  skipped:  number;
}

export interface TableOptions {
  /** Sem cabeçalho: usar ordem posicional 0-4 (PDF/DOCX) ou só a coluna 0 como descrição (CSV/XLSX). */
  positionalFallback: "five_columns" | "description_only";
  /** Força a linha de cabeçalho (0-based), quando informada pelo operador. */
  headerRow?: number;
  sheetName?: string;
}

/** Localiza a linha de cabeçalho entre as 5 primeiras (ou a forçada). -1 se não houver. */
function findHeaderRow(matrix: string[][], forced?: number): number {
  if (forced !== undefined && forced >= 0 && forced < matrix.length) return forced;
  for (let i = 0; i < Math.min(5, matrix.length); i++) {
    const row = matrix[i] ?? [];
    if (row.filter((c) => (c ?? "").trim() !== "").length < 2) continue;
    if (looksLikeHeaderCells(row)) return i;
    const numeric = row.filter((c) => c && !isNaN(Number(String(c).replace(/[R$.,\s]/g, "")))).length;
    if (numeric / row.length < 0.5 && row.filter((c) => (c ?? "").trim() !== "").length >= 2) return i;
  }
  return -1;
}

/**
 * Converte uma MATRIZ de células (planilha, tabela DOCX, getTable do PDF) em itens brutos. Fonte ÚNICA
 * usada por CSV/XLSX/PDF/DOCX. `locate(dataRowIdx, colIdx?)` fornece a localização/proveniência.
 */
export function tableToRawItems(
  matrixIn: string[][], ctx: TabularContext, opts: TableOptions,
  locate: (rowIdx: number, colIdx?: number) => { location: CellLocation; extras: Partial<Pick<ExtractionProvenance, "sectionTitle" | "tableIndex" | "rawRowData">> },
  typed?: TypedCellMatrix,
): TabularOutcome {
  const typedAt = (r: number, idx: number): string | null => (idx >= 0 ? (typed?.[r]?.[idx] ?? null) : null);
  const typedFor = (r: number, cols: { rawQuantity?: number; rawUnitPrice?: number; rawTotalPrice?: number }): RawTypedValues | undefined => {
    const out: Record<string, { type: "number"; value: string }> = {};
    for (const [k, c] of Object.entries(cols)) {
      const v = c === undefined ? null : typedAt(r, c);
      if (v !== null) out[k] = { type: "number", value: v };
    }
    return Object.keys(out).length ? (out as RawTypedValues) : undefined;
  };
  const items: RawExtractedItem[] = [];
  const warnings: ImportWarning[] = [];
  let skipped = 0, rowsRead = 0;
  const matrix = matrixIn.map((r) => (r ?? []).map((c) => String(c ?? "").trim()));
  if (matrix.length === 0) return { items, warnings, rowsRead, skipped };

  const headerRowIdx = findHeaderRow(matrix, opts.headerRow);
  const headersRaw = headerRowIdx >= 0 ? matrix[headerRowIdx] : [];
  const headersNorm = headersRaw.map(normalizeHeader);
  if (headerRowIdx < 0) warnings.push({ code: "HEADER_INFERENCE", message: "Cabeçalho não identificado; usando ordem posicional das colunas.", severity: "warning" });

  let map: ColumnMap;
  if (headersNorm.length) map = mapHeaderColumns(headersNorm);
  else if (opts.positionalFallback === "five_columns") map = { description: 0, quantity: 1, unit: 2, unitPrice: 3, totalPrice: 4, supplier: -1, brand: -1, model: -1, notes: -1, source: -1 };
  else map = { description: 0, quantity: -1, unit: -1, unitPrice: -1, totalPrice: -1, supplier: -1, brand: -1, model: -1, notes: -1, source: -1 };

  const startRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
  const dataRows = matrix.slice(startRow);
  const wide = headersNorm.length ? detectWideFormat(headersRaw, dataRows, map) : { kind: "long" as const };
  if (wide.kind === "wide") {
    warnings.push({
      code: "WIDE_FORMAT_EXPANDED",
      message: `Mapa comparativo reconhecido: ${wide.supplierColumns.length} colunas de fornecedor expandidas em uma cotação por fornecedor.`,
      severity: "info",
    });
  } else if (wide.kind === "ambiguous") {
    warnings.push({
      code: "WIDE_FORMAT_AMBIGUOUS",
      message: `Estrutura ambígua (${wide.reason}) — nenhuma expansão automática; revise as colunas de preço manualmente.`,
      severity: "warning",
    });
  }
  // Coluna casada como "fornecedor" cujos VALORES são preços (ex.: "Empresa A") é coluna de PREÇO, não o
  // nome do fornecedor — nunca gravar "100,00" como fornecedor (no largo vira cotação; no ambíguo, revisão).
  if (wide.kind !== "long" && map.supplier >= 0) {
    const priceCols = wide.kind === "wide" ? wide.supplierColumns : wide.candidateColumns;
    if (priceCols.includes(map.supplier)) map = { ...map, supplier: -1 };
  }
  const at = (row: string[], idx: number) => (idx >= 0 && idx < row.length ? (row[idx] || null) : null);
  const headerKeys = headersRaw.map((h, i) => h || `col${i}`);

  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r];
    rowsRead++;
    if (row.every(c => c === "")) { skipped++; continue; }
    const rawDescription = at(row, map.description);
    if (!rawDescription) { skipped++; continue; }
    const base = {
      rawDescription,
      rawQuantity: at(row, map.quantity),
      rawUnit:     at(row, map.unit),
      rawBrand:    at(row, map.brand),
      rawModel:    at(row, map.model),
      rawNotes:    at(row, map.notes),
      rawSource:   at(row, map.source),
    };
    const rawCellValues = Object.fromEntries(row.map((c, i) => [headerKeys[i] ?? `col${i}`, c]));
    const pushExtra = { sheetName: opts.sheetName, inferredHeaders: headersRaw.length ? headersRaw : undefined };

    if (wide.kind === "wide") {
      // Uma cotação POR FORNECEDOR com valor; fornecedor = cabeçalho da coluna de preço.
      let pushed = 0;
      for (const col of wide.supplierColumns) {
        const value = at(row, col);
        if (!value) continue;
        const { location, extras } = locate(r, col);
        const ok = pushItem(items, ctx, {
          ...base, rawUnitPrice: value, rawTotalPrice: null, rawSupplier: supplierNameFromHeader(headersRaw[col]) || null,
          rawTypedValues: typedFor(r, { rawQuantity: map.quantity, rawUnitPrice: col }),
        }, location, { ...extras, rawRowData: row }, rawCellValues, {
          ...pushExtra,
          warnings: [{ code: "WIDE_FORMAT_EXPANDED", message: `Cotação expandida da coluna "${headersRaw[col]}".`, severity: "info", field: "supplier" }],
        });
        if (!ok) { warnings.push({ code: "TRUNCATED_VALUE", message: `Limite de ${ctx.maxItems} itens atingido; linhas adicionais ignoradas.`, severity: "warning" }); return { items, warnings, rowsRead, skipped }; }
        pushed++;
      }
      if (pushed === 0) {
        // Linha sem nenhum preço: o item não é perdido — vai para revisão sem valor.
        const { location, extras } = locate(r);
        pushItem(items, ctx, { ...base, rawUnitPrice: null, rawTotalPrice: null, rawSupplier: null }, location, { ...extras, rawRowData: row }, rawCellValues, {
          ...pushExtra, warnings: [{ code: "EMPTY_FIELD", message: "Nenhum preço de fornecedor nesta linha do mapa.", severity: "warning", field: "unit_price" }],
        });
      }
      continue;
    }

    const { location, extras } = locate(r);
    const ok = pushItem(items, ctx, {
      ...base,
      rawUnitPrice:  at(row, map.unitPrice),
      rawTotalPrice: at(row, map.totalPrice),
      rawSupplier:   at(row, map.supplier),
      rawTypedValues: typedFor(r, { rawQuantity: map.quantity, rawUnitPrice: map.unitPrice, rawTotalPrice: map.totalPrice }),
    }, location, { ...extras, rawRowData: row }, rawCellValues, pushExtra);
    if (!ok) {
      warnings.push({ code: "TRUNCATED_VALUE", message: `Limite de ${ctx.maxItems} itens atingido; linhas adicionais ignoradas.`, severity: "warning" });
      break;
    }
  }
  return { items, warnings, rowsRead, skipped };
}

/**
 * Converte uma MATRIZ de células já segmentada (DOCX/PDF-getTable) em itens brutos. Mantido por
 * compatibilidade — delega a `tableToRawItems` (fallback posicional de 5 colunas).
 */
export function matrixToRawItems(
  matrix: string[][], ctx: TabularContext,
  locate: (dataRowIdx: number) => { location: CellLocation; extras: Partial<Pick<ExtractionProvenance, "sectionTitle" | "tableIndex" | "rawRowData">> },
): TabularOutcome {
  return tableToRawItems(matrix, ctx, { positionalFallback: "five_columns" }, (r, col) => {
    const loc = locate(r);
    return col === undefined ? loc : { ...loc, location: { ...loc.location, column: col + 1 } };
  });
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
    if ((cells.length >= 2 && looksLikeHeaderCells(cells)) || looksLikeHeaderCells(line.split(/\s+/))) {
      headerSeen = true; skipped++; continue;
    }
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
