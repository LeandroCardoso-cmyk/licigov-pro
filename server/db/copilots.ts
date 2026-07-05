/**
 * Sprint 4.9 — Copilots Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) dos copilotos, sessões, recomendações,
 * decision traces, políticas e métricas. Padrão getDb(): degrada graciosamente
 * sem DB (retorna null/[] / no-op). Multi-tenant por organization_id. Replay-safe.
 */

import { and, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "./connection";
import {
  copilotsTable,
  copilotSessionsTable,
  copilotRecommendationsTable,
  copilotDecisionTracesTable,
  copilotPoliciesTable,
  copilotMetricsTable,
} from "../../drizzle/schema";
import type { InstitutionalCopilot } from "../domain/institutionalCopilot";
import type { CopilotSession, CopilotSessionStatus } from "../domain/copilotSession";
import type { CopilotRecommendation } from "../domain/copilotRecommendation";
import type { CopilotDecisionTrace, TraceStep } from "../domain/copilotDecisionTrace";
import type { CopilotPolicy } from "../domain/copilotPolicy";

// ─── Copilots ─────────────────────────────────────────────────────────────────

export async function insertCopilot(copilot: InstitutionalCopilot): Promise<InstitutionalCopilot | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(copilotsTable).values({
    id: copilot.id,
    organizationId: copilot.organizationId,
    copilotType: copilot.copilotType,
    name: copilot.name,
    description: copilot.description,
    domain: copilot.domain,
    capabilities: JSON.stringify(copilot.capabilities),
    permissions: JSON.stringify(copilot.permissions),
    forbiddenActions: JSON.stringify(copilot.forbiddenActions),
    active: copilot.active ? 1 : 0,
    version: copilot.version,
    correlationId: copilot.correlationId,
    createdAt: copilot.createdAt,
  }).onDuplicateKeyUpdate({ set: { active: copilot.active ? 1 : 0, version: copilot.version } });
  return copilot;
}

export async function listCopilots(organizationId: number): Promise<Array<{ id: string; copilotType: string; name: string; domain: string; active: boolean }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(copilotsTable).where(eq(copilotsTable.organizationId, organizationId));
  return rows.map(r => ({ id: r.id, copilotType: r.copilotType, name: r.name, domain: r.domain, active: r.active === 1 }));
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function insertCopilotSession(session: CopilotSession): Promise<CopilotSession | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(copilotSessionsTable).values({
    id: session.id,
    organizationId: session.organizationId,
    workflowId: session.workflowId,
    copilotId: session.copilotId,
    copilotType: session.copilotType,
    userId: session.userId,
    contextId: session.contextId,
    reasoningId: session.reasoningId,
    query: session.query,
    status: session.status,
    correlationId: session.correlationId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }).onDuplicateKeyUpdate({ set: { status: session.status, updatedAt: session.updatedAt } });
  return session;
}

export async function getCopilotSession(id: string, organizationId: number): Promise<CopilotSession | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(copilotSessionsTable)
    .where(and(eq(copilotSessionsTable.id, id), eq(copilotSessionsTable.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, organizationId: r.organizationId, workflowId: r.workflowId,
    copilotId: r.copilotId, copilotType: r.copilotType as CopilotSession["copilotType"],
    userId: r.userId, contextId: r.contextId, reasoningId: r.reasoningId,
    query: r.query ?? "", status: r.status as CopilotSessionStatus,
    correlationId: r.correlationId, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function updateSessionStatus(id: string, organizationId: number, status: CopilotSessionStatus, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(copilotSessionsTable).set({ status, updatedAt })
    .where(and(eq(copilotSessionsTable.id, id), eq(copilotSessionsTable.organizationId, organizationId)));
  return true;
}

export async function listSessions(organizationId: number, limit = 50): Promise<Array<{ id: string; copilotType: string; query: string; status: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(copilotSessionsTable)
    .where(eq(copilotSessionsTable.organizationId, organizationId))
    .orderBy(desc(copilotSessionsTable.createdAt))
    .limit(limit);
  return rows.map(r => ({ id: r.id, copilotType: r.copilotType, query: r.query ?? "", status: r.status, createdAt: r.createdAt }));
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export async function insertRecommendation(rec: CopilotRecommendation): Promise<CopilotRecommendation | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(copilotRecommendationsTable).values({
    id: rec.id,
    organizationId: rec.organizationId,
    sessionId: rec.sessionId,
    copilotType: rec.copilotType,
    kind: rec.kind,
    summary: rec.summary,
    suggestions: JSON.stringify(rec.suggestions),
    risks: JSON.stringify(rec.risks),
    alternatives: JSON.stringify(rec.alternatives),
    justification: rec.justification,
    legalBasis: JSON.stringify(rec.legalBasis),
    evidenceIds: JSON.stringify(rec.evidenceIds),
    confidence: String(rec.confidence),
    requiresHumanReview: rec.requiresHumanReview ? 1 : 0,
    correlationId: rec.correlationId,
    createdAt: rec.createdAt,
  }).onDuplicateKeyUpdate({ set: { summary: rec.summary, confidence: String(rec.confidence) } });
  return rec;
}

export async function listRecommendationsBySession(sessionId: string, organizationId: number): Promise<Array<{ id: string; kind: string; summary: string; justification: string; confidence: number; requiresHumanReview: boolean }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(copilotRecommendationsTable)
    .where(and(eq(copilotRecommendationsTable.sessionId, sessionId), eq(copilotRecommendationsTable.organizationId, organizationId)));
  return rows.map(r => ({ id: r.id, kind: r.kind, summary: r.summary ?? "", justification: r.justification ?? "", confidence: Number(r.confidence), requiresHumanReview: r.requiresHumanReview === 1 }));
}

// ─── Decision traces ────────────────────────────────────────────────────────

export async function insertDecisionTrace(trace: CopilotDecisionTrace): Promise<CopilotDecisionTrace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(copilotDecisionTracesTable).values({
    id: trace.id,
    organizationId: trace.organizationId,
    sessionId: trace.sessionId,
    reasoningId: trace.reasoningId,
    steps: JSON.stringify(trace.steps),
    replaySnapshot: trace.replaySnapshot,
    correlationId: trace.correlationId,
    createdAt: trace.createdAt,
  }).onDuplicateKeyUpdate({ set: { steps: JSON.stringify(trace.steps), replaySnapshot: trace.replaySnapshot } });
  return trace;
}

export async function getDecisionTrace(sessionId: string, organizationId: number): Promise<{ id: string; steps: TraceStep[]; replaySnapshot: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(copilotDecisionTracesTable)
    .where(and(eq(copilotDecisionTracesTable.sessionId, sessionId), eq(copilotDecisionTracesTable.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  let steps: TraceStep[] = [];
  try { steps = r.steps ? (JSON.parse(r.steps) as TraceStep[]) : []; } catch { steps = []; }
  return { id: r.id, steps, replaySnapshot: r.replaySnapshot };
}

// ─── Policies ────────────────────────────────────────────────────────────────

export async function insertCopilotPolicy(policy: CopilotPolicy): Promise<CopilotPolicy | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(copilotPoliciesTable).values({
    id: policy.id,
    organizationId: policy.organizationId,
    copilotType: policy.copilotType,
    name: policy.name,
    allowedActions: JSON.stringify(policy.allowedActions),
    forbiddenActions: JSON.stringify(policy.forbiddenActions),
    minConfidence: String(policy.minConfidence),
    approvalRiskThreshold: policy.approvalRiskThreshold,
    active: policy.active ? 1 : 0,
    version: policy.version,
    correlationId: policy.correlationId,
    createdAt: policy.createdAt,
  }).onDuplicateKeyUpdate({ set: { name: policy.name, active: policy.active ? 1 : 0, version: policy.version } });
  return policy;
}

export async function getCopilotPolicy(copilotType: string, organizationId: number): Promise<{ id: string; allowedActions: string[]; forbiddenActions: string[] } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(copilotPoliciesTable)
    .where(and(eq(copilotPoliciesTable.copilotType, copilotType), eq(copilotPoliciesTable.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  const parse = (s: string | null): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  return { id: r.id, allowedActions: parse(r.allowedActions), forbiddenActions: parse(r.forbiddenActions) };
}

// ─── Metrics (observability) ──────────────────────────────────────────────────

export async function recordCopilotMetric(params: {
  organizationId: number;
  correlationId: string;
  copilotType: string;
  metricName: string;
  metricValue: number;
  metricUnit?: string;
  tags?: Record<string, string>;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const id = createHash("sha256")
    .update(`cmet:${params.organizationId}:${params.copilotType}:${params.metricName}:${params.correlationId}:${params.metricValue}`)
    .digest("hex").slice(0, 20);
  await db.insert(copilotMetricsTable).values({
    id,
    organizationId: params.organizationId,
    correlationId: params.correlationId,
    copilotType: params.copilotType,
    metricName: params.metricName,
    metricValue: String(params.metricValue),
    metricUnit: params.metricUnit ?? "count",
    tags: params.tags ? JSON.stringify(params.tags) : null,
  }).onDuplicateKeyUpdate({ set: { metricValue: String(params.metricValue) } });
}
