/**
 * Catálogo MULTI-MODELO de modelos institucionais (piloto Edital). Lista várias identidades do mesmo `documentKind` sem assumir
 * um único modelo: para cada identidade, mostra o nome de exibição (com a origem), o slug, as revisões (status + hash), a
 * aplicabilidade EXPLÍCITA declarada pelos bindings (modalidade · forma · plataforma · regime · critério), a SAÚDE de cada binding
 * e a revisão EXATA fixada. Só leitura; tenant-scoped; nada é escolhido automaticamente.
 *
 * Ordem do nome de exibição (a origem é sempre exposta): `displayName` da identidade (quando a persistência o fornecer) →
 * procedência registrada → slug. O nome NUNCA participa de resolução de binding.
 */
import type { RevisionStatus, TemplateBinding, TemplateDocumentKind, TemplateIdentity, TemplateRevision } from "../../domain/institutionalTemplates";
import { IMPORT_PROVENANCE_SUBJECT, decodeImportProvenance } from "../../domain/institutionalTemplates/governance/importProvenance";
import { readScope, scopeHeadline, sameScopeView, type ScopeView } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { TemplateWorkflowError } from "./errors";
import type { TemplateWorkflowPorts, WorkflowContext } from "./ports";

export type DisplayNameSource = "IDENTITY" | "REGISTRATION_PROVENANCE" | "SLUG";
export type BindingHealth = "OK" | "REVISION_NOT_PUBLISHED" | "REVISION_MISSING" | "SCOPE_CONFLICT";

export interface CatalogFilter {
  readonly documentKind?: TemplateDocumentKind;
  readonly modality?: string;
  readonly form?: string;
  readonly platform?: string;
  readonly status?: RevisionStatus;
}

export interface CatalogBindingView {
  readonly bindingId: string;
  readonly active: boolean;
  readonly scope: ScopeView;
  readonly scopeHeadline: string;
  readonly effectiveFrom: string;
  readonly pinnedRevisionId: string | null;
  readonly pinnedRevision: number | null;
  readonly pinnedRevisionStatus: RevisionStatus | null;
  readonly pinnedSemanticHash: string | null;
  readonly health: BindingHealth;
}

export interface CatalogRow {
  readonly identityId: string;
  readonly documentKind: TemplateDocumentKind;
  readonly slug: string;
  readonly displayName: string;
  readonly displayNameSource: DisplayNameSource;
  readonly templateKey: string | null;
  /** Aplicabilidade declarada no registro do modelo (procedência) — informativa; a AUTORIDADE é o binding exato. */
  readonly declaredScope: ScopeView;
  readonly revisions: readonly { readonly id: string; readonly revision: number; readonly status: RevisionStatus; readonly semanticHash: string }[];
  readonly bindings: readonly CatalogBindingView[];
  readonly bindingStatus: "BOUND" | "NOT_BOUND" | "CONFLICT";
  /** Ex.: "Edital — Pregão Eletrônico — BLL / Pregão | Eletrônica | BLL / PUBLISHED revisão 2 (ab12cd34)". */
  readonly headline: string;
}

const identityDisplayName = (identity: TemplateIdentity): string | null => {
  const v = (identity as { displayName?: unknown }).displayName;
  return typeof v === "string" && v.trim() !== "" ? v : null;
};

export function catalogHeadline(row: Pick<CatalogRow, "displayName" | "bindings" | "revisions" | "declaredScope">): string {
  const b = row.bindings.find((x) => x.active && x.health === "OK") ?? row.bindings.find((x) => x.active);
  const scope = b ? b.scopeHeadline : (Object.keys(row.declaredScope).length ? `${scopeHeadline(row.declaredScope)} (declarado, sem binding)` : "sem escopo declarado");
  const rev = b?.pinnedRevision != null ? `${b.pinnedRevisionStatus} revisão ${b.pinnedRevision} (${(b.pinnedSemanticHash ?? "").slice(0, 8)})`
    : row.revisions.length ? `${row.revisions[row.revisions.length - 1].status} revisão ${row.revisions[row.revisions.length - 1].revision} (sem binding)` : "sem revisões";
  return `${row.displayName} / ${scope} / ${rev}`;
}

export class TemplateCatalogService {
  constructor(private readonly ports: TemplateWorkflowPorts) {}

  async list(ctx: WorkflowContext, filter: CatalogFilter = {}): Promise<readonly CatalogRow[]> {
    const identities = await this.ports.repository.listIdentities(ctx.organizationId, { documentKind: filter.documentKind });
    const allBindings = await this.ports.repository.listBindings(ctx.organizationId, { documentKind: filter.documentKind });
    const rows: CatalogRow[] = [];
    for (const identity of identities) {
      if (identity.organizationId !== ctx.organizationId) throw new TemplateWorkflowError("NOT_FOUND", "recurso não encontrado nesta organização"); // adapter com vazamento = bug
      const revisions = await this.ports.repository.listRevisions(ctx.organizationId, identity.id);
      const own = allBindings.filter((b) => b.identityId === identity.id);
      const row = await this.buildRow(ctx, identity, revisions, own, allBindings);
      if (this.matches(row, filter)) rows.push(row);
    }
    return rows.sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR") || a.slug.localeCompare(b.slug));
  }

  private async buildRow(ctx: WorkflowContext, identity: TemplateIdentity, revisions: readonly TemplateRevision[], own: readonly TemplateBinding[], all: readonly TemplateBinding[]): Promise<CatalogRow> {
    const byId = new Map(revisions.map((r) => [r.id, r]));
    const bindings: CatalogBindingView[] = own.map((b) => {
      const pinned = b.pinnedRevisionId ? byId.get(b.pinnedRevisionId) ?? null : null;
      const conflict = b.active && all.some((o) => o.id !== b.id && o.active && o.documentKind === b.documentKind && sameScopeView(o.scope, b.scope));
      const health: BindingHealth = conflict ? "SCOPE_CONFLICT" : !pinned ? "REVISION_MISSING" : pinned.status !== "PUBLISHED" ? "REVISION_NOT_PUBLISHED" : "OK";
      return {
        bindingId: b.id, active: b.active, scope: readScope(b.scope), scopeHeadline: scopeHeadline(b.scope), effectiveFrom: b.effectiveFrom,
        pinnedRevisionId: b.pinnedRevisionId ?? null, pinnedRevision: pinned?.revision ?? null, pinnedRevisionStatus: pinned?.status ?? null,
        pinnedSemanticHash: pinned?.semanticHash ?? null, health,
      };
    });
    // procedência mais recente (da revisão mais nova que a tenha) — só para nome/templateKey/escopo declarado
    let prov: ReturnType<typeof decodeImportProvenance> = null;
    if (this.ports.governance) {
      for (const r of [...revisions].sort((a, b) => b.revision - a.revision)) {
        const list = await this.ports.governance.listGovernanceDecisions(ctx.organizationId, IMPORT_PROVENANCE_SUBJECT, r.id);
        if (list.length) { prov = decodeImportProvenance(list[list.length - 1]); break; }
      }
    }
    const own_name = identityDisplayName(identity);
    const displayName = own_name ?? prov?.displayName ?? identity.slug;
    const displayNameSource: DisplayNameSource = own_name ? "IDENTITY" : prov ? "REGISTRATION_PROVENANCE" : "SLUG";
    const active = bindings.filter((b) => b.active);
    const bindingStatus = active.some((b) => b.health === "SCOPE_CONFLICT") ? "CONFLICT" : active.length ? "BOUND" : "NOT_BOUND";
    const base = {
      identityId: identity.id, documentKind: identity.documentKind, slug: identity.slug, displayName, displayNameSource, templateKey: prov?.templateKey ?? null,
      declaredScope: prov?.scope ?? {},
      revisions: revisions.map((r) => ({ id: r.id, revision: r.revision, status: r.status, semanticHash: r.semanticHash })),
      bindings, bindingStatus,
    } as const;
    return { ...base, headline: catalogHeadline(base) };
  }

  /** Filtros: tipo/status (revisões) e modalidade/forma/plataforma (binding ou escopo declarado). Dimensão não declarada ⇒ não casa. */
  private matches(row: CatalogRow, f: CatalogFilter): boolean {
    if (f.status && !row.revisions.some((r) => r.status === f.status)) return false;
    for (const d of ["modality", "form", "platform"] as const) {
      const want = f[d];
      if (want === undefined) continue;
      const have = [...row.bindings.map((b) => b.scope[d]), row.declaredScope[d]].filter((x): x is string => x !== undefined);
      if (!have.includes(want)) return false;
    }
    return true;
  }
}
