import { createHash } from "crypto";

// ─── Helper ───────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentExecutionStatus =
  | "pending"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "rolled_back"
  | "cancelled";

export type ExecutionStageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ExecutionStage {
  readonly id: string;
  readonly executionId: string;
  readonly organizationId: number;
  readonly stageName: string;
  readonly status: ExecutionStageStatus;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown> | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly errorMessage: string | null;
}

export interface ExecutionCheckpoint {
  readonly id: string;
  readonly executionId: string;
  readonly organizationId: number;
  readonly checkpointName: string;
  readonly snapshotData: Record<string, unknown>;
  readonly isRollbackPoint: boolean;
  readonly createdAt: string;
}

export interface ExecutionDecision {
  readonly id: string;
  readonly executionId: string;
  readonly organizationId: number;
  readonly decisionType: string;
  readonly decision: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly decidedBy: string;
  readonly createdAt: string;
}

export interface ExecutionTrace {
  readonly id: string;
  readonly executionId: string;
  readonly organizationId: number;
  readonly traceType: string;
  readonly message: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export interface ExecutionReplay {
  readonly id: string;
  readonly originalExecutionId: string;
  readonly organizationId: number;
  readonly reason: string;
  readonly replayKey: string;
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly createdAt: string;
}

export interface ExecutionRollback {
  readonly id: string;
  readonly executionId: string;
  readonly organizationId: number;
  readonly reason: string;
  readonly initiatedBy: string;
  readonly checkpointId: string | null;
  readonly status: "pending" | "executing" | "completed" | "failed";
  readonly createdAt: string;
}

export interface AgentExecution {
  readonly id: string;
  readonly organizationId: number;
  readonly sessionId: string;
  readonly agentType: string;
  readonly status: AgentExecutionStatus;
  readonly currentStage: string | null;
  readonly stages: ExecutionStage[];
  readonly checkpoints: ExecutionCheckpoint[];
  readonly decisions: ExecutionDecision[];
  readonly replayKey: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly rollbackAt: string | null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createAgentExecution(params: {
  organizationId: number;
  sessionId: string;
  agentType: string;
  stageNames: string[];
  planId?: string;
  correlationId?: string;
}): AgentExecution {
  const now = new Date().toISOString();
  const sortedStageNames = [...params.stageNames].sort();
  const replayKey = sha256(
    JSON.stringify({
      organizationId: params.organizationId,
      sessionId: params.sessionId,
      agentType: params.agentType,
      stageNames: sortedStageNames,
    })
  );
  const correlationId =
    params.correlationId ??
    sha256(`corr:${params.organizationId}:${params.sessionId}:${Date.now()}`).slice(0, 20);
  const requestId = sha256(
    `req:${params.organizationId}:${params.sessionId}:${params.agentType}:${Date.now()}`
  ).slice(0, 20);
  const id = sha256(
    `exec:${params.organizationId}:${params.sessionId}:${params.agentType}:${replayKey}`
  ).slice(0, 20);

  return {
    id,
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    agentType: params.agentType,
    status: "pending",
    currentStage: null,
    stages: [],
    checkpoints: [],
    decisions: [],
    replayKey,
    correlationId,
    requestId,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    rollbackAt: null,
  };
}

// ─── State transitions (immutable) ───────────────────────────────────────────

export function advanceExecutionStage(
  execution: AgentExecution,
  stageName: string,
  output: Record<string, unknown>,
  status: ExecutionStageStatus = "completed",
): AgentExecution {
  const now = new Date().toISOString();
  const stageId = sha256(`stage:${execution.id}:${stageName}:${execution.stages.length}`).slice(0, 20);
  const stage: ExecutionStage = {
    id: stageId,
    executionId: execution.id,
    organizationId: execution.organizationId,
    stageName,
    status,
    input: {},
    output,
    startedAt: now,
    completedAt: status === "completed" || status === "failed" ? now : null,
    durationMs: 0,
    errorMessage: status === "failed" ? "Stage failed" : null,
  };

  const allCompleted = [...execution.stages, stage].every(
    (s) => s.status === "completed" || s.status === "skipped"
  );
  const anyFailed = [...execution.stages, stage].some((s) => s.status === "failed");

  const newStatus: AgentExecutionStatus =
    status === "failed"
      ? "failed"
      : anyFailed
      ? "failed"
      : allCompleted
      ? "completed"
      : "running";

  return {
    ...execution,
    currentStage: stageName,
    stages: [...execution.stages, stage],
    status: newStatus,
    updatedAt: now,
    completedAt: newStatus === "completed" || newStatus === "failed" ? now : execution.completedAt,
  };
}

export function addExecutionCheckpoint(
  execution: AgentExecution,
  checkpointName: string,
  snapshotData: Record<string, unknown>,
  isRollbackPoint: boolean = false,
): AgentExecution {
  const now = new Date().toISOString();
  const checkpointId = sha256(
    `checkpoint:${execution.id}:${checkpointName}:${execution.checkpoints.length}`
  ).slice(0, 20);
  const checkpoint: ExecutionCheckpoint = {
    id: checkpointId,
    executionId: execution.id,
    organizationId: execution.organizationId,
    checkpointName,
    snapshotData,
    isRollbackPoint,
    createdAt: now,
  };
  return {
    ...execution,
    checkpoints: [...execution.checkpoints, checkpoint],
    updatedAt: now,
  };
}

export function recordExecutionDecision(
  execution: AgentExecution,
  decision: {
    decisionType: string;
    decision: string;
    rationale: string;
    confidence: number;
    decidedBy: string;
  },
): AgentExecution {
  const now = new Date().toISOString();
  const decisionId = sha256(
    `decision:${execution.id}:${decision.decisionType}:${execution.decisions.length}`
  ).slice(0, 20);
  const decisionRecord: ExecutionDecision = {
    id: decisionId,
    executionId: execution.id,
    organizationId: execution.organizationId,
    decisionType: decision.decisionType,
    decision: decision.decision,
    rationale: decision.rationale,
    confidence: decision.confidence,
    decidedBy: decision.decidedBy,
    createdAt: now,
  };
  return {
    ...execution,
    decisions: [...execution.decisions, decisionRecord],
    updatedAt: now,
  };
}

export function initiateRollback(
  execution: AgentExecution,
  reason: string,
  initiatedBy: string,
  checkpointId?: string,
): ExecutionRollback {
  // Does NOT mutate execution — returns rollback record only
  const now = new Date().toISOString();
  const rollbackId = sha256(
    `rollback:${execution.id}:${reason}:${now}`
  ).slice(0, 20);
  return {
    id: rollbackId,
    executionId: execution.id,
    organizationId: execution.organizationId,
    reason,
    initiatedBy,
    checkpointId: checkpointId ?? null,
    status: "pending",
    createdAt: now,
  };
}

export function createExecutionReplay(
  originalExecution: AgentExecution,
  reason: string,
): ExecutionReplay {
  const now = new Date().toISOString();
  const replayId = sha256(
    `replay:${originalExecution.id}:${reason}:${now}`
  ).slice(0, 20);
  return {
    id: replayId,
    originalExecutionId: originalExecution.id,
    organizationId: originalExecution.organizationId,
    reason,
    replayKey: originalExecution.replayKey,
    status: "pending",
    createdAt: now,
  };
}

export function isExecutionReplayable(execution: AgentExecution): boolean {
  return (
    (execution.status === "completed" || execution.status === "failed") &&
    !!execution.replayKey
  );
}

export function getExecutionSummary(execution: AgentExecution): {
  totalStages: number;
  completedStages: number;
  failedStages: number;
  durationMs: number;
  hasRollbackPoints: boolean;
} {
  const totalStages = execution.stages.length;
  const completedStages = execution.stages.filter((s) => s.status === "completed").length;
  const failedStages = execution.stages.filter((s) => s.status === "failed").length;
  const start = new Date(execution.createdAt).getTime();
  const end = execution.completedAt
    ? new Date(execution.completedAt).getTime()
    : Date.now();
  const durationMs = end - start;
  const hasRollbackPoints = execution.checkpoints.some((c) => c.isRollbackPoint);
  return { totalStages, completedStages, failedStages, durationMs, hasRollbackPoints };
}
