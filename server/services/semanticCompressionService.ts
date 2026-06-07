import { createHash } from "crypto";
import type { ContextFragment, ContextPriority } from "../domain/contextAssembly";
import { estimateTokens } from "../domain/contextAssembly";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompressionInput {
  organizationId: number;
  fragments: ContextFragment[];
  targetTokens: number;
  preservePriority: ContextPriority[];
}

export interface CompressionResult {
  organizationId: number;
  originalFragments: ContextFragment[];
  compressedFragments: ContextFragment[];
  removedFragments: ContextFragment[];
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  deduplicatedCount: number;
  overlapRemovedCount: number;
  replayKey: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

const PRIORITY_ORDER: ContextPriority[] = [
  "background",
  "low",
  "medium",
  "high",
  "critical",
];

// ─── Service functions ────────────────────────────────────────────────────────

export function computeJaccard(a: ContextFragment, b: ContextFragment): number {
  const tokensA = new Set(
    a.content
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 0),
  );
  const tokensB = new Set(
    b.content
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 0),
  );

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersectionSize = 0;
  Array.from(tokensA).forEach(t => {
    if (tokensB.has(t)) intersectionSize++;
  });

  const unionSize = tokensA.size + tokensB.size - intersectionSize;
  return intersectionSize / unionSize;
}

export function detectDuplicates(fragments: ContextFragment[]): ContextFragment[][] {
  const groups = new Map<string, ContextFragment[]>();

  for (const fragment of fragments) {
    const existing = groups.get(fragment.replayKey);
    if (existing) {
      existing.push(fragment);
    } else {
      groups.set(fragment.replayKey, [fragment]);
    }
  }

  // Return only groups with more than one member
  return Array.from(groups.values()).filter(group => group.length > 1);
}

export function removeLowRelevance(
  fragments: ContextFragment[],
  threshold: number,
): ContextFragment[] {
  return fragments.filter(f => f.relevanceScore >= threshold);
}

export function compressContext(input: CompressionInput): CompressionResult {
  const { organizationId, fragments, targetTokens, preservePriority } = input;
  const originalFragments = [...fragments];
  const originalTokens = originalFragments.reduce((sum, f) => sum + f.tokenEstimate, 0);

  const preserveSet = new Set<ContextPriority>(preservePriority);
  const removed: ContextFragment[] = [];

  // Step 1: Remove duplicates (same replayKey) — keep the one with higher relevanceScore
  const seenKeys = new Map<string, ContextFragment>();
  let deduplicatedCount = 0;

  for (const fragment of fragments) {
    const existing = seenKeys.get(fragment.replayKey);
    if (existing) {
      deduplicatedCount++;
      // Keep higher relevance score
      if (fragment.relevanceScore > existing.relevanceScore) {
        removed.push(existing);
        seenKeys.set(fragment.replayKey, fragment);
      } else {
        removed.push(fragment);
      }
    } else {
      seenKeys.set(fragment.replayKey, fragment);
    }
  }

  let working = Array.from(seenKeys.values());

  // Step 2: Detect semantic overlap (Jaccard > 0.7) → remove the one with lower relevance
  let overlapRemovedCount = 0;
  const toRemoveForOverlap = new Set<string>();

  for (let i = 0; i < working.length; i++) {
    for (let j = i + 1; j < working.length; j++) {
      const a = working[i];
      const b = working[j];

      if (toRemoveForOverlap.has(a.id) || toRemoveForOverlap.has(b.id)) continue;

      if (computeJaccard(a, b) > 0.7) {
        // Remove the one with lower relevance score
        const toRemove = a.relevanceScore < b.relevanceScore ? a : b;
        // Never remove preserved priority fragments due to overlap
        if (!preserveSet.has(toRemove.priority)) {
          toRemoveForOverlap.add(toRemove.id);
          overlapRemovedCount++;
        }
      }
    }
  }

  const overlapRemoved = working.filter(f => toRemoveForOverlap.has(f.id));
  removed.push(...overlapRemoved);
  working = working.filter(f => !toRemoveForOverlap.has(f.id));

  // Step 3: Remove stale fragments (staleness > 0.8) if not critical and not in preservePriority
  working = working.filter(fragment => {
    if (fragment.staleness > 0.8 && !preserveSet.has(fragment.priority)) {
      removed.push(fragment);
      return false;
    }
    return true;
  });

  // Step 4: Prune by priority until targetTokens is reached
  // Remove "background" first, then "low", etc. but always preserve preservePriority
  let currentTokens = working.reduce((sum, f) => sum + f.tokenEstimate, 0);

  if (currentTokens > targetTokens) {
    for (const priority of PRIORITY_ORDER) {
      if (currentTokens <= targetTokens) break;
      if (preserveSet.has(priority)) continue;

      // Identify candidates of this priority, sorted by relevance asc (remove least relevant first)
      const candidates = working
        .filter(f => f.priority === priority)
        .sort((a, b) => a.relevanceScore - b.relevanceScore);

      for (const candidate of candidates) {
        if (currentTokens <= targetTokens) break;
        removed.push(candidate);
        working = working.filter(f => f.id !== candidate.id);
        currentTokens -= candidate.tokenEstimate;
      }
    }
  }

  const compressedTokens = working.reduce((sum, f) => sum + estimateTokens(f.content), 0);
  const compressionRatio = originalTokens > 0 ? compressedTokens / originalTokens : 1;

  const sortedReplayKeys = [...working.map(f => f.replayKey)].sort().join(",");
  const replayKey = sha256(`${sortedReplayKeys}${targetTokens}`);

  return {
    organizationId,
    originalFragments,
    compressedFragments: working,
    removedFragments: removed,
    originalTokens,
    compressedTokens,
    compressionRatio,
    deduplicatedCount,
    overlapRemovedCount,
    replayKey,
  };
}
