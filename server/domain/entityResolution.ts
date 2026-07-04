import { createHash } from "crypto";

export type ResolutionStrategy = "exact" | "fuzzy" | "alias" | "semantic" | "manual";
export type ResolutionStatus = "resolved" | "pending" | "conflict" | "rejected";

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
    createdAt: new Date().toISOString(),
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
