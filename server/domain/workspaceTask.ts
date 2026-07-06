/**
 * Sprint 5.0 — Workspace Task
 *
 * Tarefa operacional dentro de um Workspace Cognitivo. Pode ser atribuída a um
 * copiloto e/ou a um usuário, ter dependências, prioridade e exigir aprovação.
 * Determinística, multi-tenant (via workspace).
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export type WorkspaceTaskType =
  | "elaborar_documento"
  | "revisar_documento"
  | "pesquisar_precos"
  | "fundamentar_juridico"
  | "analisar_risco"
  | "aprovar"
  | "consolidar"
  | "generico";

export type WorkspaceTaskStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "in_review"
  | "done"
  | "cancelled";

export type WorkspaceTaskPriority = "baixa" | "media" | "alta" | "urgente";

export interface WorkspaceTask {
  readonly id: string;
  readonly workspaceId: string;
  readonly organizationId: number;
  readonly taskType: WorkspaceTaskType;
  readonly title: string;
  readonly assignedCopilot: CopilotType | null;
  readonly assignedUser: number | null;
  readonly priority: WorkspaceTaskPriority;
  readonly status: WorkspaceTaskStatus;
  readonly dependencies: readonly string[];
  readonly dueDate: string | null;
  readonly approvalRequired: boolean;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const TASK_TRANSITIONS: Record<WorkspaceTaskStatus, WorkspaceTaskStatus[]> = {
  pending: ["in_progress", "blocked", "cancelled"],
  in_progress: ["in_review", "blocked", "done", "cancelled"],
  blocked: ["pending", "in_progress", "cancelled"],
  in_review: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export function createWorkspaceTask(params: {
  workspaceId: string;
  organizationId: number;
  taskType: WorkspaceTaskType;
  title: string;
  assignedCopilot?: CopilotType | null;
  assignedUser?: number | null;
  priority?: WorkspaceTaskPriority;
  dependencies?: string[];
  dueDate?: string | null;
  approvalRequired?: boolean;
  correlationId: string;
  createdAt?: string;
}): WorkspaceTask {
  const id = createHash("sha256")
    .update(`wtask:${params.organizationId}:${params.workspaceId}:${params.taskType}:${params.title}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    workspaceId: params.workspaceId,
    organizationId: params.organizationId,
    taskType: params.taskType,
    title: params.title,
    assignedCopilot: params.assignedCopilot ?? null,
    assignedUser: params.assignedUser ?? null,
    priority: params.priority ?? "media",
    status: "pending",
    dependencies: params.dependencies ?? [],
    dueDate: params.dueDate ?? null,
    approvalRequired: params.approvalRequired ?? false,
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function canTransitionTask(from: WorkspaceTaskStatus, to: WorkspaceTaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function transitionTask(task: WorkspaceTask, to: WorkspaceTaskStatus, at?: string): WorkspaceTask {
  if (!canTransitionTask(task.status, to)) {
    throw new Error(`Transição de tarefa inválida: ${task.status} → ${to}`);
  }
  return { ...task, status: to, updatedAt: at ?? new Date().toISOString() };
}

/** Uma tarefa está pronta para iniciar quando todas as dependências estão concluídas. */
export function isReady(task: WorkspaceTask, doneTaskIds: ReadonlySet<string>): boolean {
  return task.dependencies.every(dep => doneTaskIds.has(dep));
}

const PRIORITY_RANK: Record<WorkspaceTaskPriority, number> = { urgente: 4, alta: 3, media: 2, baixa: 1 };

/** Ordena tarefas por prioridade (desc) e depois por id (determinístico). */
export function prioritizeTasks(tasks: readonly WorkspaceTask[]): WorkspaceTask[] {
  return [...tasks].sort(
    (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Fila de tarefas prontas para execução (dependências satisfeitas, não terminais). */
export function readyQueue(tasks: readonly WorkspaceTask[]): WorkspaceTask[] {
  const done = new Set(tasks.filter(t => t.status === "done").map(t => t.id));
  const ready = tasks.filter(t => (t.status === "pending" || t.status === "blocked") && isReady(t, done));
  return prioritizeTasks(ready);
}
