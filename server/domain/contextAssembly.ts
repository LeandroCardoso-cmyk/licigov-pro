import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContextPriority = "critical" | "high" | "medium" | "low" | "background";
export type ContextSource = "workflow" | "memory" | "retrieval" | "legal" | "institutional" | "document" | "user" | "system";
export type ContextWindowStatus = "open" | "saturated" | "pruned" | "archived";

export interface ContextFragment {
  id: string;
  organizationId: number;
  source: ContextSource;
  content: string;
  tokenEstimate: number;
  priority: ContextPriority;
  relevanceScore: number;
  confidence: number;
  isStale: boolean;
  staleness: number;
  evidenceRefs: string[];
  legalBasis: string | null;
  temporalContext: string;
  replayKey: string;
  createdAt: string;
}

export interface ContextLayer {
  id: string;
  organizationId: number;
  layerType: ContextSource;
  fragments: ContextFragment[];
  totalTokens: number;
  maxTokens: number;
  priority: ContextPriority;
  createdAt: string;
}

export interface ContextWindow {
  id: string;
  organizationId: number;
  status: ContextWindowStatus;
  layers: ContextLayer[];
  totalTokens: number;
  maxTokens: number;
  softLimit: number;
  utilizationRatio: number;
  fragmentCount: number;
  replayKey: string;
  createdAt: string;
}

export interface ContextAssembly {
  id: string;
  organizationId: number;
  window: ContextWindow;
  orderedFragments: ContextFragment[];
  suppressedFragments: ContextFragment[];
  staleFragments: ContextFragment[];
  totalTokensUsed: number;
  compressionApplied: boolean;
  assemblyReasonKey: string;
  lineage: string[];
  replayKey: string;
  assembledAt: string;
}

// ─── Priority weights ─────────────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<ContextPriority, number> = {
  critical:   5,
  high:       4,
  medium:     3,
  low:        2,
  background: 1,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function genId(input: string): string {
  return sha256(input).slice(0, 20);
}

// ─── Core functions ───────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createFragment(params: {
  organizationId: number;
  source: ContextSource;
  content: string;
  priority: ContextPriority;
  relevanceScore: number;
  confidence: number;
  temporalContext?: string;
  evidenceRefs?: string[];
  legalBasis?: string | null;
}): ContextFragment {
  const now = new Date().toISOString();
  const replayKey = sha256(`${params.organizationId}${params.source}${params.content}`);
  return {
    id:              genId(replayKey),
    organizationId:  params.organizationId,
    source:          params.source,
    content:         params.content,
    tokenEstimate:   estimateTokens(params.content),
    priority:        params.priority,
    relevanceScore:  params.relevanceScore,
    confidence:      params.confidence,
    isStale:         false,
    staleness:       0,
    evidenceRefs:    params.evidenceRefs ?? [],
    legalBasis:      params.legalBasis ?? null,
    temporalContext: params.temporalContext ?? now,
    replayKey,
    createdAt:       now,
  };
}

export function createLayer(params: {
  organizationId: number;
  layerType: ContextSource;
  maxTokens: number;
  priority: ContextPriority;
}): ContextLayer {
  const now = new Date().toISOString();
  return {
    id:             genId(`${params.organizationId}${params.layerType}${now}`),
    organizationId: params.organizationId,
    layerType:      params.layerType,
    fragments:      [],
    totalTokens:    0,
    maxTokens:      params.maxTokens,
    priority:       params.priority,
    createdAt:      now,
  };
}

export function createWindow(organizationId: number, maxTokens: number): ContextWindow {
  const now = new Date().toISOString();
  const replayKey = sha256(`${organizationId}${maxTokens}${now}`);
  return {
    id:               genId(replayKey),
    organizationId,
    status:           "open",
    layers:           [],
    totalTokens:      0,
    maxTokens,
    softLimit:        maxTokens * 0.8,
    utilizationRatio: 0,
    fragmentCount:    0,
    replayKey,
    createdAt:        now,
  };
}

export function addFragmentToLayer(layer: ContextLayer, fragment: ContextFragment): ContextLayer {
  const newFragments = [...layer.fragments, fragment];
  const newTotal = newFragments.reduce((sum, f) => sum + f.tokenEstimate, 0);
  return {
    ...layer,
    fragments:   newFragments,
    totalTokens: newTotal,
  };
}

export function assembleContext(
  organizationId: number,
  layers: ContextLayer[],
  maxTokens: number,
): ContextAssembly {
  const now = new Date().toISOString();

  // Collect all fragments from all layers
  const allFragments = layers.flatMap(l => l.fragments);

  // Deduplicate by replayKey
  const seen = new Set<string>();
  const deduplicated: ContextFragment[] = [];
  for (const f of allFragments) {
    if (!seen.has(f.replayKey)) {
      seen.add(f.replayKey);
      deduplicated.push(f);
    }
  }

  // Sort by priority desc, then relevanceScore desc
  const sorted = [...deduplicated].sort((a, b) => {
    const pDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (pDiff !== 0) return pDiff;
    return b.relevanceScore - a.relevanceScore;
  });

  // Detect stale fragments (staleness > 0.8)
  const staleFragments = sorted.filter(f => f.staleness > 0.8);

  // Apply hard token limit
  const orderedFragments: ContextFragment[] = [];
  const suppressedFragments: ContextFragment[] = [];
  let totalTokensUsed = 0;

  for (const f of sorted) {
    if (totalTokensUsed + f.tokenEstimate <= maxTokens) {
      orderedFragments.push(f);
      totalTokensUsed += f.tokenEstimate;
    } else {
      suppressedFragments.push(f);
    }
  }

  const compressionApplied = totalTokensUsed > maxTokens * 0.8;

  // Build replayKey from sorted fragment replayKeys + organizationId
  const sortedReplayKeys = [...orderedFragments.map(f => f.replayKey)].sort();
  const replayKey = sha256(sortedReplayKeys.join("") + organizationId);

  const assemblyReasonKey = sha256(`assembly:${organizationId}:${now}`);

  return {
    id:                  genId(replayKey),
    organizationId,
    window:              createWindow(organizationId, maxTokens),
    orderedFragments,
    suppressedFragments,
    staleFragments,
    totalTokensUsed,
    compressionApplied,
    assemblyReasonKey,
    lineage:             layers.map(l => l.id),
    replayKey,
    assembledAt:         now,
  };
}

export function detectSemanticOverlap(a: ContextFragment, b: ContextFragment): number {
  const tokensA = new Set(a.content.toLowerCase().split(/\s+/).filter(t => t.length > 0));
  const tokensB = new Set(b.content.toLowerCase().split(/\s+/).filter(t => t.length > 0));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersectionSize = 0;
  for (const t of Array.from(tokensA)) {
    if (tokensB.has(t)) intersectionSize++;
  }

  const unionSize = tokensA.size + tokensB.size - intersectionSize;
  return intersectionSize / unionSize;
}

export function pruneContext(assembly: ContextAssembly, targetTokens: number): ContextAssembly {
  // Sort ordered fragments by relevance ascending so we remove least relevant first
  const sorted = [...assembly.orderedFragments].sort((a, b) => {
    const pDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (pDiff !== 0) return pDiff;
    return a.relevanceScore - b.relevanceScore;
  });

  const kept: ContextFragment[] = [];
  const removed: ContextFragment[] = [];
  let total = 0;

  // Add from most relevant (end of sorted array) to least
  for (let i = sorted.length - 1; i >= 0; i--) {
    const f = sorted[i];
    if (total + f.tokenEstimate <= targetTokens) {
      kept.push(f);
      total += f.tokenEstimate;
    } else {
      removed.push(f);
    }
  }

  // Re-sort kept by original order (priority desc, relevance desc)
  const orderedFragments = [...kept].sort((a, b) => {
    const pDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (pDiff !== 0) return pDiff;
    return b.relevanceScore - a.relevanceScore;
  });

  const newSuppressed = [...assembly.suppressedFragments, ...removed];
  const newReplayKeys = [...orderedFragments.map(f => f.replayKey)].sort();
  const replayKey = sha256(newReplayKeys.join("") + assembly.organizationId);

  return {
    ...assembly,
    orderedFragments,
    suppressedFragments:  newSuppressed,
    totalTokensUsed:      total,
    compressionApplied:   total > targetTokens * 0.8,
    replayKey,
    assembledAt:          new Date().toISOString(),
  };
}

export function isContextStale(fragment: ContextFragment, maxAgeMs: number): boolean {
  const fragmentTime = new Date(fragment.temporalContext).getTime();
  if (isNaN(fragmentTime)) return false;
  return Date.now() - fragmentTime > maxAgeMs;
}
