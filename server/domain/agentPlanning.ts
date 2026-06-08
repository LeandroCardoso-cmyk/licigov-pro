import { createHash } from "crypto";

// ─── Helper ───────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskPriority = "critical" | "high" | "medium" | "low";

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "blocked";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AgentGoal {
  readonly description: string;
  readonly successCriteria: string[];
  readonly priority: TaskPriority;
}

export interface AgentConstraint {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly constraintType: "time" | "resource" | "legal" | "safety" | "budget";
  readonly value: string | number;
  readonly isHard: boolean; // hard = must satisfy, soft = best effort
}

export interface AgentAction {
  readonly id: string;
  readonly actionType: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly estimatedMs: number;
  readonly safetyLevel: string;
}

export interface ExecutionDependency {
  readonly id: string;
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly dependencyType: "sequential" | "parallel" | "conditional";
}

export interface ExecutionTask {
  readonly id: string;
  readonly planId: string;
  readonly organizationId: number;
  readonly taskName: string;
  readonly taskType: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly dependsOn: string[]; // task IDs
  readonly parallelizable: boolean;
  readonly estimatedMs: number;
  readonly actions: AgentAction[];
  readonly output: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface ExecutionPlan {
  readonly id: string;
  readonly organizationId: number;
  readonly sessionId: string;
  readonly planName: string;
  readonly goal: AgentGoal;
  readonly tasks: ExecutionTask[];
  readonly dependencies: ExecutionDependency[];
  readonly constraints: AgentConstraint[];
  readonly estimatedDurationMs: number;
  readonly replayKey: string;
  readonly planVersion: "1.0.0";
  readonly createdAt: string;
  readonly status: "draft" | "ready" | "executing" | "completed" | "failed";
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createExecutionPlan(params: {
  organizationId: number;
  sessionId: string;
  planName: string;
  goal: AgentGoal;
  constraints?: AgentConstraint[];
}): ExecutionPlan {
  const now = new Date().toISOString();
  const replayKey = sha256(
    JSON.stringify({
      organizationId: params.organizationId,
      sessionId: params.sessionId,
      planName: params.planName,
      taskNames: [] as string[],
    })
  );
  const id = sha256(`plan:${params.organizationId}:${params.sessionId}:${params.planName}`).slice(0, 20);

  return {
    id,
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    planName: params.planName,
    goal: params.goal,
    tasks: [],
    dependencies: [],
    constraints: params.constraints ?? [],
    estimatedDurationMs: 0,
    replayKey,
    planVersion: "1.0.0",
    createdAt: now,
    status: "draft",
  };
}

export function addTaskToPlan(plan: ExecutionPlan, task: Omit<ExecutionTask, "planId" | "id" | "createdAt" | "completedAt" | "output">): ExecutionPlan {
  const now = new Date().toISOString();
  const taskId = sha256(
    `task:${plan.id}:${task.taskName}:${plan.tasks.length}`
  ).slice(0, 20);
  const newTask: ExecutionTask = {
    id: taskId,
    planId: plan.id,
    organizationId: plan.organizationId,
    taskName: task.taskName,
    taskType: task.taskType,
    description: task.description,
    priority: task.priority,
    status: task.status,
    dependsOn: task.dependsOn,
    parallelizable: task.parallelizable,
    estimatedMs: task.estimatedMs,
    actions: task.actions,
    output: null,
    createdAt: now,
    completedAt: null,
  };

  const taskNames = [...plan.tasks, newTask].map((t) => t.taskName).sort();
  const replayKey = sha256(
    JSON.stringify({
      organizationId: plan.organizationId,
      sessionId: plan.sessionId,
      planName: plan.planName,
      taskNames,
    })
  );

  return {
    ...plan,
    tasks: [...plan.tasks, newTask],
    replayKey,
    estimatedDurationMs: estimatePlanDuration({
      ...plan,
      tasks: [...plan.tasks, newTask],
    }),
  };
}

export function addDependency(
  plan: ExecutionPlan,
  fromId: string,
  toId: string,
  type: ExecutionDependency["dependencyType"],
): ExecutionPlan {
  const depId = sha256(`dep:${plan.id}:${fromId}:${toId}`).slice(0, 20);
  const dep: ExecutionDependency = {
    id: depId,
    fromTaskId: fromId,
    toTaskId: toId,
    dependencyType: type,
  };
  return {
    ...plan,
    dependencies: [...plan.dependencies, dep],
  };
}

export function getReadyTasks(plan: ExecutionPlan): ExecutionTask[] {
  const completedIds = new Set(
    plan.tasks
      .filter((t) => t.status === "completed" || t.status === "skipped")
      .map((t) => t.id)
  );
  return plan.tasks.filter(
    (t) =>
      t.status === "pending" &&
      t.dependsOn.every((depId) => completedIds.has(depId))
  );
}

export function getParallelizableTasks(plan: ExecutionPlan): ExecutionTask[] {
  return getReadyTasks(plan).filter((t) => t.parallelizable);
}

export function topologicalSort(plan: ExecutionPlan): ExecutionTask[] {
  // Kahn's algorithm — tiebreak by taskName alphabetically for determinism
  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // id → list of tasks that depend on it

  for (const task of plan.tasks) {
    if (!inDegree.has(task.id)) inDegree.set(task.id, 0);
    if (!dependents.has(task.id)) dependents.set(task.id, []);
    for (const depId of task.dependsOn) {
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      const list = dependents.get(depId) ?? [];
      list.push(task.id);
      dependents.set(depId, list);
    }
  }

  // Initialize queue with zero in-degree tasks, sorted alphabetically
  const queue: ExecutionTask[] = plan.tasks
    .filter((t) => (inDegree.get(t.id) ?? 0) === 0)
    .sort((a, b) => a.taskName.localeCompare(b.taskName));

  const result: ExecutionTask[] = [];

  while (queue.length > 0) {
    // Pop first (already sorted)
    const current = queue.shift()!;
    result.push(current);

    const deps = dependents.get(current.id) ?? [];
    const newReady: ExecutionTask[] = [];
    for (const depId of deps) {
      const newDeg = (inDegree.get(depId) ?? 1) - 1;
      inDegree.set(depId, newDeg);
      if (newDeg === 0) {
        const depTask = taskMap.get(depId);
        if (depTask) newReady.push(depTask);
      }
    }
    // Insert new ready tasks in alphabetical order
    newReady.sort((a, b) => a.taskName.localeCompare(b.taskName));
    queue.push(...newReady);
    // Re-sort (stable, since new tasks are added at end but we need sorted front)
    queue.sort((a, b) => a.taskName.localeCompare(b.taskName));
  }

  return result;
}

export function validatePlanConstraints(plan: ExecutionPlan): string[] {
  const violations: string[] = [];

  // Check for circular dependencies
  const sorted = topologicalSort(plan);
  if (sorted.length !== plan.tasks.length) {
    violations.push("Dependências circulares detectadas no plano");
  }

  // Check that all dependsOn references exist
  const taskIds = new Set(plan.tasks.map((t) => t.id));
  for (const task of plan.tasks) {
    for (const depId of task.dependsOn) {
      if (!taskIds.has(depId)) {
        violations.push(`Tarefa '${task.taskName}' depende de ID inexistente: ${depId}`);
      }
    }
  }

  // Check hard constraints
  for (const constraint of plan.constraints.filter((c) => c.isHard)) {
    if (constraint.constraintType === "time" && typeof constraint.value === "number") {
      if (plan.estimatedDurationMs > constraint.value) {
        violations.push(
          `Restrição de tempo violada: ${plan.estimatedDurationMs}ms > ${constraint.value}ms (${constraint.name})`
        );
      }
    }
  }

  return violations;
}

export function estimatePlanDuration(plan: ExecutionPlan): number {
  // Critical path: max path length in ms (DFS)
  if (plan.tasks.length === 0) return 0;

  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));

  // Build adjacency (dependsOn → dependents)
  const dependents = new Map<string, string[]>();
  for (const task of plan.tasks) {
    if (!dependents.has(task.id)) dependents.set(task.id, []);
    for (const depId of task.dependsOn) {
      const list = dependents.get(depId) ?? [];
      list.push(task.id);
      dependents.set(depId, list);
    }
  }

  // Memoized longest path
  const memo = new Map<string, number>();

  function longestPath(taskId: string): number {
    if (memo.has(taskId)) return memo.get(taskId)!;
    const task = taskMap.get(taskId);
    if (!task) return 0;
    const deps = dependents.get(taskId) ?? [];
    if (deps.length === 0) {
      memo.set(taskId, task.estimatedMs);
      return task.estimatedMs;
    }
    const result = task.estimatedMs + Math.max(...deps.map(longestPath));
    memo.set(taskId, result);
    return result;
  }

  return Math.max(...plan.tasks.map((t) => longestPath(t.id)));
}
