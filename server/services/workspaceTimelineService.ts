/**
 * Sprint 5.0 — Workspace Timeline Service
 *
 * Registra automaticamente toda atividade relevante do Workspace na linha do
 * tempo institucional (auditável, determinística, replay-safe). Persistência graceful.
 */

import {
  createTimelineEntry,
  timelineSnapshot,
  type TimelineEntry,
  type TimelineEventType,
} from "../domain/workspaceTimeline";
import { insertTimelineEntry, listTimeline } from "../db/workspace";

/**
 * Registra um evento na timeline. A ordem é calculada a partir do total de
 * eventos já persistidos (consulta o repo; sem DB, começa em 0).
 */
export async function recordEvent(params: {
  organizationId: number;
  workspaceId: string;
  eventType: TimelineEventType;
  actor: string;
  summary: string;
  refId?: string;
  correlationId: string;
}): Promise<TimelineEntry> {
  const existing = await listTimeline(params.workspaceId, params.organizationId);
  const entry = createTimelineEntry({ ...params, order: existing.length });
  await insertTimelineEntry(entry);
  return entry;
}

export async function getTimeline(workspaceId: string, organizationId: number): Promise<Array<{ id: string; order: number; eventType: string; actor: string; summary: string; refId: string; createdAt: string }>> {
  return listTimeline(workspaceId, organizationId);
}

export { timelineSnapshot };
