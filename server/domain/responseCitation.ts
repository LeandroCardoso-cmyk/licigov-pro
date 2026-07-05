import { createHash } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CitationType =
  | "direct_quote"
  | "paraphrase"
  | "legal_reference"
  | "data_reference"
  | "cross_reference";

export interface ResponseCitation {
  readonly id: string;
  readonly organizationId: number;
  readonly responseId: string;
  readonly evidenceId: string | null;
  readonly chunkId: string | null;
  readonly citationText: string;
  readonly sourceDocument: string;
  readonly page: number | null;
  readonly section: string | null;
  readonly similarity: number;
  readonly citationType: CitationType;
  readonly createdAt: string;
}

// ─── Functions ──────────────────────────────────────────────────────────────

export function createCitation(params: {
  organizationId: number;
  responseId: string;
  evidenceId?: string | null;
  chunkId?: string | null;
  citationText: string;
  sourceDocument: string;
  page?: number | null;
  section?: string | null;
  similarity?: number;
  citationType: CitationType;
}): ResponseCitation {
  const id = createHash("sha256")
    .update(`rc:${params.organizationId}:${params.responseId}:${params.citationText}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    responseId: params.responseId,
    evidenceId: params.evidenceId ?? null,
    chunkId: params.chunkId ?? null,
    citationText: params.citationText,
    sourceDocument: params.sourceDocument,
    page: params.page ?? null,
    section: params.section ?? null,
    similarity: params.similarity ?? 0,
    citationType: params.citationType,
    createdAt: new Date().toISOString(),
  };
}

export function formatForDisplay(citation: ResponseCitation): string {
  const parts: string[] = [];
  parts.push(`[${citation.sourceDocument}`);
  if (citation.page !== null) {
    parts.push(`, p. ${citation.page}`);
  }
  if (citation.section !== null) {
    parts.push(`, ${citation.section}`);
  }
  return `${parts.join("")}] ${citation.citationText}`;
}

export function groupBySource(citations: readonly ResponseCitation[]): Map<string, ResponseCitation[]> {
  const grouped = new Map<string, ResponseCitation[]>();
  for (const citation of citations) {
    const existing = grouped.get(citation.sourceDocument);
    if (existing) {
      existing.push(citation);
    } else {
      grouped.set(citation.sourceDocument, [citation]);
    }
  }
  return grouped;
}

export function validateCitation(
  citation: ResponseCitation,
  sourceText: string,
): { valid: boolean; reason: string } {
  const citationLower = citation.citationText.toLowerCase();
  const sourceLower = sourceText.toLowerCase();
  if (sourceLower.includes(citationLower)) {
    return { valid: true, reason: "Citação encontrada no texto fonte." };
  }
  // Check partial match — at least 60% of citation words found in source
  const citationWords = citationLower.split(/\s+/).filter(w => w.length > 2);
  if (citationWords.length === 0) {
    return { valid: false, reason: "Citação vazia ou sem palavras significativas." };
  }
  let matchCount = 0;
  for (const word of citationWords) {
    if (sourceLower.includes(word)) matchCount++;
  }
  const coverage = matchCount / citationWords.length;
  if (coverage >= 0.6) {
    return { valid: true, reason: `Correspondência parcial: ${Math.round(coverage * 100)}% das palavras encontradas.` };
  }
  return { valid: false, reason: `Correspondência insuficiente: apenas ${Math.round(coverage * 100)}% das palavras encontradas no texto fonte.` };
}
