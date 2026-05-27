/**
 * Sprint 2.8 — Confidence Infrastructure Foundation.
 *
 * O sistema NUNCA deve esconder incerteza.
 * Cada item extraído carrega metadados de confiança explícitos.
 */

// ─── Confidence levels ────────────────────────────────────────────────────────

export type ConfidenceLevel =
  | "high"       // ≥ 0.85 — campo claramente estruturado
  | "medium"     // ≥ 0.60 — campo reconhecível mas ambíguo
  | "low"        // ≥ 0.35 — campo com incerteza significativa
  | "uncertain"; // < 0.35 — requer revisão obrigatória

export function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 0.85) return "high";
  if (score >= 0.60) return "medium";
  if (score >= 0.35) return "low";
  return "uncertain";
}

// ─── Warning types ────────────────────────────────────────────────────────────

export type ExtractionWarningCode =
  | "EMPTY_FIELD"
  | "AMBIGUOUS_UNIT"
  | "AMBIGUOUS_PRICE"
  | "MERGED_CELL"
  | "SPARSE_ROW"
  | "HEADER_INFERENCE"
  | "LOCALE_AMBIGUITY"
  | "DUPLICATE_ROW"
  | "TRUNCATED_VALUE"
  | "ENCODING_ISSUE"
  | "FORMULA_CELL"
  | "NON_NUMERIC_PRICE"
  | "ZERO_QUANTITY"
  | "NEGATIVE_VALUE"
  | "UNKNOWN_UNIT"
  | "PRICE_MISMATCH";   // unit_price * qty ≠ total_price

export type ExtractionErrorCode =
  | "PARSER_FAILURE"
  | "SHEET_NOT_FOUND"
  | "HEADER_NOT_FOUND"
  | "CORRUPT_FILE"
  | "UNSUPPORTED_FORMAT"
  | "SIZE_EXCEEDED"
  | "ENCODING_FAILURE"
  | "EMPTY_FILE"
  | "PERMISSION_DENIED"
  | "TENANT_MISMATCH";

export interface ExtractionWarning {
  code:      ExtractionWarningCode;
  message:   string;
  severity:  "info" | "warning";
  field?:    string;
  rawValue?: string;
  location?: string;
}

export interface ExtractionError {
  code:     ExtractionErrorCode;
  message:  string;
  fatal:    boolean;
  location?: string;
  cause?:   string;
}

// ─── Confidence metadata per item ─────────────────────────────────────────────

export interface FieldConfidence {
  field:   string;
  score:   number;
  level:   ConfidenceLevel;
  reasons: string[];
}

export interface ConfidenceMetadata {
  overallScore:     number;         // 0–1 média ponderada dos campos
  overallLevel:     ConfidenceLevel;
  requiresReview:   boolean;        // true se overallScore < 0.60 ou há warnings críticos
  fieldConfidences: FieldConfidence[];
  uncertaintyMarkers: string[];     // lista de fatores que reduziram a confiança
  conflictMarkers:    string[];     // e.g. "unit_price * qty ≠ total_price"
}

// ─── Builders ─────────────────────────────────────────────────────────────────

export function buildFieldConfidence(
  field:   string,
  score:   number,
  reasons: string[] = [],
): FieldConfidence {
  return { field, score, level: scoreToLevel(score), reasons };
}

export function aggregateConfidence(fields: FieldConfidence[]): ConfidenceMetadata {
  const scored = fields.filter(f => f.score >= 0);
  const overallScore = scored.length > 0
    ? scored.reduce((sum, f) => sum + f.score, 0) / scored.length
    : 0;

  const uncertaintyMarkers = fields
    .filter(f => f.level === "uncertain" || f.level === "low")
    .map(f => `${f.field}:${f.level}(${f.score.toFixed(2)})`);

  return {
    overallScore,
    overallLevel:      scoreToLevel(overallScore),
    requiresReview:    overallScore < 0.60 || uncertaintyMarkers.length > 0,
    fieldConfidences:  fields,
    uncertaintyMarkers,
    conflictMarkers:   [],
  };
}

export function withConflict(meta: ConfidenceMetadata, conflict: string): ConfidenceMetadata {
  return {
    ...meta,
    conflictMarkers: [...meta.conflictMarkers, conflict],
    requiresReview:  true,
    overallScore:    Math.max(0, meta.overallScore - 0.15),
    overallLevel:    scoreToLevel(Math.max(0, meta.overallScore - 0.15)),
  };
}

// ─── Empty/stub confidence for rows with no data ──────────────────────────────

export const EMPTY_CONFIDENCE: ConfidenceMetadata = {
  overallScore:     0,
  overallLevel:     "uncertain",
  requiresReview:   true,
  fieldConfidences: [],
  uncertaintyMarkers: ["no_data"],
  conflictMarkers:  [],
};
