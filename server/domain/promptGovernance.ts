import { createHash } from "crypto";

// ─── ID generation ─────────────────────────────────────────────────────────────

let _counter = 0;

function genId(prefix: string): string {
  _counter += 1;
  const raw = `${prefix}:${_counter}:${Date.now()}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 20);
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _versionStore = new Map<string, PromptVersion[]>();

function storeKey(organizationId: number, promptKey: string): string {
  return `${organizationId}_${promptKey}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type PromptStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "deprecated"
  | "rollback";

export type PromptEventType =
  | "created"
  | "submitted"
  | "approved"
  | "rejected"
  | "deprecated"
  | "rollback";

export interface PromptEvent {
  readonly id:          string;
  readonly type:        PromptEventType;
  readonly actor:       number;
  readonly description: string;
  readonly occurredAt:  string;
}

export interface PromptVersion {
  readonly id:             string;
  readonly organizationId: number;
  readonly promptKey:      string;
  readonly version:        string;
  readonly content:        string;
  readonly variables:      readonly string[];
  readonly status:         PromptStatus;
  readonly approvedBy:     number | null;
  readonly rejectedBy:     number | null;
  readonly rollbackFrom:   string | null;
  readonly lineage:        readonly string[];
  readonly history:        readonly PromptEvent[];
  readonly legalBasis:     string | null;
  readonly checksum:       string;
  readonly metadata:       Record<string, unknown>;
  readonly createdBy:      number;
  readonly createdAt:      string;
  readonly updatedAt:      string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function extractVariables(content: string): string[] {
  const seen   = new Set<string>();
  const result: string[] = [];
  let match: RegExpExecArray | null;
  const re = /\{\{(\w+)\}\}/g;
  while ((match = re.exec(content)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

function computeChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function verifyChecksum(version: PromptVersion): boolean {
  return computeChecksum(version.content) === version.checksum;
}

function makeEvent(
  type: PromptEventType,
  actor: number,
  description: string,
): PromptEvent {
  return {
    id:          genId("pev"),
    type,
    actor,
    description,
    occurredAt:  new Date().toISOString(),
  };
}

function persist(version: PromptVersion): void {
  const key  = storeKey(version.organizationId, version.promptKey);
  const list = _versionStore.get(key) ?? [];
  const idx  = list.findIndex(v => v.id === version.id);
  if (idx === -1) {
    _versionStore.set(key, [...list, version]);
  } else {
    const updated = [...list];
    updated[idx]  = version;
    _versionStore.set(key, updated);
  }
}

// ─── Factory & transitions ────────────────────────────────────────────────────

export function createPromptVersion(params: {
  organizationId: number;
  promptKey:      string;
  version:        string;
  content:        string;
  createdBy:      number;
  legalBasis?:    string | null;
  metadata?:      Record<string, unknown>;
  lineage?:       string[];
}): PromptVersion {
  const now = new Date().toISOString();
  const event = makeEvent("created", params.createdBy, "Prompt version created");
  const pv: PromptVersion = {
    id:             genId("pv"),
    organizationId: params.organizationId,
    promptKey:      params.promptKey,
    version:        params.version,
    content:        params.content,
    variables:      extractVariables(params.content),
    status:         "draft",
    approvedBy:     null,
    rejectedBy:     null,
    rollbackFrom:   null,
    lineage:        params.lineage ?? [],
    history:        [event],
    legalBasis:     params.legalBasis ?? null,
    checksum:       computeChecksum(params.content),
    metadata:       params.metadata ?? {},
    createdBy:      params.createdBy,
    createdAt:      now,
    updatedAt:      now,
  };
  persist(pv);
  return pv;
}

export function submitForReview(
  version: PromptVersion,
  actor: number,
): PromptVersion {
  if (version.status !== "draft") {
    throw new Error(`Cannot submit for review: current status is '${version.status}'`);
  }
  const event = makeEvent("submitted", actor, "Submitted for review");
  const updated: PromptVersion = {
    ...version,
    status:    "pending_review",
    history:   [...version.history, event],
    updatedAt: new Date().toISOString(),
  };
  persist(updated);
  return updated;
}

export function approvePromptVersion(
  version: PromptVersion,
  actor: number,
): PromptVersion {
  if (version.status !== "pending_review") {
    throw new Error(`Cannot approve: current status is '${version.status}'`);
  }
  const event = makeEvent("approved", actor, "Prompt version approved");
  const updated: PromptVersion = {
    ...version,
    status:     "approved",
    approvedBy: actor,
    history:    [...version.history, event],
    updatedAt:  new Date().toISOString(),
  };
  persist(updated);
  return updated;
}

export function rejectPromptVersion(
  version: PromptVersion,
  actor: number,
  reason: string,
): PromptVersion {
  if (version.status !== "pending_review") {
    throw new Error(`Cannot reject: current status is '${version.status}'`);
  }
  const event = makeEvent("rejected", actor, reason);
  const updated: PromptVersion = {
    ...version,
    status:     "rejected",
    rejectedBy: actor,
    history:    [...version.history, event],
    updatedAt:  new Date().toISOString(),
  };
  persist(updated);
  return updated;
}

export function deprecatePromptVersion(
  version: PromptVersion,
  actor: number,
): PromptVersion {
  const event = makeEvent("deprecated", actor, "Prompt version deprecated");
  const updated: PromptVersion = {
    ...version,
    status:    "deprecated",
    history:   [...version.history, event],
    updatedAt: new Date().toISOString(),
  };
  persist(updated);
  return updated;
}

export function rollbackPromptVersion(params: {
  originalVersion: PromptVersion;
  newVersionTag:   string;
  createdBy:       number;
  legalBasis?:     string | null;
  metadata?:       Record<string, unknown>;
}): PromptVersion {
  const { originalVersion, newVersionTag, createdBy } = params;
  const now   = new Date().toISOString();
  const event = makeEvent("rollback", createdBy, `Rollback to content from version ${originalVersion.version}`);
  const pv: PromptVersion = {
    id:             genId("pv"),
    organizationId: originalVersion.organizationId,
    promptKey:      originalVersion.promptKey,
    version:        newVersionTag,
    content:        originalVersion.content,
    variables:      originalVersion.variables,
    status:         "rollback",
    approvedBy:     null,
    rejectedBy:     null,
    rollbackFrom:   originalVersion.id,
    lineage:        [...originalVersion.lineage, originalVersion.id],
    history:        [event],
    legalBasis:     params.legalBasis ?? originalVersion.legalBasis,
    checksum:       originalVersion.checksum,
    metadata:       params.metadata ?? originalVersion.metadata,
    createdBy,
    createdAt:      now,
    updatedAt:      now,
  };
  persist(pv);
  return pv;
}

export function getLatestApproved(
  organizationId: number,
  promptKey:      string,
): PromptVersion | null {
  const key      = storeKey(organizationId, promptKey);
  const versions = _versionStore.get(key) ?? [];
  const approved = versions.filter(v => v.status === "approved");
  if (approved.length === 0) return null;
  return approved.reduce((latest, v) =>
    new Date(v.createdAt) > new Date(latest.createdAt) ? v : latest
  );
}
