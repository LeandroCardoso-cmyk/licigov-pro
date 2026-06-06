import { createHash } from "crypto";

export interface ContextChunk {
  id: string;
  content: string;
  tokenCount: number;
  priority: number;
  source: string;
  chunkType: "system" | "history" | "document" | "instruction" | "user_input";
  metadata: Record<string, unknown>;
}

export interface AssembledContext {
  id: string;
  organizationId: number;
  sessionId: string;
  chunks: ContextChunk[];
  totalTokens: number;
  maxTokens: number;
  truncated: boolean;
  assemblyStrategy: "priority" | "recency" | "balanced";
  replayKey: string;
  assembledAt: string;
}

function generateId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function fitChunks(
  ordered: ContextChunk[],
  maxTokens: number
): { chunks: ContextChunk[]; totalTokens: number; truncated: boolean } {
  const selected: ContextChunk[] = [];
  let total = 0;
  let truncated = false;

  for (const chunk of ordered) {
    if (total + chunk.tokenCount > maxTokens) {
      truncated = true;
      break;
    }
    selected.push(chunk);
    total += chunk.tokenCount;
  }

  return { chunks: selected, totalTokens: total, truncated };
}

export function assembleContext(params: {
  organizationId: number;
  sessionId: string;
  chunks: ContextChunk[];
  maxTokens: number;
  strategy: "priority" | "recency" | "balanced";
}): AssembledContext {
  const { organizationId, sessionId, chunks, maxTokens, strategy } = params;

  let ordered: ContextChunk[];

  if (strategy === "priority") {
    ordered = [...chunks].sort((a, b) => b.priority - a.priority);
  } else if (strategy === "recency") {
    ordered = [...chunks].sort((a, b) => (a.id < b.id ? 1 : -1));
  } else {
    const half = Math.ceil(chunks.length / 2);
    const byPriority = [...chunks]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, half);
    const byRecency = [...chunks]
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, half);
    const seen = new Set<string>();
    const merged: ContextChunk[] = [];
    for (const chunk of [...byPriority, ...byRecency]) {
      if (!seen.has(chunk.id)) {
        seen.add(chunk.id);
        merged.push(chunk);
      }
    }
    ordered = merged;
  }

  const { chunks: selected, totalTokens, truncated } = fitChunks(ordered, maxTokens);

  const sortedIds = chunks.map((c) => c.id).sort();
  const replayKey = createHash("sha256")
    .update(JSON.stringify({ organizationId, sessionId, strategy, ids: sortedIds }))
    .digest("hex");

  const id = generateId(`${organizationId}:${sessionId}:${strategy}:${Date.now()}`);

  return {
    id,
    organizationId,
    sessionId,
    chunks: selected,
    totalTokens,
    maxTokens,
    truncated,
    assemblyStrategy: strategy,
    replayKey,
    assembledAt: new Date().toISOString(),
  };
}

export function createChunk(
  content: string,
  chunkType: ContextChunk["chunkType"],
  priority: number,
  source: string,
  metadata?: Record<string, unknown>
): ContextChunk {
  const tokenCount = estimateChunkTokens(content);
  const id = generateId(`${source}:${chunkType}:${content.slice(0, 64)}:${Date.now()}`);
  return {
    id,
    content,
    tokenCount,
    priority,
    source,
    chunkType,
    metadata: metadata ?? {},
  };
}

export function estimateChunkTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export function splitIntoChunks(
  text: string,
  maxTokensPerChunk: number,
  chunkType: ContextChunk["chunkType"],
  source: string
): ContextChunk[] {
  const maxChars = maxTokensPerChunk * 4;
  const chunks: ContextChunk[] = [];
  let offset = 0;

  while (offset < text.length) {
    const slice = text.slice(offset, offset + maxChars);
    chunks.push(createChunk(slice, chunkType, 5, source));
    offset += maxChars;
  }

  return chunks;
}

export function getContextStats(assembled: AssembledContext): {
  chunkCount: number;
  totalTokens: number;
  byType: Record<string, number>;
  utilizationPercent: number;
} {
  const byType: Record<string, number> = {};
  for (const chunk of assembled.chunks) {
    byType[chunk.chunkType] = (byType[chunk.chunkType] ?? 0) + chunk.tokenCount;
  }

  return {
    chunkCount: assembled.chunks.length,
    totalTokens: assembled.totalTokens,
    byType,
    utilizationPercent:
      assembled.maxTokens > 0
        ? Math.round((assembled.totalTokens / assembled.maxTokens) * 100 * 100) / 100
        : 0,
  };
}
