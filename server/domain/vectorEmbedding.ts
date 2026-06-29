import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export interface VectorEmbedding {
  readonly id: string;
  readonly organizationId: number;
  readonly chunkId: string;
  readonly providerId: string;
  readonly model: string;
  readonly embeddingVersion: string;
  readonly embeddingVector: number[];
  readonly embeddingHash: string;
  readonly tokenUsage: number;
  readonly generationLatencyMs: number;
  readonly deterministicSnapshot: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createVectorEmbedding(params: {
  organizationId: number;
  chunkId: string;
  providerId: string;
  model: string;
  embeddingVersion: string;
  embeddingVector: number[];
  tokenUsage?: number;
  generationLatencyMs?: number;
  correlationId: string;
}): VectorEmbedding {
  const now = new Date().toISOString();
  const vectorStr = params.embeddingVector.map(v => v.toFixed(6)).join(",");
  const embeddingHash = sha256(`emb:${params.model}:${vectorStr}`).slice(0, 40);
  const id = sha256(`ve:${params.organizationId}:${params.chunkId}:${embeddingHash}`).slice(0, 20);
  const snapshotInput = `${params.model}:${params.chunkId}:${params.embeddingVersion}`;
  return {
    id,
    organizationId: params.organizationId,
    chunkId: params.chunkId,
    providerId: params.providerId,
    model: params.model,
    embeddingVersion: params.embeddingVersion,
    embeddingVector: params.embeddingVector,
    embeddingHash,
    tokenUsage: params.tokenUsage ?? 0,
    generationLatencyMs: params.generationLatencyMs ?? 0,
    deterministicSnapshot: sha256(`snapshot:${snapshotInput}`).slice(0, 40),
    correlationId: params.correlationId,
    createdAt: now,
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function normalizeVector(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag === 0 ? v : v.map(x => x / mag);
}

export function isEmbeddingStale(embedding: VectorEmbedding, currentVersion: string): boolean {
  return embedding.embeddingVersion !== currentVersion;
}
