/**
 * Contexto Canônico da Contratação — acesso ao ledger `procurement_context_facts` (append-only).
 * TODA leitura/escrita é escopada por (organizationId, processId) — nunca por processId sozinho.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "./connection";
import { procurementContextFactsTable } from "../../drizzle/schema";
import { fromDbDatetime } from "./institutionalConsultations";
import type { ProcurementExecutor } from "./procurement";
import {
  factValueHash, type AssertionStatus, type ContextPath, type ContextSourceType, type FactAssertion, type FactValue,
} from "../domain/canonicalProcurementContext";

export interface NewFactAssertion {
  path: ContextPath;
  value: FactValue;
  sourceType: ContextSourceType;
  sourceId: string;
  sourceVersion: string;
  status: AssertionStatus;
  actorUserId: number | null;
  basisValueHash: string | null;
}

/** Chave de deduplicação: o MESMO fato, da MESMA versão de fonte, nunca é gravado duas vezes. */
export function factDedupKey(organizationId: number, processId: string, a: NewFactAssertion): string {
  return createHash("sha256")
    .update(`ctxfact:v1:${organizationId}:${processId}:${a.path}:${a.sourceType}:${a.sourceId}:${a.sourceVersion}:${factValueHash(a.value)}`)
    .digest("hex");
}

export async function listContextFacts(organizationId: number, processId: string, executor?: ProcurementExecutor): Promise<FactAssertion[]> {
  const db = executor ?? await getDb();
  if (!db) return [];
  const rows = await db.select().from(procurementContextFactsTable)
    .where(and(eq(procurementContextFactsTable.organizationId, organizationId), eq(procurementContextFactsTable.processId, processId)))
    .orderBy(asc(procurementContextFactsTable.id));
  return rows.map((r) => ({
    id: r.id,
    path: r.path as ContextPath,
    value: r.valueJson == null ? null : (JSON.parse(r.valueJson) as FactValue),
    valueHash: r.valueHash,
    sourceType: r.sourceType as ContextSourceType,
    sourceId: r.sourceId,
    sourceVersion: r.sourceVersion,
    status: r.status as AssertionStatus,
    actorUserId: r.actorUserId ?? null,
    basisValueHash: r.basisValueHash ?? null,
    createdAt: fromDbDatetime(r.createdAt) ?? r.createdAt,
  }));
}

/**
 * Anexa afirmações (tx-aware). Idempotente: colisão em (organization_id, dedup_key) é ignorada — retry
 * da mesma operação não duplica. Retorna quantas foram efetivamente gravadas.
 */
export async function appendContextFacts(
  organizationId: number, processId: string, facts: readonly NewFactAssertion[], correlationId: string,
  executor?: ProcurementExecutor,
): Promise<number> {
  if (facts.length === 0) return 0;
  const db = executor ?? await getDb();
  if (!db) throw new Error("Banco de dados indisponível — afirmações de contexto não persistidas (fail-closed).");
  const rows = facts.map((f) => ({ f, dedupKey: factDedupKey(organizationId, processId, f) }));
  // Contagem fiel: o driver usa CLIENT_FOUND_ROWS (duplicata no-op também reporta affectedRows=1), então as
  // chaves já existentes são lidas antes; o upsert no-op continua sendo a garantia estrutural sob corrida.
  const existing = new Set((await db.select({ k: procurementContextFactsTable.dedupKey }).from(procurementContextFactsTable)
    .where(and(eq(procurementContextFactsTable.organizationId, organizationId), inArray(procurementContextFactsTable.dedupKey, rows.map((r) => r.dedupKey)))))
    .map((r) => r.k));
  let inserted = 0;
  for (const { f, dedupKey } of rows) {
    if (existing.has(dedupKey)) continue;
    existing.add(dedupKey);
    await db.insert(procurementContextFactsTable).values({
      organizationId, processId, path: f.path,
      valueJson: f.value === null ? null : JSON.stringify(f.value),
      valueHash: factValueHash(f.value),
      sourceType: f.sourceType, sourceId: f.sourceId.slice(0, 64), sourceVersion: f.sourceVersion.slice(0, 64),
      status: f.status, actorUserId: f.actorUserId, basisValueHash: f.basisValueHash,
      correlationId: (correlationId ?? "").slice(0, 64), dedupKey,
    }).onDuplicateKeyUpdate({ set: { dedupKey } });
    inserted++;
  }
  return inserted;
}
