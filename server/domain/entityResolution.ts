import { createHash } from "crypto";

export type ResolutionStrategy = "exact" | "fuzzy" | "alias" | "semantic" | "manual";
export type ResolutionStatus = "resolved" | "pending" | "conflict" | "rejected";

export interface SimilarityMetadata {
  readonly algorithm: string;
  readonly score: number;
  readonly sourceTokens: number;
  readonly targetTokens: number;
  readonly overlapTokens: number;
}

export interface EntityResolutionRecord {
  readonly id: string;
  readonly organizationId: number;
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly strategy: ResolutionStrategy;
  readonly status: ResolutionStatus;
  readonly confidence: number;
  readonly reasoning: string;
  readonly resolvedBy: string;
  // ─── Sprint 4.8.1 — operational wiring (evidence + trace) ──────────────────
  readonly resolutionEvidence: readonly string[];
  readonly resolutionTrace: readonly string[];
  readonly similarityMetadata: SimilarityMetadata | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createEntityResolution(params: {
  organizationId: number;
  sourceEntityId: string;
  targetEntityId: string;
  strategy: ResolutionStrategy;
  confidence?: number;
  reasoning?: string;
  resolvedBy?: string;
  resolutionEvidence?: string[];
  resolutionTrace?: string[];
  similarityMetadata?: SimilarityMetadata | null;
  correlationId?: string;
  createdAt?: string;
}): EntityResolutionRecord {
  const id = createHash("sha256")
    .update(`er:${params.organizationId}:${params.sourceEntityId}:${params.targetEntityId}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    sourceEntityId: params.sourceEntityId,
    targetEntityId: params.targetEntityId,
    strategy: params.strategy,
    status: params.confidence && params.confidence >= 0.9 ? "resolved" : "pending",
    confidence: params.confidence ?? 0.5,
    reasoning: params.reasoning ?? "",
    resolvedBy: params.resolvedBy ?? "system",
    resolutionEvidence: params.resolutionEvidence ?? [],
    resolutionTrace: params.resolutionTrace ?? [],
    similarityMetadata: params.similarityMetadata ?? null,
    correlationId: params.correlationId ?? "",
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Constrói similarityMetadata determinística a partir de dois textos (Jaccard/Dice em tokens). */
export function buildSimilarityMetadata(a: string, b: string): SimilarityMetadata {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  let overlap = 0;
  for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
  const denom = wordsA.size + wordsB.size;
  return {
    algorithm: "dice-token-set",
    score: denom === 0 ? 0 : (2 * overlap) / denom,
    sourceTokens: wordsA.size,
    targetTokens: wordsB.size,
    overlapTokens: overlap,
  };
}

export function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
  return (2 * overlap) / (wordsA.size + wordsB.size);
}

export function shouldAutoResolve(record: EntityResolutionRecord): boolean {
  return record.confidence >= 0.9 && record.strategy !== "manual";
}

export function markResolved(record: EntityResolutionRecord): EntityResolutionRecord {
  return { ...record, status: "resolved" };
}

export function markRejected(record: EntityResolutionRecord, reason: string): EntityResolutionRecord {
  return { ...record, status: "rejected", reasoning: reason };
}
