/**
 * R4 / PR-07 (SEM-004) — orquestração do registro de DECISÃO INSTITUCIONAL (ratificação da contratação direta).
 *
 * Uma transação LOCAL e determinística (sem IA, S3, HTTP, e-mail ou provider remoto):
 *   1. lock da linha-pai do assunto (`SELECT … FOR UPDATE`, tenant-scoped) — serializa decisões concorrentes;
 *   2. lê a decisão já gravada com a mesma chave de idempotência e a decisão corrente do assunto;
 *   3. decide com a regra pura `planDecision` (replay | CONFLICT | insert);
 *   4. insert: grava a nova revisão (INSERT puro), reflete a ETAPA da contratação direta só quando o resultado
 *      é "ratificado" (um "não ratificado" nunca põe o workspace em status `ratificado` — INV-08) e registra o
 *      evento de timeline com id estável (= id da decisão; retry nunca duplica nem reescreve).
 * O resultado nunca vem de default, e a autoridade nunca é o usuário que clicou (INV-13): ver
 * `server/domain/institutionalDecision.ts`.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { directProcurementWorkspacesTable } from "../../drizzle/schema";
import { recordProcessEvent } from "../db/procurement";
import {
  DecisionWriteRaceError, getCurrentDecision, getDecisionByIdempotencyKey, insertDecision, lockDecisionSubject,
} from "../db/institutionalDecisions";
import {
  DECISION_MESSAGES, DECISION_STALE_REVISION, planDecision, validateDecisionRequest,
  type DecisionRequest, type InstitutionalDecision,
} from "../domain/institutionalDecision";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("institutionalDecisionService");

export interface RecordDecisionResult {
  readonly decision: InstitutionalDecision;
  /** true = retry idempotente (mesma chave + mesmo pedido): nada foi escrito. */
  readonly replayed: boolean;
}

/** Registra a ratificação (ou não ratificação) de uma contratação direta no ledger. */
export async function recordDirectProcurementRatification(request: DecisionRequest): Promise<RecordDecisionResult> {
  const startedAt = Date.now();
  const base = {
    organizationId: request.organizationId, subjectType: request.subjectType, subjectId: request.subjectId,
    recordedByUserId: request.recordedByUserId, correlationId: request.correlationId,
  };
  const validation = validateDecisionRequest(request);
  if (!validation.ok) {
    log.warn("institutional_decision_rejected", { ...base, reason: validation.code, fields: validation.fields ?? [] });
    throw new TRPCError({ code: "BAD_REQUEST", message: DECISION_MESSAGES[validation.code] });
  }
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível — decisão não registrada (fail-closed)." });

  let outcome: { kind: "replay" | "insert"; decision: InstitutionalDecision } | { kind: "conflict"; code: string; currentRevision: number } | { kind: "missing" };
  try {
    outcome = await db.transaction(async (tx) => {
      const exists = await lockDecisionSubject(tx, request.organizationId, request.subjectType, request.subjectId);
      if (!exists) return { kind: "missing" as const };
      const [byKey, current] = await Promise.all([
        getDecisionByIdempotencyKey(tx, request.organizationId, request.idempotencyKey.trim()),
        getCurrentDecision(tx, request.organizationId, request.subjectType, request.subjectId),
      ]);
      const plan = planDecision(request, { byIdempotencyKey: byKey, current });
      if (plan.kind !== "insert") return plan;
      const d = plan.decision;
      await insertDecision(tx, d);
      if (d.outcome === "ratificado") {
        await tx.update(directProcurementWorkspacesTable)
          .set({ currentStage: "RATIFICATION", status: "ratificado", updatedAt: sql`CURRENT_TIMESTAMP(3)` })
          .where(and(eq(directProcurementWorkspacesTable.id, d.subjectId), eq(directProcurementWorkspacesTable.organizationId, d.organizationId)));
      }
      await recordProcessEvent({
        organizationId: d.organizationId, processId: d.subjectId, eventType: "approval",
        actor: String(d.recordedByUserId),
        summary: `Decisão de ratificação registrada (rev. ${d.revision}): ${d.outcome}; autoridade declarada: ${d.decidedByRole}${d.supersedesDecisionId ? "; substitui a decisão anterior" : ""}.`,
        refId: d.id, correlationId: d.correlationId, idempotencyKey: d.id,
      }, tx);
      return plan;
    });
  } catch (err) {
    if (err instanceof DecisionWriteRaceError) {
      log.warn("institutional_decision_conflict", { ...base, reason: DECISION_STALE_REVISION, outcome: "CONFLICT", durationMs: Date.now() - startedAt });
      throw new TRPCError({ code: "CONFLICT", message: DECISION_MESSAGES[DECISION_STALE_REVISION] });
    }
    throw err;
  }

  if (outcome.kind === "missing") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Processo de contratação direta não encontrado nesta organização." });
  }
  if (outcome.kind === "conflict") {
    log.warn("institutional_decision_conflict", { ...base, reason: outcome.code, currentRevision: outcome.currentRevision, outcome: "CONFLICT", durationMs: Date.now() - startedAt });
    throw new TRPCError({ code: "CONFLICT", message: DECISION_MESSAGES[outcome.code] });
  }
  log.info(outcome.kind === "replay" ? "institutional_decision_replayed" : "institutional_decision_recorded", {
    ...base, decisionId: outcome.decision.id, revision: outcome.decision.revision,
    outcome: outcome.kind === "replay" ? "IDEMPOTENT_CONVERGENCE" : "RECORDED",
    authorityValidation: outcome.decision.authorityValidation, durationMs: Date.now() - startedAt,
  });
  return { decision: outcome.decision, replayed: outcome.kind === "replay" };
}
