/**
 * Modelos Institucionais — WORKFLOW (Lane C). Orquestra, sobre ports estreitos:
 *   identidades · revisões DRAFT → APPROVED → PUBLISHED → DEPRECATED · bindings por revisão EXATA · pré-visualização ·
 *   explicabilidade. Sem I/O próprio, sem SQL, sem composer próprio, sem IA.
 *
 * Invariantes (T1 + decisões do owner):
 *  - ações institucionais (aprovar/publicar/depreciar/vincular) só por ator HUMANO e com CONFIRMAÇÃO explícita;
 *  - aprovação, publicação e depreciação geram decisões institucionais DISTINTAS no ledger existente (`planDecision`);
 *    a decisão registra a autoridade declarada (nunca inferida de quem clicou — INV-13);
 *  - PUBLISHED é imutável: alterar = nova revisão DRAFT; DEPRECATED permanece válida para replay histórico;
 *  - binding sempre aponta para o id EXATO de uma revisão PUBLISHED; ambiguidade ⇒ falha fechada; nunca "última";
 *  - todo acesso é tenant-scoped pelo `organizationId` do contexto autenticado (nunca do cliente).
 */
import {
  AUTHORITY_NOT_VALIDATED, DECISION_MESSAGES, decisionRequestHash, normalizeDecisionRequest, planDecision, validateDecisionRequest,
  type DecisionRequest, type InstitutionalDecision,
} from "../../domain/institutionalDecision";
import {
  createDraftRevision, resolveTemplateBinding, REVISION_STATUSES, revisionSemanticHash, revisionUpdateIssues, sameScope,
  TEMPLATE_DOCUMENT_KINDS, transitionRevision, validateTemplateIdentity,
  type BindingRequest, type BindingResolution, type BindingScope, type ComposeOutcome, type OrgId, type RevisionSourceFormat,
  type RevisionStatus, type TemplateBinding, type TemplateDocumentKind, type TemplateIdentity,
  type TemplateIssue, type TemplateRevision, validateTemplateRevision,
  type AnyVariableCatalog, isAstV2, isCatalogV2, validateAnyTemplateAst,
} from "../../domain/institutionalTemplates";
import { serviceLogger } from "../observabilityService";
import type { ReadinessMatrix } from "../../domain/institutionalTemplates/governance/readinessMatrix";
import { witnessRefs, type ReadinessWitness } from "../../domain/institutionalTemplates/governance/readinessWitness";
import { INTEGRATED_CAPABILITIES } from "../../domain/institutionalTemplates/governance/capabilities";
import { scopeHeadline, unsupportedScopeDimensions, validateExplicitScope } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { assertHumanActor } from "./authority";
import { summarizeAst, type AstSummary } from "./astSummary";
import { TemplateWorkflowError, type TemplateWorkflowIssue } from "./errors";
import { explainComposition, type CompositionExplanation } from "./explainability";
import {
  DuplicateTemplateIdentityError, DuplicateTemplateRevisionError,
  type PersistenceContext, type TemplateWorkflowPorts, type WorkflowContext,
} from "./ports";

const log = serviceLogger("institutionalTemplatesWorkflow");

/** Tipos documentais cuja PUBLICAÇÃO exige matriz de prontidão sem BLOCKED (piloto: Edital). Estender = decisão de produto. */
export const READINESS_GATED_KINDS: readonly TemplateDocumentKind[] = Object.freeze(["edital"] as TemplateDocumentKind[]);
/** Prefixo das linhas de evidência ACRESCENTADAS PELO SERVIDOR à decisão de publicação. */
export const READINESS_EVIDENCE_PREFIX = "readiness.";

const toIssues = (issues: readonly TemplateIssue[]): TemplateWorkflowIssue[] => issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));

function validationFailed(message: string, issues: readonly TemplateIssue[]): TemplateWorkflowError {
  return new TemplateWorkflowError("VALIDATION_FAILED", message, toIssues(issues));
}

const pctx = (ctx: WorkflowContext): PersistenceContext => ({ actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });

function notFound(what: string): TemplateWorkflowError {
  // Mensagem neutra: nunca distingue "não existe" de "é de outro tenant" (anti-enumeração).
  return new TemplateWorkflowError("NOT_FOUND", `${what} não encontrado(a) nesta organização`);
}

/** Visão sem AST (listas) — o conteúdo só sai no detalhe da revisão. */
export interface RevisionSummary {
  readonly id: string;
  readonly identityId: string;
  readonly revision: number;
  readonly status: RevisionStatus;
  readonly semanticHash: string;
  readonly variableCatalogVersion: string;
  readonly sourceFormat: RevisionSourceFormat;
  readonly approvalDecisionId: string | null;
  readonly publishDecisionId: string | null;
}

function summarizeRevision(r: TemplateRevision): RevisionSummary {
  return {
    id: r.id, identityId: r.identityId, revision: r.revision, status: r.status, semanticHash: r.semanticHash,
    variableCatalogVersion: r.variableCatalogVersion, sourceFormat: r.sourceFormat,
    approvalDecisionId: r.approvalDecisionId ?? null, publishDecisionId: r.publishDecisionId ?? null,
  };
}

export interface IdentitySummary {
  readonly identity: TemplateIdentity;
  readonly revisionCount: number;
  readonly statusCounts: Readonly<Record<RevisionStatus, number>>;
  /** Informativo: revisões PUBLISHED existentes. A AUTORIDADE de qual revisão se aplica é o binding exato, nunca esta lista. */
  readonly publishedRevisions: readonly { readonly id: string; readonly revision: number }[];
  readonly activeBindingCount: number;
}

const emptyCounts = (): Record<RevisionStatus, number> => ({ DRAFT: 0, APPROVED: 0, PUBLISHED: 0, DEPRECATED: 0 });

export class InstitutionalTemplatesWorkflow {
  constructor(private readonly ports: TemplateWorkflowPorts) {}

  // ─── leitura ───────────────────────────────────────────────────────────────

  async listIdentities(ctx: WorkflowContext, filter: { documentKind?: TemplateDocumentKind } = {}): Promise<IdentitySummary[]> {
    const identities = await this.ports.repository.listIdentities(ctx.organizationId, filter);
    const bindings = await this.ports.repository.listBindings(ctx.organizationId, { activeOnly: true });
    const out: IdentitySummary[] = [];
    for (const identity of identities) {
      this.assertSameTenant(ctx, identity.organizationId);
      const revisions = await this.ports.repository.listRevisions(ctx.organizationId, identity.id);
      const statusCounts = emptyCounts();
      revisions.forEach((r) => { statusCounts[r.status]++; });
      out.push({
        identity, revisionCount: revisions.length, statusCounts,
        publishedRevisions: revisions.filter((r) => r.status === "PUBLISHED").map((r) => ({ id: r.id, revision: r.revision })),
        activeBindingCount: bindings.filter((b) => b.identityId === identity.id).length,
      });
    }
    return out;
  }

  async getIdentity(ctx: WorkflowContext, identityId: string) {
    const identity = await this.requireIdentity(ctx, identityId);
    const revisions = await this.ports.repository.listRevisions(ctx.organizationId, identity.id);
    const bindings = (await this.ports.repository.listBindings(ctx.organizationId, { documentKind: identity.documentKind }))
      .filter((b) => b.identityId === identity.id);
    return { identity, revisions: revisions.map(summarizeRevision), bindings };
  }

  async getRevision(ctx: WorkflowContext, revisionId: string) {
    const { revision, identity } = await this.requireRevision(ctx, revisionId);
    const catalog = this.catalogFor(revision);
    const uses = await this.ports.repository.countManifestReferences(ctx.organizationId, revision.id);
    return {
      identity, revision, summary: summarizeAst(revision.ast), manifestReferenceCount: uses,
      catalogAvailable: catalog !== null,
      /** Estado, não autoridade: o que cada ação humana exigirá (para a UX explicar antes de pedir confirmação). */
      nextAction: nextActionFor(revision.status),
    };
  }

  async listRevisions(ctx: WorkflowContext, identityId: string): Promise<RevisionSummary[]> {
    const identity = await this.requireIdentity(ctx, identityId);
    return (await this.ports.repository.listRevisions(ctx.organizationId, identity.id)).map(summarizeRevision);
  }

  /**
   * Catálogo da AST: `tpl-ast/1` ⇒ catálogo v1 corrente (comportamento histórico); `tpl-ast/2` ⇒ catálogo v2 da MESMA versão
   * informada (um por modelo). Sem versão para v2, ou versão que não seja v2 ⇒ falha (nunca coerção silenciosa).
   */
  private catalogForAst(ast: unknown, catalogVersion?: string): AnyVariableCatalog {
    if (!isAstV2(ast)) {
      if (catalogVersion !== undefined && catalogVersion !== this.ports.catalog.current().version) {
        throw new TemplateWorkflowError("VALIDATION_FAILED", `tpl-ast/1 usa o catálogo ${this.ports.catalog.current().version}`);
      }
      return this.ports.catalog.current();
    }
    if (!catalogVersion) throw new TemplateWorkflowError("VALIDATION_FAILED", "tpl-ast/2 exige a versão do catálogo (catalogVersion) do modelo");
    const c = this.ports.catalog.byVersion(catalogVersion);
    if (!c || !isCatalogV2(c)) throw new TemplateWorkflowError("VALIDATION_FAILED", `catálogo ${catalogVersion} indisponível ou não é um catálogo tpl-catalog/2`);
    return c;
  }

  validateAst(ctx: WorkflowContext, ast: unknown, catalogVersion?: string): { valid: boolean; issues: TemplateWorkflowIssue[]; summary: AstSummary | null; catalogVersion: string } {
    void ctx;
    const catalog = this.catalogForAst(ast, catalogVersion);
    const result = validateAnyTemplateAst(ast, catalog);
    return result.ok
      ? { valid: true, issues: [], summary: summarizeAst(result.value), catalogVersion: catalog.version }
      : { valid: false, issues: toIssues(result.issues), summary: null, catalogVersion: catalog.version };
  }

  // ─── identidade e revisões (DRAFT) ─────────────────────────────────────────

  async createIdentity(ctx: WorkflowContext, input: { documentKind: TemplateDocumentKind; slug: string; displayName?: string }): Promise<TemplateIdentity> {
    assertHumanActor(ctx.actor);
    const identity: TemplateIdentity = {
      id: this.ports.ids.newId("ti"), organizationId: ctx.organizationId, documentKind: input.documentKind, slug: input.slug,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      createdAt: this.ports.clock.now(), createdByUserId: ctx.actor.userId,
    };
    const valid = validateTemplateIdentity(identity);
    if (!valid.ok) throw validationFailed("identidade inválida", valid.issues);
    const existing = await this.ports.repository.findIdentityBySlug(ctx.organizationId, input.documentKind, input.slug);
    if (existing) throw new TemplateWorkflowError("CONFLICT", "já existe um modelo com este tipo documental e identificador (slug) nesta organização");
    try {
      await this.ports.repository.insertIdentity(identity, pctx(ctx));
    } catch (err) {
      if (err instanceof DuplicateTemplateIdentityError) throw new TemplateWorkflowError("CONFLICT", "já existe um modelo com este tipo documental e identificador (slug) nesta organização");
      throw err;
    }
    log.info("template_identity_created", { organizationId: ctx.organizationId, identityId: identity.id, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return identity;
  }

  /**
   * Cria uma NOVA revisão DRAFT (nº = maior + 1). `fromRevisionId` clona o conteúdo de uma revisão existente em
   * QUALQUER estado — é assim que se altera um modelo publicado: nova revisão, nunca edição da publicada.
   */
  async createDraft(
    ctx: WorkflowContext,
    input: { identityId: string; ast?: unknown; fromRevisionId?: string; sourceFormat?: RevisionSourceFormat; catalogVersion?: string },
  ): Promise<TemplateRevision> {
    assertHumanActor(ctx.actor);
    const identity = await this.requireIdentity(ctx, input.identityId);
    let ast: unknown = input.ast;
    let sourceFormat: RevisionSourceFormat = input.sourceFormat ?? "NATIVE";
    let catalogVersion = input.catalogVersion;
    if (input.fromRevisionId !== undefined) {
      const source = await this.ports.repository.getRevision(ctx.organizationId, input.fromRevisionId);
      if (!source || source.identityId !== identity.id) throw notFound("revisão de origem");
      ast = source.ast;
      sourceFormat = "NATIVE";
      if (isAstV2(source.ast)) catalogVersion = source.variableCatalogVersion;
    }
    if (ast === undefined) throw new TemplateWorkflowError("VALIDATION_FAILED", "informe o conteúdo (AST) ou a revisão de origem");
    const catalog = this.catalogForAst(ast, catalogVersion);
    const astCheck = validateAnyTemplateAst(ast, catalog);
    if (!astCheck.ok) throw validationFailed("a estrutura do modelo é inválida", astCheck.issues);

    const existing = await this.ports.repository.listRevisions(ctx.organizationId, identity.id);
    const next = existing.reduce((m, r) => Math.max(m, r.revision), 0) + 1;
    const created = createDraftRevision({
      id: this.ports.ids.newId("tr"), identity, revision: next, ast: astCheck.value, catalog, sourceFormat,
    });
    if (!created.ok) throw validationFailed("a revisão é inválida", created.issues);
    try {
      await this.ports.repository.insertDraftRevision(created.value, pctx(ctx));
    } catch (err) {
      if (err instanceof DuplicateTemplateRevisionError) throw new TemplateWorkflowError("CONFLICT", "outra revisão foi criada ao mesmo tempo; recarregue e tente novamente");
      throw err;
    }
    log.info("template_draft_created", { organizationId: ctx.organizationId, identityId: identity.id, revisionId: created.value.id, revision: next, sourceFormat, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return created.value;
  }

  /** Edita o conteúdo de um DRAFT (CAS pelo hash que a pessoa viu). Qualquer outro estado é imutável. */
  async updateDraft(ctx: WorkflowContext, input: { revisionId: string; ast: unknown; expectedSemanticHash: string }): Promise<TemplateRevision> {
    assertHumanActor(ctx.actor);
    const { revision: before, identity } = await this.requireRevision(ctx, input.revisionId);
    if (before.status !== "DRAFT") {
      throw new TemplateWorkflowError("REVISION_IMMUTABLE", `a revisão está ${before.status} e é imutável; crie uma nova revisão (DRAFT) a partir dela`);
    }
    if (before.semanticHash !== input.expectedSemanticHash) {
      throw new TemplateWorkflowError("STALE_STATE", "o rascunho foi alterado por outra pessoa desde que você o abriu; recarregue antes de salvar");
    }
    // v2: o catálogo do rascunho NÃO muda em edição (a versão do catálogo faz parte do hash semântico da revisão).
    const catalog = this.catalogForAst(input.ast, isAstV2(input.ast) ? before.variableCatalogVersion : undefined);
    const astCheck = validateAnyTemplateAst(input.ast, catalog);
    if (!astCheck.ok) throw validationFailed("a estrutura do modelo é inválida", astCheck.issues);
    const after: TemplateRevision = {
      ...before, ast: astCheck.value, variableCatalogVersion: catalog.version,
      semanticHash: revisionSemanticHash({ ast: astCheck.value, variableCatalogVersion: catalog.version }),
    };
    const valid = validateTemplateRevision(after, identity, catalog);
    if (!valid.ok) throw validationFailed("a revisão é inválida", valid.issues);
    const immut = revisionUpdateIssues(before, after).filter((i) => i.code !== "REVISION_IMMUTABLE" || before.status !== "DRAFT");
    if (immut.length) throw validationFailed("atualização não permitida", immut);
    const applied = await this.ports.repository.updateDraftContent(ctx.organizationId, before, after, pctx(ctx));
    if (!applied) throw new TemplateWorkflowError("STALE_STATE", "o rascunho mudou (ou deixou de ser DRAFT) durante a edição; recarregue");
    log.info("template_draft_updated", { organizationId: ctx.organizationId, revisionId: before.id, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return after;
  }

  // ─── ciclo de vida: aprovar · publicar · depreciar ─────────────────────────

  approve(ctx: WorkflowContext, input: LifecycleInput) { return this.transition(ctx, "APPROVED", input); }
  /**
   * Publicar (decisão humana DISTINTA da aprovação). Para tipos sob `READINESS_GATED_KINDS` (Edital), ANTES da transição o BACKEND
   * recalcula a matriz de prontidão com o estado autoritativo atual: qualquer verificação BLOCKED ⇒ `PUBLICATION_BLOCKED` (zero
   * decisão, zero mudança de status, zero evento). Uma decisão humana NÃO substitui pré-condição estrutural/técnica ausente e não existe
   * "aceite de bloqueio". `input.inventory` é só DADO (o inventário da fonte), autenticado pelo SHA-256 registrado na procedência —
   * nunca uma matriz do cliente.
   */
  publish(ctx: WorkflowContext, input: LifecycleInput) { return this.transition(ctx, "PUBLISHED", input); }
  deprecate(ctx: WorkflowContext, input: LifecycleInput) { return this.transition(ctx, "DEPRECATED", input); }

  private async transition(ctx: WorkflowContext, to: "APPROVED" | "PUBLISHED" | "DEPRECATED", input: LifecycleInput) {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) {
      throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória para esta ação (nada foi alterado)");
    }
    const { revision: before, identity } = await this.requireRevision(ctx, input.revisionId);
    const expected = EXPECTED_BEFORE[to];
    const decisionType = DECISION_BY_TARGET[to];
    // Decisão institucional (ledger existente). Autoridade DECLARADA no ato; competência não validada (política pendente).
    const request: DecisionRequest = {
      organizationId: ctx.organizationId, subjectType: decisionType.subjectType, subjectId: before.id, decisionType: decisionType.decisionType,
      outcome: decisionType.outcome, decidedByName: input.decision.decidedByName, decidedByRole: input.decision.decidedByRole,
      decidedByUserId: input.decision.decidedByUserId ?? null, decidedAt: input.decision.decidedAt, basisReference: input.decision.basisReference,
      reason: input.decision.reason, evidence: input.decision.evidence ?? [], recordedByUserId: ctx.actor.userId,
      expectedRevision: 0, idempotencyKey: input.idempotencyKey, correlationId: ctx.correlationId,
    };
    if (input.expectedStatus !== before.status) {
      // Replay: a MESMA ação (mesma chave de idempotência E mesmo pedido) já foi concluída ⇒ converge para a decisão gravada.
      const replay = await this.replayedTransition(ctx, to, request, before);
      if (replay) return replay;
      throw new TemplateWorkflowError("STALE_STATE", `o estado da revisão mudou (agora ${before.status}); recarregue antes de decidir`);
    }
    if (before.status !== expected) {
      throw new TemplateWorkflowError("TRANSITION_INVALID", `transição ${before.status} → ${to} não permitida (esperado: ${expected} → ${to})`);
    }
    const catalog = this.catalogFor(before);
    if (!catalog) throw new TemplateWorkflowError("VALIDATION_FAILED", `catálogo de variáveis ${before.variableCatalogVersion} indisponível; a revisão não pode ser decidida`);
    // Prontidão: recalculada AQUI, com estado autoritativo, antes de qualquer decisão/escrita. BLOCKED ⇒ nada é persistido.
    const readiness = to === "PUBLISHED" ? await this.assertPublicationReadiness(ctx, identity, before, input.inventory) : null;
    const readinessEvidence = readiness?.evidence ?? [];
    const planned: DecisionRequest = readinessEvidence.length ? { ...request, evidence: [...request.evidence, ...readinessEvidence] } : request;

    if (to === "DEPRECATED") {
      const pinning = (await this.ports.repository.listBindings(ctx.organizationId, { activeOnly: true })).filter((b) => b.pinnedRevisionId === before.id);
      if (pinning.length > 0) {
        throw new TemplateWorkflowError("REVISION_PINNED_BY_BINDING", `a revisão está fixada por ${pinning.length} binding(s) ativo(s); desative-os (ou fixe outra revisão PUBLISHED) antes de depreciar`);
      }
    }

    const valid = validateDecisionRequest(planned);
    if (!valid.ok) {
      throw new TemplateWorkflowError("DECISION_REJECTED", DECISION_MESSAGES[valid.code] ?? valid.code,
        (valid.fields ?? []).map((f) => ({ code: valid.code, path: f, message: "campo obrigatório ou inválido" })));
    }
    const plan = planDecision(planned, { byIdempotencyKey: null, current: null });
    if (plan.kind !== "insert") throw new TemplateWorkflowError("DECISION_REJECTED", "decisão não pôde ser planejada");
    const decision: InstitutionalDecision = plan.decision;

    const step = to === "APPROVED"
      ? ({ to: "APPROVED", approvalDecisionId: decision.id } as const)
      : to === "PUBLISHED"
        ? ({ to: "PUBLISHED", publishDecisionId: decision.id } as const)
        : ({ to: "DEPRECATED" } as const);
    const next = transitionRevision(before, step, identity, catalog);
    if (!next.ok) throw validationFailed(`a revisão não pode ir para ${to}`, next.issues);

    const result = await this.ports.repository.commitLifecycleTransition({
      organizationId: ctx.organizationId, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId,
      expectedStatus: before.status, before, after: next.value, decision,
      ...(readiness?.witness ? { readinessWitness: witnessRefs(readiness.witness) } : {}),
    });
    if (result.status === "READINESS_STALE") {
      // TOCTOU-001: a procedência/evidência/revisão mudou entre o cálculo da prontidão e o COMMIT. Nada foi gravado.
      throw new TemplateWorkflowError("READINESS_STALE", `a prontidão foi calculada sobre um estado que mudou antes da publicação (${result.drift.join(", ")}); recalcule e publique novamente (nada foi alterado)`);
    }
    if (result.status === "STALE_STATUS") {
      throw new TemplateWorkflowError("STALE_STATE", `o estado da revisão mudou (agora ${result.currentStatus}); recarregue antes de decidir`);
    }
    if (result.status === "DECISION_IDEMPOTENCY_CONFLICT") {
      throw new TemplateWorkflowError("DECISION_REJECTED", DECISION_MESSAGES.DECISION_IDEMPOTENCY_CONFLICT);
    }
    log.info(`template_revision_${to.toLowerCase()}`, {
      organizationId: ctx.organizationId, revisionId: before.id, decisionId: result.decision.id, actorUserId: ctx.actor.userId,
      authorityValidation: AUTHORITY_NOT_VALIDATED, replayed: result.status === "REPLAYED", correlationId: ctx.correlationId,
    });
    return { revision: next.value, decision: result.decision, replayed: result.status === "REPLAYED" };
  }

  /**
   * Replay de uma transição já concluída: só converge quando a decisão da MESMA chave de idempotência existe neste tenant,
   * é do MESMO assunto/tipo e a revisão está exatamente no estado-alvo (ou além, por passos posteriores legítimos).
   */
  private async replayedTransition(
    ctx: WorkflowContext, to: "APPROVED" | "PUBLISHED" | "DEPRECATED", request: DecisionRequest, current: TemplateRevision,
  ): Promise<{ revision: TemplateRevision; decision: InstitutionalDecision; replayed: true } | null> {
    const prior = await this.ports.repository.getDecisionByIdempotencyKey(ctx.organizationId, request.idempotencyKey);
    if (!prior) return null;
    const target = DECISION_BY_TARGET[to];
    // A decisão de publicação carrega linhas `readiness.*` ACRESCENTADAS PELO SERVIDOR (hash/instante/estados da matriz): o replay
    // compara o pedido do humano com a decisão gravada SEM essas linhas e só então confere o hash com as linhas originais.
    const humanEvidence = prior.evidence.filter((l) => !l.startsWith(READINESS_EVIDENCE_PREFIX));
    const normalized = normalizeDecisionRequest(request).evidence;
    const sameHumanEvidence = humanEvidence.length === normalized.length && humanEvidence.every((l, i) => l === normalized[i]);
    if (prior.subjectId !== current.id || prior.subjectType !== target.subjectType || prior.decisionType !== target.decisionType
      || !sameHumanEvidence || prior.requestHash !== decisionRequestHash({ ...request, evidence: prior.evidence })) {
      throw new TemplateWorkflowError("DECISION_REJECTED", DECISION_MESSAGES.DECISION_IDEMPOTENCY_CONFLICT);
    }
    if (REVISION_STATUSES.indexOf(current.status) < REVISION_STATUSES.indexOf(to)) return null;
    log.info(`template_revision_${to.toLowerCase()}`, {
      organizationId: ctx.organizationId, revisionId: current.id, decisionId: prior.id, actorUserId: ctx.actor.userId,
      authorityValidation: AUTHORITY_NOT_VALIDATED, replayed: true, correlationId: ctx.correlationId,
    });
    return { revision: current, decision: prior, replayed: true };
  }

  /**
   * Gate de prontidão da publicação. Devolve as linhas `readiness.*` (hash, instante, estados) a gravar NA decisão de publicação.
   * Não confia em nada do cliente: a matriz é recalculada pelo port a partir do estado atual. Indisponível ⇒ falha fechada.
   */
  private async assertPublicationReadiness(ctx: WorkflowContext, identity: TemplateIdentity, revision: TemplateRevision, inventory: unknown): Promise<{ evidence: string[]; witness: ReadinessWitness | null }> {
    if (!READINESS_GATED_KINDS.includes(identity.documentKind)) return { evidence: [], witness: null };
    const port = this.ports.readiness;
    if (!port) throw new TemplateWorkflowError("READINESS_UNAVAILABLE", "a prontidão para publicar não pôde ser verificada (port não configurado); a publicação foi bloqueada (nada foi alterado)");
    let matrix: ReadinessMatrix;
    try {
      matrix = await port.evaluateForPublication(ctx, { revisionId: revision.id, ...(inventory !== undefined ? { inventory } : {}) });
    } catch (err) {
      if (err instanceof TemplateWorkflowError && err.code === "NOT_FOUND") throw err;
      throw new TemplateWorkflowError("READINESS_UNAVAILABLE", "a prontidão para publicar não pôde ser verificada; a publicação foi bloqueada (nada foi alterado)");
    }
    if (!matrix || matrix.revisionId !== revision.id || matrix.revisionSemanticHash !== revision.semanticHash || !Array.isArray(matrix.checks)) {
      throw new TemplateWorkflowError("READINESS_UNAVAILABLE", "a matriz de prontidão não corresponde à revisão exata; a publicação foi bloqueada (nada foi alterado)");
    }
    const blocked = matrix.checks.filter((c) => c.status === "BLOCKED");
    if (blocked.length > 0) {
      throw new TemplateWorkflowError("PUBLICATION_BLOCKED", `a revisão não pode ser publicada: ${blocked.length} verificação(ões) de prontidão BLOCKED (matrixHash=${matrix.matrixHash}); nada foi alterado`,
        blocked.map((c) => ({ code: c.id, path: `readiness.${c.id}`, message: `${c.label}: ${c.detail}` })));
    }
    // A testemunha é OBRIGATÓRIA no gate: sem ela não há como provar, dentro da transação, que o estado não mudou.
    if (!matrix.witness || matrix.witness.revisionId !== revision.id || matrix.witness.matrixHash !== matrix.matrixHash) {
      throw new TemplateWorkflowError("READINESS_UNAVAILABLE", "a matriz de prontidão não trouxe a testemunha do estado provado; a publicação foi bloqueada (nada foi alterado)");
    }
    return {
      witness: matrix.witness,
      evidence: [
        `${READINESS_EVIDENCE_PREFIX}matrixHash=${matrix.matrixHash}`,
        `${READINESS_EVIDENCE_PREFIX}witnessHash=${matrix.witness.witnessHash}`,
        `${READINESS_EVIDENCE_PREFIX}checkedAt=${this.ports.clock.now()}`,
        `${READINESS_EVIDENCE_PREFIX}statuses=${matrix.checks.map((c) => `${c.id}:${c.status}`).join(",")}`,
      ],
    };
  }

  // ─── bindings por revisão EXATA ────────────────────────────────────────────

  async listBindings(ctx: WorkflowContext, filter: { documentKind?: TemplateDocumentKind; activeOnly?: boolean } = {}): Promise<TemplateBinding[]> {
    return [...(await this.ports.repository.listBindings(ctx.organizationId, filter))];
  }

  /** Vincula (documentKind, escopo) a UMA revisão PUBLISHED exata. Nunca "última"; ambiguidade ⇒ recusa. */
  async setBinding(
    ctx: WorkflowContext,
    input: { documentKind: TemplateDocumentKind; scope: BindingScope; identityId: string; pinnedRevisionId: string; effectiveFrom: string; confirm: boolean; replacesBindingId?: string },
  ): Promise<TemplateBinding> {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória para vincular (nada foi alterado)");
    if (!TEMPLATE_DOCUMENT_KINDS.includes(input.documentKind)) throw new TemplateWorkflowError("VALIDATION_FAILED", "tipo documental fora do contrato");
    if (!input.pinnedRevisionId) throw new TemplateWorkflowError("BINDING_NOT_PINNED", "o binding exige o id exato da revisão; 'última publicada' não é permitido");
    // Aplicabilidade EXPLÍCITA (Edital: modalidade, forma, regime, critério e — se eletrônica — plataforma). Nada é inferido.
    const scopeIssues = validateExplicitScope(input.documentKind, input.scope);
    if (scopeIssues.length) {
      throw new TemplateWorkflowError("SCOPE_INVALID", "aplicabilidade do vínculo incompleta ou inválida (nada foi alterado)", scopeIssues.map((i) => ({ code: i.code, path: i.dimension, message: i.message })));
    }
    // Dimensão que a persistência não suporta ⇒ recusa fechada (descartar em silêncio faria escopos distintos colidirem).
    const unsupported = unsupportedScopeDimensions(input.scope, (this.ports.capabilities ?? INTEGRATED_CAPABILITIES).scopeDimensions);
    if (unsupported.length) {
      throw new TemplateWorkflowError("SCOPE_DIMENSION_UNSUPPORTED", `a persistência atual não suporta as dimensões de escopo: ${unsupported.join(", ")} (nada foi alterado)`, unsupported.map((d) => ({ code: "SCOPE_DIMENSION_UNSUPPORTED", path: d, message: "dimensão ainda não persistida" })));
    }
    const identity = await this.requireIdentity(ctx, input.identityId);
    if (identity.documentKind !== input.documentKind) throw new TemplateWorkflowError("VALIDATION_FAILED", "o tipo documental do binding difere do tipo do modelo");
    const revision = await this.ports.repository.getRevision(ctx.organizationId, input.pinnedRevisionId);
    if (!revision || revision.identityId !== identity.id) throw notFound("revisão");
    if (revision.status !== "PUBLISHED") throw new TemplateWorkflowError("BINDING_NOT_PUBLISHED", `a revisão está ${revision.status}; só uma revisão PUBLISHED pode ser vinculada`);

    const binding: TemplateBinding = {
      id: this.ports.ids.newId("tb"), organizationId: ctx.organizationId, documentKind: input.documentKind, scope: input.scope,
      identityId: identity.id, pinnedRevisionId: revision.id, active: true, effectiveFrom: input.effectiveFrom,
    };
    const ambiguityProbe = await this.ports.repository.listBindings(ctx.organizationId, { documentKind: input.documentKind, activeOnly: true });
    const remaining = ambiguityProbe.filter((b) => b.id !== input.replacesBindingId);
    const trial = resolveTemplateBinding(
      { organizationId: ctx.organizationId, documentKind: input.documentKind, scope: input.scope, asOf: input.effectiveFrom },
      [...remaining, binding], await this.revisionsFor(ctx, [...remaining, binding]),
    );
    if (trial.status === "INVALID") throw validationFailed("binding inválido", trial.issues);
    if (trial.status === "AMBIGUOUS") {
      throw new TemplateWorkflowError("BINDING_AMBIGUOUS", `já existe binding ativo para este tipo e escopo (${trial.bindingIds.length} candidatos); informe qual substituir ou desative o anterior`);
    }
    if (input.replacesBindingId !== undefined) {
      const old = await this.ports.repository.getBinding(ctx.organizationId, input.replacesBindingId);
      if (!old || old.documentKind !== input.documentKind || !sameScope(old.scope, input.scope)) throw notFound("binding a substituir");
    }
    // Substituição ATÔMICA: desativar o anterior e criar o novo acontecem na mesma transação (nunca zero nem dois ativos).
    await this.ports.repository.insertBinding(binding, pctx(ctx), input.replacesBindingId);
    log.info("template_binding_set", { organizationId: ctx.organizationId, bindingId: binding.id, scope: scopeHeadline(input.scope), revisionId: revision.id, replaced: input.replacesBindingId ?? null, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return binding;
  }

  async deactivateBinding(ctx: WorkflowContext, input: { bindingId: string; confirm: boolean }): Promise<void> {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória (nada foi alterado)");
    const binding = await this.ports.repository.getBinding(ctx.organizationId, input.bindingId);
    if (!binding) throw notFound("binding");
    const done = await this.ports.repository.deactivateBinding(ctx.organizationId, binding.id, pctx(ctx));
    if (!done) throw new TemplateWorkflowError("STALE_STATE", "o binding já estava inativo");
    log.info("template_binding_deactivated", { organizationId: ctx.organizationId, bindingId: binding.id, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
  }

  /** Resolução EXATA (composição por port; padrão = domínio). `asOf` explícito. Ambíguo/sem pin ⇒ falha fechada. */
  async resolveBinding(ctx: WorkflowContext, input: { documentKind: TemplateDocumentKind; scope: BindingScope; asOf?: string }): Promise<BindingResolution> {
    const request: BindingRequest = { organizationId: ctx.organizationId, documentKind: input.documentKind, scope: input.scope, asOf: input.asOf ?? this.ports.clock.now() };
    if (this.ports.composition.resolveExactBinding) {
      const resolved = await this.ports.composition.resolveExactBinding(request);
      this.assertResolutionTenant(ctx, resolved);
      return resolved;
    }
    const bindings = await this.ports.repository.listBindings(ctx.organizationId, { documentKind: input.documentKind, activeOnly: true });
    return resolveTemplateBinding(request, bindings, await this.revisionsFor(ctx, bindings));
  }

  // ─── pré-visualização e explicabilidade ────────────────────────────────────

  /** Pré-visualiza UMA revisão exata (qualquer estado) com valores de exemplo. Nada é persistido; nenhuma IA é chamada. */
  async preview(ctx: WorkflowContext, input: { revisionId: string; sampleValues: Readonly<Record<string, unknown>> }): Promise<PreviewResult> {
    const { revision, identity } = await this.requireRevision(ctx, input.revisionId);
    return this.composePreview(identity, revision, input.sampleValues);
  }

  /** Pré-visualiza o que SERIA aplicado: resolve o binding exato e compõe SÓ a revisão fixada (ambíguo ⇒ falha fechada). */
  async previewBound(ctx: WorkflowContext, input: { documentKind: TemplateDocumentKind; scope: BindingScope; asOf?: string; sampleValues: Readonly<Record<string, unknown>> }) {
    const resolution = await this.resolveBinding(ctx, { documentKind: input.documentKind, scope: input.scope, asOf: input.asOf });
    if (resolution.status !== "RESOLVED") return { resolution: describeResolution(resolution), preview: null as PreviewResult | null };
    const identity = await this.requireIdentity(ctx, resolution.binding.identityId);
    return { resolution: describeResolution(resolution), preview: await this.composePreview(identity, resolution.revision, input.sampleValues) };
  }

  async explainManifest(ctx: WorkflowContext, manifestId: string): Promise<CompositionExplanation> {
    if (!this.ports.manifests) throw new TemplateWorkflowError("PORTS_NOT_CONFIGURED", "leitura de manifest não configurada");
    const manifest = await this.ports.manifests.getManifest(ctx.organizationId, manifestId);
    if (!manifest) throw notFound("manifest");
    this.assertSameTenant(ctx, manifest.organizationId);
    const { revision, identity } = await this.requireRevision(ctx, manifest.templateRevisionId);
    return explainComposition({ identity, revision, manifest, preview: false });
  }

  // ─── internos ──────────────────────────────────────────────────────────────

  private async composePreview(identity: TemplateIdentity, revision: TemplateRevision, sampleValues: Readonly<Record<string, unknown>>): Promise<PreviewResult> {
    const catalog = this.catalogFor(revision);
    if (!catalog) throw new TemplateWorkflowError("VALIDATION_FAILED", `catálogo de variáveis ${revision.variableCatalogVersion} indisponível`);
    const slots = summarizeAst(revision.ast).aiSlotKeys;
    // Nenhuma IA na pré-visualização: cada slot recebe um marcador explícito e determinístico.
    const aiNarratives = Object.fromEntries(slots.map((k) => [k, `[Narrativa de IA — slot "${k}" — gerada somente na geração, com revisão humana]`]));
    const outcome: ComposeOutcome = await this.ports.composition.previewComposition({ revision, catalog, values: sampleValues, aiNarratives, identity });
    const base = { revision: { id: revision.id, revision: revision.revision, status: revision.status, semanticHash: revision.semanticHash } };
    if ("error" in outcome) return { status: "COMPOSE_ERROR", error: outcome.error, ...base };
    return {
      status: "COMPOSED", content: { text: outcome.content.text }, ...base,
      explanation: explainComposition({ identity, revision, manifest: outcome.manifestDraft, preview: true }),
    };
  }

  private catalogFor(revision: TemplateRevision): AnyVariableCatalog | null {
    return this.ports.catalog.byVersion(revision.variableCatalogVersion);
  }

  private assertSameTenant(ctx: WorkflowContext, organizationId: OrgId): void {
    if (organizationId !== ctx.organizationId) {
      // Um adapter que devolve linha de outro tenant é bug de integração: falha fechada, sem vazar nada.
      throw new TemplateWorkflowError("NOT_FOUND", "recurso não encontrado nesta organização");
    }
  }

  private assertResolutionTenant(ctx: WorkflowContext, r: BindingResolution): void {
    if (r.status === "RESOLVED") { this.assertSameTenant(ctx, r.binding.organizationId); this.assertSameTenant(ctx, r.revision.organizationId); }
  }

  private async requireIdentity(ctx: WorkflowContext, identityId: string): Promise<TemplateIdentity> {
    const identity = await this.ports.repository.getIdentity(ctx.organizationId, identityId);
    if (!identity) throw notFound("modelo");
    this.assertSameTenant(ctx, identity.organizationId);
    return identity;
  }

  private async requireRevision(ctx: WorkflowContext, revisionId: string): Promise<{ revision: TemplateRevision; identity: TemplateIdentity }> {
    const revision = await this.ports.repository.getRevision(ctx.organizationId, revisionId);
    if (!revision) throw notFound("revisão");
    this.assertSameTenant(ctx, revision.organizationId);
    const identity = await this.requireIdentity(ctx, revision.identityId);
    return { revision, identity };
  }

  private async revisionsFor(ctx: WorkflowContext, bindings: readonly TemplateBinding[]): Promise<TemplateRevision[]> {
    const ids = [...new Set(bindings.map((b) => b.identityId))];
    const all: TemplateRevision[] = [];
    for (const id of ids) all.push(...(await this.ports.repository.listRevisions(ctx.organizationId, id)));
    return all;
  }
}

export interface LifecycleInput {
  readonly revisionId: string;
  /** Estado que a pessoa viu na tela (CAS). */
  readonly expectedStatus: RevisionStatus;
  /** Confirmação humana EXPLÍCITA (literal `true`). */
  readonly confirm: boolean;
  readonly idempotencyKey: string;
  /** Só para PUBLICAR: o inventário da fonte (dado). O servidor o autentica pelo SHA-256 da procedência e recalcula a matriz. */
  readonly inventory?: unknown;
  readonly decision: {
    readonly decidedByName: string;
    readonly decidedByRole: string;
    readonly decidedByUserId?: number | null;
    /** AAAA-MM-DD */
    readonly decidedAt: string;
    readonly basisReference: string;
    readonly reason: string;
    readonly evidence?: readonly string[];
  };
}

const EXPECTED_BEFORE: Record<"APPROVED" | "PUBLISHED" | "DEPRECATED", RevisionStatus> = {
  APPROVED: "DRAFT", PUBLISHED: "APPROVED", DEPRECATED: "PUBLISHED",
};

const DECISION_BY_TARGET = {
  APPROVED: { subjectType: "institutional_template.approval", decisionType: "template_approval", outcome: "aprovado" },
  PUBLISHED: { subjectType: "institutional_template.publication", decisionType: "template_publication", outcome: "publicado" },
  DEPRECATED: { subjectType: "institutional_template.deprecation", decisionType: "template_deprecation", outcome: "depreciado" },
} as const;

export function nextActionFor(status: RevisionStatus): { action: "APPROVE" | "PUBLISH" | "DEPRECATE" | "NEW_REVISION_ONLY"; requires: string } {
  switch (status) {
    case "DRAFT": return { action: "APPROVE", requires: "aprovação humana (decisão institucional de aprovação); aprovar NÃO publica" };
    case "APPROVED": return { action: "PUBLISH", requires: "publicação humana distinta (decisão institucional de publicação)" };
    case "PUBLISHED": return { action: "DEPRECATE", requires: "depreciação humana; para alterar o conteúdo crie uma nova revisão DRAFT" };
    default: return { action: "NEW_REVISION_ONLY", requires: "depreciada: válida só para replay de documentos existentes; para novo uso crie nova revisão" };
  }
}

export type PreviewResult =
  | {
      readonly status: "COMPOSED";
      readonly content: { readonly text: string };
      readonly revision: { readonly id: string; readonly revision: number; readonly status: RevisionStatus; readonly semanticHash: string };
      readonly explanation: CompositionExplanation;
    }
  | {
      readonly status: "COMPOSE_ERROR";
      readonly error: string;
      readonly revision: { readonly id: string; readonly revision: number; readonly status: RevisionStatus; readonly semanticHash: string };
    };

export function describeResolution(r: BindingResolution) {
  switch (r.status) {
    case "RESOLVED": return { status: r.status, bindingId: r.binding.id, identityId: r.binding.identityId, revisionId: r.revision.id, revision: r.revision.revision, semanticHash: r.revision.semanticHash, effectiveFrom: r.binding.effectiveFrom };
    case "AMBIGUOUS": return { status: r.status, bindingIds: r.bindingIds };
    case "INVALID": return { status: r.status, issues: r.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
    default: return { status: r.status };
  }
}
