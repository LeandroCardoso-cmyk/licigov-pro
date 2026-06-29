import { createHash } from "crypto";
import { type VectorEmbedding, createVectorEmbedding } from "../domain/vectorEmbedding";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

const _embeddings = new Map<number, VectorEmbedding[]>();

export type EmbeddingProvider = "mock" | "openai" | "gemini";

function generateDeterministicEmbedding(text: string, model: string, dimensions: number): number[] {
  const hash = sha256(`embed:${model}:${text}`);
  const vector: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    const hexPart = hash.slice((i * 2) % hash.length, ((i * 2) % hash.length) + 4) || hash.slice(0, 4);
    const val = parseInt(hexPart, 16) / 65535;
    vector.push(val * 2 - 1);
  }
  const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return mag === 0 ? vector : vector.map(v => v / mag);
}

export function generateEmbedding(params: {
  organizationId: number;
  chunkId: string;
  text: string;
  provider?: EmbeddingProvider;
  model?: string;
  embeddingVersion?: string;
  dimensions?: number;
  correlationId: string;
}): VectorEmbedding {
  const provider = params.provider ?? "mock";
  const model = params.model ?? `${provider}-embedding-v1`;
  const dimensions = params.dimensions ?? 128;
  const startMs = Date.now();
  const vector = generateDeterministicEmbedding(params.text, model, dimensions);
  const latency = Date.now() - startMs;

  const embedding = createVectorEmbedding({
    organizationId: params.organizationId,
    chunkId: params.chunkId,
    providerId: provider,
    model,
    embeddingVersion: params.embeddingVersion ?? "v1",
    embeddingVector: vector,
    tokenUsage: Math.ceil(params.text.length / 4),
    generationLatencyMs: latency,
    correlationId: params.correlationId,
  });

  const existing = _embeddings.get(params.organizationId) ?? [];
  _embeddings.set(params.organizationId, [...existing, embedding]);
  return embedding;
}

export function batchGenerateEmbeddings(params: {
  organizationId: number;
  chunks: { chunkId: string; text: string }[];
  provider?: EmbeddingProvider;
  model?: string;
  embeddingVersion?: string;
  correlationId: string;
}): VectorEmbedding[] {
  return params.chunks.map(chunk =>
    generateEmbedding({
      organizationId: params.organizationId,
      chunkId: chunk.chunkId,
      text: chunk.text,
      provider: params.provider,
      model: params.model,
      embeddingVersion: params.embeddingVersion,
      correlationId: params.correlationId,
    })
  );
}

export function getEmbeddings(organizationId: number, chunkId?: string): VectorEmbedding[] {
  const all = _embeddings.get(organizationId) ?? [];
  return chunkId ? all.filter(e => e.chunkId === chunkId) : all;
}

export function getEmbeddingById(organizationId: number, embeddingId: string): VectorEmbedding | null {
  return ((_embeddings.get(organizationId) ?? []).find(e => e.id === embeddingId)) ?? null;
}

export function getEmbeddingStats(organizationId: number): { total: number; totalTokens: number; providers: Record<string, number>; versions: Record<string, number> } {
  const all = _embeddings.get(organizationId) ?? [];
  const providers: Record<string, number> = {};
  const versions: Record<string, number> = {};
  let totalTokens = 0;
  for (const e of all) {
    providers[e.providerId] = (providers[e.providerId] ?? 0) + 1;
    versions[e.embeddingVersion] = (versions[e.embeddingVersion] ?? 0) + 1;
    totalTokens += e.tokenUsage;
  }
  return { total: all.length, totalTokens, providers, versions };
}

export function deleteEmbeddings(organizationId: number, chunkId: string): number {
  const existing = _embeddings.get(organizationId) ?? [];
  const filtered = existing.filter(e => e.chunkId !== chunkId);
  _embeddings.set(organizationId, filtered);
  return existing.length - filtered.length;
}
