import { createHash } from "crypto";
import {
  type AgentExecution,
  createAgentExecution,
  advanceExecutionStage,
  addExecutionCheckpoint,
  recordExecutionDecision,
} from "../domain/agentExecution";
import { type SafetyCheck, performSafetyCheck, classifyAction } from "../domain/actionSafety";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentExecutionEngineInput {
  organizationId: number;
  sessionId: string;
  agentType: string;
  stages: Array<{ name: string; input: Record<string, unknown>; estimatedMs?: number }>;
  planId?: string;
  complianceRules?: Array<{ ruleId: string; ruleName: string }>;
}

export interface AgentExecutionEngineOutput {
  execution: AgentExecution;
  stageOutputs: Record<string, Record<string, unknown>>;
  safetyChecks: SafetyCheck[];
  approvalRequired: boolean;
  replayKey: string;
  processingMs: number;
  correlationId: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _store = new Map<number, Map<string, AgentExecutionEngineOutput[]>>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

function simulateStageOutput(stageName: string, input: Record<string, unknown>): Record<string, unknown> {
  const hash = sha256(`${stageName}${JSON.stringify(input)}`).slice(0, 20);
  return { result: hash, stageName, simulatedAt: new Date().toISOString() };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export function runAgentExecution(input: AgentExecutionEngineInput): AgentExecutionEngineOutput {
  const start = Date.now();
  const { organizationId, sessionId, agentType, stages } = input;

  const stageNames = stages.map(s => s.name);
  let execution = createAgentExecution({ organizationId, sessionId, agentType, stageNames });
  const stageOutputs: Record<string, Record<string, unknown>> = {};
  const safetyChecks: SafetyCheck[] = [];
  let approvalRequired = false;

  for (const stage of stages) {
    const classification = classifyAction(organizationId, `agent_${stage.name}`, stage.input);
    const check = performSafetyCheck(organizationId, `agent_${stage.name}`, execution.id, 0.85);
    safetyChecks.push(check);

    if (check.recommendation === "block") {
      execution = advanceExecutionStage(execution, stage.name, { error: "blocked" }, "failed");
      break;
    }

    if (check.recommendation === "escalate" || classification.requiresApproval) {
      approvalRequired = true;
      execution = recordExecutionDecision(execution, {
        decisionType: "approval_gate",
        decision: "pause",
        rationale: `Stage '${stage.name}' requer aprovação humana`,
        confidence: 0.9,
        decidedBy: "system",
      });
      execution = advanceExecutionStage(execution, stage.name, { status: "awaiting_approval" }, "completed");
    } else {
      const output = simulateStageOutput(stage.name, stage.input);
      stageOutputs[stage.name] = output;
      execution = advanceExecutionStage(execution, stage.name, output, "completed");
      execution = addExecutionCheckpoint(execution, `after_${stage.name}`, output, true);
    }
  }

  const replayKey = sha256(JSON.stringify({
    organizationId, sessionId, agentType,
    stageNames: stageNames.sort(),
  }));

  const output: AgentExecutionEngineOutput = {
    execution,
    stageOutputs,
    safetyChecks,
    approvalRequired,
    replayKey,
    processingMs: Date.now() - start,
    correlationId: execution.correlationId,
  };

  const orgStore = _store.get(organizationId) ?? new Map();
  const sessStore = orgStore.get(sessionId) ?? [];
  orgStore.set(sessionId, [...sessStore, output]);
  _store.set(organizationId, orgStore);

  return output;
}

export function getExecutionHistory(organizationId: number, sessionId?: string): AgentExecutionEngineOutput[] {
  const orgStore = _store.get(organizationId);
  if (!orgStore) return [];
  if (sessionId) return orgStore.get(sessionId) ?? [];
  return [...orgStore.values()].flat();
}

export function replayExecution(original: AgentExecutionEngineOutput): AgentExecutionEngineOutput {
  const { execution } = original;
  return runAgentExecution({
    organizationId: execution.organizationId,
    sessionId: execution.sessionId,
    agentType: execution.agentType,
    stages: execution.stages.map(s => ({ name: s.stageName, input: s.input })),
  });
}
