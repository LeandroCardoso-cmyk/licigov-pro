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
import {
  decodeTemplateGovernancePolicy, encodeTemplateGovernancePolicy, isLegacyTemplateOrganization, originChangeIssue, type OrganizationTransitionState, resolveEffectiveTemplateGovernancePolicy, TEMPLATE_POLICY_SUBJECT_ID,
  validateTemplateGovernancePolicy, type EffectiveTemplateGovernancePolicy, type TemplateGovernancePolicy,
} from "../../domain/institutionalTemplates/governance/templateGovernanceV2";
import { explainIntegrity, type IntegrityExplanation, type LineageProbe } from "../../domain/institutionalTemplates/governance/integrityExplanation";
import { getModelPackage } from "./modelPackages";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import { TemplateWorkflowError } from "./errors";
import type { OriginalVerification, TemplateGovernancePort, TemplateWorkflowPorts, WorkflowContext } from "./ports";

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
  /** Explainability de integridade: hash declarado × calculado × semântico × lineage, com o grau de garantia de cada um. */
  readonly integrity: IntegrityExplanation;
}

export type OriginalVerificationView =
  | { readonly applicable: false; readonly reason: string }
  | { readonly applicable: true; readonly status: OriginalVerification["status"]; readonly storageKey: string; readonly expectedSha256: string; readonly computedSha256: string | null; readonly checkedAt: string; readonly message: string };

export interface TemplatePolicyVersionView {
  readonly version: number;
  readonly decisionId: string;
  readonly policy: TemplateGovernancePolicy | null;
  readonly declaredBy: { readonly name: string; readonly role: string };
  readonly actDate: string;
  readonly basisReference: string;
  readonly reason: string;
  readonly recordedByUserId: number;
}
export interface TemplatePolicyView extends EffectiveTemplateGovernancePolicy {
  readonly history: readonly TemplatePolicyVersionView[];
  /** Compatibilidade/transição explícitas: por que este órgão está (ou não) no regime anterior e como sair dele. */
  readonly transition: { readonly cutoverAt: string | null; readonly source: "LEDGER_MARKER" | "UNAVAILABLE"; readonly legacyOrganization: boolean | null; readonly explanation: string };
  readonly note: string;
}
function transitionExplanation(kind: EffectiveTemplateGovernancePolicy["kind"], markerUnavailable: boolean): string {
  switch (kind) {
    case "TENANT_DEFINED": return "Política estabelecida pelo próprio órgão; prevalece sobre qualquer padrão da plataforma.";
    case "LEGACY_COMPAT": return "O órgão já possuía modelos antes da transição do padrão da plataforma e não registrou política: segue, por compatibilidade, exigindo evidência jurídica prévia. Nada foi alterado em silêncio. Para adotar o padrão da plataforma (opcional) ou confirmar a exigência, registre a política do órgão (gerente).";
    case "UNRESOLVED_STRICT": return markerUnavailable ? "O marco de transição da plataforma não está disponível: por segurança aplica-se o padrão estrito (evidência jurídica prévia exigida) até que ele possa ser lido. Nada foi alterado em silêncio." : "A política não pôde ser resolvida/lida: aplica-se o padrão estrito (evidência jurídica exigida) até que o órgão a restabeleça.";
    default: return "Padrão da plataforma: a evidência jurídica prévia do modelo é opcional. O órgão pode estabelecer a exigência (REQUIRED) a qualquer momento.";
  }
}
const POLICY_NOTE = "A política define o que o órgão exige para DISPONIBILIZAR um modelo no catálogo interno de elaboração. Não publica documento oficial e não substitui a análise jurídica dos documentos elaborados (etapa própria da Procuradoria).";

const LIFECYCLE_NOTE = "Evidência jurídica e procedência são metadados de governança: não alteram o status da revisão nem substituem a aprovação e a publicação humanas no sistema.";

export class TemplateGovernanceService {
  constructor(private readonly ports: Pick<TemplateWorkflowPorts, "repository" | "governance" | "clock"> & Partial<Pick<TemplateWorkflowPorts, "originals">>) {}

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
    const revision = await this.revision(ctx, revisionId);
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
    const integrity = explainIntegrity({
      revisionSemanticHash: revision.semanticHash, provenance: provCurrent, legalEvidence: evCurrent,
      lineageProbe: await this.probeLineage(ctx, provCurrent),
    });
    return {
      revisionId, provenance: provCurrent, provenanceVersions: prov.length, legalEvidence: evCurrent, legalEvidenceHistory: evHistory,
      malformedRecords: malformed, lifecycleNote: LIFECYCLE_NOTE, integrity,
    };
  }

  /** Reverifica AGORA a origem do lineage (leitura tenant-scoped; revisão de outro órgão é indistinguível de inexistente). */
  private async probeLineage(ctx: WorkflowContext, prov: ImportProvenance | null): Promise<LineageProbe | null> {
    const l = prov?.origin?.lineage;
    if (!l) return null;
    if (l.kind === "PLATFORM_PACKAGE") return { kind: "PLATFORM_PACKAGE", currentPackageSha256: getModelPackage(l.packageKey)?.provenance.sourceSha256 ?? null };
    const src = await this.ports.repository.getRevision(ctx.organizationId, l.revisionId);
    return { kind: "TENANT_REVISION", sourceRevisionSemanticHash: src && src.organizationId === ctx.organizationId ? src.semanticHash : null };
  }

  /**
   * Reverificação SOB DEMANDA do original preservado: relê o objeto no armazenamento e recalcula o SHA-256. Só leitura; só chaves do próprio órgão.
   * O resultado é um FATO observado agora (não é gravado nem altera a revisão).
   */
  async verifyOriginal(ctx: WorkflowContext, revisionId: string): Promise<OriginalVerificationView> {
    await this.revision(ctx, revisionId);
    const list = await this.gov().listGovernanceDecisions(ctx.organizationId, IMPORT_PROVENANCE_SUBJECT, revisionId);
    const prov = list.length ? decodeImportProvenance(list[list.length - 1]) : null;
    const original = prov?.origin?.original ?? null;
    if (!original) return { applicable: false, reason: "Este modelo não tem arquivo original enviado (pacote da plataforma, estrutura nativa ou derivado)." };
    if (!this.ports.originals) throw new TemplateWorkflowError("ORIGINAL_STORAGE_UNAVAILABLE", "o armazenamento de arquivos não está disponível; não foi possível reverificar o original agora");
    const r = await this.ports.originals.verify({ organizationId: ctx.organizationId, storageKey: original.storageKey, sha256: original.sha256 });
    log.info("template_original_verified", { organizationId: ctx.organizationId, revisionId, status: r.status, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    const message = r.status === "VERIFIED" ? "O arquivo preservado existe e seu SHA-256 confere com o calculado no envio."
      : r.status === "MISMATCH" ? "ATENÇÃO: o arquivo preservado NÃO confere com o SHA-256 calculado no envio. Não use este original e acione a administração."
      : r.status === "MISSING" ? "O arquivo preservado não foi encontrado no armazenamento."
      : r.status === "FORBIDDEN_KEY" ? "A chave de armazenamento registrada não pertence a este órgão; a leitura foi recusada."
      : `O armazenamento não respondeu: ${r.message}`;
    return { applicable: true, status: r.status, storageKey: original.storageKey, expectedSha256: original.sha256, computedSha256: r.status === "MISMATCH" ? r.computedSha256 : r.status === "VERIFIED" ? original.sha256 : null, checkedAt: this.ports.clock.now(), message };
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
    // Origem IMUTÁVEL: uma nova versão da procedência só repete a origem registrada (ou classifica um registro legado que não a tinha).
    const priorProv = (await this.gov().listGovernanceDecisions(ctx.organizationId, IMPORT_PROVENANCE_SUBJECT, revision.id)).map(decodeImportProvenance).filter((p): p is ImportProvenance => p !== null).pop() ?? null;
    const originProblem = originChangeIssue(priorProv?.origin ?? null, input.provenance.origin ?? null);
    if (originProblem) throw new TemplateWorkflowError("VALIDATION_FAILED", originProblem, [{ code: "ORIGIN_IMMUTABLE", path: "origin", message: originProblem }]);
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
   * Política de governança de templates do órgão (Template Governance V2). Decisão explícita do órgão sempre prevalece; ausente ⇒ órgão LEGADO (modelos anteriores ao
   * marco de transição) segue em LEGACY_COMPAT (REQUIRED), os demais no padrão da plataforma (OPTIONAL); marco indisponível ou corrente ilegível ⇒ estrito. Só leitura — nada é gravado.
   */
  async getTemplatePolicy(ctx: WorkflowContext): Promise<TemplatePolicyView> {
    const history = this.ports.governance ? await this.ports.governance.listGovernanceDecisions(ctx.organizationId, "institutional.policy", TEMPLATE_POLICY_SUBJECT_ID) : [];
    // marco imutável (migration 0318) — indisponível/ilegível ⇒ null ⇒ modo ESTRITO (nunca presume órgão novo)
    const marker = this.ports.governance?.getLegacyPolicyCutover ? await this.ports.governance.getLegacyPolicyCutover() : null;
    let organization: OrganizationTransitionState = "UNKNOWN";
    // só consulta as identidades quando o resultado depende disso (sem decisão registrada e com marco disponível)
    if (marker && history.length === 0) organization = isLegacyTemplateOrganization(await this.ports.repository.listIdentities(ctx.organizationId, {}), marker.cutoverAt) ? "LEGACY" : "NEW";
    const effective = resolveEffectiveTemplateGovernancePolicy(history, { organization });
    return {
      ...effective, note: POLICY_NOTE,
      transition: { cutoverAt: marker?.cutoverAt ?? null, source: marker ? "LEDGER_MARKER" : "UNAVAILABLE", legacyOrganization: history.length === 0 && marker ? organization === "LEGACY" : null, explanation: transitionExplanation(effective.kind, !marker) },
      history: history.map((d) => ({
        version: d.revision, decisionId: d.id, policy: decodeTemplateGovernancePolicy(d), declaredBy: { name: d.decidedByName, role: d.decidedByRole },
        actDate: d.decidedAt, basisReference: d.basisReference, reason: d.reason, recordedByUserId: d.recordedByUserId,
      })),
    };
  }

  /**
   * Estabelece (ou supera) a política do órgão. Só ator HUMANO, com confirmação, autoridade declarada, justificativa e CAS pela versão vista; append-only
   * (a anterior permanece). O piso de papel para aprovar/publicar só pode ser elevado (≥ manager). Nada é presumido: sem este ato valem o padrão da plataforma ou, para órgão legado, o regime anterior (LEGACY_COMPAT).
   */
  async recordTemplatePolicy(ctx: WorkflowContext, input: GovernanceWriteInput & { policy: TemplateGovernancePolicy }): Promise<{ policy: TemplatePolicyView; replayed: boolean }> {
    assertHumanActor(ctx.actor);
    this.requireConfirmation(input.confirm, "estabelecer a política de governança de modelos");
    const issues = validateTemplateGovernancePolicy(input.policy);
    if (issues.length) throw new TemplateWorkflowError("VALIDATION_FAILED", "política inválida", issues.map((i) => ({ code: "POLICY_INVALID", path: i.field, message: i.message })));
    const { decision, replayed } = await this.commit(ctx, {
      subjectType: "institutional.policy", decisionType: "institutional_policy", outcome: "estabelecida", revisionId: TEMPLATE_POLICY_SUBJECT_ID,
      input, evidenceLines: encodeTemplateGovernancePolicy(input.policy),
    });
    log.info("template_governance_policy_recorded", {
      organizationId: ctx.organizationId, decisionId: decision.id, version: decision.revision, replayed, legalEvidence: input.policy.legalEvidence,
      approveMinRole: input.policy.approveMinRole, publishMinRole: input.policy.publishMinRole, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId,
    });
    return { policy: await this.getTemplatePolicy(ctx), replayed };
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
    subjectType: DecisionSubjectType; decisionType: "template_legal_approval_evidence" | "template_import_provenance" | "institutional_policy"; outcome: "registrado" | "estabelecida";
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
