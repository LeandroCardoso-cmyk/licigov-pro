/**
 * Sprint 5.0 — Workspace Observability Service
 *
 * Emite traces (console JSON) e persiste métricas de produtividade, tempo e fluxo
 * na tabela workspace_metrics (graceful sem DB): tempo por tarefa/copiloto/etapa,
 * gargalos, filas, revisões, aprovações.
 */

import { recordWorkspaceMetric } from "../db/workspace";

export async function recordProductivity(params: {
  organizationId: number;
  workspaceId: string;
  correlationId: string;
  metricName: string;
  value: number;
  unit?: string;
  tags?: Record<string, string>;
}): Promise<void> {
  console.info(JSON.stringify({ event: "workspace_metric", ...params }));
  await recordWorkspaceMetric({
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    correlationId: params.correlationId,
    metricName: params.metricName,
    metricValue: params.value,
    metricUnit: params.unit ?? "count",
    tags: params.tags,
  });
}

/** Registra a conclusão de uma tarefa (contador de produtividade). */
export async function recordTaskCompletion(params: {
  organizationId: number;
  workspaceId: string;
  correlationId: string;
  taskType: string;
}): Promise<void> {
  await recordProductivity({
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    correlationId: params.correlationId,
    metricName: "workspace.task.completed",
    value: 1,
    tags: { taskType: params.taskType },
  });
}

/** Registra uma aprovação concluída. */
export async function recordApproval(params: {
  organizationId: number;
  workspaceId: string;
  correlationId: string;
}): Promise<void> {
  await recordProductivity({
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    correlationId: params.correlationId,
    metricName: "workspace.approval",
    value: 1,
  });
}

/**
 * Calcula um resumo de fluxo (filas/gargalos) a partir dos status das tarefas.
 * Puro — não persiste; útil para dashboards.
 */
export function computeFlowSummary(taskStatuses: readonly string[]): {
  pending: number;
  inProgress: number;
  blocked: number;
  inReview: number;
  done: number;
  bottleneck: string | null;
} {
  const count = (s: string) => taskStatuses.filter(t => t === s).length;
  const summary = {
    pending: count("pending"),
    inProgress: count("in_progress"),
    blocked: count("blocked"),
    inReview: count("in_review"),
    done: count("done"),
    bottleneck: null as string | null,
  };
  const openStages: Array<[string, number]> = [
    ["blocked", summary.blocked],
    ["in_review", summary.inReview],
    ["pending", summary.pending],
    ["in_progress", summary.inProgress],
  ];
  openStages.sort((a, b) => b[1] - a[1]);
  if (openStages[0][1] > 0) summary.bottleneck = openStages[0][0];
  return summary;
}
