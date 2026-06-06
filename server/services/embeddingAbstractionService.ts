import { createHash } from "crypto";

export interface EmbeddingVector {
  id: string;
  organizationId: number;
  text: string;
  vector: number[];
  dimensions: number;
  model: string;
  checksum: string;
  createdAt: string;
}

export const EMBEDDING_DIMENSIONS = 1536;

const _embeddingCache = new Map<string, EmbeddingVector>();

function generateId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function deterministicVector(seed: string, dimensions: number): number[] {
  const raw: number[] = [];
  let block = 0;

  while (raw.length < dimensions) {
    const hash = createHash("sha256")
      .update(`${seed}::block::${block}`)
      .digest("hex");
    for (let i = 0; i < hash.length - 1 && raw.length < dimensions; i += 2) {
      const byte = parseInt(hash.slice(i, i + 2), 16);
      raw.push((byte - 127.5) / 127.5);
    }
    block++;
  }

  const trimmed = raw.slice(0, dimensions);
  const magnitude = Math.sqrt(trimmed.reduce((sum, v) => sum + v * v, 0));
  return magnitude === 0 ? trimmed : trimmed.map((v) => v / magnitude);
}

export function generateEmbedding(
  text: string,
  organizationId: number,
  model?: string
): EmbeddingVector {
  const resolvedModel = model ?? "mock-embed-v1";
  const seed = createHash("sha256")
    .update(`${text}::${resolvedModel}`)
    .digest("hex");

  const vectorCheckKey = `${seed}::cached`;
  const existingBySeed = _embeddingCache.get(vectorCheckKey);
  if (existingBySeed) return existingBySeed;

  const vector = deterministicVector(seed, EMBEDDING_DIMENSIONS);
  const checksum = createHash("sha256")
    .update(JSON.stringify(vector))
    .digest("hex")
    .slice(0, 8);

  const id = generateId(`${organizationId}:${resolvedModel}:${seed}`);

  const embedding: EmbeddingVector = {
    id,
    organizationId,
    text,
    vector,
    dimensions: EMBEDDING_DIMENSIONS,
    model: resolvedModel,
    checksum,
    createdAt: new Date().toISOString(),
  };

  _embeddingCache.set(checksum, embedding);
  _embeddingCache.set(vectorCheckKey, embedding);
  return embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
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

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function batchGenerateEmbeddings(
  texts: string[],
  organizationId: number
): EmbeddingVector[] {
  return texts.map((text) => generateEmbedding(text, organizationId));
}

export function getCachedEmbedding(checksum: string): EmbeddingVector | null {
  return _embeddingCache.get(checksum) ?? null;
}
