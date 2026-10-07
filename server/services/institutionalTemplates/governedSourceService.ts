/**
 * Registro HUMANO das fontes canônicas governadas por decisão (CERTAME_CONFIG, POLICY, BUDGET) e da EVIDÊNCIA de aprovação
 * jurídica do modelo. Ledger EXISTENTE (`institutional_decisions`); validação fail-closed do contrato; ator humano +
 * confirmação explícita; CAS por revisão; idempotência. NÃO existe default de resultado, de autoridade, de número de parecer,
 * de data nem de protocolo: tudo é informado por pessoa (o piloto preenche).
 *
 * `authorityValidation` permanece NOT_VALIDATED_POLICY_PENDING — o sistema registra o ato e a referência; não valida
 * competência jurídica e nenhuma IA decide.
 */
import { getCurrentDecision } from "../../db/institutionalDecisions";
import { getRevision } from "../../db/institutionalTemplates";
import type { InstitutionalDecision } from "../../domain/institutionalDecision";
import {
  BUDGET_DISCLOSURES, CERTAME_CONFIG_SCHEMA, POLICY_KEY_RE, POLICY_PAYLOAD_SCHEMA, encodeGovernedPayload, validateCertameConfig, validatePolicyPayload,
  type BudgetDisclosure,
} from "../../domain/institutionalTemplates/governedSources";
import type { TemplateIssue } from "../../domain/institutionalTemplates";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import { recordHumanDecision, type DecisionActInput, type RecordedDecision } from "./decisionRecorder";
import { TemplateWorkflowError } from "./errors";
import type { WorkflowContext } from "./ports";

const log = serviceLogger("GovernedSourceService");
const toIssues = (issues: readonly TemplateIssue[]) => issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));

function requireConfirmed(act: DecisionActInput, what: string): void {
  if (act.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", `confirmação humana explícita obrigatória para ${what} (nada foi alterado)`);
}

export const LEGAL_APPROVAL_OUTCOMES = ["aprovado", "reprovado"] as const;
export type LegalApprovalOutcome = (typeof LEGAL_APPROVAL_OUTCOMES)[number];

export interface LegalApprovalEvidence {
  readonly decision: InstitutionalDecision;
  /** Hash semântico da revisão que o ato aprovou (do `evidence`) e se ainda é o da revisão persistida (imutável em PUBLISHED). */
  readonly approvedSemanticHash: string | null;
  readonly matchesRevision: boolean;
}

export class GovernedSourceService {
  /** Configuração decidida do certame para o PROCESSO (assunto = id do processo). */
  async recordCertameConfig(ctx: WorkflowContext, input: DecisionActInput & { processId: string; config: unknown; expectedRevision: number }): Promise<RecordedDecision> {
    assertHumanActor(ctx.actor);
    requireConfirmed(input, "registrar a configuração do certame");
    const valid = validateCertameConfig(input.config);
    if (!valid.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "configuração do certame inválida", toIssues(valid.issues));
    const { evidence } = encodeGovernedPayload(CERTAME_CONFIG_SCHEMA, valid.value);
    const out = await recordHumanDecision(ctx, {
      subjectType: "procurement.certame_config", decisionType: "certame_configuration", outcome: "configurado", mode: "revision",
      subjectId: input.processId, evidence, act: input, expectedRevision: input.expectedRevision,
    });
    log.info("certame_config_recorded", { organizationId: ctx.organizationId, processId: input.processId, decisionId: out.decision.id, revision: out.decision.revision, replayed: out.replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return out;
  }

  /** Política institucional do ÓRGÃO (assunto = chave da política). */
  async recordPolicy(ctx: WorkflowContext, input: DecisionActInput & { policyKey: string; payload: unknown; expectedRevision: number }): Promise<RecordedDecision> {
    assertHumanActor(ctx.actor);
    requireConfirmed(input, "registrar a política institucional");
    if (!POLICY_KEY_RE.test(input.policyKey)) throw new TemplateWorkflowError("VALIDATION_FAILED", "chave de política inválida (minúsculas, dígitos e _; começa por letra; até 48)");
    const valid = validatePolicyPayload(input.payload);
    if (!valid.ok) throw new TemplateWorkflowError("VALIDATION_FAILED", "política inválida", toIssues(valid.issues));
    const { evidence } = encodeGovernedPayload(POLICY_PAYLOAD_SCHEMA, valid.value);
    const out = await recordHumanDecision(ctx, {
      subjectType: "institutional.policy", decisionType: "institutional_policy", outcome: "estabelecida", mode: "revision",
      subjectId: input.policyKey, evidence, act: input, expectedRevision: input.expectedRevision,
    });
    log.info("institutional_policy_recorded", { organizationId: ctx.organizationId, policyKey: input.policyKey, decisionId: out.decision.id, revision: out.decision.revision, replayed: out.replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return out;
  }

  /** Divulgação do orçamento do processo: o resultado (público | sigiloso) é a decisão — sem padrão. */
  async recordBudgetDisclosure(ctx: WorkflowContext, input: DecisionActInput & { processId: string; disclosure: BudgetDisclosure; expectedRevision: number }): Promise<RecordedDecision> {
    assertHumanActor(ctx.actor);
    requireConfirmed(input, "registrar a divulgação do orçamento");
    if (!(BUDGET_DISCLOSURES as readonly string[]).includes(input.disclosure)) throw new TemplateWorkflowError("VALIDATION_FAILED", "divulgação do orçamento deve ser publico ou sigiloso");
    const out = await recordHumanDecision(ctx, {
      subjectType: "procurement.budget_disclosure", decisionType: "budget_disclosure", outcome: input.disclosure, mode: "revision",
      subjectId: input.processId, evidence: [`disclosure:${input.disclosure}`], act: input, expectedRevision: input.expectedRevision,
    });
    log.info("budget_disclosure_recorded", { organizationId: ctx.organizationId, processId: input.processId, disclosure: input.disclosure, decisionId: out.decision.id, revision: out.decision.revision, replayed: out.replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return out;
  }

  /**
   * Evidência de APROVAÇÃO JURÍDICA do modelo (a Procuradoria aprovou o conteúdo congelado de uma revisão EXATA). O ato
   * referencia o hash semântico da revisão e este precisa coincidir com o persistido (o conteúdo aprovado é o conteúdo
   * versionado). `basisReference` (parecer/protocolo), data e autoridade são INFORMADOS por pessoa — nunca inventados.
   * Não altera a revisão nem a publica; não substitui a aprovação/publicação do lifecycle (decisões distintas).
   */
  async recordLegalApproval(
    ctx: WorkflowContext,
    input: DecisionActInput & { revisionId: string; semanticHash: string; outcome: LegalApprovalOutcome; expectedRevision: number },
  ): Promise<RecordedDecision> {
    assertHumanActor(ctx.actor);
    requireConfirmed(input, "registrar a aprovação jurídica do modelo");
    if (!(LEGAL_APPROVAL_OUTCOMES as readonly string[]).includes(input.outcome)) throw new TemplateWorkflowError("VALIDATION_FAILED", "resultado da análise jurídica deve ser aprovado ou reprovado");
    const revision = await getRevision(ctx.organizationId, input.revisionId);
    if (!revision) throw new TemplateWorkflowError("NOT_FOUND", "revisão não encontrada nesta organização");
    if (revision.semanticHash !== input.semanticHash) {
      throw new TemplateWorkflowError("VALIDATION_FAILED", "o hash semântico informado não corresponde ao conteúdo da revisão — a aprovação jurídica refere-se a um conteúdo exato");
    }
    const out = await recordHumanDecision(ctx, {
      subjectType: "institutional_template.legal_approval", decisionType: "template_legal_approval", outcome: input.outcome, mode: "revision",
      subjectId: revision.id, act: input, expectedRevision: input.expectedRevision,
      evidence: [`model-revision:${revision.id}`, `semantic-hash:${revision.semanticHash}`, `catalog:${revision.variableCatalogVersion}`, `hash-version:${revision.hashVersion}`],
    });
    log.info("template_legal_approval_recorded", { organizationId: ctx.organizationId, revisionId: revision.id, outcome: input.outcome, decisionId: out.decision.id, revision: out.decision.revision, replayed: out.replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return out;
  }

  /** Leitura: a evidência jurídica CORRENTE da revisão e se ela ainda corresponde ao conteúdo persistido. */
  async getLegalApprovalEvidence(organizationId: number, revisionId: string): Promise<LegalApprovalEvidence | null> {
    const decision = await getCurrentDecision(null, organizationId, "institutional_template.legal_approval", revisionId);
    if (!decision) return null;
    const revision = await getRevision(organizationId, revisionId);
    const approvedSemanticHash = decision.evidence.find((e) => e.startsWith("semantic-hash:"))?.slice("semantic-hash:".length) ?? null;
    return { decision, approvedSemanticHash, matchesRevision: !!revision && approvedSemanticHash !== null && revision.semanticHash === approvedSemanticHash };
  }
}
