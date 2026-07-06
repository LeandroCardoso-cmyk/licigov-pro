/**
 * Sprint 5.0 — Cognitive Workspace Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) do Workspace, tarefas, timeline, decisões,
 * riscos e métricas. Padrão getDb(): degrada graciosamente sem DB. Multi-tenant
 * por organization_id. Replay-safe (IDs determinísticos do domínio).
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "./connection";
import {
  cognitiveWorkspacesTable,
  workspaceTasksTable,
  workspaceTimelineTable,
  workspaceDecisionsTable,
  workspaceRisksTable,
  workspaceMetricsTable,
} from "../../drizzle/schema";
import type { CognitiveWorkspace, WorkspaceStatus, WorkspaceStage, WorkspaceType } from "../domain/cognitiveWorkspace";
import type { WorkspaceTask, WorkspaceTaskStatus } from "../domain/workspaceTask";
import type { TimelineEntry } from "../domain/workspaceTimeline";
import type { WorkspaceDecision } from "../domain/workspaceDecision";
import type { WorkspaceRisk } from "../domain/workspaceRisk";
import type { CopilotType } from "../domain/institutionalCopilot";

function parseArr<T>(raw: string | null): T[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as T[] : []; } catch { return []; }
}

// ─── Workspace ─────────────────────────────────────────────────────────────

export async function insertWorkspace(ws: CognitiveWorkspace): Promise<CognitiveWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(cognitiveWorkspacesTable).values({
    id: ws.id, organizationId: ws.organizationId, processId: ws.processId,
    workspaceType: ws.workspaceType, title: ws.title, status: ws.status, owner: ws.owner,
    participants: JSON.stringify(ws.participants), currentStage: ws.currentStage,
    activeCopilots: JSON.stringify(ws.activeCopilots), activeTasks: JSON.stringify(ws.activeTasks),
    activeDocuments: JSON.stringify(ws.activeDocuments), correlationId: ws.correlationId,
    createdAt: ws.createdAt, updatedAt: ws.updatedAt,
  }).onDuplicateKeyUpdate({ set: { status: ws.status, currentStage: ws.currentStage, participants: JSON.stringify(ws.participants), activeCopilots: JSON.stringify(ws.activeCopilots), activeTasks: JSON.stringify(ws.activeTasks), updatedAt: ws.updatedAt } });
  return ws;
}

export async function getWorkspace(id: string, organizationId: number): Promise<CognitiveWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(cognitiveWorkspacesTable)
    .where(and(eq(cognitiveWorkspacesTable.id, id), eq(cognitiveWorkspacesTable.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, organizationId: r.organizationId, processId: r.processId,
    workspaceType: r.workspaceType as WorkspaceType, title: r.title,
    status: r.status as WorkspaceStatus, owner: r.owner,
    participants: parseArr<number>(r.participants), currentStage: r.currentStage as WorkspaceStage,
    activeCopilots: parseArr<CopilotType>(r.activeCopilots), activeTasks: parseArr<string>(r.activeTasks),
    activeDocuments: parseArr<string>(r.activeDocuments), correlationId: r.correlationId,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function updateWorkspace(ws: CognitiveWorkspace): Promise<CognitiveWorkspace | null> {
  return insertWorkspace(ws);
}

export async function listWorkspaces(organizationId: number, limit = 50): Promise<Array<{ id: string; title: string; workspaceType: string; status: string; currentStage: string; updatedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(cognitiveWorkspacesTable)
    .where(eq(cognitiveWorkspacesTable.organizationId, organizationId))
    .orderBy(desc(cognitiveWorkspacesTable.updatedAt)).limit(limit);
  return rows.map(r => ({ id: r.id, title: r.title, workspaceType: r.workspaceType, status: r.status, currentStage: r.currentStage, updatedAt: r.updatedAt }));
}

// ─── Tasks ─────────────────────────────────────────────────────────────────

export async function insertTask(task: WorkspaceTask): Promise<WorkspaceTask | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(workspaceTasksTable).values({
    id: task.id, organizationId: task.organizationId, workspaceId: task.workspaceId,
    taskType: task.taskType, title: task.title, assignedCopilot: task.assignedCopilot,
    assignedUser: task.assignedUser, priority: task.priority, status: task.status,
    dependencies: JSON.stringify(task.dependencies), dueDate: task.dueDate,
    approvalRequired: task.approvalRequired ? 1 : 0, correlationId: task.correlationId,
    createdAt: task.createdAt, updatedAt: task.updatedAt,
  }).onDuplicateKeyUpdate({ set: { status: task.status, priority: task.priority, updatedAt: task.updatedAt } });
  return task;
}

export async function listWorkspaceTasks(workspaceId: string, organizationId: number): Promise<Array<{ id: string; taskType: string; title: string; status: string; priority: string; assignedCopilot: string | null; approvalRequired: boolean }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(workspaceTasksTable)
    .where(and(eq(workspaceTasksTable.workspaceId, workspaceId), eq(workspaceTasksTable.organizationId, organizationId)));
  return rows.map(r => ({ id: r.id, taskType: r.taskType, title: r.title, status: r.status, priority: r.priority, assignedCopilot: r.assignedCopilot ?? null, approvalRequired: r.approvalRequired === 1 }));
}

export async function updateWorkspaceTaskStatus(id: string, organizationId: number, status: WorkspaceTaskStatus, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(workspaceTasksTable).set({ status, updatedAt })
    .where(and(eq(workspaceTasksTable.id, id), eq(workspaceTasksTable.organizationId, organizationId)));
  return true;
}

// ─── Timeline ────────────────────────────────────────────────────────────────

export async function insertTimelineEntry(entry: TimelineEntry): Promise<TimelineEntry | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(workspaceTimelineTable).values({
    id: entry.id, organizationId: entry.organizationId, workspaceId: entry.workspaceId,
    eventOrder: entry.order, eventType: entry.eventType, actor: entry.actor,
    summary: entry.summary, refId: entry.refId, correlationId: entry.correlationId,
    createdAt: entry.createdAt,
  }).onDuplicateKeyUpdate({ set: { summary: entry.summary } });
  return entry;
}

export async function listTimeline(workspaceId: string, organizationId: number): Promise<Array<{ id: string; order: number; eventType: string; actor: string; summary: string; refId: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(workspaceTimelineTable)
    .where(and(eq(workspaceTimelineTable.workspaceId, workspaceId), eq(workspaceTimelineTable.organizationId, organizationId)))
    .orderBy(asc(workspaceTimelineTable.eventOrder));
  return rows.map(r => ({ id: r.id, order: r.eventOrder, eventType: r.eventType, actor: r.actor, summary: r.summary ?? "", refId: r.refId, createdAt: r.createdAt }));
}

// ─── Decisions ────────────────────────────────────────────────────────────────

export async function insertDecision(decision: WorkspaceDecision): Promise<WorkspaceDecision | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(workspaceDecisionsTable).values({
    id: decision.id, organizationId: decision.organizationId, workspaceId: decision.workspaceId,
    title: decision.title, decision: decision.decision, justification: decision.justification,
    responsibleUser: decision.responsibleUser, outcome: decision.outcome, status: decision.status,
    evidenceIds: JSON.stringify(decision.evidenceIds), involvedCopilots: JSON.stringify(decision.involvedCopilots),
    correlationId: decision.correlationId, createdAt: decision.createdAt,
  }).onDuplicateKeyUpdate({ set: { status: decision.status, outcome: decision.outcome, justification: decision.justification } });
  return decision;
}

export async function listDecisions(workspaceId: string, organizationId: number): Promise<Array<{ id: string; title: string; outcome: string; status: string; responsibleUser: number }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(workspaceDecisionsTable)
    .where(and(eq(workspaceDecisionsTable.workspaceId, workspaceId), eq(workspaceDecisionsTable.organizationId, organizationId)));
  return rows.map(r => ({ id: r.id, title: r.title, outcome: r.outcome, status: r.status, responsibleUser: r.responsibleUser }));
}

export async function updateDecisionStatus(id: string, organizationId: number, status: string, outcome: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(workspaceDecisionsTable).set({ status, outcome })
    .where(and(eq(workspaceDecisionsTable.id, id), eq(workspaceDecisionsTable.organizationId, organizationId)));
  return true;
}

// ─── Risks ─────────────────────────────────────────────────────────────────

export async function insertRisk(risk: WorkspaceRisk): Promise<WorkspaceRisk | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(workspaceRisksTable).values({
    id: risk.id, organizationId: risk.organizationId, workspaceId: risk.workspaceId,
    category: risk.category, description: risk.description, severity: risk.severity,
    likelihood: String(risk.likelihood), status: risk.status, mitigation: risk.mitigation,
    correlatedRiskIds: JSON.stringify(risk.correlatedRiskIds), correlationId: risk.correlationId,
    createdAt: risk.createdAt,
  }).onDuplicateKeyUpdate({ set: { status: risk.status, mitigation: risk.mitigation } });
  return risk;
}

export async function listRisks(workspaceId: string, organizationId: number): Promise<Array<{ id: string; category: string; description: string; severity: string; status: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(workspaceRisksTable)
    .where(and(eq(workspaceRisksTable.workspaceId, workspaceId), eq(workspaceRisksTable.organizationId, organizationId)));
  return rows.map(r => ({ id: r.id, category: r.category, description: r.description ?? "", severity: r.severity, status: r.status }));
}

// ─── Metrics ───────────────────────────────────────────────────────────────

export async function recordWorkspaceMetric(params: {
  organizationId: number;
  workspaceId: string;
  correlationId: string;
  metricName: string;
  metricValue: number;
  metricUnit?: string;
  tags?: Record<string, string>;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const id = createHash("sha256")
    .update(`wm:${params.organizationId}:${params.workspaceId}:${params.metricName}:${params.correlationId}:${params.metricValue}`)
    .digest("hex").slice(0, 20);
  await db.insert(workspaceMetricsTable).values({
    id, organizationId: params.organizationId, workspaceId: params.workspaceId,
    correlationId: params.correlationId, metricName: params.metricName,
    metricValue: String(params.metricValue), metricUnit: params.metricUnit ?? "count",
    tags: params.tags ? JSON.stringify(params.tags) : null,
  }).onDuplicateKeyUpdate({ set: { metricValue: String(params.metricValue) } });
}
