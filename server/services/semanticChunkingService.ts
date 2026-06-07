import { createHash } from "crypto";

export type ChunkStrategy =
  | "hierarchical"
  | "semantic"
  | "section_aware"
  | "legal_aware"
  | "token_aware"
  | "overlap";

export type DocumentType =
  | "tr"
  | "clause"
  | "justification"
  | "workflow"
  | "parecer"
  | "catmat"
  | "operational_log"
  | "evidence"
  | "historical";

export interface SemanticChunk {
  id: string;
  organizationId: number;
  documentId: string;
  documentType: DocumentType;
  content: string;
  tokenCount: number;
  chunkIndex: number;
  totalChunks: number;
  strategy: ChunkStrategy;
  sectionTitle: string | null;
  legalRef: string | null;
  overlapWithPrev: number;
  lineage: string[];
  replayKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChunkingResult {
  documentId: string;
  organizationId: number;
  strategy: ChunkStrategy;
  chunks: SemanticChunk[];
  totalTokens: number;
  avgTokensPerChunk: number;
  processingMs: number;
  replayKey: string;
}

const _chunkStore = new Map<string, SemanticChunk[]>();

function sha20(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const LEGAL_PATTERN = /\b(Art\.|§|Lei|Decreto|IN|Portaria)\b/;

function splitBySections(content: string): Array<{ title: string | null; text: string }> {
  const lines = content.split("\n");
  const sections: Array<{ title: string | null; text: string }> = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed === trimmed.toUpperCase() && trimmed.length > 3) {
      if (currentLines.length > 0) {
        sections.push({ title: currentTitle, text: currentLines.join("\n").trim() });
      }
      currentTitle = trimmed;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ title: currentTitle, text: currentLines.join("\n").trim() });
  }
  return sections.filter((s) => s.text.length > 0);
}

function splitByLegalMarkers(content: string): Array<{ ref: string | null; text: string }> {
  const parts: Array<{ ref: string | null; text: string }> = [];
  const segments = content.split(/(?=\b(?:Art\.|§|Lei|Decreto|IN|Portaria)\b)/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(Art\.|§\s*\d+|Lei\s+[\d./]+|Decreto\s+[\d./]+|IN\s+[\d./]+|Portaria\s+[\d./]+)/);
    parts.push({ ref: match ? match[0] : null, text: trimmed });
  }
  return parts.filter((p) => p.text.length > 0);
}

function splitByParagraphs(content: string): string[] {
  return content
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitByTokenLimit(
  text: string,
  maxTokens: number,
  overlapTokens: number
): Array<{ content: string; overlap: number }> {
  const approxMaxChars = maxTokens * 4;
  const approxOverlapChars = overlapTokens * 4;
  const result: Array<{ content: string; overlap: number }> = [];

  if (countTokens(text) <= maxTokens) {
    return [{ content: text, overlap: 0 }];
  }

  let offset = 0;
  let isFirst = true;
  while (offset < text.length) {
    const slice = text.slice(offset, offset + approxMaxChars);
    const overlap = isFirst ? 0 : approxOverlapChars;
    result.push({ content: slice.trim(), overlap });
    if (offset + approxMaxChars >= text.length) break;
    offset += approxMaxChars - approxOverlapChars;
    isFirst = false;
  }
  return result;
}

function buildChunks(
  segments: Array<{ content: string; sectionTitle?: string | null; legalRef?: string | null; overlap?: number }>,
  params: {
    organizationId: number;
    documentId: string;
    documentType: DocumentType;
    strategy: ChunkStrategy;
    maxTokensPerChunk: number;
    overlapTokens: number;
    lineage: string[];
    now: string;
  }
): SemanticChunk[] {
  const expanded: Array<{ content: string; sectionTitle: string | null; legalRef: string | null; overlap: number }> = [];

  for (const seg of segments) {
    const st = seg.sectionTitle ?? null;
    const lr = seg.legalRef ?? null;
    if (countTokens(seg.content) <= params.maxTokensPerChunk) {
      expanded.push({ content: seg.content, sectionTitle: st, legalRef: lr, overlap: seg.overlap ?? 0 });
    } else {
      const sub = splitByTokenLimit(seg.content, params.maxTokensPerChunk, params.overlapTokens);
      for (const s of sub) {
        expanded.push({ content: s.content, sectionTitle: st, legalRef: lr, overlap: s.overlap });
      }
    }
  }

  const total = expanded.length;
  return expanded.map((seg, idx) => {
    const replayKey = sha20(`${params.documentId}${idx}${params.strategy}`);
    const id = sha20(`${params.organizationId}${params.documentId}${idx}${params.strategy}`);
    const chunk: SemanticChunk = {
      id,
      organizationId: params.organizationId,
      documentId: params.documentId,
      documentType: params.documentType,
      content: seg.content,
      tokenCount: countTokens(seg.content),
      chunkIndex: idx,
      totalChunks: total,
      strategy: params.strategy,
      sectionTitle: seg.sectionTitle,
      legalRef: seg.legalRef,
      overlapWithPrev: idx === 0 ? 0 : seg.overlap,
      lineage: [...params.lineage],
      replayKey,
      metadata: {},
      createdAt: params.now,
    };
    return chunk;
  });
}

export function chunkDocument(params: {
  organizationId: number;
  documentId: string;
  content: string;
  documentType: DocumentType;
  strategy: ChunkStrategy;
  maxTokensPerChunk?: number;
  overlapTokens?: number;
}): ChunkingResult {
  const start = Date.now();
  const maxTokensPerChunk = params.maxTokensPerChunk ?? 512;
  const overlapTokens = params.overlapTokens ?? 64;
  const now = new Date().toISOString();

  let segments: Array<{ content: string; sectionTitle?: string | null; legalRef?: string | null; overlap?: number }> = [];

  if (params.strategy === "legal_aware") {
    const parts = splitByLegalMarkers(params.content);
    segments = parts.map((p) => ({ content: p.text, legalRef: p.ref }));
  } else if (params.strategy === "section_aware") {
    const hasCaps = params.content.split("\n").some((l) => {
      const t = l.trim();
      return t.length > 3 && t === t.toUpperCase();
    });
    if (hasCaps) {
      const secs = splitBySections(params.content);
      segments = secs.map((s) => ({ content: s.text, sectionTitle: s.title }));
    } else {
      const paras = splitByParagraphs(params.content);
      segments = paras.map((p) => ({ content: p }));
    }
  } else if (params.strategy === "hierarchical") {
    const secs = splitBySections(params.content);
    if (secs.length > 1) {
      segments = secs.map((s) => ({ content: s.text, sectionTitle: s.title }));
    } else {
      segments = [{ content: params.content }];
    }
  } else {
    const sub = splitByTokenLimit(params.content, maxTokensPerChunk, overlapTokens);
    segments = sub.map((s) => ({ content: s.content, overlap: s.overlap }));
  }

  if (segments.length === 0) {
    segments = [{ content: params.content }];
  }

  const chunks = buildChunks(segments, {
    organizationId: params.organizationId,
    documentId: params.documentId,
    documentType: params.documentType,
    strategy: params.strategy,
    maxTokensPerChunk,
    overlapTokens,
    lineage: [],
    now,
  });

  const storeKey = `${params.organizationId}:${params.documentId}`;
  _chunkStore.set(storeKey, chunks);

  const stats = computeChunkStats(chunks);
  const resultReplayKey = sha20(chunks.map((c) => c.id).join(""));

  return {
    documentId: params.documentId,
    organizationId: params.organizationId,
    strategy: params.strategy,
    chunks,
    totalTokens: stats.totalTokens,
    avgTokensPerChunk: stats.avgTokensPerChunk,
    processingMs: Date.now() - start,
    replayKey: resultReplayKey,
  };
}

export function rechunkDocument(params: {
  organizationId: number;
  documentId: string;
  content: string;
  documentType: DocumentType;
  strategy: ChunkStrategy;
  maxTokensPerChunk?: number;
  overlapTokens?: number;
}): ChunkingResult {
  const storeKey = `${params.organizationId}:${params.documentId}`;
  const previousChunks = _chunkStore.get(storeKey) ?? [];
  const previousIds = previousChunks.map((c) => c.id);

  const result = chunkDocument(params);

  const updatedChunks = result.chunks.map((chunk) => ({
    ...chunk,
    lineage: [...previousIds],
  }));

  _chunkStore.set(storeKey, updatedChunks);

  return {
    ...result,
    chunks: updatedChunks,
  };
}

export function getChunksForDocument(organizationId: number, documentId: string): SemanticChunk[] {
  const storeKey = `${organizationId}:${documentId}`;
  return _chunkStore.get(storeKey) ?? [];
}

export function computeChunkStats(chunks: SemanticChunk[]): {
  totalTokens: number;
  avgTokensPerChunk: number;
  minTokens: number;
  maxTokens: number;
  chunkCount: number;
} {
  if (chunks.length === 0) {
    return { totalTokens: 0, avgTokensPerChunk: 0, minTokens: 0, maxTokens: 0, chunkCount: 0 };
  }
  const tokens = chunks.map((c) => c.tokenCount);
  const totalTokens = tokens.reduce((a, b) => a + b, 0);
  return {
    totalTokens,
    avgTokensPerChunk: Math.round(totalTokens / chunks.length),
    minTokens: Math.min(...tokens),
    maxTokens: Math.max(...tokens),
    chunkCount: chunks.length,
  };
}

export { LEGAL_PATTERN };
