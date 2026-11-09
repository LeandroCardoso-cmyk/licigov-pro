/**
 * E2 — RESOLUÇÃO HUMANA de trecho pendente do Edital composto por modelo (slot de IA sem narrativa).
 *
 * A pessoa autenticada (ator SEMPRE do contexto; nunca do cliente) escolhe, por slot:
 *  - `HUMAN_TEXT`    — redige o trecho; o servidor substitui o marcador (ou o trecho resolvido antes) pelo texto informado;
 *  - `DECLARED_NONE` — declara que não há conteúdo adicional; só em slot ELEGÍVEL (política versionada + parágrafo próprio), e o texto do
 *    documento passa a ser a frase FIXA da política.
 * Um único ato grava, NA MESMA TRANSAÇÃO, a edição governada do rascunho (CAS pelo hash visto, idempotência, ledger `human_edit` com a
 * linhagem em `reason`) e a decisão `template_slot_resolution` no ledger EXISTENTE (`institutional_decisions`, lock do M1, CAS por revisão).
 * A emissão confere a resolução contra o trecho emitido (`evaluateSlotResolutions`); qualquer alteração posterior a desatualiza.
 * Sem conteúdo em log (só hashes, slot e ids). A autoridade permanece NOT_VALIDATED_POLICY_PENDING (registro eletrônico do usuário).
 */
import { getGeneratedDocumentByKind } from "../../db/procurement";
import { decisionRequestHash, type InstitutionalDecision } from "../../domain/institutionalDecision";
import { draftContentHash } from "../../domain/generatedDocument";
import {
  SLOT_KEY_RE, SLOT_RESOLUTION_POLICY_VERSION, latestSlotResolutions, normalizeSlotText, planSlotResolution, slotPolicy, type SlotResolutionType,
} from "../../domain/institutionalTemplates/slotResolution";
import { sha256Hex } from "../../domain/canonicalJson";
import type { OrgId } from "../../domain/institutionalTemplates";
import type { TemplatesTx } from "../../db/institutionalTemplates";
import { getDecisionByIdempotencyKey } from "../../db/institutionalDecisions";
import { getDb } from "../../db/connection";
import { applyTemplateSlotResolutionEdit } from "../procurementProcessService";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import {
  assertDecisionRequestValid, buildDecisionRequest, recordDecisionInTx, recordHumanDecision, translateDecisionError,
  type DecisionActInput, type RecordDecisionSpec, type RecordedDecision,
} from "./decisionRecorder";
import { TemplateWorkflowError } from "./errors";
import type { TemplatePorts, WorkflowContext } from "./ports";
import { SLOT_RESOLUTION_SUBJECT, slotResolutionSubjectId } from "./slotResolutionSubject";

const log = serviceLogger("TemplateSlotResolutionService");

export interface ResolveSlotInput extends DecisionActInput {
  readonly processId: string;
  readonly manifestId: string;
  readonly slotKey: string;
  readonly resolution: SlotResolutionType;
  /** Só em `HUMAN_TEXT` (em `DECLARED_NONE` o texto é a frase fixa da política; texto informado é recusado). */
  readonly text?: string;
  /** Hash do rascunho que a pessoa VIU (CAS). */
  readonly expectedContentHash: string;
  /** Revisão atual da resolução do slot (0 = primeira). */
  readonly expectedRevision: number;
}

export interface ResolveSlotResult extends RecordedDecision {
  readonly contentHash: string;
  readonly documentChanged: boolean;
}

const evidenceTag = (evidence: readonly string[], name: string): string | null => {
  const hit = evidence.find((e) => e.startsWith(`${name}:`));
  return hit ? hit.slice(name.length + 1) : null;
};

const fail = (message: string, path = "slot"): TemplateWorkflowError =>
  new TemplateWorkflowError("VALIDATION_FAILED", message, [{ code: "SLOT_RESOLUTION_INVALID", path, message }]);


export class TemplateSlotResolutionService {
  constructor(private readonly ports: Pick<TemplatePorts, "manifests" | "review">) {}

  private async priorByKey(org: OrgId, idempotencyKey: string): Promise<InstitutionalDecision | null> {
    const db = await getDb();
    if (!db) throw new TemplateWorkflowError("PORTS_NOT_CONFIGURED", "persistência indisponível — nada foi gravado");
    return getDecisionByIdempotencyKey(db, org, idempotencyKey.trim());
  }

  async resolveSlot(ctx: WorkflowContext, input: ResolveSlotInput): Promise<ResolveSlotResult> {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória (nada foi alterado)");
    if (!SLOT_KEY_RE.test(input.slotKey)) throw fail("trecho inválido", "slotKey");
    if (input.resolution !== "HUMAN_TEXT" && input.resolution !== "DECLARED_NONE") throw fail("tipo de resolução inválido", "resolution");
    const org = ctx.organizationId as OrgId;

    // Rascunho do Edital do processo (tenant do contexto) e o M1 VIGENTE dele: resolução vale só para o M1 exibido.
    const draft = await getGeneratedDocumentByKind(input.processId, org, "edital");
    if (!draft) throw new TemplateWorkflowError("NOT_FOUND", "rascunho do Edital não encontrado nesta organização");
    const m1 = await this.ports.manifests.findGenerationManifestForDraft(org, draft.id);
    if (!m1 || m1.stage !== "GENERATION" || m1.organizationId !== org) throw new TemplateWorkflowError("NOT_FOUND", "o rascunho não foi composto por modelo institucional nesta organização");
    if (m1.id !== input.manifestId) throw new TemplateWorkflowError("STALE_STATE", "a minuta foi recomposta desde que você abriu a tela — recarregue antes de resolver o trecho");
    if (m1.aiNarratives.some((n) => n.slotKey === input.slotKey)) throw fail("este trecho tem narrativa de IA registrada: o caminho é o aceite da narrativa, não a resolução manual");
    // Idempotência ANTES do CAS: a mesma chave já registrou esta resolução (ex.: resposta perdida) ⇒ devolve-a, mesmo com o rascunho já alterado
    // por ela; a mesma chave com outro slot/tipo/texto/autor ⇒ conflito (nada é gravado).
    const prior = await this.priorByKey(org, input.idempotencyKey);
    if (prior) {
      const policyText = slotPolicy(input.slotKey).declaredNoneText;
      const expectedTextHash = input.resolution === "DECLARED_NONE" ? (policyText ? sha256Hex(policyText) : null) : sha256Hex(normalizeSlotText(input.text ?? ""));
      const same = prior.subjectType === SLOT_RESOLUTION_SUBJECT && prior.subjectId === slotResolutionSubjectId(m1.id, input.slotKey)
        && prior.recordedByUserId === ctx.actor.userId && prior.outcome === input.resolution && evidenceTag(prior.evidence, "text") === expectedTextHash;
      if (!same) throw new TemplateWorkflowError("DECISION_REJECTED", "esta solicitação já foi usada para registrar outra decisão (nada foi gravado)");
      return { decision: prior, replayed: true, contentHash: evidenceTag(prior.evidence, "content") ?? "", documentChanged: false };
    }
    const current = draft.content;
    if (draftContentHash(current) !== input.expectedContentHash) {
      throw new TemplateWorkflowError("STALE_STATE", "o rascunho mudou desde que você abriu a tela — recarregue e revise antes de resolver o trecho");
    }

    // Onde o trecho está e o que entra nele: regra pura do domínio (marcador ou trecho da última resolução; nunca posição do cliente).
    const previous = latestSlotResolutions(org, m1.id, await this.ports.review.listSlotResolutions(org, m1.id)).get(input.slotKey) ?? null;
    const plan = planSlotResolution({ content: current, slotKey: input.slotKey, resolution: input.resolution, text: input.text, previous });
    if (!plan.ok) throw fail(plan.reason, plan.field);
    const { content: next, textHash, prefix, suffix } = plan;
    const contentHash = draftContentHash(next);

    const spec: RecordDecisionSpec = {
      subjectType: SLOT_RESOLUTION_SUBJECT, decisionType: "template_slot_resolution", outcome: input.resolution, mode: "revision",
      expectedRevision: input.expectedRevision, subjectId: slotResolutionSubjectId(m1.id, input.slotKey), act: input,
      evidence: [
        `slot:${input.slotKey}`, `type:${input.resolution}`, `text:${textHash}`,
        `prefix:${JSON.stringify(prefix)}`, `suffix:${JSON.stringify(suffix)}`,
        `content:${contentHash}`, `policy:${SLOT_RESOLUTION_POLICY_VERSION}`,
      ],
    };
    const request = buildDecisionRequest(ctx, spec);
    assertDecisionRequestValid(request); // recusa ANTES de qualquer escrita (inclusive da edição)

    let recorded: RecordedDecision | null = null;
    let documentChanged = false;
    try {
      if (!plan.changed) {
        // Mesmo texto já presente (nova resolução da redação atual, ex.: após desatualização): só a decisão, com CAS pela revisão.
        recorded = await recordHumanDecision(ctx, spec);
      } else {
        const edit = await applyTemplateSlotResolutionEdit({
          organizationId: org, processId: input.processId, content: next,
          reason: JSON.stringify({ kind: "template_slot_resolution", slotKey: input.slotKey, resolution: input.resolution, textHash, manifestId: m1.id }),
          actorUserId: ctx.actor.userId, expectedContentHash: input.expectedContentHash, idempotencyKey: input.idempotencyKey, correlationId: ctx.correlationId,
          afterPersist: async (tx) => { recorded = await recordDecisionInTx(tx as TemplatesTx, ctx, spec, request); },
        });
        documentChanged = !edit.replayed;
        if (edit.replayed) {
          // Replay da edição ⇒ a decisão foi gravada na MESMA transação original: devolve-a (mesmo pedido) ou recusa (pedido diferente).
          const again = await this.priorByKey(org, input.idempotencyKey);
          if (!again || again.subjectId !== spec.subjectId || again.requestHash !== decisionRequestHash(request)) {
            throw new TemplateWorkflowError("DECISION_REJECTED", "esta solicitação já foi usada para registrar outra resolução (nada foi gravado)");
          }
          recorded = { decision: again, replayed: true };
        }
      }
    } catch (err) {
      return translateDecisionError(err);
    }
    const out = recorded as RecordedDecision | null;
    if (!out) throw new TemplateWorkflowError("STALE_STATE", "a resolução não foi registrada (o texto já correspondia ao estado atual) — recarregue e tente novamente");
    log.info("template_slot_resolved", {
      organizationId: org, manifestId: m1.id, slotKey: input.slotKey, resolution: input.resolution, decisionId: out.decision.id,
      revision: out.decision.revision, replayed: out.replayed, documentChanged, textHash: textHash.slice(0, 16), actorUserId: ctx.actor.userId,
      correlationId: ctx.correlationId,
    });
    return { ...out, contentHash, documentChanged };
  }
}
