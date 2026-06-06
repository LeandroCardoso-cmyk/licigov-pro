import { createHash } from "crypto";

export interface VectorEntry {
  id: string;
  organizationId: number;
  content: string;
  vector: number[];
  metadata: Record<string, unknown>;
  score: number | null;
  indexedAt: string;
}

export interface VectorSearchResult {
  entry: VectorEntry;
  similarity: number;
  rank: number;
}

export interface VectorIndex {
  id: string;
  organizationId: number;
  name: string;
  entries: VectorEntry[];
  dimensions: number;
  createdAt: string;
  updatedAt: string;
}

const _indices = new Map<string, VectorIndex>();

function generateId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function indexKey(organizationId: number, name: string): string {
  return `${organizationId}:${name}`;
}

export function createIndex(
  organizationId: number,
  name: string,
  dimensions?: number
): VectorIndex {
  const key = indexKey(organizationId, name);
  const existing = _indices.get(key);
  if (existing) return existing;

  const now = new Date().toISOString();
  const id = generateId(`${organizationId}:${name}:${now}`);

  const index: VectorIndex = {
    id,
    organizationId,
    name,
    entries: [],
    dimensions: dimensions ?? 1536,
    createdAt: now,
    updatedAt: now,
  };

  _indices.set(key, index);
  return index;
}

export function addToIndex(
  indexId: string,
  content: string,
  vector: number[],
  metadata?: Record<string, unknown>
): VectorEntry {
  const index = _indices.get(indexId);
  if (!index) {
    throw new Error(`Index not found: ${indexId}`);
  }

  const now = new Date().toISOString();
  const id = generateId(`${indexId}:${content.slice(0, 64)}:${now}`);

  const entry: VectorEntry = {
    id,
    organizationId: index.organizationId,
    content,
    vector,
    metadata: metadata ?? {},
    score: null,
    indexedAt: now,
  };

  index.entries.push(entry);
  index.updatedAt = now;
  return entry;
}

export function search(
  organizationId: number,
  indexName: string,
  queryVector: number[],
  topK: number
): VectorSearchResult[] {
  const key = indexKey(organizationId, indexName);
  const index = _indices.get(key);
  if (!index) return [];

  const scored = index.entries.map((entry) => ({
    entry,
    similarity: cosineSimilarity(queryVector, entry.vector),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, topK).map((item, idx) => ({
    entry: item.entry,
    similarity: item.similarity,
    rank: idx + 1,
  }));
}

export function deleteFromIndex(
  organizationId: number,
  indexName: string,
  entryId: string
): boolean {
  const key = indexKey(organizationId, indexName);
  const index = _indices.get(key);
  if (!index) return false;

  const before = index.entries.length;
  index.entries = index.entries.filter((e) => e.id !== entryId);
  const removed = index.entries.length < before;
  if (removed) index.updatedAt = new Date().toISOString();
  return removed;
}

export function getIndexStats(
  organizationId: number,
  indexName: string
): { entryCount: number; dimensions: number; createdAt: string } | null {
  const key = indexKey(organizationId, indexName);
  const index = _indices.get(key);
  if (!index) return null;

  return {
    entryCount: index.entries.length,
    dimensions: index.dimensions,
    createdAt: index.createdAt,
  };
}

export function listIndices(organizationId: number): VectorIndex[] {
  return Array.from(_indices.values()).filter(
    (index) => index.organizationId === organizationId
  );
}
