/**
 * R4 / PR-07 — repositório do ledger APPEND-ONLY `institutional_decisions` (migration 0312).
 *
 * Só INSERT e SELECT: não existe caminho de UPDATE/DELETE nesta tabela (guarda estática em
 * `institutional-decision-ledger.test.ts`). Toda leitura é tenant-scoped (organization_id do contexto).
 * A transação, o lock do assunto e a decisão (replay/CAS/insert) ficam no serviço
 * `institutionalDecisionService`; aqui só há primitivas que recebem o executor.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { institutionalDecisionsTable, directProcurementWorkspacesTable } from "../../drizzle/schema";
import { isDuplicateKeyError, type ProcurementExecutor } from "./procurement";
import type { DecisionSubjectType, InstitutionalDecision, InstitutionalDecisionType, AuthorityValidation } from "../domain/institutionalDecision";

/** Outra gravação da MESMA revisão (ou da mesma chave) venceu a corrida — o serviço converte em CONFLICT. */
export class DecisionWriteRaceError extends Error {
  constructor() { super("institutional_decision_write_race"); this.name = "DecisionWriteRaceError"; }
}

type Row = typeof institutionalDecisionsTable.$inferSelect;

function parseEvidence(raw: string | null): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

function fromRow(r: Row): InstitutionalDecision {
  return {
    id: r.id, organizationId: r.organizationId, subjectType: r.subjectType as DecisionSubjectType, subjectId: r.subjectId,
    decisionType: r.decisionType as InstitutionalDecisionType, outcome: r.outcome, revision: r.revision,
    supersedesDecisionId: r.supersedesDecisionId ?? null, decidedByName: r.decidedByName, decidedByRole: r.decidedByRole,
    decidedByUserId: r.decidedByUserId ?? null, decidedAt: r.decidedAt, basisReference: r.basisReference, reason: r.reason,
    evidence: parseEvidence(r.evidence), recordedByUserId: r.recordedByUserId,
    authorityValidation: r.authorityValidation as AuthorityValidation, correlationId: r.correlationId,
    idempotencyKey: r.idempotencyKey, requestHash: r.requestHash,
  };
}

/**
 * Lock do ASSUNTO (linha-pai) para serializar decisões concorrentes sobre ele. Devolve false se o assunto não
 * existe no órgão (anti-enumeração: o serviço responde NOT_FOUND neutro).
 */
export async function lockDecisionSubject(
  tx: ProcurementExecutor, organizationId: number, subjectType: DecisionSubjectType, subjectId: string,
): Promise<boolean> {
  if (subjectType === "direct_procurement.ratification") {
    const rows = await tx.select({ id: directProcurementWorkspacesTable.id }).from(directProcurementWorkspacesTable)
      .where(and(eq(directProcurementWorkspacesTable.id, subjectId), eq(directProcurementWorkspacesTable.organizationId, organizationId)))
      .for("update");
    return rows.length === 1;
  }
  return false;
}

export async function getDecisionByIdempotencyKey(
  exec: ProcurementExecutor, organizationId: number, idempotencyKey: string,
): Promise<InstitutionalDecision | null> {
  const rows = await exec.select().from(institutionalDecisionsTable)
    .where(and(eq(institutionalDecisionsTable.organizationId, organizationId), eq(institutionalDecisionsTable.idempotencyKey, idempotencyKey)))
    .limit(1);
  return rows.length ? fromRow(rows[0]) : null;
}

/** Decisão CORRENTE do assunto = a de maior revisão (as anteriores ficam como histórico superado). */
export async function getCurrentDecision(
  exec: ProcurementExecutor | null, organizationId: number, subjectType: DecisionSubjectType, subjectId: string,
): Promise<InstitutionalDecision | null> {
  const db = exec ?? await getDb();
  if (!db) return null;
  const rows = await db.select().from(institutionalDecisionsTable)
    .where(and(
      eq(institutionalDecisionsTable.organizationId, organizationId),
      eq(institutionalDecisionsTable.subjectType, subjectType),
      eq(institutionalDecisionsTable.subjectId, subjectId),
    ))
    .orderBy(desc(institutionalDecisionsTable.revision)).limit(1);
  return rows.length ? fromRow(rows[0]) : null;
}

/** Histórico completo do assunto, da 1ª revisão à corrente. */
export async function listDecisions(
  organizationId: number, subjectType: DecisionSubjectType, subjectId: string,
): Promise<InstitutionalDecision[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(institutionalDecisionsTable)
    .where(and(
      eq(institutionalDecisionsTable.organizationId, organizationId),
      eq(institutionalDecisionsTable.subjectType, subjectType),
      eq(institutionalDecisionsTable.subjectId, subjectId),
    ))
    .orderBy(asc(institutionalDecisionsTable.revision));
  return rows.map(fromRow);
}

/** INSERT puro. Colisão de PK/UNIQUE (revisão ou chave já gravadas por outra transação) ⇒ DecisionWriteRaceError. */
export async function insertDecision(tx: ProcurementExecutor, d: InstitutionalDecision): Promise<void> {
  try {
    await tx.insert(institutionalDecisionsTable).values({
      id: d.id, organizationId: d.organizationId, subjectType: d.subjectType, subjectId: d.subjectId,
      decisionType: d.decisionType, outcome: d.outcome, revision: d.revision, supersedesDecisionId: d.supersedesDecisionId,
      decidedByName: d.decidedByName, decidedByRole: d.decidedByRole, decidedByUserId: d.decidedByUserId,
      decidedAt: d.decidedAt, basisReference: d.basisReference, reason: d.reason, evidence: JSON.stringify(d.evidence),
      recordedByUserId: d.recordedByUserId, authorityValidation: d.authorityValidation, correlationId: d.correlationId,
      idempotencyKey: d.idempotencyKey, requestHash: d.requestHash,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new DecisionWriteRaceError();
    throw err;
  }
}
