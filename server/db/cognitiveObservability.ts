/**
 * RC-4.2.1 — Cognitive Observability — persistência (Drizzle).
 *
 * Camada de PERSISTÊNCIA da observabilidade cognitiva. Padrão getDb(): degrada sem DB
 * (insert no-op, get null). Multi-tenant. Determinística (id via sha256, sem Date.now).
 */

import { and, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "./connection";
import { cognitiveObservabilityTable } from "../../drizzle/schema";

export interface ObservabilityRow {
  id: string;
  tenantId: number;
  correlationId: string;
  task: string;
  replayHash: string;
  reasoningPlanId: string;
  reasoningPlanHash: string;
  provider: string;
  latencyMs: number;
  totalTokens: number;
  structuredOutputValid: boolean;
  executionStatus: string;
  /** Snapshot completo da observabilidade (JSON). */
  payload: unknown;
  createdAt?: string;
}

function rowId(correlationId: string, replayHash: string): string {
  return createHash("sha256").update(`cobs:${correlationId}:${replayHash}`).digest("hex").slice(0, 20);
}

export async function insertObservability(row: Omit<ObservabilityRow, "id" | "createdAt">): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const id = rowId(row.correlationId, row.replayHash);
  await db.insert(cognitiveObservabilityTable).values({
    id, tenantId: row.tenantId, correlationId: row.correlationId, task: row.task,
    replayHash: row.replayHash, reasoningPlanId: row.reasoningPlanId, reasoningPlanHash: row.reasoningPlanHash,
    provider: row.provider, latencyMs: row.latencyMs, totalTokens: row.totalTokens,
    structuredOutputValid: row.structuredOutputValid ? 1 : 0, executionStatus: row.executionStatus,
    payload: JSON.stringify(row.payload ?? null),
  }).onDuplicateKeyUpdate({ set: { payload: JSON.stringify(row.payload ?? null), executionStatus: row.executionStatus } });
  return id;
}

export async function getObservabilityByCorrelation(correlationId: string): Promise<ObservabilityRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(cognitiveObservabilityTable)
    .where(eq(cognitiveObservabilityTable.correlationId, correlationId))
    .orderBy(desc(cognitiveObservabilityTable.createdAt)).limit(1);
  if (!rows.length) return null;
  const r = rows[0];
  let payload: unknown = null;
  try { payload = r.payload ? JSON.parse(r.payload) : null; } catch { payload = null; }
  return {
    id: r.id, tenantId: r.tenantId, correlationId: r.correlationId, task: r.task, replayHash: r.replayHash,
    reasoningPlanId: r.reasoningPlanId, reasoningPlanHash: r.reasoningPlanHash, provider: r.provider,
    latencyMs: r.latencyMs, totalTokens: r.totalTokens, structuredOutputValid: r.structuredOutputValid === 1,
    executionStatus: r.executionStatus, payload, createdAt: r.createdAt,
  };
}

export async function countObservabilityForTenant(tenantId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: cognitiveObservabilityTable.id }).from(cognitiveObservabilityTable)
    .where(and(eq(cognitiveObservabilityTable.tenantId, tenantId)));
  return rows.length;
}
