import { createHash } from "crypto";
import { type SafetyLevel, classifyAction } from "../domain/actionSafety";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskSimulationInput {
  organizationId: number;
  sessionId: string;
  planId?: string;
  tasks: Array<{
    name: string;
    type: string;
    input: Record<string, unknown>;
    estimatedMs?: number;
  }>;
  simulationType: "dry_run" | "full_preview" | "rollback_preview" | "impact_estimation";
}

export interface SimulatedTask {
  name: string;
  simulatedOutput: Record<string, unknown>;
  estimatedMs: number;
  riskLevel: SafetyLevel;
  canRollback: boolean;
}

export interface TaskSimulationOutput {
  simulationId: string;
  tasks: SimulatedTask[];
  overallRisk: SafetyLevel;
  impactSummary: string;
  rollbackSummary: string;
  processingMs: number;
  replayKey: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _store = new Map<number, TaskSimulationOutput[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

const RISK_RANK: Record<SafetyLevel, number> = {
  safe: 0, low_risk: 1, medium_risk: 2, high_risk: 3, critical: 4, blocked: 5,
};

function maxRisk(a: SafetyLevel, b: SafetyLevel): SafetyLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export function simulateTasks(input: TaskSimulationInput): TaskSimulationOutput {
  const start = Date.now();
  const { organizationId, sessionId, tasks, simulationType } = input;

  const simulationId = sha256(`sim:${organizationId}:${sessionId}:${simulationType}`).slice(0, 20);
  let overallRisk: SafetyLevel = "safe";
  const simulatedTasks: SimulatedTask[] = [];

  for (const task of tasks) {
    const classification = classifyAction(organizationId, task.type, task.input);
    const simulatedOutput = {
      result: sha256(`${task.name}${JSON.stringify(task.input)}`).slice(0, 20),
      simulated: true,
      simulationType,
    };
    const canRollback = classification.isReversible && classification.rollbackStrategy !== "none";
    overallRisk = maxRisk(overallRisk, classification.safetyLevel);

    simulatedTasks.push({
      name: task.name,
      simulatedOutput,
      estimatedMs: task.estimatedMs ?? 500,
      riskLevel: classification.safetyLevel,
      canRollback,
    });
  }

  const blockedTasks = simulatedTasks.filter(t => t.riskLevel === "blocked");
  const highRiskTasks = simulatedTasks.filter(t => t.riskLevel === "high_risk" || t.riskLevel === "critical");
  const rollbackableTasks = simulatedTasks.filter(t => t.canRollback);

  const impactSummary = [
    `${simulatedTasks.length} tarefa(s) simulada(s)`,
    blockedTasks.length > 0 ? `${blockedTasks.length} bloqueada(s)` : null,
    highRiskTasks.length > 0 ? `${highRiskTasks.length} de alto risco` : null,
    `Risco geral: ${overallRisk}`,
  ].filter(Boolean).join(", ");

  const rollbackSummary = rollbackableTasks.length === 0
    ? "Nenhuma tarefa com rollback automático disponível"
    : `${rollbackableTasks.length} tarefa(s) com rollback disponível: ${rollbackableTasks.map(t => t.name).join(", ")}`;

  const replayKey = sha256(JSON.stringify({
    organizationId, sessionId, simulationType,
    taskNames: tasks.map(t => t.name).sort(),
  }));

  const output: TaskSimulationOutput = {
    simulationId,
    tasks: simulatedTasks,
    overallRisk,
    impactSummary,
    rollbackSummary,
    processingMs: Date.now() - start,
    replayKey,
  };

  const existing = _store.get(organizationId) ?? [];
  _store.set(organizationId, [...existing, output]);
  return output;
}

export function getSimulationHistory(organizationId: number): TaskSimulationOutput[] {
  return _store.get(organizationId) ?? [];
}
