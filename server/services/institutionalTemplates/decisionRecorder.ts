/**
 * Gravação de decisões institucionais HUMANAS ligadas aos Modelos (revisão do documento composto, fontes governadas,
 * evidência de aprovação jurídica). Reusa o ledger EXISTENTE (`institutional_decisions`, append-only) e o lock do assunto
 * (`lockDecisionSubject`) — nenhum segundo ledger, nenhum segundo lock. A transação (com retry de deadlock, SEM-084) repete
 * INTEIRA; a decisão é determinística por (órgão, assunto, revisão), então replay nunca duplica.
 */
import { getCurrentDecision, getDecisionByIdempotencyKey, insertDecision, lockDecisionSubject, DecisionWriteRaceError } from "../../db/institutionalDecisions";
import { TemplatePersistenceError, withTemplatesTransaction } from "../../db/institutionalTemplates";
import {
  DECISION_MESSAGES, planDecision, validateDecisionRequest,
  type DecisionRequest, type DecisionSubjectType, type InstitutionalDecision, type InstitutionalDecisionType,
} from "../../domain/institutionalDecision";
import { TemplateWorkflowError } from "./errors";
import type { WorkflowContext } from "./ports";

export interface DecisionActInput {
  readonly confirm: boolean;
  readonly idempotencyKey: string;
  readonly decision: {
    readonly decidedByName: string; readonly decidedByRole: string; readonly decidedByUserId?: number | null;
    readonly decidedAt: string; readonly basisReference: string; readonly reason: string;
  };
}

export interface RecordedDecision { readonly decision: InstitutionalDecision; readonly replayed: boolean }

export interface RecordDecisionSpec {
  readonly subjectType: DecisionSubjectType;
  readonly decisionType: InstitutionalDecisionType;
  readonly outcome: string;
  readonly subjectId: string;
  readonly evidence: readonly string[];
  readonly act: DecisionActInput;
  /**
   * `converge`  — o MESMO ato (mesmo assunto) já registrado devolve a decisão existente (aceite de IA, reconhecimento);
   * `revision`  — decisão REVISADA: CAS por `expectedRevision` (0 = primeira); outra decisão corrente ⇒ DECISION_STALE_REVISION.
   */
  readonly mode: "converge" | "revision";
  readonly expectedRevision?: number;
}

/** Valida (campos do ato obrigatórios, resultado do catálogo) e grava, tudo fail-closed. Nada é gravado em caso de recusa. */
export async function recordHumanDecision(ctx: WorkflowContext, spec: RecordDecisionSpec): Promise<RecordedDecision> {
  const request: DecisionRequest = {
    organizationId: ctx.organizationId, subjectType: spec.subjectType, subjectId: spec.subjectId, decisionType: spec.decisionType, outcome: spec.outcome,
    decidedByName: spec.act.decision.decidedByName, decidedByRole: spec.act.decision.decidedByRole, decidedByUserId: spec.act.decision.decidedByUserId ?? null,
    decidedAt: spec.act.decision.decidedAt, basisReference: spec.act.decision.basisReference, reason: spec.act.decision.reason, evidence: spec.evidence,
    recordedByUserId: ctx.actor.userId, expectedRevision: spec.mode === "revision" ? (spec.expectedRevision ?? 0) : 0,
    idempotencyKey: spec.act.idempotencyKey, correlationId: ctx.correlationId,
  };
  const valid = validateDecisionRequest(request);
  if (!valid.ok) {
    throw new TemplateWorkflowError("DECISION_REJECTED", DECISION_MESSAGES[valid.code] ?? valid.code,
      (valid.fields ?? []).map((f) => ({ code: valid.code, path: f, message: "campo obrigatório ou inválido" })));
  }
  try {
    return await withTemplatesTransaction("template.decision.record", ctx, async (tx) => {
      const exists = await lockDecisionSubject(tx, ctx.organizationId, spec.subjectType, spec.subjectId);
      if (!exists) throw new TemplatePersistenceError("NOT_FOUND", "assunto inexistente neste tenant");
      const [byKey, current] = await Promise.all([
        getDecisionByIdempotencyKey(tx, ctx.organizationId, spec.act.idempotencyKey.trim()),
        getCurrentDecision(tx, ctx.organizationId, spec.subjectType, spec.subjectId),
      ]);
      if (spec.mode === "converge" && current && !byKey) return { decision: current, replayed: true };
      const plan = planDecision(request, { byIdempotencyKey: byKey, current });
      if (plan.kind === "replay") return { decision: plan.decision, replayed: true };
      if (plan.kind === "conflict") {
        throw new TemplateWorkflowError(plan.code === "DECISION_STALE_REVISION" ? "STALE_STATE" : "DECISION_REJECTED", DECISION_MESSAGES[plan.code]);
      }
      await insertDecision(tx, plan.decision);
      return { decision: plan.decision, replayed: false };
    });
  } catch (err) {
    if (err instanceof TemplatePersistenceError && err.code === "NOT_FOUND") throw new TemplateWorkflowError("NOT_FOUND", "recurso não encontrado nesta organização");
    if (err instanceof DecisionWriteRaceError) throw new TemplateWorkflowError("STALE_STATE", "outra pessoa registrou esta decisão ao mesmo tempo; recarregue");
    throw err;
  }
}
