import { createHash } from "crypto";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export type ExecutionType = "inference" | "embedding" | "classification" | "completion";
export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "fallback_triggered" | "replay";

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ReplaySnapshot {
  readonly originalExecutionId: string;
  readonly snapshotKey: string;
  readonly snapshotedAt: string;
}

export interface ProviderExecution {
  readonly id: string;
  readonly organizationId: number;
  readonly workflowId: string;
  readonly providerId: string;
  readonly model: string;
  readonly executionType: ExecutionType;
  readonly promptHash: string;
  readonly promptVersion: string;
  readonly requestPayload: Record<string, unknown>;
  readonly responsePayload: Record<string, unknown>;
  readonly tokenUsage: TokenUsage;
  readonly latencyMs: number;
  readonly retryCount: number;
  readonly fallbackTriggered: boolean;
  readonly executionStatus: ExecutionStatus;
  readonly correlationId: string;
  readonly replaySnapshot: ReplaySnapshot | null;
  readonly reasoningTrace: string | null;
  readonly explainabilityData: Record<string, unknown> | null;
  readonly createdAt: string;
}

export function createProviderExecution(params: {
  organizationId: number;
  workflowId: string;
  providerId: string;
  model: string;
  executionType: ExecutionType;
  requestPayload: Record<string, unknown>;
  correlationId?: string;
}): ProviderExecution {
  const now = new Date().toISOString();
  const promptStr = JSON.stringify(params.requestPayload);
  const promptHash = sha256(promptStr);
  const correlationId = params.correlationId ?? sha256(`corr:${params.organizationId}:${params.workflowId}:${now}`).slice(0,20);
  const id = sha256(`pexec:${params.organizationId}:${correlationId}:${params.model}`).slice(0,20);
  return {
    id,
    organizationId: params.organizationId,
    workflowId: params.workflowId,
    providerId: params.providerId,
    model: params.model,
    executionType: params.executionType,
    promptHash,
    promptVersion: "1.0",
    requestPayload: params.requestPayload,
    responsePayload: {},
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    latencyMs: 0,
    retryCount: 0,
    fallbackTriggered: false,
    executionStatus: "pending",
    correlationId,
    replaySnapshot: null,
    reasoningTrace: null,
    explainabilityData: null,
    createdAt: now,
  };
}

export function completeExecution(exec: ProviderExecution, result: {
  responsePayload: Record<string, unknown>;
  tokenUsage: TokenUsage;
  latencyMs: number;
  reasoningTrace?: string;
  explainabilityData?: Record<string, unknown>;
}): ProviderExecution {
  return { ...exec, executionStatus: "completed", responsePayload: result.responsePayload, tokenUsage: result.tokenUsage, latencyMs: result.latencyMs, reasoningTrace: result.reasoningTrace ?? null, explainabilityData: result.explainabilityData ?? null };
}

export function failExecution(exec: ProviderExecution, errorMessage: string): ProviderExecution {
  return { ...exec, executionStatus: "failed", responsePayload: { error: errorMessage }, explainabilityData: { failureReason: errorMessage } };
}

export function triggerFallback(exec: ProviderExecution): ProviderExecution {
  return { ...exec, executionStatus: "fallback_triggered", fallbackTriggered: true };
}

export function createReplaySnapshot(exec: ProviderExecution): ProviderExecution {
  const snapshotKey = sha256(`snapshot:${exec.id}:${exec.promptHash}`);
  return {
    ...exec,
    replaySnapshot: { originalExecutionId: exec.id, snapshotKey, snapshotedAt: new Date().toISOString() },
    executionStatus: "replay",
  };
}

export function isReplayable(exec: ProviderExecution): boolean {
  return exec.executionStatus === "completed" && exec.replaySnapshot !== null;
}
