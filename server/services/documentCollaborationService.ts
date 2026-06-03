/**
 * Sprint 3.3 — Document Collaboration Service.
 *
 * Document diffing, version lineage, and merge conflict detection.
 * Uses diff-match-patch for text diffing.
 *
 * PRINCIPLES:
 *   - Replay-safe: same versions => same diff (deterministic).
 *   - Multi-tenant: organizationId mandatory.
 */

import { createHash } from "crypto";
import { diff_match_patch } from "diff-match-patch";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiffChange {
  field: string;
  type: "added" | "removed" | "modified";
  before: string | null;
  after: string | null;
  similarity: number; // 0-1
}

export interface DocumentDiff {
  id: string;
  organizationId: number;
  fromVersionId: string;
  toVersionId: string;
  entityType: "item_tr" | "clause" | "section" | "tr";
  entityId: string;
  changes: DiffChange[];
  summary: string;
  createdAt: string;
}

export interface VersionEntry {
  versionId: string;
  content: string | Record<string, unknown>;
  author: number;
  message: string;
  checksum: string;
  createdAt: string;
}

export interface VersionLineage {
  id: string;
  organizationId: number;
  entityId: string;
  entityType: string;
  versions: VersionEntry[];
}

// ─── Core diff functions ──────────────────────────────────────────────────────

function computeTextSimilarity(before: string, after: string): number {
  if (before === after) return 1.0;
  if (!before || !after) return 0.0;
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(before, after);
  dmp.diff_cleanupSemantic(diffs);
  const levenshtein = dmp.diff_levenshtein(diffs);
  const maxLen = Math.max(before.length, after.length);
  if (maxLen === 0) return 1.0;
  return Math.max(0, 1 - levenshtein / maxLen);
}

export function computeDiff(
  before: string | Record<string, unknown>,
  after: string | Record<string, unknown>,
  type: "text" | "object",
): DiffChange[] {
  if (type === "text") {
    const beforeStr = typeof before === "string" ? before : JSON.stringify(before);
    const afterStr = typeof after === "string" ? after : JSON.stringify(after);
    if (beforeStr === afterStr) return [];
    const similarity = computeTextSimilarity(beforeStr, afterStr);
    const changeType: DiffChange["type"] =
      beforeStr === "" ? "added" : afterStr === "" ? "removed" : "modified";
    return [
      {
        field: "content",
        type: changeType,
        before: beforeStr || null,
        after: afterStr || null,
        similarity,
      },
    ];
  }

  // Object diff: field-by-field
  const beforeObj = typeof before === "object" && before !== null ? before : {};
  const afterObj = typeof after === "object" && after !== null ? after : {};
  const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const changes: DiffChange[] = [];

  for (const key of Array.from(allKeys).sort()) {
    const bVal = beforeObj[key];
    const aVal = afterObj[key];
    const bStr = bVal !== undefined ? String(bVal) : null;
    const aStr = aVal !== undefined ? String(aVal) : null;

    if (bStr === aStr) continue;

    let changeType: DiffChange["type"];
    if (bStr === null) changeType = "added";
    else if (aStr === null) changeType = "removed";
    else changeType = "modified";

    const similarity =
      bStr && aStr ? computeTextSimilarity(bStr, aStr) : 0.0;

    changes.push({ field: key, type: changeType, before: bStr, after: aStr, similarity });
  }

  return changes;
}

export function buildDocumentDiff(
  fromVersion: VersionEntry,
  toVersion: VersionEntry,
  orgId: number,
): DocumentDiff {
  const type =
    typeof fromVersion.content === "string" &&
    typeof toVersion.content === "string"
      ? "text"
      : "object";

  const changes = computeDiff(fromVersion.content, toVersion.content, type);
  const summary = computeDiffSummary(changes);
  const id = createHash("sha256")
    .update(`${orgId}:${fromVersion.versionId}:${toVersion.versionId}`)
    .digest("hex")
    .slice(0, 32);

  return {
    id,
    organizationId: orgId,
    fromVersionId: fromVersion.versionId,
    toVersionId: toVersion.versionId,
    entityType: "tr",
    entityId: fromVersion.versionId,
    changes,
    summary,
    createdAt: new Date().toISOString(),
  };
}

export function buildVersionLineage(
  entityId: string,
  entityType: string,
  orgId: number,
  versions: VersionEntry[],
): VersionLineage {
  const id = createHash("sha256")
    .update(`${orgId}:${entityId}:${entityType}`)
    .digest("hex")
    .slice(0, 32);
  return { id, organizationId: orgId, entityId, entityType, versions };
}

export function getMergeConflicts(
  diffs: DocumentDiff[],
): Array<{ field: string; conflictingValues: string[] }> {
  const fieldChanges = new Map<string, string[]>();

  for (const diff of diffs) {
    for (const change of diff.changes) {
      if (change.type === "modified" && change.after !== null) {
        const existing = fieldChanges.get(change.field) ?? [];
        if (!existing.includes(change.after)) {
          existing.push(change.after);
        }
        fieldChanges.set(change.field, existing);
      }
    }
  }

  const conflicts: Array<{ field: string; conflictingValues: string[] }> = [];
  for (const [field, values] of fieldChanges.entries()) {
    if (values.length > 1) {
      conflicts.push({ field, conflictingValues: values });
    }
  }
  return conflicts;
}

export function computeDiffSummary(changes: DiffChange[]): string {
  const added = changes.filter((c) => c.type === "added").length;
  const removed = changes.filter((c) => c.type === "removed").length;
  const modified = changes.filter((c) => c.type === "modified").length;
  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} campo${modified !== 1 ? "s" : ""} modificado${modified !== 1 ? "s" : ""}`);
  if (added > 0) parts.push(`${added} adicionado${added !== 1 ? "s" : ""}`);
  if (removed > 0) parts.push(`${removed} removido${removed !== 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(", ") : "Sem alterações";
}

export function rollbackToVersion(
  lineage: VersionLineage,
  versionId: string,
): VersionEntry {
  const version = lineage.versions.find((v) => v.versionId === versionId);
  if (!version) {
    throw new Error(`Versão não encontrada: ${versionId}`);
  }
  return version;
}

export function buildChangeSummary(diff: DocumentDiff): {
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  highImpactChanges: string[];
} {
  const addedCount = diff.changes.filter((c) => c.type === "added").length;
  const removedCount = diff.changes.filter((c) => c.type === "removed").length;
  const modifiedCount = diff.changes.filter((c) => c.type === "modified").length;
  // High-impact: low similarity (< 0.5) modifications
  const highImpactChanges = diff.changes
    .filter((c) => c.type === "modified" && c.similarity < 0.5)
    .map((c) => c.field);
  return { addedCount, removedCount, modifiedCount, highImpactChanges };
}
