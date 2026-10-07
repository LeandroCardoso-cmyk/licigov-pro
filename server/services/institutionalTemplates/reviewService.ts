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
import type { DecisionSubjectType } from "../../domain/institutionalDecision";
import type { StructuralDeviationKind } from "../../domain/institutionalTemplates/revalidation";
import type { OrgId } from "../../domain/institutionalTemplates";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import { TemplateWorkflowError } from "./errors";
import { recordHumanDecision, type DecisionActInput, type RecordedDecision } from "./decisionRecorder";
import type { TemplateManifestPort, WorkflowContext } from "./ports";

const log = serviceLogger("TemplateReviewService");

export const AI_ACCEPTANCE_SUBJECT = "institutional_template.ai_acceptance" as const satisfies DecisionSubjectType;
export const DEVIATION_ACK_SUBJECT = "institutional_template.deviation_acknowledgment" as const satisfies DecisionSubjectType;

const keyHash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
export const aiAcceptanceSubjectId = (manifestId: string, slotKey: string): string => `${manifestId}:${keyHash(`ai:${slotKey}`)}`;
export const deviationAckSubjectId = (manifestId: string, blockId: string, kind: StructuralDeviationKind): string => `${manifestId}:${keyHash(`dev:${blockId}|${kind}`)}`;

export type ReviewDecisionInput = DecisionActInput;
export type RecordedReview = RecordedDecision;

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
    const out = await recordHumanDecision(ctx, {
      subjectType: AI_ACCEPTANCE_SUBJECT, decisionType: "template_ai_acceptance", outcome: "aceito", mode: "converge",
      subjectId: aiAcceptanceSubjectId(m1.id, input.slotKey), act: input,
      evidence: [`slot:${input.slotKey}`, `execution:${input.executionId}`, `output:${input.outputHash}`],
    });
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
    const out = await recordHumanDecision(ctx, {
      subjectType: DEVIATION_ACK_SUBJECT, decisionType: "template_deviation_acknowledgment", outcome: "reconhecido", mode: "converge",
      subjectId: deviationAckSubjectId(m1.id, input.blockId, input.kind), act: input, evidence: [`block:${input.blockId}`, `kind:${input.kind}`],
    });
    log.info("template_deviation_acknowledged", { organizationId: ctx.organizationId, manifestId: m1.id, blockId: input.blockId, kind: input.kind, decisionId: out.decision.id, replayed: out.replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return out;
  }
}
