/**
 * Adapter REAL do `TemplateGovernancePort` sobre o ledger institucional EXISTENTE (`institutional_decisions`). Nenhuma tabela
 * nova, nenhum segundo ledger/lock: `lockDecisionSubject` (extensão do mecanismo existente para a revisão do modelo).
 * Procedência e evidência jurídica são decisões append-only de assunto = revisão exata; NÃO transitam a revisão.
 */
import { DecisionWriteRaceError, getCurrentDecision, getDecisionByIdempotencyKey, insertDecision, listDecisions, lockDecisionSubject } from "../../../db/institutionalDecisions";
import { TemplatePersistenceError, withTemplatesTransaction } from "../../../db/institutionalTemplates";
import { DECISION_STALE_REVISION, planDecision } from "../../../domain/institutionalDecision";
import type { TemplateGovernancePort } from "../ports";
import { translatePersistenceError } from "./errors";

export function createTemplateGovernanceAdapter(): TemplateGovernancePort {
  return {
    async recordGovernanceDecision(request) {
      const ctx = { organizationId: request.organizationId, actorUserId: request.recordedByUserId, correlationId: request.correlationId };
      try {
        return await withTemplatesTransaction("template.governance.decision", ctx, async (tx) => {
          const exists = await lockDecisionSubject(tx, request.organizationId, request.subjectType, request.subjectId);
          if (!exists) return { status: "SUBJECT_NOT_FOUND" as const };
          const [byKey, current] = await Promise.all([
            getDecisionByIdempotencyKey(tx, request.organizationId, request.idempotencyKey.trim()),
            getCurrentDecision(tx, request.organizationId, request.subjectType, request.subjectId),
          ]);
          const plan = planDecision(request, { byIdempotencyKey: byKey, current });
          if (plan.kind === "replay") return { status: "REPLAYED" as const, decision: plan.decision };
          if (plan.kind === "conflict") {
            return plan.code === DECISION_STALE_REVISION
              ? { status: "STALE_VERSION" as const, currentVersion: plan.currentRevision }
              : { status: "DECISION_IDEMPOTENCY_CONFLICT" as const };
          }
          await insertDecision(tx, plan.decision); // colisão de versão ⇒ DecisionWriteRaceError (rollback)
          return { status: "COMMITTED" as const, decision: plan.decision };
        });
      } catch (err) {
        if (err instanceof DecisionWriteRaceError) {
          const current = await getCurrentDecision(null, request.organizationId, request.subjectType, request.subjectId);
          return { status: "STALE_VERSION", currentVersion: current?.revision ?? 0 };
        }
        if (err instanceof TemplatePersistenceError) return translatePersistenceError(err);
        throw err;
      }
    },
    listGovernanceDecisions: (org, subjectType, revisionId) => listDecisions(org, subjectType, revisionId),
  };
}
