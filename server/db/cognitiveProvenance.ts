/**
 * V1 PRE-PILOT CLOSURE — Fase A1 — Cognitive Provenance — persistência (Drizzle).
 *
 * Camada de PERSISTÊNCIA do ledger de proveniência cognitiva. Padrão getDb(): degrada
 * sem DB (insert no-op, reads null/[]). MULTI-TENANT: toda leitura é escopada por
 * organization_id — NUNCA lookup por ID global sem prova de tenant. Determinística
 * (id do envelope, sem Date.now). Aceita executor (db|tx) para linkage ATÔMICO.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { cognitiveProvenanceTable } from "../../drizzle/schema";
import type { ProvenanceEnvelope } from "../domain/cognitiveProvenance";

/** Executor: a conexão (getDb) ou uma transação Drizzle — permite persistir junto do commit documental. */
type ProvDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type ProvenanceExecutor = ProvDb | Parameters<Parameters<ProvDb["transaction"]>[0]>[0];

export type CognitiveProvenanceRecord = typeof cognitiveProvenanceTable.$inferSelect;

function envelopeToRow(env: ProvenanceEnvelope): typeof cognitiveProvenanceTable.$inferInsert {
  return {
    id: env.id,
    organizationId: env.organizationId,
    executionId: env.executionId,
    correlationId: env.correlationId,
    task: env.task,
    executionMode: env.executionMode,
    executionStatus: env.executionStatus,
    degradationReason: env.degradationReason,
    failureClass: env.failureClass,
    groundingState: env.groundingState,
    provenanceClass: env.provenanceClass,
    provider: env.provider,
    model: env.model,
    taskVersion: env.taskVersion,
    promptContractVersion: env.promptContractVersion,
    orchestratorVersion: env.orchestratorVersion,
    inputFingerprint: env.inputFingerprint,
    outputFingerprint: env.outputFingerprint,
    evidenceFingerprint: env.evidenceFingerprint,
    replayHash: env.replayHash,
    idempotencyKey: env.idempotencyKey,
    isReplay: env.isReplay ? 1 : 0,
    replayOfExecutionId: env.replayOfExecutionId,
    approvalState: env.approvalState,
    businessDomain: env.businessDomain,
    processId: env.processId,
    workspaceId: env.workspaceId,
    stage: env.stage,
    actorUserId: env.actorUserId,
    failureMessage: env.failureMessage,
  };
}

/**
 * Persiste (ou reafirma, idempotente) o envelope de proveniência. Idempotente por `id`
 * determinístico: re-execuções da MESMA execução lógica não duplicam. NÃO reescreve o
 * fingerprint de saída ORIGINAL nem o input/replay (imutáveis); em duplicata só reafirma
 * o estado de execução/aprovação e o linkage. Retorna o `id` (ou null sem DB).
 */
export async function insertCognitiveProvenance(env: ProvenanceEnvelope, executor?: ProvenanceExecutor): Promise<string | null> {
  const db = executor ?? (await getDb());
  if (!db) return null;
  const row = envelopeToRow(env);
  await db
    .insert(cognitiveProvenanceTable)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        executionStatus: row.executionStatus,
        degradationReason: row.degradationReason,
        failureClass: row.failureClass,
        approvalState: row.approvalState,
        failureMessage: row.failureMessage,
      },
    });
  return env.id;
}

/** Recupera proveniência por executionId — SEMPRE escopado ao tenant (organization_id). */
export async function getProvenanceByExecutionId(organizationId: number, executionId: string): Promise<CognitiveProvenanceRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(cognitiveProvenanceTable)
    .where(and(eq(cognitiveProvenanceTable.organizationId, organizationId), eq(cognitiveProvenanceTable.executionId, executionId)))
    .orderBy(desc(cognitiveProvenanceTable.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Recupera a proveniência ORIGINAL de uma chave de idempotência — escopado ao tenant. Base
 * do replay cognitivo: a 2ª execução com a mesma chave referencia esta original (não re-chama
 * provider). Ignora marcadores de replay (só a original autoritativa). Cross-tenant impossível.
 */
export async function getOriginalProvenanceByIdempotencyKey(organizationId: number, idempotencyKey: string): Promise<CognitiveProvenanceRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(cognitiveProvenanceTable)
    .where(
      and(
        eq(cognitiveProvenanceTable.organizationId, organizationId),
        eq(cognitiveProvenanceTable.idempotencyKey, idempotencyKey),
        eq(cognitiveProvenanceTable.isReplay, 0),
      ),
    )
    .orderBy(desc(cognitiveProvenanceTable.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Lista as proveniências de um correlationId — escopado ao tenant. Base do artifact lineage. */
export async function listProvenanceByCorrelation(organizationId: number, correlationId: string): Promise<CognitiveProvenanceRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(cognitiveProvenanceTable)
    .where(and(eq(cognitiveProvenanceTable.organizationId, organizationId), eq(cognitiveProvenanceTable.correlationId, correlationId)))
    .orderBy(desc(cognitiveProvenanceTable.createdAt));
}

/**
 * Vincula a proveniência de um correlationId ao ARTEFATO produzido (generated_document) e,
 * quando materializado, ao documento oficial + linhagem. Escopado ao tenant. Aceita executor
 * (tx) para ocorrer na MESMA transação da persistência do artefato (atomicidade: sem artefato
 * com proveniência perdida). Não fabrica nada: só preenche o linkage factual.
 */
export async function linkProvenanceArtifact(
  executor: ProvenanceExecutor,
  p: {
    organizationId: number;
    correlationId: string;
    artifactKind?: string | null;
    artifactId?: string | null;
    officialDocumentId?: string | null;
    officialLineageId?: string | null;
    approvalState?: string;
  },
): Promise<void> {
  if (!p.correlationId) return;
  await executor
    .update(cognitiveProvenanceTable)
    .set({
      artifactKind: p.artifactKind ?? null,
      artifactId: p.artifactId ?? null,
      officialDocumentId: p.officialDocumentId ?? null,
      officialLineageId: p.officialLineageId ?? null,
      ...(p.approvalState ? { approvalState: p.approvalState } : {}),
    })
    .where(
      and(
        eq(cognitiveProvenanceTable.organizationId, p.organizationId),
        eq(cognitiveProvenanceTable.correlationId, p.correlationId),
      ),
    );
}

/** Contagem por tenant (auditoria/testes). */
export async function countProvenanceForTenant(organizationId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ id: cognitiveProvenanceTable.id })
    .from(cognitiveProvenanceTable)
    .where(eq(cognitiveProvenanceTable.organizationId, organizationId));
  return rows.length;
}
