import { createHash } from "crypto";
import { type VectorEmbedding, cosineSimilarity } from "../domain/vectorEmbedding";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export type IndexStatus = "ready" | "building" | "stale" | "rebuilding" | "failed";

export interface VectorIndex {
  readonly id: string;
  readonly organizationId: number;
  readonly corpusId: string;
  readonly embeddingVersion: string;
  readonly entries: VectorIndexEntry[];
  readonly status: IndexStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VectorIndexEntry {
  readonly embeddingId: string;
  readonly chunkId: string;
  readonly vector: number[];
}

export interface SimilarityResult {
  readonly embeddingId: string;
  readonly chunkId: string;
  readonly score: number;
}

const _indices = new Map<number, VectorIndex[]>();

export function createVectorIndex(params: { organizationId: number; corpusId: string; embeddingVersion?: string }): VectorIndex {
  const now = new Date().toISOString();
  const id = sha256(`vidx:${params.organizationId}:${params.corpusId}:${now}`).slice(0, 20);
  const idx: VectorIndex = {
    id, organizationId: params.organizationId, corpusId: params.corpusId,
    embeddingVersion: params.embeddingVersion ?? "v1", entries: [], status: "ready",
    createdAt: now, updatedAt: now,
  };
  const existing = _indices.get(params.organizationId) ?? [];
  _indices.set(params.organizationId, [...existing, idx]);
  return idx;
}

export function appendToIndex(organizationId: number, indexId: string, embeddings: VectorEmbedding[]): VectorIndex | null {
  const existing = _indices.get(organizationId) ?? [];
  const idx = existing.findIndex(i => i.id === indexId);
  if (idx === -1) return null;
  const current = existing[idx]!;
  const existingIds = new Set(current.entries.map(e => e.embeddingId));
  const newEntries = embeddings.filter(e => !existingIds.has(e.id)).map(e => ({
    embeddingId: e.id, chunkId: e.chunkId, vector: e.embeddingVector,
  }));
  const updated: VectorIndex = { ...current, entries: [...current.entries, ...newEntries], updatedAt: new Date().toISOString() };
  const newList = [...existing]; newList[idx] = updated;
  _indices.set(organizationId, newList);
  return updated;
}

export function searchIndex(organizationId: number, indexId: string, queryVector: number[], topK: number): SimilarityResult[] {
  const existing = _indices.get(organizationId) ?? [];
  const index = existing.find(i => i.id === indexId);
  if (!index) return [];
  const results: SimilarityResult[] = index.entries.map(entry => ({
    embeddingId: entry.embeddingId, chunkId: entry.chunkId,
    score: cosineSimilarity(queryVector, entry.vector),
  }));
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

export function getIndex(organizationId: number, indexId: string): VectorIndex | null {
  return ((_indices.get(organizationId) ?? []).find(i => i.id === indexId)) ?? null;
}

export function getIndicesByCorpus(organizationId: number, corpusId: string): VectorIndex[] {
  return (_indices.get(organizationId) ?? []).filter(i => i.corpusId === corpusId);
}

export function rebuildIndex(organizationId: number, indexId: string, embeddings: VectorEmbedding[]): VectorIndex | null {
  const existing = _indices.get(organizationId) ?? [];
  const idx = existing.findIndex(i => i.id === indexId);
  if (idx === -1) return null;
  const current = existing[idx]!;
  const entries = embeddings.map(e => ({ embeddingId: e.id, chunkId: e.chunkId, vector: e.embeddingVector }));
  const updated: VectorIndex = { ...current, entries, status: "ready", updatedAt: new Date().toISOString() };
  const newList = [...existing]; newList[idx] = updated;
  _indices.set(organizationId, newList);
  return updated;
}

export function detectOrphans(organizationId: number, indexId: string, validChunkIds: Set<string>): string[] {
  const index = getIndex(organizationId, indexId);
  if (!index) return [];
  return index.entries.filter(e => !validChunkIds.has(e.chunkId)).map(e => e.embeddingId);
}
