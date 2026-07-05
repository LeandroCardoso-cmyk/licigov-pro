import { createHash } from "crypto";
import {
  type ContextFragment,
  type ContextLayer,
  type ContextAssembly,
  type ContextSource,
  type ContextPriority,
  createFragment,
  createLayer,
  createWindow,
  addFragmentToLayer,
  assembleContext as domainAssembleContext,
  estimateTokens,
} from "../domain/contextAssembly";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssemblyInput {
  organizationId: number;
  sessionId: string;
  workflowId?: string;
  retrievalResults?: Array<{ content: string; score: number; source: string }>;
  memories?: Array<{ content: string; memoryType: string; confidence: number }>;
  legalRefs?: string[];
  documentRefs?: string[];
  userContext?: string;
  maxTokens?: number;
}

export interface AssemblyOutput {
  assembly: ContextAssembly;
  fragmentCount: number;
  tokenCount: number;
  compressionRatio: number;
  evidenceCount: number;
  correlationId: string;
  replayKey: string;
  assembledAt: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _assemblySnapshots = new Map<number, AssemblyOutput[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ─── Service functions ────────────────────────────────────────────────────────

export function assembleContextService(input: AssemblyInput): AssemblyOutput {
  const {
    organizationId,
    sessionId,
    workflowId,
    retrievalResults = [],
    memories = [],
    legalRefs = [],
    documentRefs = [],
    userContext,
    maxTokens = 4096,
  } = input;

  // Build layers keyed by source type
  const layerMap = new Map<ContextSource, ContextLayer>();

  function getOrCreateLayer(source: ContextSource, priority: ContextPriority): ContextLayer {
    if (!layerMap.has(source)) {
      layerMap.set(
        source,
        createLayer({ organizationId, layerType: source, maxTokens, priority }),
      );
    }
    return layerMap.get(source)!;
  }

  // legalRefs → priority "critical", source "legal", relevanceScore 0.95
  for (const ref of legalRefs) {
    const layer = getOrCreateLayer("legal", "critical");
    const fragment = createFragment({
      organizationId,
      source: "legal",
      content: ref,
      priority: "critical",
      relevanceScore: 0.95,
      confidence: 0.95,
      legalBasis: ref,
    });
    layerMap.set("legal", addFragmentToLayer(layer, fragment));
  }

  // workflowId → priority "high", source "workflow", relevanceScore 0.85
  if (workflowId !== undefined) {
    const layer = getOrCreateLayer("workflow", "high");
    const fragment = createFragment({
      organizationId,
      source: "workflow",
      content: `Workflow: ${workflowId}`,
      priority: "high",
      relevanceScore: 0.85,
      confidence: 0.85,
    });
    layerMap.set("workflow", addFragmentToLayer(layer, fragment));
  }

  // retrievalResults → priority "medium", source "retrieval", relevanceScore = result.score
  for (const result of retrievalResults) {
    const layer = getOrCreateLayer("retrieval", "medium");
    const fragment = createFragment({
      organizationId,
      source: "retrieval",
      content: result.content,
      priority: "medium",
      relevanceScore: result.score,
      confidence: result.score,
    });
    layerMap.set("retrieval", addFragmentToLayer(layer, fragment));
  }

  // memories → priority "low", source "memory", relevanceScore = confidence
  for (const memory of memories) {
    const layer = getOrCreateLayer("memory", "low");
    const fragment = createFragment({
      organizationId,
      source: "memory",
      content: memory.content,
      priority: "low",
      relevanceScore: memory.confidence,
      confidence: memory.confidence,
    });
    layerMap.set("memory", addFragmentToLayer(layer, fragment));
  }

  // documentRefs → priority "low", source "document", relevanceScore 0.6
  for (const ref of documentRefs) {
    const layer = getOrCreateLayer("document", "low");
    const fragment = createFragment({
      organizationId,
      source: "document",
      content: ref,
      priority: "low",
      relevanceScore: 0.6,
      confidence: 0.6,
    });
    layerMap.set("document", addFragmentToLayer(layer, fragment));
  }

  // userContext → priority "background", source "user", relevanceScore 0.5
  if (userContext !== undefined) {
    const layer = getOrCreateLayer("user", "background");
    const fragment = createFragment({
      organizationId,
      source: "user",
      content: userContext,
      priority: "background",
      relevanceScore: 0.5,
      confidence: 0.5,
    });
    layerMap.set("user", addFragmentToLayer(layer, fragment));
  }

  const layers = Array.from(layerMap.values());
  const assembly = domainAssembleContext(organizationId, layers, maxTokens);

  const fragmentCount = assembly.orderedFragments.length;
  const tokenCount = assembly.totalTokensUsed;
  const compressionRatio = tokenCount / maxTokens;
  const evidenceCount = assembly.orderedFragments.reduce(
    (sum, f) => sum + f.evidenceRefs.length,
    0,
  );

  // Deterministic correlationId
  const correlationId = sha256(`${sessionId}${organizationId}`);
  const replayKey = assembly.replayKey;
  const assembledAt = assembly.assembledAt;

  const output: AssemblyOutput = {
    assembly,
    fragmentCount,
    tokenCount,
    compressionRatio,
    evidenceCount,
    correlationId,
    replayKey,
    assembledAt,
  };

  snapshotAssembly(output, organizationId);

  return output;
}

export function snapshotAssembly(output: AssemblyOutput, organizationId: number): void {
  const existing = _assemblySnapshots.get(organizationId) ?? [];
  _assemblySnapshots.set(organizationId, [...existing, output]);
}

export function getAssemblySnapshots(organizationId: number): AssemblyOutput[] {
  return _assemblySnapshots.get(organizationId) ?? [];
}

export function compareAssemblies(a: AssemblyOutput, b: AssemblyOutput): string {
  const lines: string[] = [];

  const tokenDiff = b.tokenCount - a.tokenCount;
  lines.push(`tokenCount: ${a.tokenCount} → ${b.tokenCount} (${tokenDiff >= 0 ? "+" : ""}${tokenDiff})`);

  const fragmentDiff = b.fragmentCount - a.fragmentCount;
  lines.push(`fragmentCount: ${a.fragmentCount} → ${b.fragmentCount} (${fragmentDiff >= 0 ? "+" : ""}${fragmentDiff})`);

  const ratioDiff = b.compressionRatio - a.compressionRatio;
  lines.push(
    `compressionRatio: ${a.compressionRatio.toFixed(4)} → ${b.compressionRatio.toFixed(4)} (${ratioDiff >= 0 ? "+" : ""}${ratioDiff.toFixed(4)})`,
  );

  return lines.join("\n");
}

// ─── Sprint 4.0 backward-compat shims (used by sprint40-ai-foundation.test.ts) ─

export interface ContextChunk {
  id: string;
  content: string;
  tokenCount: number;
  priority: number;
  source: string;
  chunkType: string;
}

interface AssembledContext {
  id: string;
  chunks: ContextChunk[];
  totalTokens: number;
  maxTokens: number;
  truncated: boolean;
  assemblyStrategy: string;
  assembledAt: string;
  replayKey: string;
  organizationId: number;
}

export function estimateChunkTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createChunk(content: string, chunkType: string, priority: number, source: string): ContextChunk {
  const { createHash } = require("crypto") as typeof import("crypto");
  return {
    id:         createHash("sha256").update(`${content}${chunkType}${source}`).digest("hex").slice(0, 20),
    content,
    tokenCount: estimateChunkTokens(content),
    priority,
    source,
    chunkType,
  };
}

export function assembleContext(params: {
  organizationId: number;
  sessionId: string;
  chunks: ContextChunk[];
  maxTokens: number;
  strategy: string;
}): AssembledContext {
  const { createHash } = require("crypto") as typeof import("crypto");
  const sorted = [...params.chunks].sort((a, b) => b.priority - a.priority);
  const included: ContextChunk[] = [];
  let total = 0;
  for (const c of sorted) {
    if (total + c.tokenCount <= params.maxTokens) {
      included.push(c);
      total += c.tokenCount;
    }
  }
  const replayKey = createHash("sha256")
    .update(params.sessionId + params.organizationId + params.strategy + params.chunks.map(c => c.id).sort().join(""))
    .digest("hex");
  return {
    id:               replayKey.slice(0, 20),
    chunks:           included,
    totalTokens:      total,
    maxTokens:        params.maxTokens,
    truncated:        included.length < params.chunks.length,
    assemblyStrategy: params.strategy,
    assembledAt:      new Date().toISOString(),
    replayKey,
    organizationId:   params.organizationId,
  };
}

export function splitIntoChunks(text: string, maxTokens: number, chunkType: string, source: string): ContextChunk[] {
  const words = text.split(/\s+/);
  const chunks: ContextChunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const word of words) {
    const wt = estimateChunkTokens(word + " ");
    if (currentTokens + wt > maxTokens && current.length > 0) {
      chunks.push(createChunk(current.join(" "), chunkType, 1, source));
      current = [];
      currentTokens = 0;
    }
    current.push(word);
    currentTokens += wt;
  }
  if (current.length > 0) chunks.push(createChunk(current.join(" "), chunkType, 1, source));
  return chunks;
}

export function getContextStats(assembled: AssembledContext): {
  chunkCount: number;
  totalTokens: number;
  maxTokens: number;
  utilizationPercent: number;
  truncated: boolean;
} {
  return {
    chunkCount:         assembled.chunks.length,
    totalTokens:        assembled.totalTokens,
    maxTokens:          assembled.maxTokens,
    utilizationPercent: Math.ceil((assembled.totalTokens / assembled.maxTokens) * 100),
    truncated:          assembled.truncated,
  };
}

// ─── Sprint 4.7 — Institutional RAG Engine ──────────────────────────────────

export function assembleForQuery(
  query: { readonly normalizedQuery: string; readonly intent: string; readonly organizationId: number },
  orgId: number,
): ContextAssembly {
  const promptContext = `Query: ${query.normalizedQuery}\nIntent: ${query.intent}`;
  const idSeed = `${orgId}${query.normalizedQuery}`;
  const id = sha256(idSeed).slice(0, 20);
  const replayKey = sha256(`${idSeed}${query.intent}`);

  return {
    id,
    organizationId: orgId,
    window: createWindow(orgId, 4096),
    orderedFragments: [],
    suppressedFragments: [],
    staleFragments: [],
    totalTokensUsed: estimateTokens(promptContext),
    compressionApplied: false,
    assemblyReasonKey: query.intent,
    lineage: [],
    replayKey,
    assembledAt: new Date().toISOString(),
  };
}

export function semanticGrouping(
  chunks: ReadonlyArray<{ readonly chunkId: string; readonly content: string; readonly similarity: number; readonly source: string }>,
): Array<{ readonly group: string; readonly chunks: Array<{ readonly chunkId: string; readonly content: string; readonly similarity: number; readonly source: string }> }> {
  const groupMap = new Map<string, Array<{ readonly chunkId: string; readonly content: string; readonly similarity: number; readonly source: string }>>();

  for (const chunk of chunks) {
    const existing = groupMap.get(chunk.source) ?? [];
    groupMap.set(chunk.source, [...existing, chunk]);
  }

  const result: Array<{ readonly group: string; readonly chunks: Array<{ readonly chunkId: string; readonly content: string; readonly similarity: number; readonly source: string }> }> = [];
  for (const [group, groupChunks] of groupMap) {
    result.push({ group, chunks: groupChunks });
  }

  return result;
}

export function contextualCompression(
  assembly: ContextAssembly,
  maxTokens: number,
): ContextAssembly {
  if (assembly.totalTokensUsed <= maxTokens) {
    return { ...assembly };
  }

  // Sort by relevanceScore ascending so we can remove lowest first
  const sorted = [...assembly.orderedFragments].sort(
    (a, b) => a.relevanceScore - b.relevanceScore,
  );

  const kept: ContextFragment[] = [];
  const trimmed: ContextFragment[] = [];
  let total = 0;

  // Accumulate from highest relevance (end of sorted array) backward
  for (let i = sorted.length - 1; i >= 0; i--) {
    const f = sorted[i];
    if (total + f.tokenEstimate <= maxTokens) {
      kept.push(f);
      total += f.tokenEstimate;
    } else {
      trimmed.push(f);
    }
  }

  // Restore original ordering (highest relevance first)
  kept.reverse();

  const newSuppressed = [...assembly.suppressedFragments, ...trimmed];
  const replayKey = sha256(
    kept.map(f => f.replayKey).sort().join("") + assembly.organizationId,
  );

  return {
    ...assembly,
    orderedFragments: kept,
    suppressedFragments: newSuppressed,
    totalTokensUsed: total,
    compressionApplied: true,
    replayKey,
    assembledAt: new Date().toISOString(),
  };
}

export function evidencePrioritization(
  evidence: ReadonlyArray<{ readonly evidenceId: string; readonly type: string; readonly content: string; readonly confidence: number }>,
): Array<{ readonly evidenceId: string; readonly type: string; readonly content: string; readonly confidence: number }> {
  return [...evidence].sort((a, b) => b.confidence - a.confidence);
}

export function legalGrouping(
  legalRefs: ReadonlyArray<{ readonly lawRef: string; readonly article: string; readonly clause: string | null; readonly text: string }>,
): Map<string, Array<{ readonly lawRef: string; readonly article: string; readonly clause: string | null; readonly text: string }>> {
  const result = new Map<string, Array<{ readonly lawRef: string; readonly article: string; readonly clause: string | null; readonly text: string }>>();

  for (const ref of legalRefs) {
    const existing = result.get(ref.lawRef) ?? [];
    result.set(ref.lawRef, [...existing, ref]);
  }

  return result;
}

export function municipalityMemoryEnrichment(
  _orgId: number,
  _query: string,
): Array<{ readonly processId: string; readonly description: string; readonly date: string; readonly relevance: number }> {
  // Stub for future sprint — returns empty array
  return [];
}
