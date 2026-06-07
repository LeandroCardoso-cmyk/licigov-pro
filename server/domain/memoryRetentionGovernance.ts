import { createHash } from "crypto";

// ─── ID gen ────────────────────────────────────────────────────────────────────

let _counter = 0;

function genId(prefix: string): string {
  return createHash("sha256")
    .update(`${prefix}:${++_counter}:${Date.now()}`)
    .digest("hex")
    .slice(0, 20);
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RetentionPolicy =
  | "permanent"
  | "session"
  | "short_term"
  | "long_term"
  | "legal_hold"
  | "archival";

export type RetentionStatus =
  | "active"
  | "expiring_soon"
  | "expired"
  | "archived"
  | "legal_hold"
  | "deleted";

export type ArchivalReason =
  | "ttl_expired"
  | "governance_policy"
  | "user_request"
  | "legal_requirement"
  | "storage_optimization";

export interface RetentionRule {
  id: string;
  organizationId: number;
  policy: RetentionPolicy;
  ttlMs: number | null;
  legalBasis: string | null;
  appliesTo: string[];
  priority: number;
  isActive: boolean;
  createdBy: number;
  createdAt: string;
}

export interface RetentionSnapshot {
  id: string;
  organizationId: number;
  totalMemories: number;
  activeMemories: number;
  expiringSoon: number;
  archived: number;
  legalHold: number;
  byPolicy: Record<RetentionPolicy, number>;
  snapshotAt: string;
}

export interface MemoryArchivalRecord {
  id: string;
  organizationId: number;
  memoryId: string;
  archivedBy: number;
  reason: ArchivalReason;
  previousStatus: RetentionStatus;
  retentionPolicyApplied: RetentionPolicy;
  legalBasis: string | null;
  immutable: boolean;
  archivedAt: string;
}

export interface GovernanceLineage {
  memoryId: string;
  organizationId: number;
  events: Array<{ type: string; actor: number; description: string; occurredAt: string }>;
}

// ─── In-memory stores ─────────────────────────────────────────────────────────

const _rules = new Map<number, RetentionRule[]>();
const _archivalRecords = new Map<number, MemoryArchivalRecord[]>();
const _lineages = new Map<string, GovernanceLineage>();

// ─── Functions ─────────────────────────────────────────────────────────────────

export function createRetentionRule(params: {
  organizationId: number;
  policy: RetentionPolicy;
  ttlMs?: number | null;
  legalBasis?: string;
  appliesTo: string[];
  priority?: number;
  createdBy: number;
}): RetentionRule {
  const rule: RetentionRule = {
    id: genId("rule"),
    organizationId: params.organizationId,
    policy: params.policy,
    ttlMs: params.ttlMs ?? null,
    legalBasis: params.legalBasis ?? null,
    appliesTo: [...params.appliesTo],
    priority: params.priority ?? 0,
    isActive: true,
    createdBy: params.createdBy,
    createdAt: new Date().toISOString(),
  };
  const existing = _rules.get(params.organizationId) ?? [];
  _rules.set(params.organizationId, [...existing, rule]);
  return rule;
}

export function applyRetentionPolicy(
  _memoryId: string,
  memoryType: string,
  organizationId: number,
): RetentionPolicy {
  const rules = _rules.get(organizationId) ?? [];
  const active = rules.filter(r => r.isActive);

  const applicable = active.filter(r =>
    r.appliesTo.some(t => t === memoryType || t === "*"),
  );

  if (applicable.length === 0) return "session";

  const sorted = [...applicable].sort((a, b) => b.priority - a.priority);
  return sorted[0].policy;
}

export function archiveMemory(params: {
  memoryId: string;
  archivedBy: number;
  reason: ArchivalReason;
  organizationId: number;
  legalBasis?: string;
}): MemoryArchivalRecord {
  const policy = applyRetentionPolicy(params.memoryId, "*", params.organizationId);
  const record: MemoryArchivalRecord = {
    id: genId("arch"),
    organizationId: params.organizationId,
    memoryId: params.memoryId,
    archivedBy: params.archivedBy,
    reason: params.reason,
    previousStatus: "active",
    retentionPolicyApplied: policy,
    legalBasis: params.legalBasis ?? null,
    immutable: true,
    archivedAt: new Date().toISOString(),
  };
  const existing = _archivalRecords.get(params.organizationId) ?? [];
  _archivalRecords.set(params.organizationId, [...existing, record]);
  return record;
}

export function computeRetentionStatus(
  memoryCreatedAt: string,
  ttlMs: number | null,
): RetentionStatus {
  if (ttlMs === null) return "active";
  const elapsed = Date.now() - new Date(memoryCreatedAt).getTime();
  if (elapsed > ttlMs) return "expired";
  if (elapsed / ttlMs > 0.8) return "expiring_soon";
  return "active";
}

export function takeRetentionSnapshot(
  organizationId: number,
  memories: Array<{
    id: string;
    memoryType: string;
    createdAt: string;
    isActive: boolean;
    ttlMs: number | null;
  }>,
): RetentionSnapshot {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  const byPolicy: Record<RetentionPolicy, number> = {
    permanent: 0,
    session: 0,
    short_term: 0,
    long_term: 0,
    legal_hold: 0,
    archival: 0,
  };

  let activeMemories = 0;
  let expiringSoon = 0;
  let archived = 0;
  let legalHold = 0;

  for (const mem of memories) {
    const policy = applyRetentionPolicy(mem.id, mem.memoryType, organizationId);
    byPolicy[policy] += 1;

    const status = computeRetentionStatus(mem.createdAt, mem.ttlMs);

    if (policy === "legal_hold") {
      legalHold += 1;
    } else if (policy === "archival") {
      archived += 1;
    } else if (status === "active" && mem.isActive) {
      activeMemories += 1;

      if (mem.ttlMs !== null) {
        const remaining = mem.ttlMs - (Date.now() - new Date(mem.createdAt).getTime());
        if (remaining > 0 && remaining < TWENTY_FOUR_HOURS_MS) {
          expiringSoon += 1;
        }
      }
    }
  }

  return {
    id: genId("snap"),
    organizationId,
    totalMemories: memories.length,
    activeMemories,
    expiringSoon,
    archived,
    legalHold,
    byPolicy,
    snapshotAt: new Date().toISOString(),
  };
}

export function getGovernanceLineage(
  memoryId: string,
  organizationId: number,
): GovernanceLineage {
  const existing = _lineages.get(memoryId);
  if (existing !== undefined) return existing;
  const lineage: GovernanceLineage = {
    memoryId,
    organizationId,
    events: [],
  };
  _lineages.set(memoryId, lineage);
  return lineage;
}

export function appendGovernanceEvent(
  memoryId: string,
  organizationId: number,
  type: string,
  actor: number,
  description: string,
): GovernanceLineage {
  const existing = getGovernanceLineage(memoryId, organizationId);
  const updated: GovernanceLineage = {
    ...existing,
    events: [
      ...existing.events,
      { type, actor, description, occurredAt: new Date().toISOString() },
    ],
  };
  _lineages.set(memoryId, updated);
  return updated;
}

export function getRulesForOrg(organizationId: number): RetentionRule[] {
  const rules = _rules.get(organizationId) ?? [];
  return [...rules]
    .filter(r => r.isActive)
    .sort((a, b) => b.priority - a.priority);
}

export function getArchivalRecords(
  organizationId: number,
  limit?: number,
): MemoryArchivalRecord[] {
  const records = _archivalRecords.get(organizationId) ?? [];
  if (limit === undefined) return [...records];
  return records.slice(-limit);
}
