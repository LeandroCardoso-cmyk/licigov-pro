import { createHash } from "crypto";

export interface Citation {
  readonly id: string;
  readonly responseId: string;
  readonly evidenceId: string | null;
  readonly chunkId: string | null;
  readonly citationText: string;
  readonly sourceDocument: string;
  readonly page: string | null;
  readonly section: string | null;
  readonly similarity: number;
  readonly citationType:
    | "direct_quote"
    | "paraphrase"
    | "legal_reference"
    | "data_reference"
    | "cross_reference";
  readonly organizationId: number;
}

interface EvidenceItem {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly confidence: number;
}

interface ChunkItem {
  readonly chunkId: string;
  readonly content: string;
  readonly source: string;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

function determineCitationType(
  similarity: number,
): Citation["citationType"] {
  if (similarity > 0.8) return "direct_quote";
  if (similarity > 0.5) return "paraphrase";
  return "cross_reference";
}

export function generateCitations(
  response: string,
  evidence: EvidenceItem[],
  chunks: ChunkItem[],
  organizationId: number,
  responseId: string,
): Citation[] {
  const sentences = splitSentences(response);
  const citations: Citation[] = [];

  for (const sentence of sentences) {
    let bestMatch: { id: string; source: string; similarity: number; type: "evidence" | "chunk" } | null = null;

    for (const ev of evidence) {
      const sim = wordOverlap(sentence, ev.content);
      if (sim > 0.3 && (!bestMatch || sim > bestMatch.similarity)) {
        bestMatch = { id: ev.id, source: ev.source, similarity: sim, type: "evidence" };
      }
    }

    for (const ch of chunks) {
      const sim = wordOverlap(sentence, ch.content);
      if (sim > 0.3 && (!bestMatch || sim > bestMatch.similarity)) {
        bestMatch = { id: ch.chunkId, source: ch.source, similarity: sim, type: "chunk" };
      }
    }

    if (bestMatch) {
      const citId = createHash("sha256")
        .update(`cit:${organizationId}:${responseId}:${sentence.slice(0, 50)}`)
        .digest("hex")
        .slice(0, 20);
      citations.push({
        id: citId,
        responseId,
        evidenceId: bestMatch.type === "evidence" ? bestMatch.id : null,
        chunkId: bestMatch.type === "chunk" ? bestMatch.id : null,
        citationText: sentence,
        sourceDocument: bestMatch.source,
        page: null,
        section: null,
        similarity: bestMatch.similarity,
        citationType: determineCitationType(bestMatch.similarity),
        organizationId,
      });
    }
  }

  return citations;
}

export function matchResponseToEvidence(
  response: string,
  evidence: Array<{ id: string; content: string; source: string }>,
): Array<{ sentence: string; evidenceId: string; similarity: number }> {
  const sentences = splitSentences(response);
  const matches: Array<{ sentence: string; evidenceId: string; similarity: number }> = [];

  for (const sentence of sentences) {
    let best: { evidenceId: string; similarity: number } | null = null;
    for (const ev of evidence) {
      const sim = wordOverlap(sentence, ev.content);
      if (sim > 0.2 && (!best || sim > best.similarity)) {
        best = { evidenceId: ev.id, similarity: sim };
      }
    }
    if (best) {
      matches.push({ sentence, ...best });
    }
  }

  return matches;
}

export function formatCitationBlock(citations: Citation[]): string {
  if (citations.length === 0) return "";
  const lines = citations.map(
    (c, i) => `[${i + 1}] ${c.sourceDocument}${c.page ? `, p. ${c.page}` : ""} — "${c.citationText}"`,
  );
  return lines.join("\n");
}

export function validateAllCitations(
  citations: Citation[],
  sources: Array<{ id: string; content: string }>,
): Array<{ citationId: string; valid: boolean; reason: string }> {
  const sourceMap = new Map(sources.map((s) => [s.id, s.content]));
  return citations.map((c) => {
    const sourceId = c.evidenceId ?? c.chunkId;
    if (!sourceId) return { citationId: c.id, valid: false, reason: "No source reference" };
    const sourceContent = sourceMap.get(sourceId);
    if (!sourceContent) return { citationId: c.id, valid: false, reason: "Source not found" };
    const overlap = wordOverlap(c.citationText, sourceContent);
    if (overlap > 0.3) return { citationId: c.id, valid: true, reason: "Content matches source" };
    return { citationId: c.id, valid: false, reason: "Content does not match source" };
  });
}

export function groupCitationsByType(
  citations: Citation[],
): Map<string, Citation[]> {
  const groups = new Map<string, Citation[]>();
  for (const c of citations) {
    const existing = groups.get(c.citationType) ?? [];
    existing.push(c);
    groups.set(c.citationType, existing);
  }
  return groups;
}
