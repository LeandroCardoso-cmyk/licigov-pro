/**
 * Governança do modelo (piloto Edital): PROCEDÊNCIA da importação e EVIDÊNCIA de aprovação jurídica externa, sobre uma
 * revisão exata, no ledger institucional existente (via `TemplateGovernancePort`).
 *
 *  - Só ator HUMANO autenticado, com confirmação explícita; a autoridade declarada (nome/cargo) é a que a pessoa informa —
 *    nunca inferida de quem clicou, nunca validada (NOT_VALIDATED_POLICY_PENDING).
 *  - NÃO muda o status da revisão: evidência jurídica é governança, não ciclo de vida (DRAFT→APPROVED→PUBLISHED→DEPRECATED).
 *  - Nada é inventado: número/data do parecer, protocolo e procurador só existem se informados.
 *  - Append-only: um novo registro SUPERA o anterior (versão +1, CAS pela versão que a pessoa viu); o histórico permanece.
 */
import {
  DECISION_MESSAGES, validateDecisionRequest, type DecisionRequest, type DecisionSubjectType, type InstitutionalDecision,
} from "../../domain/institutionalDecision";
import type { TemplateRevision } from "../../domain/institutionalTemplates";
import {
  decodeLegalEvidence, encodeLegalEvidence, LEGAL_EVIDENCE_DECISION_TYPE, LEGAL_EVIDENCE_OUTCOME, LEGAL_EVIDENCE_SUBJECT,
  validateLegalEvidenceInput, type LegalApprovalEvidence, type LegalEvidenceInput,
} from "../../domain/institutionalTemplates/governance/legalEvidence";
import {
  decodeImportProvenance, encodeImportProvenance, IMPORT_PROVENANCE_DECISION_TYPE, IMPORT_PROVENANCE_OUTCOME, IMPORT_PROVENANCE_SUBJECT,
  validateImportProvenanceInput, type ImportProvenance, type ImportProvenanceInput,
} from "../../domain/institutionalTemplates/governance/importProvenance";
import { decodeKv } from "../../domain/institutionalTemplates/governance/kv";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import { TemplateWorkflowError } from "./errors";
import type { TemplateGovernancePort, TemplateWorkflowPorts, WorkflowContext } from "./ports";

const log = serviceLogger("templateGovernance");

export interface DeclaredAuthority {
  readonly decidedByName: string;
  readonly decidedByRole: string;
  readonly decidedByUserId?: number | null;
  /** AAAA-MM-DD — data do ato declarada por quem registra (NÃO é data de parecer). */
  readonly decidedAt: string;
  readonly basisReference: string;
  readonly reason: string;
}

export interface GovernanceWriteInput {
  /** Versão corrente do registro que a pessoa viu (0 = nenhum). CAS: outra pessoa registrou antes ⇒ STALE_STATE. */
  readonly expectedVersion: number;
  readonly confirm: boolean;
  readonly idempotencyKey: string;
  readonly decision: DeclaredAuthority;
}

export interface RevisionGovernanceView {
  readonly revisionId: string;
  readonly provenance: ImportProvenance | null;
  readonly provenanceVersions: number;
  readonly legalEvidence: LegalApprovalEvidence | null;
  readonly legalEvidenceHistory: readonly LegalApprovalEvidence[];
  /** Registros do ledger que não puderam ser decodificados (nunca "meio válidos"): contagem para a UX alertar. */
  readonly malformedRecords: number;
  readonly lifecycleNote: string;
}

const LIFECYCLE_NOTE = "Evidência jurídica e procedência são metadados de governança: não alteram o status da revisão nem substituem a aprovação e a publicação humanas no sistema.";

export class TemplateGovernanceService {
  constructor(private readonly ports: Pick<TemplateWorkflowPorts, "repository" | "governance" | "clock">) {}

  private gov(): TemplateGovernancePort {
    if (!this.ports.governance) throw new TemplateWorkflowError("PORTS_NOT_CONFIGURED", "registro de governança do modelo não está configurado (fail-closed)");
    return this.ports.governance;
  }

  private async revision(ctx: WorkflowContext, revisionId: string): Promise<TemplateRevision> {
    const r = await this.ports.repository.getRevision(ctx.organizationId, revisionId);
    if (!r || r.organizationId !== ctx.organizationId) throw new TemplateWorkflowError("NOT_FOUND", "revisão não encontrada nesta organização");
    return r;
  }

  async get(ctx: WorkflowContext, revisionId: string): Promise<RevisionGovernanceView> {
    await this.revision(ctx, revisionId);
    const [prov, ev] = await Promise.all([
      this.gov().listGovernanceDecisions(ctx.organizationId, IMPORT_PROVENANCE_SUBJECT, revisionId),
      this.gov().listGovernanceDecisions(ctx.organizationId, LEGAL_EVIDENCE_SUBJECT, revisionId),
    ]);
    const decodedProv = prov.map(decodeImportProvenance);
    const decodedEv = ev.map(decodeLegalEvidence);
    const malformed = decodedProv.filter((d) => d === null).length + decodedEv.filter((d) => d === null).length;
    // corrente = a de MAIOR versão; se a corrente for malformada, NÃO se volta a uma anterior em silêncio (fail-closed)
    const provCurrent = decodedProv.length ? decodedProv[decodedProv.length - 1] : null;
    const evHistory = decodedEv.filter((d): d is LegalApprovalEvidence => d !== null);
    const evCurrent = decodedEv.length ? decodedEv[decodedEv.length - 1] : null;
    return {
      revisionId, provenance: provCurrent, provenanceVersions: prov.length, legalEvidence: evCurrent, legalEvidenceHistory: evHistory,
      malformedRecords: malformed, lifecycleNote: LIFECYCLE_NOTE,
    };
  }

  /** Registra (ou supera) a EVIDÊNCIA de aprovação jurídica externa do conteúdo-fonte. Não transita a revisão. */
  async recordLegalEvidence(ctx: WorkflowContext, input: GovernanceWriteInput & { revisionId: string; evidence: LegalEvidenceInput }): Promise<{ evidence: LegalApprovalEvidence; replayed: boolean }> {
    assertHumanActor(ctx.actor);
    this.requireConfirmation(input.confirm, "registrar a evidência de aprovação jurídica");
    const revision = await this.revision(ctx, input.revisionId);
    const issues = validateLegalEvidenceInput(input.evidence);
    if (issues.length) throw new TemplateWorkflowError("VALIDATION_FAILED", "evidência jurídica inválida", issues.map((i) => ({ code: "LEGAL_EVIDENCE_INVALID", path: i.field, message: i.message })));
    const recordedAt = await this.recordedAtFor(ctx, LEGAL_EVIDENCE_SUBJECT, revision.id, input.idempotencyKey);
    const lines = encodeLegalEvidence(input.evidence, { revisionSemanticHash: revision.semanticHash, recordedAt });
    const { decision, replayed } = await this.commit(ctx, {
      subjectType: LEGAL_EVIDENCE_SUBJECT, decisionType: LEGAL_EVIDENCE_DECISION_TYPE, outcome: LEGAL_EVIDENCE_OUTCOME, revisionId: revision.id, input, evidenceLines: lines,
    });
    const decoded = decodeLegalEvidence(decision);
    if (!decoded) throw new TemplateWorkflowError("VALIDATION_FAILED", "a evidência gravada não pôde ser reconstruída (registro inconsistente)");
    log.info("template_legal_evidence_recorded", { organizationId: ctx.organizationId, revisionId: revision.id, decisionId: decision.id, version: decision.revision, replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return { evidence: decoded, replayed };
  }

  /** Registra (ou supera) a PROCEDÊNCIA da importação da revisão. Não transita a revisão. */
  async recordImportProvenance(ctx: WorkflowContext, input: GovernanceWriteInput & { revisionId: string; provenance: ImportProvenanceInput }): Promise<{ provenance: ImportProvenance; replayed: boolean }> {
    assertHumanActor(ctx.actor);
    this.requireConfirmation(input.confirm, "registrar a procedência da importação");
    const revision = await this.revision(ctx, input.revisionId);
    const issues = validateImportProvenanceInput(input.provenance);
    if (issues.length) throw new TemplateWorkflowError("VALIDATION_FAILED", "procedência inválida", issues.map((i) => ({ code: "PROVENANCE_INVALID", path: i.field, message: i.message })));
    const recordedAt = await this.recordedAtFor(ctx, IMPORT_PROVENANCE_SUBJECT, revision.id, input.idempotencyKey);
    const lines = encodeImportProvenance(input.provenance, { revisionSemanticHash: revision.semanticHash, recordedAt });
    const { decision, replayed } = await this.commit(ctx, {
      subjectType: IMPORT_PROVENANCE_SUBJECT, decisionType: IMPORT_PROVENANCE_DECISION_TYPE, outcome: IMPORT_PROVENANCE_OUTCOME, revisionId: revision.id, input, evidenceLines: lines,
    });
    const decoded = decodeImportProvenance(decision);
    if (!decoded) throw new TemplateWorkflowError("VALIDATION_FAILED", "a procedência gravada não pôde ser reconstruída (registro inconsistente)");
    log.info("template_import_provenance_recorded", { organizationId: ctx.organizationId, revisionId: revision.id, decisionId: decision.id, version: decision.revision, replayed, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return { provenance: decoded, replayed };
  }

  /**
   * Instante do registro. O `recordedAt` entra nas linhas de evidência (e, portanto, no hash do pedido): numa REPETIÇÃO com a mesma
   * chave de idempotência ele precisa ser o já gravado — senão o relógio faria o replay parecer "pedido diferente" (conflito).
   * Sem decisão prévia da chave (para este assunto/tipo) ⇒ relógio atual.
   */
  private async recordedAtFor(ctx: WorkflowContext, subjectType: DecisionSubjectType, revisionId: string, idempotencyKey: string): Promise<string> {
    const prior = await this.ports.repository.getDecisionByIdempotencyKey(ctx.organizationId, idempotencyKey.trim());
    if (prior && prior.subjectType === subjectType && prior.subjectId === revisionId) {
      const at = decodeKv(prior.evidence, ["recordedAt"]).values.recordedAt;
      if (at) return at;
    }
    return this.ports.clock.now();
  }

  private requireConfirmation(confirm: boolean, what: string): void {
    if (confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", `confirmação humana explícita obrigatória para ${what} (nada foi gravado)`);
  }

  private async commit(ctx: WorkflowContext, a: {
    subjectType: DecisionSubjectType; decisionType: "template_legal_approval_evidence" | "template_import_provenance"; outcome: "registrado";
    revisionId: string; input: GovernanceWriteInput; evidenceLines: readonly string[];
  }): Promise<{ decision: InstitutionalDecision; replayed: boolean }> {
    const d = a.input.decision;
    const request: DecisionRequest = {
      organizationId: ctx.organizationId, subjectType: a.subjectType, subjectId: a.revisionId, decisionType: a.decisionType, outcome: a.outcome,
      decidedByName: d.decidedByName, decidedByRole: d.decidedByRole, decidedByUserId: d.decidedByUserId ?? null, decidedAt: d.decidedAt,
      basisReference: d.basisReference, reason: d.reason, evidence: a.evidenceLines, recordedByUserId: ctx.actor.userId,
      expectedRevision: a.input.expectedVersion, idempotencyKey: a.input.idempotencyKey, correlationId: ctx.correlationId,
    };
    const valid = validateDecisionRequest(request);
    if (!valid.ok) {
      throw new TemplateWorkflowError("DECISION_REJECTED", DECISION_MESSAGES[valid.code] ?? valid.code,
        (valid.fields ?? []).map((f) => ({ code: valid.code, path: f, message: "campo obrigatório ou inválido" })));
    }
    const res = await this.gov().recordGovernanceDecision(request);
    switch (res.status) {
      case "COMMITTED": return { decision: res.decision, replayed: false };
      case "REPLAYED": return { decision: res.decision, replayed: true };
      case "SUBJECT_NOT_FOUND": throw new TemplateWorkflowError("NOT_FOUND", "revisão não encontrada nesta organização");
      case "STALE_VERSION": throw new TemplateWorkflowError("STALE_STATE", `outra pessoa registrou antes (versão atual ${res.currentVersion}); recarregue e revise antes de registrar`);
      default: throw new TemplateWorkflowError("DECISION_REJECTED", DECISION_MESSAGES.DECISION_IDEMPOTENCY_CONFLICT);
    }
  }
}
