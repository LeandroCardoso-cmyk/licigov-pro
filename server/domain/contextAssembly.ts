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

// ─── Sprint 4.7: Institutional RAG Context Assembly ─────────────────────────

export interface RetrievedChunk {
  readonly chunkId: string;
  readonly content: string;
  readonly similarity: number;
  readonly source: string;
}

export interface LegalReference {
  readonly lawRef: string;
  readonly article: string;
  readonly clause: string;
  readonly text: string;
}

export interface MunicipalityHistoryEntry {
  readonly processId: string;
  readonly description: string;
  readonly date: string;
  readonly relevance: number;
}

export interface SimilarTR {
  readonly trId: string;
  readonly title: string;
  readonly similarity: number;
  readonly keyTerms: readonly string[];
}

export interface SemanticEvidenceEntry {
  readonly evidenceId: string;
  readonly type: string;
  readonly content: string;
  readonly confidence: number;
}

export interface RAGContextAssembly {
  readonly id: string;
  readonly organizationId: number;
  readonly queryId: string;
  readonly retrievedChunks: readonly RetrievedChunk[];
  readonly legalReferences: readonly LegalReference[];
  readonly municipalityHistory: readonly MunicipalityHistoryEntry[];
  readonly similarTRs: readonly SimilarTR[];
  readonly semanticEvidence: readonly SemanticEvidenceEntry[];
  readonly promptContext: string;
  readonly totalTokens: number;
  readonly assemblyStrategy: string;
  readonly compressionApplied: boolean;
  readonly createdAt: string;
}

export function assembleRAGContext(
  query: { id: string; organizationId: number },
  chunks: readonly RetrievedChunk[],
  legalRefs: readonly LegalReference[],
  history: readonly MunicipalityHistoryEntry[],
  trs: readonly SimilarTR[],
  evidence: readonly SemanticEvidenceEntry[],
): RAGContextAssembly {
  const id = createHash("sha256")
    .update(`ctx:${query.organizationId}:${query.id}`)
    .digest("hex").slice(0, 20);

  const sections: string[] = [];

  if (legalRefs.length > 0) {
    sections.push("=== REFERÊNCIAS LEGAIS ===");
    for (const ref of legalRefs) {
      sections.push(`${ref.lawRef}, Art. ${ref.article}: ${ref.text}`);
    }
  }

  if (chunks.length > 0) {
    sections.push("\n=== TRECHOS RECUPERADOS ===");
    for (const chunk of chunks) {
      sections.push(`[${chunk.source}] (sim: ${chunk.similarity.toFixed(2)}) ${chunk.content}`);
    }
  }

  if (history.length > 0) {
    sections.push("\n=== HISTÓRICO MUNICIPAL ===");
    for (const entry of history) {
      sections.push(`[${entry.date}] ${entry.description} (rel: ${entry.relevance.toFixed(2)})`);
    }
  }

  if (trs.length > 0) {
    sections.push("\n=== TERMOS DE REFERÊNCIA SIMILARES ===");
    for (const tr of trs) {
      sections.push(`${tr.title} (sim: ${tr.similarity.toFixed(2)}) — ${tr.keyTerms.join(", ")}`);
    }
  }

  if (evidence.length > 0) {
    sections.push("\n=== EVIDÊNCIAS SEMÂNTICAS ===");
    for (const ev of evidence) {
      sections.push(`[${ev.type}] (conf: ${ev.confidence.toFixed(2)}) ${ev.content}`);
    }
  }

  const promptContext = sections.join("\n");
  const totalTokens = estimateRAGTokens(promptContext);

  return {
    id,
    organizationId: query.organizationId,
    queryId: query.id,
    retrievedChunks: chunks,
    legalReferences: legalRefs,
    municipalityHistory: history,
    similarTRs: trs,
    semanticEvidence: evidence,
    promptContext,
    totalTokens,
    assemblyStrategy: "hybrid",
    compressionApplied: false,
    createdAt: new Date().toISOString(),
  };
}

export function compressRAGContext(
  assembly: RAGContextAssembly,
  maxTokens: number,
): RAGContextAssembly {
  if (assembly.totalTokens <= maxTokens) return assembly;

  // Trim items with lowest relevance/confidence/similarity until within token budget
  const sortedChunks = [...assembly.retrievedChunks].sort((a, b) => b.similarity - a.similarity);
  const sortedHistory = [...assembly.municipalityHistory].sort((a, b) => b.relevance - a.relevance);
  const sortedTRs = [...assembly.similarTRs].sort((a, b) => b.similarity - a.similarity);
  const sortedEvidence = [...assembly.semanticEvidence].sort((a, b) => b.confidence - a.confidence);

  let currentChunks = sortedChunks;
  let currentHistory = sortedHistory;
  let currentTRs = sortedTRs;
  let currentEvidence = sortedEvidence;

  // Iteratively remove lowest-scoring items from each category
  let iterations = 0;
  const maxIterations = currentChunks.length + currentHistory.length + currentTRs.length + currentEvidence.length;

  while (iterations < maxIterations) {
    const tempAssembly = assembleRAGContext(
      { id: assembly.queryId, organizationId: assembly.organizationId },
      currentChunks,
      assembly.legalReferences, // never trim legal references
      currentHistory,
      currentTRs,
      currentEvidence,
    );
    if (tempAssembly.totalTokens <= maxTokens) {
      return { ...tempAssembly, compressionApplied: true };
    }

    // Remove the lowest-scoring item across all categories
    const candidates: { category: string; score: number }[] = [];
    if (currentChunks.length > 0) {
      candidates.push({ category: "chunks", score: currentChunks[currentChunks.length - 1].similarity });
    }
    if (currentHistory.length > 0) {
      candidates.push({ category: "history", score: currentHistory[currentHistory.length - 1].relevance });
    }
    if (currentTRs.length > 0) {
      candidates.push({ category: "trs", score: currentTRs[currentTRs.length - 1].similarity });
    }
    if (currentEvidence.length > 0) {
      candidates.push({ category: "evidence", score: currentEvidence[currentEvidence.length - 1].confidence });
    }

    if (candidates.length === 0) break;

    candidates.sort((a, b) => a.score - b.score);
    const toRemove = candidates[0].category;

    if (toRemove === "chunks") currentChunks = currentChunks.slice(0, -1);
    else if (toRemove === "history") currentHistory = currentHistory.slice(0, -1);
    else if (toRemove === "trs") currentTRs = currentTRs.slice(0, -1);
    else if (toRemove === "evidence") currentEvidence = currentEvidence.slice(0, -1);

    iterations++;
  }

  const finalAssembly = assembleRAGContext(
    { id: assembly.queryId, organizationId: assembly.organizationId },
    currentChunks,
    assembly.legalReferences,
    currentHistory,
    currentTRs,
    currentEvidence,
  );
  return { ...finalAssembly, compressionApplied: true };
}

export function estimateRAGTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

export function prioritizeEvidence(
  evidence: readonly SemanticEvidenceEntry[],
): SemanticEvidenceEntry[] {
  return [...evidence].sort((a, b) => b.confidence - a.confidence);
}
