/**
 * Institutional Templates — REVISÃO HUMANA do documento composto (M1): aceite EXATO de narrativa de IA e reconhecimento de
 * desvio estrutural. São decisões institucionais no ledger EXISTENTE (`institutional_decisions`, append-only), com o lock
 * do assunto (o M1) pelo mecanismo existente (`lockDecisionSubject`). A IA nunca registra nenhuma delas: só pessoa
 * autenticada, com confirmação explícita. A autoridade permanece NOT_VALIDATED_POLICY_PENDING.
 *
 * Aceite exato = (manifest M1, slot, execução, hash do texto): o chamador ecoa execução e hash e eles precisam coincidir
 * com o que o M1 registrou; qualquer divergência recusa sem escrever. Assuntos: `<manifestId>:<sha256(chave)[0..16]>`.
 */
import { createHash } from "crypto";
import { getCurrentDecision, getDecisionByIdempotencyKey, insertDecision, lockDecisionSubject, DecisionWriteRaceError } from "../../db/institutionalDecisions";
import { TemplatePersistenceError, withTemplatesTransaction } from "../../db/institutionalTemplates";
import {
  DECISION_MESSAGES, planDecision, validateDecisionRequest, type DecisionRequest, type DecisionSubjectType, type InstitutionalDecision,
} from "../../domain/institutionalDecision";
import type { StructuralDeviationKind } from "../../domain/institutionalTemplates/revalidation";
import type { OrgId } from "../../domain/institutionalTemplates";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import { TemplateWorkflowError } from "./errors";
import type { TemplateManifestPort, WorkflowContext } from "./ports";

const log = serviceLogger("TemplateReviewService");

export const AI_ACCEPTANCE_SUBJECT = "institutional_template.ai_acceptance" as const satisfies DecisionSubjectType;
export const DEVIATION_ACK_SUBJECT = "institutional_template.deviation_acknowledgment" as const satisfies DecisionSubjectType;

const keyHash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
export const aiAcceptanceSubjectId = (manifestId: string, slotKey: string): string => `${manifestId}:${keyHash(`ai:${slotKey}`)}`;
export const deviationAckSubjectId = (manifestId: string, blockId: string, kind: StructuralDeviationKind): string => `${manifestId}:${keyHash(`dev:${blockId}|${kind}`)}`;

export interface ReviewDecisionInput {
  readonly confirm: boolean;
  readonly idempotencyKey: string;
  readonly decision: {
    readonly decidedByName: string; readonly decidedByRole: string; readonly decidedByUserId?: number | null;
    readonly decidedAt: string; readonly basisReference: string; readonly reason: string;
  };
}

export interface RecordedReview { readonly decision: InstitutionalDecision; readonly replayed: boolean }

async function persistReviewDecision(
  ctx: WorkflowContext, subjectType: DecisionSubjectType, decisionType: "template_ai_acceptance" | "template_deviation_acknowledgment",
  outcome: "aceito" | "reconhecido", subjectId: string, input: ReviewDecisionInput, evidence: readonly string[],
): Promise<RecordedReview> {
  const request: DecisionRequest = {
    organizationId: ctx.organizationId, subjectType, subjectId, decisionType, outcome,
    decidedByName: input.decision.decidedByName, decidedByRole: input.decision.decidedByRole, decidedByUserId: input.decision.decidedByUserId ?? null,
    decidedAt: input.decision.decidedAt, basisReference: input.decision.basisReference, reason: input.decision.reason, evidence,
    recordedByUserId: ctx.actor.userId, expectedRevision: 0, idempotencyKey: input.idempotencyKey, correlationId: ctx.correlationId,
  };
  const valid = validateDecisionRequest(request);
  if (!valid.ok) {
    throw new TemplateWorkflowError("DECISION_REJECTED", DECISION_MESSAGES[valid.code] ?? valid.code,
      (valid.fields ?? []).map((f) => ({ code: valid.code, path: f, message: "campo obrigatório ou inválido" })));
  }
  try {
    return await withTemplatesTransaction("template.review.decision", ctx, async (tx) => {
      const exists = await lockDecisionSubject(tx, ctx.organizationId, subjectType, subjectId);
      if (!exists) throw new TemplatePersistenceError("NOT_FOUND", "manifest inexistente neste tenant");
      const [byKey, current] = await Promise.all([
        getDecisionByIdempotencyKey(tx, ctx.organizationId, input.idempotencyKey.trim()),
        getCurrentDecision(tx, ctx.organizationId, subjectType, subjectId),
      ]);
      // O mesmo ato (assunto = M1 + slot/bloco) já foi registrado: converge para a decisão existente (sem segunda linha).
      if (current && !byKey) return { decision: current, replayed: true };
      const plan = planDecision(request, { byIdempotencyKey: byKey, current });
      if (plan.kind === "replay") return { decision: plan.decision, replayed: true };
      if (plan.kind === "conflict") throw new TemplateWorkflowError("DECISION_REJECTED", DECISION_MESSAGES[plan.code]);
      await insertDecision(tx, plan.decision);
      return { decision: plan.decision, replayed: false };
    });
  } catch (err) {
    if (err instanceof TemplatePersistenceError && (err.code === "NOT_FOUND")) throw new TemplateWorkflowError("NOT_FOUND", "manifest não encontrado nesta organização");
    if (err instanceof DecisionWriteRaceError) throw new TemplateWorkflowError("STALE_STATE", "outra pessoa registrou esta decisão ao mesmo tempo; recarregue");
    throw err;
  }
}

export class TemplateReviewService {
  constructor(private readonly manifests: Pick<TemplateManifestPort, "getManifest">) {}

  /** Aceite humano EXATO de uma narrativa de IA (slot + execução + hash do texto) do M1. */
  async acceptAiNarrative(
    ctx: WorkflowContext,
    input: ReviewDecisionInput & { manifestId: string; slotKey: string; executionId: string; outputHash: string },
  ): Promise<RecordedReview> {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória para aceitar a narrativa (nada foi alterado)");
    const m1 = await this.manifests.getManifest(ctx.organizationId as OrgId, input.manifestId);
    if (!m1 || m1.stage !== "GENERATION" || m1.organizationId !== ctx.organizationId) throw new TemplateWorkflowError("NOT_FOUND", "manifest não encontrado nesta organização");
    const narrative = m1.aiNarratives.find((n) => n.slotKey === input.slotKey);
    if (!narrative) throw new TemplateWorkflowError("VALIDATION_FAILED", "o manifest não registra narrativa de IA para este slot");
    if (narrative.executionId !== input.executionId || narrative.outputHash !== input.outputHash) {
      throw new TemplateWorkflowError("VALIDATION_FAILED", "execução/hash informados não correspondem à narrativa registrada no manifest — o aceite exige o texto exato");
    }
    const out = await persistReviewDecision(ctx, AI_ACCEPTANCE_SUBJECT, "template_ai_acceptance", "aceito",
      aiAcceptanceSubjectId(m1.id, input.slotKey), input,
      [`slot:${input.slotKey}`, `execution:${input.executionId}`, `output:${input.outputHash}`]);
    log.info("template_ai_narrative_accepted", { organizationId: ctx.organizationId, manifestId: m1.id, slotKey: input.slotKey, decisionId: out.decision.id, replayed: out.replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return out;
  }

  /** Reconhecimento humano registrado de um desvio estrutural (bloco incluído removido / excluído inserido). */
  async acknowledgeDeviation(
    ctx: WorkflowContext,
    input: ReviewDecisionInput & { manifestId: string; blockId: string; kind: StructuralDeviationKind },
  ): Promise<RecordedReview> {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória (nada foi alterado)");
    if (input.kind !== "INCLUDED_BLOCK_REMOVED" && input.kind !== "EXCLUDED_BLOCK_INSERTED") throw new TemplateWorkflowError("VALIDATION_FAILED", "tipo de desvio inválido");
    const m1 = await this.manifests.getManifest(ctx.organizationId as OrgId, input.manifestId);
    if (!m1 || m1.stage !== "GENERATION" || m1.organizationId !== ctx.organizationId) throw new TemplateWorkflowError("NOT_FOUND", "manifest não encontrado nesta organização");
    const out = await persistReviewDecision(ctx, DEVIATION_ACK_SUBJECT, "template_deviation_acknowledgment", "reconhecido",
      deviationAckSubjectId(m1.id, input.blockId, input.kind), input, [`block:${input.blockId}`, `kind:${input.kind}`]);
    log.info("template_deviation_acknowledged", { organizationId: ctx.organizationId, manifestId: m1.id, blockId: input.blockId, kind: input.kind, decisionId: out.decision.id, replayed: out.replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return out;
  }
}
