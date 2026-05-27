/**
 * Sprint 2.8 — Import Foundation Layer.
 * Tipos oficiais do aggregate ImportSession e ecossistema de importação.
 */

// ─── ImportSession lifecycle ──────────────────────────────────────────────────

export type ImportSessionStatus =
  | "uploaded"        // arquivo recebido, aguardando fila
  | "queued"          // na fila de processamento
  | "parsing"         // parser em execução
  | "extracted"       // extração bruta concluída
  | "normalized"      // normalização de unidades/valores concluída
  | "awaiting_review" // aguardando revisão humana
  | "approved"        // aprovado pelo revisor
  | "rejected"        // rejeitado pelo revisor
  | "failed"          // falha (retry possível até maxRetries)
  | "archived";       // arquivado (terminal)

export type ImportType =
  | "price_research"  // pesquisa de preço (planilha XLSX/CSV)
  | "tr_items"        // itens de TR existente (DOCX/PDF)
  | "catmat"          // catálogo CATMAT/CATSER importado
  | "generic";        // arquivo genérico não classificado

export type ParserType =
  | "xlsx"
  | "xls"
  | "csv"
  | "docx"
  | "pdf"
  | "auto";           // detecção automática por mime/extensão

// ─── Session flow helpers ─────────────────────────────────────────────────────

/** Transições válidas do lifecycle de ImportSession */
export const IMPORT_TRANSITIONS: Record<ImportSessionStatus, ImportSessionStatus[]> = {
  uploaded:        ["queued", "failed", "archived"],
  queued:          ["parsing", "failed", "archived"],
  parsing:         ["extracted", "failed"],
  extracted:       ["normalized", "failed"],
  normalized:      ["awaiting_review", "failed"],
  awaiting_review: ["approved", "rejected"],
  approved:        ["archived"],
  rejected:        ["uploaded", "archived"], // upload pode ser reprocessado
  failed:          ["queued", "archived"],   // retry vai para queued
  archived:        [],
};

export function isValidImportTransition(from: ImportSessionStatus, to: ImportSessionStatus): boolean {
  return IMPORT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalStatus(status: ImportSessionStatus): boolean {
  return status === "approved" || status === "archived";
}

export function canRetry(status: ImportSessionStatus, retryCount: number, maxRetries = 3): boolean {
  return status === "failed" && retryCount < maxRetries;
}

// ─── Warning / Error shapes ───────────────────────────────────────────────────

export type WarningSeverity = "info" | "warning" | "error" | "critical";

export interface ImportWarning {
  code:     string;
  message:  string;
  severity: WarningSeverity;
  location?: string; // e.g. "sheet:Planilha1, row:12"
  field?:    string;
  raw?:      string;
}

export interface ImportError {
  code:      string;
  message:   string;
  fatal:     boolean;
  location?: string;
  cause?:    string;
}

// ─── Extraction summary ───────────────────────────────────────────────────────

export interface ExtractionSummary {
  totalRowsRead:      number;
  totalItemsExtracted: number;
  totalItemsSkipped:   number;
  totalWarnings:       number;
  totalErrors:         number;
  sheetsProcessed?:    number;
  pagesProcessed?:     number;
  averageConfidence:   number; // 0–1
  processingMs:        number;
  parserType:          string;
  parserVersion:       string;
}

// ─── MIME type registry ───────────────────────────────────────────────────────

export const ALLOWED_MIME_TYPES: Record<string, ParserType> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel":                                           "xls",
  "text/csv":                                                           "csv",
  "application/csv":                                                    "csv",
  "text/plain":                                                         "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword":                                                  "docx",
  "application/pdf":                                                     "pdf",
};

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function detectParserType(mimeType: string, filename: string): ParserType | null {
  if (ALLOWED_MIME_TYPES[mimeType]) return ALLOWED_MIME_TYPES[mimeType];
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const extMap: Record<string, ParserType> = {
    xlsx: "xlsx", xls: "xls", csv: "csv",
    docx: "docx", doc: "docx", pdf: "pdf",
  };
  return extMap[ext] ?? null;
}
