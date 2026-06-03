/**
 * Sprint 3.3 — External Storage Foundation.
 *
 * Storage adapter registry, sync metadata, conflict detection.
 * NO real HTTP / provider calls in this sprint.
 *
 * PRINCIPLES:
 *   - Multi-tenant: organizationId mandatory.
 *   - Replay-safe: same params => deterministic ids.
 *   - Structured logging for observability.
 */

import { createHash } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type StorageProviderType =
  | "google_drive"
  | "onedrive"
  | "sharepoint"
  | "s3"
  | "custom";

export interface StorageAdapter {
  id: string;
  organizationId: number;
  providerType: StorageProviderType;
  name: string;
  config: Record<string, unknown>; // opaque
  active: boolean;
  createdAt: string;
}

export interface StorageSyncMetadata {
  id: string;
  adapterId: string;
  organizationId: number;
  externalId: string;
  localPath: string;
  checksum: string;
  syncStatus: "synced" | "pending" | "conflict" | "error";
  lastSyncedAt: string;
  version: number;
}

export interface StorageSnapshot {
  id: string;
  adapterId: string;
  organizationId: number;
  totalFiles: number;
  syncedFiles: number;
  conflictsCount: number;
  checksum: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _counter = 0;
function nextId(prefix: string, seed: string): string {
  _counter++;
  return (
    prefix +
    "_" +
    createHash("sha256")
      .update(`${seed}:${_counter}`)
      .digest("hex")
      .slice(0, 24)
  );
}

function emit(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      service: "external_storage",
      event,
      ...payload,
      timestamp: new Date().toISOString(),
    }),
  );
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export function registerAdapter(params: {
  organizationId: number;
  providerType: StorageProviderType;
  name: string;
  config: Record<string, unknown>;
}): StorageAdapter {
  const now = new Date().toISOString();
  const id = nextId(
    "sad",
    `${params.organizationId}:${params.providerType}:${params.name}`,
  );
  const adapter: StorageAdapter = {
    id,
    organizationId: params.organizationId,
    providerType: params.providerType,
    name: params.name,
    config: params.config,
    active: true,
    createdAt: now,
  };
  emit("storage_adapter_registered", {
    adapterId: id,
    providerType: params.providerType,
    organizationId: params.organizationId,
  });
  return adapter;
}

// ─── Sync metadata ────────────────────────────────────────────────────────────

export function createSyncMetadata(
  adapterId: string,
  externalId: string,
  localPath: string,
  checksum: string,
  orgId: number,
): StorageSyncMetadata {
  const now = new Date().toISOString();
  const id = nextId("ssm", `${orgId}:${adapterId}:${externalId}`);
  return {
    id,
    adapterId,
    organizationId: orgId,
    externalId,
    localPath,
    checksum,
    syncStatus: "synced",
    lastSyncedAt: now,
    version: 1,
  };
}

export function updateSyncStatus(
  metadata: StorageSyncMetadata,
  status: StorageSyncMetadata["syncStatus"],
  checksum?: string,
): StorageSyncMetadata {
  const now = new Date().toISOString();
  return {
    ...metadata,
    syncStatus: status,
    checksum: checksum ?? metadata.checksum,
    lastSyncedAt: now,
    version: metadata.version + 1,
  };
}

// ─── Conflict detection ───────────────────────────────────────────────────────

export function detectConflicts(
  metadata: StorageSyncMetadata[],
): StorageSyncMetadata[] {
  // Detect by grouping externalId and finding divergent checksums
  const byExternal = new Map<string, StorageSyncMetadata[]>();
  for (const m of metadata) {
    const existing = byExternal.get(m.externalId) ?? [];
    existing.push(m);
    byExternal.set(m.externalId, existing);
  }

  const conflicts: StorageSyncMetadata[] = [];
  for (const [, items] of byExternal.entries()) {
    const checksums = new Set(items.map((i) => i.checksum));
    if (checksums.size > 1) {
      conflicts.push(...items.map((i) => ({ ...i, syncStatus: "conflict" as const })));
    }
  }
  return conflicts;
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export function createStorageSnapshot(
  adapter: StorageAdapter,
  metadata: StorageSyncMetadata[],
): StorageSnapshot {
  const now = new Date().toISOString();
  const id = nextId("ssn", `${adapter.id}:${now}`);
  const synced = metadata.filter((m) => m.syncStatus === "synced").length;
  const conflicts = metadata.filter((m) => m.syncStatus === "conflict").length;
  const checksumSource = metadata.map((m) => m.checksum).sort().join("|");
  const checksum = createHash("sha256")
    .update(checksumSource)
    .digest("hex")
    .slice(0, 32);

  return {
    id,
    adapterId: adapter.id,
    organizationId: adapter.organizationId,
    totalFiles: metadata.length,
    syncedFiles: synced,
    conflictsCount: conflicts,
    checksum,
    createdAt: now,
  };
}

export function verifyStorageIntegrity(
  snapshot: StorageSnapshot,
  metadata: StorageSyncMetadata[],
): { valid: boolean; mismatches: number } {
  const synced = metadata.filter((m) => m.syncStatus === "synced").length;
  const mismatches = Math.abs(snapshot.syncedFiles - synced);
  return { valid: mismatches === 0, mismatches };
}

// ─── Sync plan ────────────────────────────────────────────────────────────────

export function buildSyncPlan(metadata: StorageSyncMetadata[]): {
  toUpload: string[];
  toDownload: string[];
  conflicts: string[];
} {
  const toUpload: string[] = [];
  const toDownload: string[] = [];
  const conflicts: string[] = [];

  for (const m of metadata) {
    if (m.syncStatus === "pending") {
      toUpload.push(m.localPath);
    } else if (m.syncStatus === "error") {
      toDownload.push(m.localPath);
    } else if (m.syncStatus === "conflict") {
      conflicts.push(m.localPath);
    }
  }

  return { toUpload, toDownload, conflicts };
}
