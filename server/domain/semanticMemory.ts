import { createHash } from "crypto";

// ─── ID generation ─────────────────────────────────────────────────────────────

let _counter = 0;

function genId(prefix: string): string {
  _counter += 1;
  const raw = `${prefix}:${_counter}:${Date.now()}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 20);
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _memoryStore = new Map<string, SemanticMemoryEntry[]>();

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemoryType = "semantic" | "contextual" | "institutional";

export interface SemanticMemoryEntry {
  readonly id:              string;
  readonly organizationId:  number;
  readonly memoryType:      MemoryType;
  readonly key:             string;
  readonly value:           string;
  readonly embedding:       readonly number[] | null;
  readonly sourceRef:       string | null;
  readonly context:         Record<string, unknown>;
  readonly relevanceScore:  number;
  readonly lastAccessedAt:  string | null;
  readonly accessCount:     number;
  readonly ttlMs:           number | null;
  readonly isActive:        boolean;
  readonly createdAt:       string;
  readonly updatedAt:       string;
}

export interface RetrievalReference {
  readonly id:                 string;
  readonly memoryId:           string;
  readonly retrievedBy:        number;
  readonly retrievedAt:        string;
  readonly queryContext:       string;
  readonly relevanceAtRetrieval: number;
}

export interface MemoryStats {
  total:      number;
  active:     number;
  expired:    number;
  byType:     Record<MemoryType, number>;
  avgRelevance: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isExpired(entry: SemanticMemoryEntry): boolean {
  if (entry.ttlMs === null) return false;
  return Date.now() - new Date(entry.createdAt).getTime() > entry.ttlMs;
}

// ─── Factory & operations ─────────────────────────────────────────────────────

export function createMemoryEntry(params: {
  organizationId: number;
  memoryType:     MemoryType;
  key:            string;
  value:          string;
  embedding?:     number[] | null;
  sourceRef?:     string | null;
  context?:       Record<string, unknown>;
  relevanceScore?: number;
  ttlMs?:         number | null;
}): SemanticMemoryEntry {
  const now = new Date().toISOString();
  const entry: SemanticMemoryEntry = {
    id:             genId("mem"),
    organizationId: params.organizationId,
    memoryType:     params.memoryType,
    key:            params.key,
    value:          params.value,
    embedding:      params.embedding ?? null,
    sourceRef:      params.sourceRef ?? null,
    context:        params.context ?? {},
    relevanceScore: params.relevanceScore ?? 0.5,
    lastAccessedAt: null,
    accessCount:    0,
    ttlMs:          params.ttlMs ?? null,
    isActive:       true,
    createdAt:      now,
    updatedAt:      now,
  };
  const existing = _memoryStore.get(String(params.organizationId)) ?? [];
  _memoryStore.set(String(params.organizationId), [...existing, entry]);
  return entry;
}

export function retrieveMemories(
  organizationId: number,
  memoryType:     MemoryType,
  _query:         string,
  limit:          number,
): SemanticMemoryEntry[] {
  const all        = _memoryStore.get(String(organizationId)) ?? [];
  const now        = new Date().toISOString();
  const filtered   = all.filter(
    e => e.organizationId === organizationId &&
         e.memoryType === memoryType &&
         e.isActive &&
         !isExpired(e)
  );
  const sorted = [...filtered].sort((a, b) => b.relevanceScore - a.relevanceScore);
  const sliced = sorted.slice(0, limit);

  const updated = sliced.map(e => ({
    ...e,
    lastAccessedAt: now,
    accessCount:    e.accessCount + 1,
    updatedAt:      now,
  }));

  const updatedIds = new Set(updated.map(e => e.id));
  const merged = all.map(e => {
    if (!updatedIds.has(e.id)) return e;
    return updated.find(u => u.id === e.id)!;
  });
  _memoryStore.set(String(organizationId), merged);

  return updated;
}

export function deactivateMemory(entry: SemanticMemoryEntry): SemanticMemoryEntry {
  const now     = new Date().toISOString();
  const updated: SemanticMemoryEntry = {
    ...entry,
    isActive:  false,
    updatedAt: now,
  };
  const all    = _memoryStore.get(String(entry.organizationId)) ?? [];
  const merged = all.map(e => (e.id === entry.id ? updated : e));
  _memoryStore.set(String(entry.organizationId), merged);
  return updated;
}

export function refreshRelevance(
  entry:    SemanticMemoryEntry,
  newScore: number,
): SemanticMemoryEntry {
  if (newScore < 0 || newScore > 1) {
    throw new Error(`Relevance score must be between 0 and 1, got ${newScore}`);
  }
  const updated: SemanticMemoryEntry = {
    ...entry,
    relevanceScore: newScore,
    updatedAt:      new Date().toISOString(),
  };
  const all    = _memoryStore.get(String(entry.organizationId)) ?? [];
  const merged = all.map(e => (e.id === entry.id ? updated : e));
  _memoryStore.set(String(entry.organizationId), merged);
  return updated;
}

export function computeMemoryStats(entries: SemanticMemoryEntry[]): MemoryStats {
  const total   = entries.length;
  const active  = entries.filter(e => e.isActive && !isExpired(e)).length;
  const expired = entries.filter(e => isExpired(e)).length;

  const byType: Record<MemoryType, number> = {
    semantic:      0,
    contextual:    0,
    institutional: 0,
  };
  for (const e of entries) {
    byType[e.memoryType] += 1;
  }

  const avgRelevance =
    total === 0
      ? 0
      : entries.reduce((acc, e) => acc + e.relevanceScore, 0) / total;

  return { total, active, expired, byType, avgRelevance };
}

export function createRetrievalReference(
  memoryId:     string,
  retrievedBy:  number,
  queryContext: string,
  relevance:    number,
): RetrievalReference {
  return {
    id:                    genId("ref"),
    memoryId,
    retrievedBy,
    retrievedAt:           new Date().toISOString(),
    queryContext,
    relevanceAtRetrieval:  relevance,
  };
}
