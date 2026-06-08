import { createHash } from "crypto";
import {
  type ExecutionPlan,
  type ExecutionTask,
  type AgentGoal,
  createExecutionPlan,
  addTaskToPlan,
  addDependency,
  getReadyTasks,
  getParallelizableTasks,
  topologicalSort,
  validatePlanConstraints,
  estimatePlanDuration,
} from "../domain/agentPlanning";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentPlanningInput {
  organizationId: number;
  sessionId: string;
  planName: string;
  goal: AgentGoal;
  rawTasks: Array<{
    name: string;
    type: string;
    description: string;
    priority: ExecutionTask["priority"];
    dependsOn?: string[];
    parallelizable?: boolean;
    estimatedMs?: number;
  }>;
}

export interface AgentPlanningOutput {
  plan: ExecutionPlan;
  sortedTasks: ExecutionTask[];
  readyTasks: ExecutionTask[];
  criticalPath: string[];
  estimatedDurationMs: number;
  violations: string[];
  replayKey: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _store = new Map<number, AgentPlanningOutput[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

function computeCriticalPath(plan: ExecutionPlan): string[] {
  const sorted = topologicalSort(plan);
  if (sorted.length === 0) return [];
  // Find path with max cumulative ms
  const taskMap = new Map(plan.tasks.map(t => [t.id, t]));
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const t of sorted) { dist.set(t.id, t.estimatedMs); prev.set(t.id, null); }
  for (const t of sorted) {
    const dependents = plan.tasks.filter(task => task.dependsOn.includes(t.id));
    for (const dep of dependents) {
      const newDist = (dist.get(t.id) ?? 0) + dep.estimatedMs;
      if (newDist > (dist.get(dep.id) ?? 0)) {
        dist.set(dep.id, newDist);
        prev.set(dep.id, t.id);
      }
    }
  }
  // Find end node with max dist
  let maxDist = 0; let endId = "";
  for (const [id, d] of dist) { if (d > maxDist) { maxDist = d; endId = id; } }
  const path: string[] = [];
  let cur: string | null | undefined = endId;
  while (cur) {
    const task = taskMap.get(cur);
    if (task) path.unshift(task.taskName);
    cur = prev.get(cur);
  }
  return path;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export function planExecution(input: AgentPlanningInput): AgentPlanningOutput {
  const { organizationId, sessionId, planName, goal, rawTasks } = input;
  let plan = createExecutionPlan({ organizationId, sessionId, planName, goal });

  // Build task name → id map for dependency resolution
  const nameToId = new Map<string, string>();

  for (const rawTask of rawTasks) {
    const tempPlan = addTaskToPlan(plan, {
      organizationId,
      taskName: rawTask.name,
      taskType: rawTask.type,
      description: rawTask.description,
      priority: rawTask.priority,
      status: "pending",
      dependsOn: [],
      parallelizable: rawTask.parallelizable ?? false,
      estimatedMs: rawTask.estimatedMs ?? 1000,
      actions: [],
    });
    const newTask = tempPlan.tasks[tempPlan.tasks.length - 1];
    nameToId.set(rawTask.name, newTask.id);
    plan = tempPlan;
  }

  // Add dependencies
  for (const rawTask of rawTasks) {
    const fromId = nameToId.get(rawTask.name);
    if (!fromId) continue;
    for (const depName of rawTask.dependsOn ?? []) {
      const toId = nameToId.get(depName);
      if (toId) plan = addDependency(plan, toId, fromId, "sequential");
    }
  }

  const sortedTasks = topologicalSort(plan);
  const readyTasks = getReadyTasks(plan);
  const criticalPath = computeCriticalPath(plan);
  const estimatedDurationMs = estimatePlanDuration(plan);
  const violations = validatePlanConstraints(plan);

  const replayKey = sha256(JSON.stringify({
    organizationId,
    sessionId,
    planName,
    taskNames: rawTasks.map(t => t.name).sort(),
  }));

  const output: AgentPlanningOutput = {
    plan,
    sortedTasks,
    readyTasks,
    criticalPath,
    estimatedDurationMs,
    violations,
    replayKey,
  };

  const existing = _store.get(organizationId) ?? [];
  _store.set(organizationId, [...existing, output]);
  return output;
}

export function getPlanHistory(organizationId: number): AgentPlanningOutput[] {
  return _store.get(organizationId) ?? [];
}

export function replayPlan(original: AgentPlanningOutput): AgentPlanningOutput {
  const { plan } = original;
  return planExecution({
    organizationId: plan.organizationId,
    sessionId: plan.sessionId,
    planName: plan.planName,
    goal: plan.goal,
    rawTasks: plan.tasks.map(t => ({
      name: t.taskName,
      type: t.taskType,
      description: t.description,
      priority: t.priority,
      dependsOn: [],
      parallelizable: t.parallelizable,
      estimatedMs: t.estimatedMs,
    })),
  });
}
