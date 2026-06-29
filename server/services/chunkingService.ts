import { createHash } from "crypto";
import { type SemanticChunk, type ChunkStrategy, createSemanticChunk, type SourceType } from "../domain/semanticChunk";

const _chunks = new Map<number, SemanticChunk[]>();

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
}

function slidingWindow(text: string, windowSize: number, overlap: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += windowSize - overlap) {
    const slice = words.slice(i, i + windowSize);
    if (slice.length > 0) chunks.push(slice.join(" "));
    if (i + windowSize >= words.length) break;
  }
  return chunks;
}

function splitLegalClauses(text: string): string[] {
  return text.split(/(?=Art\.\s*\d+|§\s*\d+|Inciso\s+[IVXLCDM]+|Alínea\s+[a-z])/i)
    .map(c => c.trim()).filter(c => c.length > 0);
}

export function chunkText(params: {
  organizationId: number;
  documentId: string;
  text: string;
  strategy: ChunkStrategy;
  sourceType: SourceType;
  sourceSnapshotId?: string;
  windowSize?: number;
  overlap?: number;
}): SemanticChunk[] {
  let segments: string[];
  switch (params.strategy) {
    case "paragraph_chunking":
      segments = splitParagraphs(params.text);
      break;
    case "sliding_window":
      segments = slidingWindow(params.text, params.windowSize ?? 200, params.overlap ?? 50);
      break;
    case "legal_clause_chunking":
      segments = splitLegalClauses(params.text);
      break;
    case "hierarchical_chunking": {
      const paragraphs = splitParagraphs(params.text);
      segments = [];
      for (let i = 0; i < paragraphs.length; i += 2) {
        segments.push(paragraphs.slice(i, i + 2).join("\n\n"));
      }
      break;
    }
    case "semantic_chunking":
    default:
      segments = splitParagraphs(params.text);
      break;
  }

  const chunks = segments.map((seg, idx) =>
    createSemanticChunk({
      organizationId: params.organizationId,
      documentId: params.documentId,
      sourceType: params.sourceType,
      sourceSnapshotId: params.sourceSnapshotId,
      chunkIndex: idx,
      chunkText: seg,
      chunkStrategy: params.strategy,
      tokenCount: estimateTokens(seg),
    })
  );

  const existing = _chunks.get(params.organizationId) ?? [];
  _chunks.set(params.organizationId, [...existing, ...chunks]);
  return chunks;
}

export function getChunks(organizationId: number, documentId?: string): SemanticChunk[] {
  const all = _chunks.get(organizationId) ?? [];
  return documentId ? all.filter(c => c.documentId === documentId) : all;
}

export function getChunkById(organizationId: number, chunkId: string): SemanticChunk | null {
  return ((_chunks.get(organizationId) ?? []).find(c => c.id === chunkId)) ?? null;
}

export function deleteChunks(organizationId: number, documentId: string): number {
  const existing = _chunks.get(organizationId) ?? [];
  const filtered = existing.filter(c => c.documentId !== documentId);
  _chunks.set(organizationId, filtered);
  return existing.length - filtered.length;
}

export function getChunkingStats(organizationId: number): { totalChunks: number; totalTokens: number; strategies: Record<string, number> } {
  const all = _chunks.get(organizationId) ?? [];
  const strategies: Record<string, number> = {};
  let totalTokens = 0;
  for (const c of all) {
    strategies[c.chunkStrategy] = (strategies[c.chunkStrategy] ?? 0) + 1;
    totalTokens += c.tokenCount;
  }
  return { totalChunks: all.length, totalTokens, strategies };
}
