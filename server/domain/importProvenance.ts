/**
 * Sprint 2.8 — Extraction Provenance Foundation.
 * Rastreabilidade completa de onde cada item foi extraído.
 * Permite replay, reprocessamento e auditoria.
 */

// ─── Source location ──────────────────────────────────────────────────────────

export interface CellLocation {
  sheet?:  string;
  page?:   number;
  row?:    number;
  column?: number | string; // número ou letra (A, B, C...)
  cell?:   string;          // ex: "B12", "C:D merge"
}

export interface ExtractionProvenance {
  // Arquivo fonte
  sourceFileId:    string;   // storage key
  sourceFileName:  string;
  sourceMimeType:  string;
  sourceChecksum:  string;   // SHA-256 do arquivo original

  // Localização na fonte
  location:        CellLocation;

  // Parser utilizado
  parserType:      string;
  parserVersion:   string;
  extractedAt:     string;   // ISO timestamp

  // Contexto adicional
  sectionTitle?:   string;   // título da seção (PDF/DOCX)
  tableIndex?:     number;   // índice da tabela dentro da página/seção
  rawRowData?:     string[]; // linha bruta completa para replay
}

// ─── Lineage chain ─────────────────────────────────────────────────────────────

export interface ExtractionLineage {
  importSessionId: number;
  provenance:      ExtractionProvenance;
  transformations: TransformationRecord[];
}

export interface TransformationRecord {
  step:        string;       // e.g. "unit_normalization", "price_parsing"
  appliedAt:   string;
  before:      unknown;
  after:       unknown;
  confidence:  number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatLocation(loc: CellLocation): string {
  const parts: string[] = [];
  if (loc.sheet) parts.push(`sheet:${loc.sheet}`);
  if (loc.page  !== undefined) parts.push(`page:${loc.page}`);
  if (loc.row   !== undefined) parts.push(`row:${loc.row}`);
  if (loc.column !== undefined) parts.push(`col:${loc.column}`);
  if (loc.cell) parts.push(`cell:${loc.cell}`);
  return parts.length > 0 ? parts.join(", ") : "location:unknown";
}

export function buildProvenance(
  fileId:       string,
  fileName:     string,
  mimeType:     string,
  checksum:     string,
  parserType:   string,
  parserVersion: string,
  location:     CellLocation,
  extras?:      Partial<Pick<ExtractionProvenance, "sectionTitle" | "tableIndex" | "rawRowData">>,
): ExtractionProvenance {
  return {
    sourceFileId:   fileId,
    sourceFileName: fileName,
    sourceMimeType: mimeType,
    sourceChecksum: checksum,
    location,
    parserType,
    parserVersion,
    extractedAt:    new Date().toISOString(),
    ...extras,
  };
}
