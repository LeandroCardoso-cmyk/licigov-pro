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
  AUTHORITY_NOT_VALIDATED, DECISION_MESSAGES, planDecision, validateDecisionRequest,
  type DecisionRequest, type InstitutionalDecision,
} from "../../domain/institutionalDecision";
import {
  createDraftRevision, resolveTemplateBinding, revisionSemanticHash, revisionUpdateIssues, sameScope,
  TEMPLATE_DOCUMENT_KINDS, transitionRevision, validateTemplateAst, validateTemplateIdentity,
  type BindingRequest, type BindingResolution, type BindingScope, type ComposeOutcome, type OrgId, type RevisionSourceFormat,
  type RevisionStatus, type TemplateBinding, type TemplateDocumentKind, type TemplateIdentity,
  type TemplateIssue, type TemplateRevision, type VariableCatalog, validateTemplateRevision,
} from "../../domain/institutionalTemplates";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import { summarizeAst, type AstSummary } from "./astSummary";
import { TemplateWorkflowError, type TemplateWorkflowIssue } from "./errors";
import { explainComposition, type CompositionExplanation } from "./explainability";
import {
  DuplicateTemplateIdentityError, DuplicateTemplateRevisionError,
  type TemplateWorkflowPorts, type WorkflowContext,
} from "./ports";

const log = serviceLogger("institutionalTemplatesWorkflow");

const toIssues = (issues: readonly TemplateIssue[]): TemplateWorkflowIssue[] => issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));

function validationFailed(message: string, issues: readonly TemplateIssue[]): TemplateWorkflowError {
  return new TemplateWorkflowError("VALIDATION_FAILED", message, toIssues(issues));
}

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

  validateAst(ctx: WorkflowContext, ast: unknown): { valid: boolean; issues: TemplateWorkflowIssue[]; summary: AstSummary | null; catalogVersion: string } {
    void ctx;
    const catalog = this.ports.catalog.current();
    const result = validateTemplateAst(ast, catalog);
    return result.ok
      ? { valid: true, issues: [], summary: summarizeAst(result.value), catalogVersion: catalog.version }
      : { valid: false, issues: toIssues(result.issues), summary: null, catalogVersion: catalog.version };
  }

  // ─── identidade e revisões (DRAFT) ─────────────────────────────────────────

  async createIdentity(ctx: WorkflowContext, input: { documentKind: TemplateDocumentKind; slug: string }): Promise<TemplateIdentity> {
    assertHumanActor(ctx.actor);
    const identity: TemplateIdentity = {
      id: this.ports.ids.newId("ti"), organizationId: ctx.organizationId, documentKind: input.documentKind, slug: input.slug,
      createdAt: this.ports.clock.now(), createdByUserId: ctx.actor.userId,
    };
    const valid = validateTemplateIdentity(identity);
    if (!valid.ok) throw validationFailed("identidade inválida", valid.issues);
    const existing = await this.ports.repository.findIdentityBySlug(ctx.organizationId, input.documentKind, input.slug);
    if (existing) throw new TemplateWorkflowError("CONFLICT", "já existe um modelo com este tipo documental e identificador (slug) nesta organização");
    try {
      await this.ports.repository.insertIdentity(identity);
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
    input: { identityId: string; ast?: unknown; fromRevisionId?: string; sourceFormat?: RevisionSourceFormat },
  ): Promise<TemplateRevision> {
    assertHumanActor(ctx.actor);
    const identity = await this.requireIdentity(ctx, input.identityId);
    const catalog = this.ports.catalog.current();
    let ast: unknown = input.ast;
    let sourceFormat: RevisionSourceFormat = input.sourceFormat ?? "NATIVE";
    if (input.fromRevisionId !== undefined) {
      const source = await this.ports.repository.getRevision(ctx.organizationId, input.fromRevisionId);
      if (!source || source.identityId !== identity.id) throw notFound("revisão de origem");
      ast = source.ast;
      sourceFormat = "NATIVE";
    }
    if (ast === undefined) throw new TemplateWorkflowError("VALIDATION_FAILED", "informe o conteúdo (AST) ou a revisão de origem");
    const astCheck = validateTemplateAst(ast, catalog);
    if (!astCheck.ok) throw validationFailed("a estrutura do modelo é inválida", astCheck.issues);

    const existing = await this.ports.repository.listRevisions(ctx.organizationId, identity.id);
    const next = existing.reduce((m, r) => Math.max(m, r.revision), 0) + 1;
    const created = createDraftRevision({
      id: this.ports.ids.newId("tr"), identity, revision: next, ast: astCheck.value, catalog, sourceFormat,
    });
    if (!created.ok) throw validationFailed("a revisão é inválida", created.issues);
    try {
      await this.ports.repository.insertDraftRevision(created.value);
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
    const catalog = this.ports.catalog.current();
    const astCheck = validateTemplateAst(input.ast, catalog);
    if (!astCheck.ok) throw validationFailed("a estrutura do modelo é inválida", astCheck.issues);
    const after: TemplateRevision = {
      ...before, ast: astCheck.value, variableCatalogVersion: catalog.version,
      semanticHash: revisionSemanticHash({ ast: astCheck.value, variableCatalogVersion: catalog.version }),
    };
    const valid = validateTemplateRevision(after, identity, catalog);
    if (!valid.ok) throw validationFailed("a revisão é inválida", valid.issues);
    const immut = revisionUpdateIssues(before, after).filter((i) => i.code !== "REVISION_IMMUTABLE" || before.status !== "DRAFT");
    if (immut.length) throw validationFailed("atualização não permitida", immut);
    const applied = await this.ports.repository.updateDraftContent(ctx.organizationId, before, after);
    if (!applied) throw new TemplateWorkflowError("STALE_STATE", "o rascunho mudou (ou deixou de ser DRAFT) durante a edição; recarregue");
    log.info("template_draft_updated", { organizationId: ctx.organizationId, revisionId: before.id, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return after;
  }

  // ─── ciclo de vida: aprovar · publicar · depreciar ─────────────────────────

  approve(ctx: WorkflowContext, input: LifecycleInput) { return this.transition(ctx, "APPROVED", input); }
  publish(ctx: WorkflowContext, input: LifecycleInput) { return this.transition(ctx, "PUBLISHED", input); }
  deprecate(ctx: WorkflowContext, input: LifecycleInput) { return this.transition(ctx, "DEPRECATED", input); }

  private async transition(ctx: WorkflowContext, to: "APPROVED" | "PUBLISHED" | "DEPRECATED", input: LifecycleInput) {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) {
      throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória para esta ação (nada foi alterado)");
    }
    const { revision: before, identity } = await this.requireRevision(ctx, input.revisionId);
    const expected = EXPECTED_BEFORE[to];
    if (input.expectedStatus !== before.status) {
      throw new TemplateWorkflowError("STALE_STATE", `o estado da revisão mudou (agora ${before.status}); recarregue antes de decidir`);
    }
    if (before.status !== expected) {
      throw new TemplateWorkflowError("TRANSITION_INVALID", `transição ${before.status} → ${to} não permitida (esperado: ${expected} → ${to})`);
    }
    const catalog = this.catalogFor(before);
    if (!catalog) throw new TemplateWorkflowError("VALIDATION_FAILED", `catálogo de variáveis ${before.variableCatalogVersion} indisponível; a revisão não pode ser decidida`);

    if (to === "DEPRECATED") {
      const pinning = (await this.ports.repository.listBindings(ctx.organizationId, { activeOnly: true })).filter((b) => b.pinnedRevisionId === before.id);
      if (pinning.length > 0) {
        throw new TemplateWorkflowError("REVISION_PINNED_BY_BINDING", `a revisão está fixada por ${pinning.length} binding(s) ativo(s); desative-os (ou fixe outra revisão PUBLISHED) antes de depreciar`);
      }
    }

    // Decisão institucional (ledger existente). Autoridade DECLARADA no ato; competência não validada (política pendente).
    const decisionType = DECISION_BY_TARGET[to];
    const request: DecisionRequest = {
      organizationId: ctx.organizationId, subjectType: decisionType.subjectType, subjectId: before.id, decisionType: decisionType.decisionType,
      outcome: decisionType.outcome, decidedByName: input.decision.decidedByName, decidedByRole: input.decision.decidedByRole,
      decidedByUserId: input.decision.decidedByUserId ?? null, decidedAt: input.decision.decidedAt, basisReference: input.decision.basisReference,
      reason: input.decision.reason, evidence: input.decision.evidence ?? [], recordedByUserId: ctx.actor.userId,
      expectedRevision: 0, idempotencyKey: input.idempotencyKey, correlationId: ctx.correlationId,
    };
    const valid = validateDecisionRequest(request);
    if (!valid.ok) {
      throw new TemplateWorkflowError("DECISION_REJECTED", DECISION_MESSAGES[valid.code] ?? valid.code,
        (valid.fields ?? []).map((f) => ({ code: valid.code, path: f, message: "campo obrigatório ou inválido" })));
    }
    const plan = planDecision(request, { byIdempotencyKey: null, current: null });
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
      organizationId: ctx.organizationId, expectedStatus: before.status, before, after: next.value, decision,
    });
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
      await this.ports.repository.deactivateBinding(ctx.organizationId, old.id);
    }
    await this.ports.repository.insertBinding(binding);
    log.info("template_binding_set", { organizationId: ctx.organizationId, bindingId: binding.id, revisionId: revision.id, replaced: input.replacesBindingId ?? null, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId });
    return binding;
  }

  async deactivateBinding(ctx: WorkflowContext, input: { bindingId: string; confirm: boolean }): Promise<void> {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória (nada foi alterado)");
    const binding = await this.ports.repository.getBinding(ctx.organizationId, input.bindingId);
    if (!binding) throw notFound("binding");
    const done = await this.ports.repository.deactivateBinding(ctx.organizationId, binding.id);
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
    const outcome: ComposeOutcome = await this.ports.composition.previewComposition({ revision, catalog, values: sampleValues, aiNarratives });
    const base = { revision: { id: revision.id, revision: revision.revision, status: revision.status, semanticHash: revision.semanticHash } };
    if ("error" in outcome) return { status: "COMPOSE_ERROR", error: outcome.error, ...base };
    return {
      status: "COMPOSED", content: { text: outcome.content.text }, ...base,
      explanation: explainComposition({ identity, revision, manifest: outcome.manifestDraft, preview: true }),
    };
  }

  private catalogFor(revision: TemplateRevision): VariableCatalog | null {
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
