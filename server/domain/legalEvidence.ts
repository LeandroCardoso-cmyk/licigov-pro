import { createHash } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type LegalSourceType =
  | "lei_14133"
  | "decreto"
  | "instrucao_normativa"
  | "jurisprudencia"
  | "sumula"
  | "parecer"
  | "doutrina";

export interface LegalEvidence {
  readonly id: string;
  readonly organizationId: number;
  readonly sourceType: LegalSourceType;
  readonly sourceId: string;
  readonly lawReference: string;
  readonly article: string;
  readonly clause: string | null;
  readonly paragraph: string | null;
  readonly jurisprudenceReference: string | null;
  readonly text: string;
  readonly confidence: number;
  readonly explanation: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
}

// ─── Functions ──────────────────────────────────────────────────────────────

export function createLegalEvidence(params: {
  organizationId: number;
  sourceType: LegalSourceType;
  sourceId: string;
  lawReference: string;
  article: string;
  clause?: string | null;
  paragraph?: string | null;
  jurisprudenceReference?: string | null;
  text: string;
  confidence: number;
  explanation: string;
  tags?: string[];
}): LegalEvidence {
  const id = createHash("sha256")
    .update(`le:${params.organizationId}:${params.sourceType}:${params.article}:${params.sourceId}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    lawReference: params.lawReference,
    article: params.article,
    clause: params.clause ?? null,
    paragraph: params.paragraph ?? null,
    jurisprudenceReference: params.jurisprudenceReference ?? null,
    text: params.text,
    confidence: params.confidence,
    explanation: params.explanation,
    tags: params.tags ?? [],
    createdAt: new Date().toISOString(),
  };
}

export function matchesQuery(evidence: LegalEvidence, query: string): boolean {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const evidenceText = evidence.text.toLowerCase();
  const evidenceTags = evidence.tags.map(t => t.toLowerCase());
  for (const word of queryWords) {
    if (evidenceText.includes(word)) return true;
    for (const tag of evidenceTags) {
      if (tag.includes(word)) return true;
    }
  }
  return false;
}

export function rankByRelevance(evidences: readonly LegalEvidence[], query: string): LegalEvidence[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const scored = evidences.map(ev => {
    const evidenceText = ev.text.toLowerCase();
    const evidenceTags = ev.tags.map(t => t.toLowerCase());
    let wordOverlap = 0;
    for (const word of queryWords) {
      if (evidenceText.includes(word)) wordOverlap++;
      for (const tag of evidenceTags) {
        if (tag.includes(word)) {
          wordOverlap++;
          break;
        }
      }
    }
    const overlapScore = queryWords.length > 0 ? wordOverlap / queryWords.length : 0;
    const score = overlapScore * 0.6 + ev.confidence * 0.4;
    return { evidence: ev, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.evidence);
}

export function formatCitation(evidence: LegalEvidence): string {
  const parts: string[] = [evidence.lawReference];
  if (evidence.article) {
    parts.push(`Art. ${evidence.article}`);
  }
  if (evidence.paragraph) {
    parts.push(`§ ${evidence.paragraph}`);
  }
  if (evidence.clause) {
    parts.push(evidence.clause);
  }
  return parts.join(", ");
}
