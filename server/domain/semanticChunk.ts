import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChunkStrategy =
  | "paragraph_chunking"
  | "semantic_chunking"
  | "sliding_window"
  | "hierarchical_chunking"
  | "legal_clause_chunking";

export type SourceType = "document" | "legal_text" | "jurisprudence" | "template" | "manual_entry";

export interface SemanticChunk {
  readonly id: string;
  readonly organizationId: number;
  readonly documentId: string;
  readonly sourceType: SourceType;
  readonly sourceSnapshotId: string | null;
  readonly chunkIndex: number;
  readonly chunkHash: string;
  readonly chunkText: string;
  readonly normalizedText: string;
  readonly semanticMetadata: Record<string, unknown>;
  readonly chunkStrategy: ChunkStrategy;
  readonly tokenCount: number;
  readonly language: string;
  readonly createdAt: string;
}

// ─── Functions ────────────────────────────────────────────────────────────────

export function createSemanticChunk(params: {
  organizationId: number;
  documentId: string;
  sourceType: SourceType;
  sourceSnapshotId?: string;
  chunkIndex: number;
  chunkText: string;
  normalizedText?: string;
  semanticMetadata?: Record<string, unknown>;
  chunkStrategy: ChunkStrategy;
  tokenCount?: number;
  language?: string;
}): SemanticChunk {
  const now = new Date().toISOString();
  const normalized = params.normalizedText ?? params.chunkText.toLowerCase().trim();
  const chunkHash = sha256(`chunk:${params.organizationId}:${params.documentId}:${params.chunkIndex}:${normalized}`).slice(0, 40);
  const id = sha256(`sc:${params.organizationId}:${chunkHash}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    documentId: params.documentId,
    sourceType: params.sourceType,
    sourceSnapshotId: params.sourceSnapshotId ?? null,
    chunkIndex: params.chunkIndex,
    chunkHash,
    chunkText: params.chunkText,
    normalizedText: normalized,
    semanticMetadata: params.semanticMetadata ?? {},
    chunkStrategy: params.chunkStrategy,
    tokenCount: params.tokenCount ?? Math.ceil(params.chunkText.length / 4),
    language: params.language ?? "pt-BR",
    createdAt: now,
  };
}

export function getChunkLineage(chunk: SemanticChunk): {
  documentId: string;
  sourceType: SourceType;
  chunkIndex: number;
  chunkHash: string;
  strategy: ChunkStrategy;
  snapshotId: string | null;
} {
  return {
    documentId: chunk.documentId,
    sourceType: chunk.sourceType,
    chunkIndex: chunk.chunkIndex,
    chunkHash: chunk.chunkHash,
    strategy: chunk.chunkStrategy,
    snapshotId: chunk.sourceSnapshotId,
  };
}

export function isChunkDuplicate(a: SemanticChunk, b: SemanticChunk): boolean {
  return a.chunkHash === b.chunkHash && a.organizationId === b.organizationId;
}
