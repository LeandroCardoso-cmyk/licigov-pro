/**
 * PR C.2 — Persistência da governança CATMAT/CATSER (Drizzle/MySQL).
 *
 * Duas tabelas ADITIVAS:
 *   - `catmat_decisions`      → LEDGER IMUTÁVEL (append-only) de decisões humanas.
 *   - `catmat_threshold_config` → configuração VERSIONADA do limiar (fail-closed).
 *
 * Padrão getDb(): degrada graciosamente sem DB. Multi-tenant SEMPRE por
 * `organizationId` em toda leitura/escrita. Nenhuma linha de limiar é semeada:
 * sem configuração ativa, o limiar permanece indefinido (o domínio é fail-closed).
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { catmatDecisionsTable, catmatThresholdConfigTable } from "../../drizzle/schema";
import type { CATMATGovernanceDecision } from "../domain/catmatGovernance";

// ─── Threshold config (versionado, fail-closed) ──────────────────────────────

export interface ActiveThreshold {
  readonly id: number;
  readonly minScore: number;
  readonly version: number;
}

/**
 * Lê a configuração ATIVA de limiar para a organização. Retorna `null` quando não
 * há linha ativa — nesse caso o domínio permanece fail-closed (nunca assume valor).
 */
export async function getActiveCatmatThreshold(orgId: number): Promise<ActiveThreshold | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(catmatThresholdConfigTable)
    .where(and(eq(catmatThresholdConfigTable.organizationId, orgId), eq(catmatThresholdConfigTable.active, 1)))
    .orderBy(desc(catmatThresholdConfigTable.version))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, minScore: Number(r.minScore), version: r.version };
}

/**
 * Define uma NOVA versão do limiar (decisão institucional humana em runtime).
 * O VALOR vem do chamador autorizado — nunca é escolhido aqui. Desativa a versão
 * anterior e insere a nova como ativa (lineage preservado: versões antigas ficam
 * inativas, jamais apagadas). Retorna a versão criada.
 */
export async function setCatmatThresholdConfig(params: {
  organizationId: number;
  minScore: number;
  reason: string;
  actorUserId: number;
  correlationId: string;
}): Promise<ActiveThreshold | null> {
  const db = await getDb();
  if (!db) return null;

  const current = await getActiveCatmatThreshold(params.organizationId);
  const nextVersion = (current?.version ?? 0) + 1;

  // Desativa a versão vigente (preserva histórico — nunca deleta).
  if (current) {
    await db.update(catmatThresholdConfigTable).set({ active: 0 })
      .where(and(
        eq(catmatThresholdConfigTable.organizationId, params.organizationId),
        eq(catmatThresholdConfigTable.id, current.id),
      ));
  }

  await db.insert(catmatThresholdConfigTable).values({
    organizationId: params.organizationId,
    minScore: params.minScore.toFixed(5),
    version: nextVersion,
    active: 1,
    reason: params.reason,
    actorUserId: params.actorUserId,
    correlationId: params.correlationId,
  });

  return { id: 0, minScore: params.minScore, version: nextVersion };
}

// ─── Decision ledger (imutável, append-only) ─────────────────────────────────

export interface CatmatDecisionRecord {
  readonly id: number;
  readonly decision: CATMATGovernanceDecision;
  readonly itemId: string;
  readonly processId: string | null;
  readonly suggestionId: string | null;
  readonly catmatCode: string | null;
  readonly catmatDescription: string | null;
  readonly source: string | null;
  readonly score: number | null;
  readonly justification: string | null;
  readonly thresholdMinScore: number | null;
  readonly thresholdConfigId: number | null;
  readonly actorUserId: number;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

/**
 * Anexa uma decisão ao ledger imutável. Idempotente na fronteira do banco via
 * UNIQUE (organizationId, idempotencyKey): uma reexecução da MESMA chave não cria
 * uma segunda linha. Nunca atualiza linhas anteriores (append-only).
 */
export async function insertCatmatDecision(params: {
  organizationId: number;
  processId: string | null;
  itemId: string;
  decision: CATMATGovernanceDecision;
  suggestionId?: string | null;
  catmatCode?: string | null;
  catmatDescription?: string | null;
  source?: string | null;
  score?: number | null;
  justification?: string | null;
  thresholdMinScore?: number | null;
  thresholdConfigId?: number | null;
  actorUserId: number;
  correlationId: string;
  idempotencyKey: string;
}): Promise<CatmatDecisionRecord | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(catmatDecisionsTable).values({
    organizationId: params.organizationId,
    processId: params.processId,
    itemId: params.itemId,
    decision: params.decision,
    suggestionId: params.suggestionId ?? null,
    catmatCode: params.catmatCode ?? null,
    catmatDescription: params.catmatDescription ?? null,
    source: params.source ?? null,
    score: params.score === null || params.score === undefined ? null : params.score.toFixed(5),
    justification: params.justification ?? null,
    thresholdMinScore:
      params.thresholdMinScore === null || params.thresholdMinScore === undefined
        ? null
        : params.thresholdMinScore.toFixed(5),
    thresholdConfigId: params.thresholdConfigId ?? null,
    actorUserId: params.actorUserId,
    correlationId: params.correlationId,
    idempotencyKey: params.idempotencyKey,
  }).onDuplicateKeyUpdate({
    // Idempotência tenant-aware: reexecução da mesma chave é no-op (append-only).
    set: { idempotencyKey: params.idempotencyKey },
  });

  return getLatestCatmatDecision(params.itemId, params.organizationId);
}

function mapRow(r: typeof catmatDecisionsTable.$inferSelect): CatmatDecisionRecord {
  return {
    id: r.id,
    decision: r.decision as CATMATGovernanceDecision,
    itemId: r.itemId,
    processId: r.processId ?? null,
    suggestionId: r.suggestionId ?? null,
    catmatCode: r.catmatCode ?? null,
    catmatDescription: r.catmatDescription ?? null,
    source: r.source ?? null,
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    justification: r.justification ?? null,
    thresholdMinScore:
      r.thresholdMinScore === null || r.thresholdMinScore === undefined ? null : Number(r.thresholdMinScore),
    thresholdConfigId: r.thresholdConfigId ?? null,
    actorUserId: r.actorUserId,
    correlationId: r.correlationId ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

/** Histórico IMUTÁVEL de decisões do item (mais recente primeiro). */
export async function listCatmatDecisions(itemId: string, orgId: number): Promise<CatmatDecisionRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(catmatDecisionsTable)
    .where(and(eq(catmatDecisionsTable.itemId, itemId), eq(catmatDecisionsTable.organizationId, orgId)))
    .orderBy(desc(catmatDecisionsTable.id));
  return rows.map(mapRow);
}

/** Decisão VIGENTE do item = última linha do ledger (ou null se nunca decidido). */
export async function getLatestCatmatDecision(itemId: string, orgId: number): Promise<CatmatDecisionRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(catmatDecisionsTable)
    .where(and(eq(catmatDecisionsTable.itemId, itemId), eq(catmatDecisionsTable.organizationId, orgId)))
    .orderBy(desc(catmatDecisionsTable.id))
    .limit(1);
  return rows.length > 0 ? mapRow(rows[0]) : null;
}
