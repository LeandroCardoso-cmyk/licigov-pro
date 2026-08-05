/**
 * PR B.2.2 — Tipos e helpers PUROS do staging (testáveis sem DOM).
 *
 * Provenance (origem do dado) e confidence (confiança da extração) chegam como JSON solto do
 * backend; aqui os normalizamos de forma defensiva para exibição institucional.
 */

export type ReviewStatus = "pending" | "approved" | "rejected" | "skipped";
/** Ações de revisão humana disponíveis na B.2.1 (sem correção de valores). */
export type ReviewAction = "approved" | "rejected" | "skipped";

export interface StagingItem {
  id: number;
  rawDescription: string | null;
  rawQuantity: string | null;
  rawUnit: string | null;
  rawUnitPrice: string | null;
  rawTotalPrice: string | null;
  sourceLocation: unknown;
  confidenceMetadata: unknown;
  extractionWarnings: unknown;
  reviewStatus: ReviewStatus;
  reviewedBy: number | null;
  reviewedAt: string | Date | null;
  reviewNote: string | null;
}

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending:  "Pendente",
  approved: "Aceito",
  rejected: "Rejeitado",
  skipped:  "Pulado",
};

/** Extrai um score de confiança 0–1 de um metadado solto, se houver. */
export function extractConfidence(meta: unknown): number | null {
  if (meta == null || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const candidate = m.averageConfidence ?? m.score ?? m.confidence ?? m.overall;
  if (typeof candidate === "number" && candidate >= 0 && candidate <= 1) return candidate;
  return null;
}

/** Formata a origem do dado (planilha/linha/página) para exibição, sem vazar estrutura interna. */
export function formatProvenance(loc: unknown): string | null {
  if (loc == null || typeof loc !== "object") return null;
  const l = loc as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof l.sheet === "string") parts.push(`planilha "${l.sheet}"`);
  if (typeof l.page === "number") parts.push(`página ${l.page}`);
  if (typeof l.row === "number") parts.push(`linha ${l.row}`);
  if (typeof l.line === "number") parts.push(`linha ${l.line}`);
  if (typeof l.cell === "string") parts.push(`célula ${l.cell}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Normaliza advertências de extração de um item em uma lista de mensagens. */
export function extractItemWarnings(w: unknown): string[] {
  if (!Array.isArray(w)) return [];
  return w
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.message === "string") return e.message;
        if (typeof e.code === "string") return e.code;
      }
      return null;
    })
    .filter((x): x is string => !!x);
}
