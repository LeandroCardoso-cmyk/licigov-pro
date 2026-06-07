import { createHash } from "crypto";
import type { PromptChain, PromptExecutionStatus } from "../domain/promptOrchestration";
import type { ContextAssembly } from "../domain/contextAssembly";
import { buildExecutionPlan } from "../domain/promptOrchestration";
import { createReasoningStage, createReasoningTrace } from "../domain/aiReasoning";

// silence unused import warnings — these are available for callers extending this service
void createReasoningStage;
void createReasoningTrace;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  organizationId: number;
  sessionId: string;
  chainId: string;
  chain: PromptChain;
  contextAssembly: ContextAssembly;
  variables: Record<string, string>;
  maxTokens: number;
}

export interface StageExecution {
  stageId: string;
  stageName: string;
  status: PromptExecutionStatus;
  input: string;
  output: string;
  tokensUsed: number;
  durationMs: number;
  retryCount: number;
  fallbackUsed: boolean;
  replayKey: string;
  executedAt: string;
}

export interface OrchestratorResult {
  organizationId: number;
  sessionId: string;
  chainId: string;
  status: "completed" | "partial" | "failed";
  stageExecutions: StageExecution[];
  finalOutput: string;
  totalTokensUsed: number;
  totalDurationMs: number;
  replayKey: string;
  correlationId: string;
  executedAt: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _executionHistory = new Map<string, OrchestratorResult[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function sortedVariablesJson(variables: Record<string, string>): string {
  const sorted = Object.keys(variables)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = variables[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

// ─── Service functions ────────────────────────────────────────────────────────

export function executeChain(input: OrchestratorInput): OrchestratorResult {
  const { organizationId, sessionId, chainId, chain, variables } = input;

  const plan = buildExecutionPlan(chain);
  const executedAt = new Date().toISOString();

  const stageExecutions: StageExecution[] = [];
  let totalTokensUsed = 0;
  let totalDurationMs = 0;
  let allCompleted = true;

  for (const stageId of plan.executionOrder) {
    const stage = chain.stages.find(s => s.id === stageId);
    if (!stage) continue;

    const varKeys = Object.keys(variables).sort().join(",");
    const mockHash = sha256(
      stageId + sortedVariablesJson(variables),
    ).slice(0, 8);

    const output = `[Mock output para stage '${stage.name}': hash=${mockHash}, vars=${varKeys}]`;
    const tokensUsed = Math.ceil(output.length / 4);
    const durationMs = (parseInt(mockHash.slice(0, 4), 16) % 100) + 10;
    const stageReplayKey = sha256(`${stageId}${chainId}${sessionId}`);

    const execution: StageExecution = {
      stageId,
      stageName:    stage.name,
      status:       "completed",
      input:        sortedVariablesJson(variables),
      output,
      tokensUsed,
      durationMs,
      retryCount:   0,
      fallbackUsed: false,
      replayKey:    stageReplayKey,
      executedAt,
    };

    stageExecutions.push(execution);
    totalTokensUsed += tokensUsed;
    totalDurationMs += durationMs;
  }

  const sortedVarKeys = Object.keys(variables).sort().join(",");
  const replayKey = sha256(`${chainId}${sessionId}${sortedVarKeys}`);
  const correlationId = sha256(`${sessionId}${chainId}`);

  const finalOutput =
    stageExecutions.length > 0
      ? stageExecutions[stageExecutions.length - 1].output
      : "";

  const overallStatus: OrchestratorResult["status"] = allCompleted ? "completed" : "partial";

  const result: OrchestratorResult = {
    organizationId,
    sessionId,
    chainId,
    status:          overallStatus,
    stageExecutions,
    finalOutput,
    totalTokensUsed,
    totalDurationMs,
    replayKey,
    correlationId,
    executedAt,
  };

  const historyKey = `${organizationId}:${sessionId}`;
  const existing = _executionHistory.get(historyKey) ?? [];
  _executionHistory.set(historyKey, [...existing, result]);

  return result;
}

export function replayExecution(
  result: OrchestratorResult,
  newVariables?: Record<string, string>,
): OrchestratorResult {
  // Reconstruct a minimal input from the existing result to re-execute
  // We rebuild the chain from stage executions as a mock replay
  const executedAt = new Date().toISOString();
  const variables = newVariables ?? {};

  const stageExecutions: StageExecution[] = result.stageExecutions.map(prev => {
    const varKeys = Object.keys(variables).sort().join(",");
    const mockHash = sha256(
      prev.stageId + JSON.stringify(
        Object.keys(variables).sort().reduce<Record<string, string>>((acc, key) => {
          acc[key] = variables[key];
          return acc;
        }, {}),
      ),
    ).slice(0, 8);

    const output = `[Mock output para stage '${prev.stageName}': hash=${mockHash}, vars=${varKeys}]`;
    const tokensUsed = Math.ceil(output.length / 4);
    const durationMs = (parseInt(mockHash.slice(0, 4), 16) % 100) + 10;

    return {
      ...prev,
      input:       JSON.stringify(variables),
      output,
      tokensUsed,
      durationMs,
      replayKey:   sha256(`${prev.stageId}${result.chainId}${result.sessionId}`),
      executedAt,
    };
  });

  const totalTokensUsed = stageExecutions.reduce((sum, e) => sum + e.tokensUsed, 0);
  const totalDurationMs = stageExecutions.reduce((sum, e) => sum + e.durationMs, 0);
  const sortedVarKeys = Object.keys(variables).sort().join(",");
  const replayKey = sha256(`${result.chainId}${result.sessionId}${sortedVarKeys}`);

  const finalOutput =
    stageExecutions.length > 0
      ? stageExecutions[stageExecutions.length - 1].output
      : "";

  const replayed: OrchestratorResult = {
    ...result,
    stageExecutions,
    finalOutput,
    totalTokensUsed,
    totalDurationMs,
    replayKey,
    executedAt,
  };

  const historyKey = `${result.organizationId}:${result.sessionId}`;
  const existing = _executionHistory.get(historyKey) ?? [];
  _executionHistory.set(historyKey, [...existing, replayed]);

  return replayed;
}

export function getExecutionHistory(
  organizationId: number,
  sessionId: string,
): OrchestratorResult[] {
  const historyKey = `${organizationId}:${sessionId}`;
  return _executionHistory.get(historyKey) ?? [];
}
