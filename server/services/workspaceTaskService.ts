/**
 * Sprint 5.0 — Workspace Task Service
 *
 * Gerencia tarefas do Workspace: criação, dependências, filas e priorização.
 * Persistência graceful via repo. Determinístico.
 */

import {
  createWorkspaceTask,
  readyQueue,
  prioritizeTasks,
  transitionTask,
  type WorkspaceTask,
  type WorkspaceTaskType,
  type WorkspaceTaskPriority,
} from "../domain/workspaceTask";
import type { CopilotType } from "../domain/institutionalCopilot";
import { insertTask } from "../db/workspace";

export async function createTask(params: {
  workspaceId: string;
  organizationId: number;
  taskType: WorkspaceTaskType;
  title: string;
  assignedCopilot?: CopilotType | null;
  assignedUser?: number | null;
  priority?: WorkspaceTaskPriority;
  dependencies?: string[];
  approvalRequired?: boolean;
  correlationId: string;
}): Promise<WorkspaceTask> {
  const task = createWorkspaceTask(params);
  await insertTask(task);
  return task;
}

export async function completeTask(task: WorkspaceTask): Promise<WorkspaceTask> {
  // Percorre a cadeia válida até "done": pending → in_progress → in_review → done.
  let current = task;
  if (current.status === "pending" || current.status === "blocked") current = transitionTask(current, "in_progress");
  if (current.status === "in_progress") current = transitionTask(current, "in_review");
  if (current.status === "in_review") current = transitionTask(current, "done");
  await insertTask(current);
  return current;
}

/** Fila de execução: tarefas prontas (dependências satisfeitas) ordenadas por prioridade. */
export function computeReadyQueue(tasks: readonly WorkspaceTask[]): WorkspaceTask[] {
  return readyQueue(tasks);
}

export function computePrioritized(tasks: readonly WorkspaceTask[]): WorkspaceTask[] {
  return prioritizeTasks(tasks);
}
