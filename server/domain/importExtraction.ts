/**
 * Sprint 2.8 — Raw Extraction Model.
 *
 * PRINCÍPIO CRÍTICO: extração bruta NUNCA persiste diretamente no domínio final.
 * Todo item passa por staging → validação → normalização → revisão → aprovação.
 *
 * RawExtractedItem é o snapshot imutável do que o parser encontrou na fonte.
 */
import { nanoid } from "nanoid";
import type { ExtractionProvenance } from "./importProvenance";
import type { ConfidenceMetadata, ExtractionWarning, ExtractionError } from "./importConfidence";

// ─── Parser metadata ──────────────────────────────────────────────────────────

export interface ParserMetadata {
  parserType:       string;
  parserVersion:    string;
  processingMs:     number;
  rawCellValues:    Record<string, unknown>;  // valores brutos das células (coluna → valor)
  inferredHeaders?: string[];                 // cabeçalhos inferidos pelo parser
  sheetName?:       string;
  pageNumber?:      number;
}

// ─── Raw extracted item ───────────────────────────────────────────────────────

export interface RawExtractedItem {
  id:                string;          // UUID local para staging (nunca é PK de domínio)
  importSessionId:   number;

  // Campos brutos — exatamente como vieram da fonte
  rawDescription:    string | null;
  rawQuantity:       string | null;
  rawUnit:           string | null;
  rawUnitPrice:      string | null;
  rawTotalPrice:     string | null;
  rawMetadata:       Record<string, unknown>; // campos extras da linha/tabela

  // Rastreabilidade
  sourceLocation:    ExtractionProvenance;
  parserMetadata:    ParserMetadata;

  // Confiança e qualidade
  confidenceMetadata: ConfidenceMetadata;
  extractionWarnings: ExtractionWarning[];
  extractionErrors:   ExtractionError[];
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createRawItem(
  importSessionId:   number,
  raw: Partial<Pick<RawExtractedItem,
    "rawDescription" | "rawQuantity" | "rawUnit" | "rawUnitPrice" | "rawTotalPrice" | "rawMetadata"
  >>,
  provenance:   ExtractionProvenance,
  parser:       ParserMetadata,
  confidence:   ConfidenceMetadata,
  warnings:     ExtractionWarning[] = [],
  errors:       ExtractionError[]   = [],
): RawExtractedItem {
  return {
    id:                nanoid(),
    importSessionId,
    rawDescription:    raw.rawDescription    ?? null,
    rawQuantity:       raw.rawQuantity       ?? null,
    rawUnit:           raw.rawUnit           ?? null,
    rawUnitPrice:      raw.rawUnitPrice      ?? null,
    rawTotalPrice:     raw.rawTotalPrice     ?? null,
    rawMetadata:       raw.rawMetadata       ?? {},
    sourceLocation:    provenance,
    parserMetadata:    parser,
    confidenceMetadata: confidence,
    extractionWarnings: warnings,
    extractionErrors:   errors,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function hasExtractionErrors(item: RawExtractedItem): boolean {
  return item.extractionErrors.some(e => e.fatal);
}

export function isItemReviewable(item: RawExtractedItem): boolean {
  return !hasExtractionErrors(item) && item.rawDescription !== null;
}

export function summarizeItems(items: RawExtractedItem[]): {
  total:         number;
  reviewable:    number;
  skipped:       number;
  avgConfidence: number;
} {
  const reviewable    = items.filter(isItemReviewable).length;
  const avgConfidence = items.length > 0
    ? items.reduce((s, i) => s + i.confidenceMetadata.overallScore, 0) / items.length
    : 0;
  return {
    total:      items.length,
    reviewable,
    skipped:    items.length - reviewable,
    avgConfidence,
  };
}
