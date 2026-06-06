import { createHash } from "crypto";

// ─── ID generation ─────────────────────────────────────────────────────────────

let _counter = 0;

function genId(prefix: string): string {
  _counter += 1;
  const raw = `${prefix}:${_counter}:${Date.now()}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 20);
}

// ─── Status & transitions ─────────────────────────────────────────────────────

export type OrchestrationStatus =
  | "queued"
  | "dispatched"
  | "executing"
  | "awaiting_tool"
  | "awaiting_human"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export const ORCHESTRATION_TRANSITIONS: Record<OrchestrationStatus, OrchestrationStatus[]> = {
  queued:          ["dispatched", "cancelled", "expired"],
  dispatched:      ["executing", "failed", "cancelled", "expired"],
  executing:       ["completed", "failed", "awaiting_tool", "awaiting_human", "expired"],
  awaiting_tool:   ["executing", "failed", "cancelled", "expired"],
  awaiting_human:  ["executing", "cancelled", "expired"],
  retrying:        ["dispatched", "expired"],
  completed:       [],
  failed:          ["retrying"],
  cancelled:       [],
  expired:         [],
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrchestrationEventType =
  | "created"
  | "dispatched"
  | "retried"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "awaiting_human"
  | "awaiting_tool";

export interface OrchestrationEvent {
  readonly id:          string;
  readonly type:        OrchestrationEventType;
  readonly actor:       number | null;
  readonly description: string;
  readonly metadata:    Record<string, unknown>;
  readonly occurredAt:  string;
}

export interface AIOrchestration {
  readonly id:             string;
  readonly organizationId: number;
  readonly sessionId:      string;
  readonly promptId:       string;
  readonly provider:       string;
  readonly model:          string;
  readonly status:         OrchestrationStatus;
  readonly attempt:        number;
  readonly maxAttempts:    number;
  readonly lineage:        readonly string[];
  readonly inputs:         Record<string, unknown>;
  readonly outputs:        Record<string, unknown> | null;
  readonly error:          string | null;
  readonly history:        readonly OrchestrationEvent[];
  readonly replayKey:      string;
  readonly startedAt:      string;
  readonly completedAt:    string | null;
  readonly updatedAt:      string;
  readonly createdAt:      string;
}

export interface OrchestrationMetrics {
  total:       number;
  completed:   number;
  failed:      number;
  avgLatencyMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeReplayKey(inputs: Record<string, unknown>): string {
  const sorted = JSON.stringify(inputs, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      );
    }
    return v;
  });
  return createHash("sha256").update(sorted, "utf8").digest("hex").slice(0, 20);
}

function makeEvent(
  type: OrchestrationEventType,
  actor: number | null,
  description: string,
  metadata: Record<string, unknown> = {},
): OrchestrationEvent {
  return {
    id:          genId("oev"),
    type,
    actor,
    description,
    metadata,
    occurredAt:  new Date().toISOString(),
  };
}

function assertTransition(
  current: OrchestrationStatus,
  next: OrchestrationStatus,
): void {
  if (!ORCHESTRATION_TRANSITIONS[current].includes(next)) {
    throw new Error(
      `Invalid orchestration transition: ${current} → ${next}`
    );
  }
}

// ─── Factory & transitions ────────────────────────────────────────────────────

export function createOrchestration(params: {
  organizationId: number;
  sessionId:      string;
  promptId:       string;
  provider:       string;
  model:          string;
  inputs:         Record<string, unknown>;
  maxAttempts?:   number;
  lineage?:       string[];
  actor?:         number | null;
}): AIOrchestration {
  const now = new Date().toISOString();
  const event = makeEvent("created", params.actor ?? null, "Orchestration created");
  return {
    id:             genId("orch"),
    organizationId: params.organizationId,
    sessionId:      params.sessionId,
    promptId:       params.promptId,
    provider:       params.provider,
    model:          params.model,
    status:         "queued",
    attempt:        1,
    maxAttempts:    params.maxAttempts ?? 3,
    lineage:        params.lineage ?? [],
    inputs:         params.inputs,
    outputs:        null,
    error:          null,
    history:        [event],
    replayKey:      computeReplayKey(params.inputs),
    startedAt:      now,
    completedAt:    null,
    updatedAt:      now,
    createdAt:      now,
  };
}

export function dispatchOrchestration(
  orch: AIOrchestration,
  actor?: number | null,
): AIOrchestration {
  assertTransition(orch.status, "dispatched");
  const event = makeEvent("dispatched", actor ?? null, "Orchestration dispatched");
  return {
    ...orch,
    status:    "dispatched",
    history:   [...orch.history, event],
    updatedAt: new Date().toISOString(),
  };
}

export function completeOrchestration(
  orch: AIOrchestration,
  outputs: Record<string, unknown>,
  actor?: number | null,
): AIOrchestration {
  assertTransition(orch.status, "completed");
  const now = new Date().toISOString();
  const event = makeEvent("completed", actor ?? null, "Orchestration completed", { outputs });
  return {
    ...orch,
    status:      "completed",
    outputs,
    error:       null,
    history:     [...orch.history, event],
    completedAt: now,
    updatedAt:   now,
  };
}

export function failOrchestration(
  orch: AIOrchestration,
  error: string,
  actor?: number | null,
): AIOrchestration {
  assertTransition(orch.status, "failed");
  const event = makeEvent("failed", actor ?? null, "Orchestration failed", { error });
  return {
    ...orch,
    status:    "failed",
    error,
    history:   [...orch.history, event],
    updatedAt: new Date().toISOString(),
  };
}

export function cancelOrchestration(
  orch: AIOrchestration,
  actor?: number | null,
): AIOrchestration {
  assertTransition(orch.status, "cancelled");
  const event = makeEvent("cancelled", actor ?? null, "Orchestration cancelled");
  return {
    ...orch,
    status:    "cancelled",
    history:   [...orch.history, event],
    updatedAt: new Date().toISOString(),
  };
}

export function expireOrchestration(
  orch: AIOrchestration,
  actor?: number | null,
): AIOrchestration {
  assertTransition(orch.status, "expired");
  const event = makeEvent("expired", actor ?? null, "Orchestration expired");
  return {
    ...orch,
    status:    "expired",
    history:   [...orch.history, event],
    updatedAt: new Date().toISOString(),
  };
}

export function markAwaitingTool(
  orch: AIOrchestration,
  actor?: number | null,
): AIOrchestration {
  assertTransition(orch.status, "awaiting_tool");
  const event = makeEvent("awaiting_tool", actor ?? null, "Orchestration awaiting tool response");
  return {
    ...orch,
    status:    "awaiting_tool",
    history:   [...orch.history, event],
    updatedAt: new Date().toISOString(),
  };
}

export function markAwaitingHuman(
  orch: AIOrchestration,
  actor?: number | null,
): AIOrchestration {
  assertTransition(orch.status, "awaiting_human");
  const event = makeEvent("awaiting_human", actor ?? null, "Orchestration awaiting human input");
  return {
    ...orch,
    status:    "awaiting_human",
    history:   [...orch.history, event],
    updatedAt: new Date().toISOString(),
  };
}

export function retryOrchestration(
  orch: AIOrchestration,
  actor?: number | null,
): AIOrchestration {
  if (orch.attempt >= orch.maxAttempts) {
    throw new Error(
      `Max attempts reached: ${orch.attempt}/${orch.maxAttempts}`
    );
  }
  assertTransition(orch.status, "retrying");
  const event = makeEvent("retried", actor ?? null, `Retrying attempt ${orch.attempt + 1}`);
  return {
    ...orch,
    status:    "retrying",
    attempt:   orch.attempt + 1,
    error:     null,
    lineage:   [...orch.lineage, orch.id],
    history:   [...orch.history, event],
    updatedAt: new Date().toISOString(),
  };
}

export function computeOrchestrationMetrics(
  orchestrations: AIOrchestration[],
): OrchestrationMetrics {
  const total     = orchestrations.length;
  const completed = orchestrations.filter(o => o.status === "completed").length;
  const failed    = orchestrations.filter(o => o.status === "failed").length;

  const completedWithDuration = orchestrations.filter(
    o => o.status === "completed" && o.completedAt !== null
  );

  const avgLatencyMs =
    completedWithDuration.length === 0
      ? 0
      : completedWithDuration.reduce((acc, o) => {
          const start = new Date(o.startedAt).getTime();
          const end   = new Date(o.completedAt!).getTime();
          return acc + (end - start);
        }, 0) / completedWithDuration.length;

  return { total, completed, failed, avgLatencyMs };
}
