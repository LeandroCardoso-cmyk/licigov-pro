/**
 * Sprint 5.0 — Workspace Timeline
 *
 * Linha do tempo institucional de um Workspace. Registra automaticamente cada
 * atividade relevante (decisões, revisões, aprovações, recomendações, mudanças)
 * de forma auditável e determinística (replay). Append-only.
 */

import { createHash } from "crypto";

export type TimelineEventType =
  | "workspace_created"
  | "stage_advanced"
  | "task_created"
  | "task_completed"
  | "copilot_activated"
  | "recommendation"
  | "review"
  | "decision"
  | "approval"
  | "rejection"
  | "risk_identified"
  | "comment"
  | "change";

export interface TimelineEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly organizationId: number;
  readonly order: number;
  readonly eventType: TimelineEventType;
  readonly actor: string;
  readonly summary: string;
  readonly refId: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createTimelineEntry(params: {
  workspaceId: string;
  organizationId: number;
  order: number;
  eventType: TimelineEventType;
  actor: string;
  summary: string;
  refId?: string;
  correlationId: string;
  createdAt?: string;
}): TimelineEntry {
  const id = createHash("sha256")
    .update(`wtl:${params.organizationId}:${params.workspaceId}:${params.order}:${params.eventType}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workspaceId: params.workspaceId,
    organizationId: params.organizationId,
    order: params.order,
    eventType: params.eventType,
    actor: params.actor,
    summary: params.summary,
    refId: params.refId ?? "",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Adiciona uma entrada calculando a próxima ordem sequencial. */
export function appendTimeline(
  entries: readonly TimelineEntry[],
  params: {
    workspaceId: string;
    organizationId: number;
    eventType: TimelineEventType;
    actor: string;
    summary: string;
    refId?: string;
    correlationId: string;
    createdAt?: string;
  },
): TimelineEntry[] {
  const entry = createTimelineEntry({ ...params, order: entries.length });
  return [...entries, entry];
}

/** Snapshot determinístico da timeline para replay/auditoria. */
export function timelineSnapshot(entries: readonly TimelineEntry[]): string {
  const canonical = entries.map(e => `${e.order}:${e.eventType}:${e.actor}:${e.refId}`);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}
