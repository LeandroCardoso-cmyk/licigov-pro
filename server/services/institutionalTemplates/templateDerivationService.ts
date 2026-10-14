/**
 * DERIVAÇÃO de modelos (Template Governance V2): uma prefeitura ADAPTA um modelo da plataforma ou um modelo próprio, com versionamento independente e
 * lineage preservado. A derivada é uma NOVA identidade DRAFT no MESMO órgão (nunca em outro tenant), com procedência e origem `DERIVED` gravadas no ledger
 * existente. Nunca aprova, publica, vincula, nem altera a revisão de origem (imutável). O conteúdo de origem é copiado como está; adaptar é editar o DRAFT.
 *
 * Idempotência/concorrência: o `slug` da nova identidade é o ponto de convergência. Repetir o mesmo pedido (mesma origem exata) devolve a derivada existente
 * (e completa a procedência se faltar); o mesmo slug com outra origem ⇒ CONFLICT.
 */
import type { TemplateIdentity, TemplateRevision } from "../../domain/institutionalTemplates";
import { decodeImportProvenance, IMPORT_PROVENANCE_SUBJECT, type ImportProvenance, type ImportProvenanceInput } from "../../domain/institutionalTemplates/governance/importProvenance";
import { readScope, validateExplicitScope, type ScopeView } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { validateTemplateOrigin, type TemplateLineage, type TemplateOrigin } from "../../domain/institutionalTemplates/governance/templateGovernanceV2";
import { serviceLogger } from "../observabilityService";
import { assertHumanActor } from "./authority";
import { TemplateWorkflowError } from "./errors";
import { TemplateGovernanceService, type DeclaredAuthority } from "./governanceService";
import { getModelPackage, type ModelPackage } from "./modelPackages";
import { summarizePackageInventory } from "./modelRegistrationService";
import type { TemplateWorkflowPorts, WorkflowContext } from "./ports";
import { InstitutionalTemplatesWorkflow } from "./workflowService";

const log = serviceLogger("templateDerivation");

export interface DeriveTemplateInput {
  readonly source: { readonly kind: "TENANT_REVISION"; readonly revisionId: string } | { readonly kind: "PLATFORM_PACKAGE"; readonly modelKey: string };
  readonly slug: string;
  readonly displayName: string;
  /** Aplicabilidade declarada da derivada (informativa). Ausente ⇒ a da origem. */
  readonly declaredScope?: ScopeView;
  readonly declaredAuthor?: string;
  readonly confirm: boolean;
  readonly idempotencyKey: string;
  readonly decision: DeclaredAuthority;
}

export interface DeriveTemplateResult {
  readonly identity: TemplateIdentity;
  readonly revision: TemplateRevision;
  readonly origin: TemplateOrigin;
  readonly provenance: { readonly status: "RECORDED" | "ALREADY_RECORDED" } | { readonly status: "FAILED"; readonly message: string };
  readonly replayed: boolean;
  readonly notices: readonly string[];
}

interface ResolvedSource {
  readonly kind: TemplateIdentity["documentKind"];
  readonly ast: unknown;
  readonly catalogVersion: string;
  readonly lineage: TemplateLineage;
  readonly base: Pick<ImportProvenanceInput, "templateKey" | "sourceLogicalVersion" | "sourceSha256" | "sourceFormat" | "inventory">;
  readonly scope: ScopeView;
}

export class TemplateDerivationService {
  constructor(private readonly ports: TemplateWorkflowPorts) {}

  async derive(ctx: WorkflowContext, input: DeriveTemplateInput): Promise<DeriveTemplateResult> {
    assertHumanActor(ctx.actor);
    if (input.confirm !== true) throw new TemplateWorkflowError("CONFIRMATION_REQUIRED", "confirmação humana explícita obrigatória para derivar o modelo (nada foi criado)");
    if (!this.ports.governance) throw new TemplateWorkflowError("PORTS_NOT_CONFIGURED", "registro de governança do modelo não está configurado (fail-closed)");
    const src = await this.resolveSource(ctx, input.source);
    const scope = readScope(input.declaredScope ?? src.scope);
    const scopeIssues = validateExplicitScope(src.kind, scope);
    if (scopeIssues.length) throw new TemplateWorkflowError("SCOPE_INVALID", "aplicabilidade declarada incompleta ou inválida (nada foi criado)", scopeIssues.map((i) => ({ code: i.code, path: i.dimension, message: i.message })));
    const origin: TemplateOrigin = { ownership: "DERIVED", source: "TENANT_AUTHORED", lineage: src.lineage, original: null, declaredAuthor: input.declaredAuthor?.trim() || null };
    const originIssues = validateTemplateOrigin(origin);
    if (originIssues.length) throw new TemplateWorkflowError("VALIDATION_FAILED", "origem da derivada inválida", originIssues.map((i) => ({ code: "ORIGIN_INVALID", path: i.field, message: i.message })));

    // convergência: mesmo slug ⇒ só é replay se for a MESMA derivação (origem exata); senão CONFLICT
    const existing = await this.ports.repository.findIdentityBySlug(ctx.organizationId, src.kind, input.slug);
    if (existing) return this.replay(ctx, existing, input, src, origin, scope);

    const wf = new InstitutionalTemplatesWorkflow(this.ports);
    let identity: TemplateIdentity;
    try {
      identity = await wf.createIdentity(ctx, { documentKind: src.kind, slug: input.slug, displayName: input.displayName });
    } catch (err) {
      if (err instanceof TemplateWorkflowError && err.code === "CONFLICT") {
        const raced = await this.ports.repository.findIdentityBySlug(ctx.organizationId, src.kind, input.slug);
        if (raced) return this.replay(ctx, raced, input, src, origin, scope);
      }
      throw err;
    }
    const revision = await wf.createDraft(ctx, { identityId: identity.id, ast: src.ast, sourceFormat: "NATIVE", catalogVersion: src.catalogVersion });
    const provenance = await this.recordProvenance(ctx, revision.id, input, src, origin, scope);
    log.info("template_derived", {
      organizationId: ctx.organizationId, identityId: identity.id, revisionId: revision.id, lineage: src.lineage.kind,
      fromRevisionId: src.lineage.kind === "TENANT_REVISION" ? src.lineage.revisionId : null, provenance: provenance.status, actorUserId: ctx.actor.userId, correlationId: ctx.correlationId,
    });
    return { identity, revision, origin, provenance, replayed: false, notices: NOTICES };
  }

  private async resolveSource(ctx: WorkflowContext, source: DeriveTemplateInput["source"]): Promise<ResolvedSource> {
    if (source.kind === "PLATFORM_PACKAGE") {
      const pkg: ModelPackage | null = getModelPackage(source.modelKey);
      if (!pkg) throw new TemplateWorkflowError("VALIDATION_FAILED", "pacote da plataforma desconhecido ou indisponível para derivação (candidatos não são derivados)");
      return {
        kind: pkg.documentKind, ast: pkg.ast, catalogVersion: pkg.catalog.version,
        lineage: { kind: "PLATFORM_PACKAGE", packageKey: pkg.modelKey, packageVersion: pkg.provenance.sourceLogicalVersion, sourceSha256: pkg.provenance.sourceSha256 },
        base: { templateKey: pkg.modelKey, sourceLogicalVersion: pkg.provenance.sourceLogicalVersion, sourceSha256: pkg.provenance.sourceSha256, sourceFormat: "NATIVE", inventory: summarizePackageInventory(pkg) },
        scope: readScope(pkg.declaredScope),
      };
    }
    // revisão de OUTRO tenant é indistinguível de inexistente (a leitura é tenant-scoped)
    const rev = await this.ports.repository.getRevision(ctx.organizationId, source.revisionId);
    if (!rev || rev.organizationId !== ctx.organizationId) throw new TemplateWorkflowError("NOT_FOUND", "revisão de origem não encontrada nesta organização");
    if (rev.status === "DRAFT") throw new TemplateWorkflowError("VALIDATION_FAILED", "só se deriva de uma revisão já decidida (aprovada, publicada ou depreciada); um rascunho ainda pode mudar");
    const identity = await this.ports.repository.getIdentity(ctx.organizationId, rev.identityId);
    if (!identity || identity.organizationId !== ctx.organizationId) throw new TemplateWorkflowError("NOT_FOUND", "revisão de origem não encontrada nesta organização");
    const prov = await this.provenanceOfIdentity(ctx, identity.id);
    if (!prov) throw new TemplateWorkflowError("VALIDATION_FAILED", "o modelo de origem não tem procedência registrada; não é possível derivá-lo com lineage rastreável");
    return {
      kind: identity.documentKind, ast: rev.ast, catalogVersion: rev.variableCatalogVersion,
      lineage: { kind: "TENANT_REVISION", identityId: identity.id, revisionId: rev.id, semanticHash: rev.semanticHash },
      base: { templateKey: prov.templateKey, sourceLogicalVersion: prov.sourceLogicalVersion, sourceSha256: prov.sourceSha256, sourceFormat: prov.sourceFormat, ...(prov.inventory ? { inventory: prov.inventory } : {}) },
      scope: prov.scope,
    };
  }

  /** Procedência mais recente da identidade (revisão mais nova que a tenha). */
  private async provenanceOfIdentity(ctx: WorkflowContext, identityId: string): Promise<ImportProvenance | null> {
    const revisions = [...(await this.ports.repository.listRevisions(ctx.organizationId, identityId))].sort((a, b) => b.revision - a.revision);
    for (const r of revisions) {
      const list = await this.ports.governance!.listGovernanceDecisions(ctx.organizationId, IMPORT_PROVENANCE_SUBJECT, r.id);
      if (list.length) return decodeImportProvenance(list[list.length - 1]);
    }
    return null;
  }

  private async recordProvenance(ctx: WorkflowContext, revisionId: string, input: DeriveTemplateInput, src: ResolvedSource, origin: TemplateOrigin, scope: ScopeView): Promise<DeriveTemplateResult["provenance"]> {
    try {
      await new TemplateGovernanceService(this.ports).recordImportProvenance(ctx, {
        revisionId, expectedVersion: 0, confirm: true, idempotencyKey: input.idempotencyKey, decision: input.decision,
        provenance: { ...src.base, displayName: input.displayName, scope, origin },
      });
      return { status: "RECORDED" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "falha desconhecida";
      log.warn("template_derivation_provenance_failed", { organizationId: ctx.organizationId, revisionId, correlationId: ctx.correlationId, message });
      return { status: "FAILED", message };
    }
  }

  private async replay(ctx: WorkflowContext, existing: TemplateIdentity, input: DeriveTemplateInput, src: ResolvedSource, origin: TemplateOrigin, scope: ScopeView): Promise<DeriveTemplateResult> {
    // Corrida: outra requisição idêntica pode estar ENTRE criar a identidade e gravar rascunho/procedência. Espera limitada e determinística
    // (nunca decide CONFLICT por um estado transitório); esgotada a espera, segue com o que existe (falha parcial é completada abaixo).
    let first: TemplateRevision | undefined;
    let prov: ImportProvenance | null = null;
    for (let attempt = 0; attempt < REPLAY_SETTLE_ATTEMPTS; attempt++) {
      const revisions = [...(await this.ports.repository.listRevisions(ctx.organizationId, existing.id))].sort((a, b) => a.revision - b.revision);
      first = revisions[0];
      const decisions = first ? await this.ports.governance!.listGovernanceDecisions(ctx.organizationId, IMPORT_PROVENANCE_SUBJECT, first.id) : [];
      prov = decisions.length ? decodeImportProvenance(decisions[decisions.length - 1]) : null;
      if (first && prov) break;
      await new Promise((resolve) => setTimeout(resolve, REPLAY_SETTLE_DELAY_MS));
    }
    const sameSource = (l: TemplateLineage | null | undefined): boolean => !!l && JSON.stringify(l) === JSON.stringify(src.lineage);
    // sem procedência ainda (falha parcial): só converge se o conteúdo da 1ª revisão é EXATAMENTE o da origem (hash semântico do AST copiado)
    const contentMatchesSource = !!first && (src.lineage.kind === "TENANT_REVISION" ? first.semanticHash === src.lineage.semanticHash : first.variableCatalogVersion === src.catalogVersion);
    const isSameDerivation = prov ? prov.origin?.ownership === "DERIVED" && sameSource(prov.origin.lineage) : (!!first && contentMatchesSource && existing.createdByUserId === ctx.actor.userId);
    if (!first || !isSameDerivation) throw new TemplateWorkflowError("CONFLICT", "já existe um modelo com este tipo documental e identificador (slug) nesta organização");
    if (prov) return { identity: existing, revision: first, origin: prov.origin!, provenance: { status: "ALREADY_RECORDED" }, replayed: true, notices: NOTICES };
    const provenance = await this.recordProvenance(ctx, first.id, input, src, origin, scope);
    return { identity: existing, revision: first, origin, provenance, replayed: true, notices: NOTICES };
  }
}

const REPLAY_SETTLE_ATTEMPTS = 20;
const REPLAY_SETTLE_DELAY_MS = 50;

const NOTICES = [
  "A derivada nasceu como RASCUNHO, com versionamento independente do modelo de origem (que permanece imutável). O lineage está registrado.",
  "Nenhum vínculo, publicação, documento ou processo foi tocado. Adapte o rascunho, valide a prontidão e disponibilize no catálogo conforme a política do órgão.",
];
