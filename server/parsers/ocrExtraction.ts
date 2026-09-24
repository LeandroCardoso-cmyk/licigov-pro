/**
 * U2A-OCR — Página reconhecida por OCR → itens brutos, pelo MESMO parser tabular canônico.
 *
 *   OcrPageResult → PositionedTextToken (source "ocr") → reconstructPageTable (a MESMA reconstrução geométrica
 *                   do texto nativo do PDF — Layout v2) → tableToRawItems (canônico)
 *                 → anotação de incerteza (confiança por campo, avisos, texto bruto da linha)
 *   Página sem tabela reconhecível pela geometria (sem linhas-âncora com valores) → fallback de linhas
 *   (`buildOcrPageLayout` v1 → matrixToRawItems | linesToRawItems), como o texto nativo cai nas linhas do getText.
 *
 * Não há segunda materialização nem regra de negócio específica de OCR: o que muda é só a ORIGEM do texto,
 * registrada em cada item (parserMetadata.extractionMode = "ocr" + rawMetadata.ocr). Valores ficam BRUTOS
 * (o contrato monetário decide no staging/promoção; ambíguo ⇒ bloqueia, nunca adivinha).
 */
import type { OcrPageResult } from "../domain/ocr";
import type { RawExtractedItem } from "../domain/importExtraction";
import type { ExtractionWarning } from "../domain/importConfidence";
import { aggregateConfidence, buildFieldConfidence } from "../domain/importConfidence";
import type { ImportWarning } from "../domain/importTypes";
import { buildOcrPageLayout, isSuspiciousNumericToken, type OcrRowMeta } from "./ocrLayout";
import { linesToRawItems, mapHeaderColumns, matrixToRawItems, normalizeHeader, type TabularContext, type TabularOutcome } from "./tabularExtraction";
import { tokensFromOcrPage } from "./layout/positionedText";
import { reconstructPageTable, type PageLayoutResult } from "./layout/tableLayoutReconstructor";
import { extractItemsFromLayoutTable, layoutWarningsToImport, type LayoutTableValidation } from "./layout/layoutExtraction";

type FieldKey = "description" | "quantity" | "unit" | "unit_price" | "total_price";
const RAW_OF: Record<FieldKey, keyof RawExtractedItem> = {
  description: "rawDescription", quantity: "rawQuantity", unit: "rawUnit", unit_price: "rawUnitPrice", total_price: "rawTotalPrice",
};
const NUMERIC_FIELDS: FieldKey[] = ["quantity", "unit_price", "total_price"];

export interface OcrExtractionOptions {
  minConfidence: number;
  engine:        string;
  engineVersion: string;
}

function minConf(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? Math.min(...v) : null;
}

export interface OcrPageExtraction extends TabularOutcome {
  /** Reconstrução geométrica da página (mesma do texto nativo). */
  layout:     PageLayoutResult;
  validation: LayoutTableValidation | null;
}

/** Reconstrução geométrica de uma página do OCR (mesma do texto nativo) — exposta para a decisão por documento. */
export function reconstructOcrPage(page: OcrPageResult): PageLayoutResult {
  return reconstructPageTable(tokensFromOcrPage(page), { page: page.pageNumber });
}

export function extractItemsFromOcrPage(
  page: OcrPageResult, ctx: TabularContext, o: OcrExtractionOptions,
  opts: { geometric?: PageLayoutResult; allowLinesFallback?: boolean } = {},
): OcrPageExtraction {
  // 1) Caminho CONVERGENTE: palavras do OCR → tokens posicionados → MESMA reconstrução do texto nativo.
  const geometric = opts.geometric ?? reconstructOcrPage(page);
  if (geometric.table) {
    const res = extractItemsFromLayoutTable(geometric.table, ctx, { tableIndex: 0, source: "ocr" });
    const table = res.table;
    const offset = table.header ? 1 : 0;
    const m = table.header ? mapHeaderColumns(table.header.map(normalizeHeader)) : null;
    const fieldCol: Partial<Record<FieldKey, number>> = m
      ? { description: m.description, quantity: m.quantity, unit: m.unit, unit_price: m.unitPrice, total_price: m.totalPrice }
      : { description: 0, quantity: 1, unit: 2, unit_price: 3, total_price: 4 };
    annotateOcr(res.items, page, o, (row) => table.rowMeta[row - offset], fieldCol, true);
    const warnings = [...layoutWarningsToImport(geometric), ...res.warnings];
    return { items: res.items, warnings, rowsRead: res.rowsRead, skipped: res.skipped, layout: geometric, validation: res.validation };
  }

  // Documento com tabela de itens em outra página: esta página (assinatura/identificação) não gera itens.
  if (opts.allowLinesFallback === false) return { items: [], warnings: [], rowsRead: 0, skipped: 0, layout: geometric, validation: null };

  // 2) Fallback de linhas (página sem linhas-âncora tabulares): geometria v1 do OCR.
  const layout = buildOcrPageLayout(page);
  if (layout.kind === "empty") return { items: [], warnings: [], rowsRead: 0, skipped: 0, layout: geometric, validation: null };

  let out: TabularOutcome;
  let fieldCol: Partial<Record<FieldKey, number>> = {};
  if (layout.kind === "table") {
    out = matrixToRawItems(layout.matrix, ctx, (r) => ({ location: { page: page.pageNumber, row: r + 1 }, extras: {} }));
    const m = mapHeaderColumns(layout.matrix[0].map(normalizeHeader));
    fieldCol = { description: m.description, quantity: m.quantity, unit: m.unit, unit_price: m.unitPrice, total_price: m.totalPrice };
  } else {
    out = linesToRawItems(layout.lines, ctx, (i) => ({ location: { page: page.pageNumber, row: i + 1 }, extras: {} }));
  }
  annotateOcr(out.items, page, o, (row) => layout.rowMeta[row], fieldCol, layout.kind === "table");

  const pageWarnings: ImportWarning[] = out.warnings.map((w) => ({ ...w, location: w.location ?? `page:${page.pageNumber}` }));
  return { ...out, warnings: pageWarnings, layout: geometric, validation: null };
}

/** Metadado mínimo de uma linha lógica para anotar a incerteza do OCR (comum às duas geometrias). */
type OcrMetaLike = Pick<OcrRowMeta, "lineText" | "confidence" | "mergedContinuation" | "spansColumns" | "bbox">;

/**
 * Anota cada item com a incerteza do OCR: confiança por campo (mínimo das palavras da célula), valor com
 * caractere suspeito, descrição unida de várias linhas, célula que atravessa colunas e o texto bruto da linha.
 */
function annotateOcr(
  items: TabularOutcome["items"], page: OcrPageResult, o: OcrExtractionOptions,
  metaOf: (row: number) => OcrMetaLike | undefined, fieldCol: Partial<Record<FieldKey, number>>, byColumn: boolean,
): void {
  for (const item of items) {
    const row = (item.sourceLocation.location.row ?? 0) - 1;
    const meta = metaOf(row);
    if (!meta) continue;
    // Mapa comparativo: o preço unitário vem da coluna do fornecedor (location.column, 1-based).
    const column = typeof item.sourceLocation.location.column === "number" ? item.sourceLocation.location.column - 1 : undefined;
    const cols: Partial<Record<FieldKey, number>> = { ...fieldCol, ...(column !== undefined ? { unit_price: column } : {}) };
    const rowConfidence = minConf(meta.confidence);
    const confOf = (f: FieldKey): number | null => {
      const c = cols[f];
      return byColumn && c !== undefined && c >= 0 ? meta.confidence[c] ?? null : rowConfidence;
    };

    const warnings: ExtractionWarning[] = [{
      code: "OCR_EXTRACTED", severity: "info",
      message: `Linha reconhecida por OCR (página ${page.pageNumber}${rowConfidence !== null ? `, confiança ${Math.round(rowConfidence)}%` : ""}). Confira com o documento original.`,
      location: `page:${page.pageNumber}, row:${row + 1}`,
    }];
    for (const f of Object.keys(RAW_OF) as FieldKey[]) {
      const value = item[RAW_OF[f]] as string | null | undefined;
      if (!value) continue;
      const c = confOf(f);
      if (c !== null && c < o.minConfidence) {
        warnings.push({ code: "OCR_LOW_CONFIDENCE", severity: "warning", field: f, rawValue: String(value).slice(0, 80), message: `Baixa confiança do OCR (${Math.round(c)}%) no campo "${f}". Confira o valor.` });
      }
      if (NUMERIC_FIELDS.includes(f) && isSuspiciousNumericToken(value)) {
        warnings.push({ code: "OCR_AMBIGUOUS_VALUE", severity: "warning", field: f, rawValue: String(value).slice(0, 80), message: `Valor com caractere suspeito para número ("${String(value).slice(0, 30)}") — não foi corrigido automaticamente; corrija na revisão.` });
      }
    }
    if (meta.mergedContinuation) {
      warnings.push({ code: "OCR_MULTILINE_MERGED", severity: "warning", field: "description", message: "Descrição continuada em mais de uma linha foi unida — confira o texto." });
    }
    if (meta.spansColumns && !item.extractionWarnings.some((w) => w.code === "MERGED_CELL")) {
      warnings.push({ code: "MERGED_CELL", severity: "warning", message: "OCR: um trecho da linha ocupa mais de uma coluna — confira a atribuição das colunas." });
    }
    item.extractionWarnings = [...item.extractionWarnings, ...warnings];

    // Confiança do item = mínimo entre a heurística estrutural e a confiança do OCR de cada campo.
    item.confidenceMetadata = aggregateConfidence(item.confidenceMetadata.fieldConfidences.map((fc) => {
      const c = confOf(fc.field as FieldKey);
      return c === null ? fc : buildFieldConfidence(fc.field, Math.min(fc.score, c / 100), [...fc.reasons, `ocr:${Math.round(c)}`]);
    }));
    item.confidenceMetadata.requiresReview = true;

    item.parserMetadata = {
      ...item.parserMetadata, extractionMode: "ocr",
      ocr: { engine: o.engine, engineVersion: o.engineVersion, rowConfidence },
    };
    item.rawMetadata = {
      ...item.rawMetadata,
      ocr: { pageNumber: page.pageNumber, lineText: meta.lineText.slice(0, 2000), rowConfidence, bbox: meta.bbox },
    };
  }
}
