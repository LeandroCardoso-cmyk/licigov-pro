/**
 * Identidade e revisão do modelo institucional (T1_DESIGN_PACKAGE; INV-TPL-02/06/26/32; HD-02).
 *
 * Ciclo do T1: DRAFT → APPROVED → PUBLISHED → RETIRED.
 *  - APPROVED ≠ PUBLISHED (HD-02): duas transições explícitas, cada uma com a sua decisão institucional; não existe
 *    atalho DRAFT → PUBLISHED.
 *  - Conteúdo (AST, catálogo, hash) só muda em DRAFT; PUBLISHED é imutável; mudança = nova revisão.
 *  - RETIRED ≠ INVALID: revisão aposentada continua válida para documentos que a usaram (HD-13, parte congelada).
 *  - Importação (Markdown/DOCX) sempre nasce DRAFT.
 *  - Revisão referenciada por manifest nunca é removida.
 */
import { validateTemplateAst, type TemplateAST } from "./ast";
import { revisionSemanticHash, templateCanonicalJson } from "./semanticHash";
import { organizationIssues, sameOrganizationIssues } from "./tenant";
import { validateVariableCatalog, type VariableCatalog } from "./variableCatalog";
import {
  TEMPLATE_DOCUMENT_KINDS, TEMPLATE_HASH_VERSION, fail, issue, isSha256, ok,
  type HashVersion, type OrgId, type Sha256, type TemplateDocumentKind, type TemplateIssue, type TemplateResult,
} from "./types";

export interface TemplateIdentity {
  readonly id: string;
  readonly organizationId: OrgId;
  readonly documentKind: TemplateDocumentKind;
  readonly slug: string;
  readonly createdAt: string;
  readonly createdByUserId: number;
}

export type RevisionStatus = "DRAFT" | "APPROVED" | "PUBLISHED" | "RETIRED";
export type RevisionSourceFormat = "NATIVE" | "MARKDOWN_IMPORT" | "DOCX_IMPORT";

export interface TemplateRevision {
  readonly id: string;
  readonly identityId: string;
  readonly organizationId: OrgId;
  readonly revision: number;
  readonly status: RevisionStatus;
  readonly ast: TemplateAST;
  readonly variableCatalogVersion: string;
  readonly semanticHash: Sha256;
  readonly hashVersion: HashVersion;
  readonly sourceFormat: RevisionSourceFormat;
  /** Decisões em `institutional_decisions` (aprovação e publicação são decisões distintas). */
  readonly approvalDecisionId?: string;
  readonly publishDecisionId?: string;
}

/** id `varchar(24)` (convenção das tabelas modernas). */
export const TEMPLATE_ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateTemplateIdentity(identity: TemplateIdentity): TemplateResult<TemplateIdentity> {
  const issues: TemplateIssue[] = [...organizationIssues(identity, "organizationId")];
  if (!TEMPLATE_ID_RE.test(identity.id)) issues.push(issue("REVISION_INVALID", "id", "id inválido"));
  if (!TEMPLATE_DOCUMENT_KINDS.includes(identity.documentKind)) issues.push(issue("REVISION_INVALID", "documentKind", "tipo documental fora do contrato"));
  if (!SLUG_RE.test(identity.slug) || identity.slug.length > 120) issues.push(issue("REVISION_INVALID", "slug", "slug inválido"));
  if (!Number.isSafeInteger(identity.createdByUserId) || identity.createdByUserId <= 0) issues.push(issue("REVISION_INVALID", "createdByUserId", "autor obrigatório"));
  if (typeof identity.createdAt !== "string" || identity.createdAt === "") issues.push(issue("REVISION_INVALID", "createdAt", "createdAt é input explícito"));
  return issues.length ? fail(issues) : ok(identity);
}

/**
 * Valida a revisão contra a sua identidade e o catálogo: tenant, AST (whitelist + variáveis), versão do catálogo
 * e hash semântico recalculado. Não confia no `semanticHash` informado.
 */
export function validateTemplateRevision(
  revision: TemplateRevision, identity: TemplateIdentity, catalog: VariableCatalog,
): TemplateResult<TemplateRevision> {
  const issues: TemplateIssue[] = [
    ...organizationIssues(revision, "organizationId"),
    ...sameOrganizationIssues(identity, revision, "identityId"),
  ];
  if (!TEMPLATE_ID_RE.test(revision.id)) issues.push(issue("REVISION_INVALID", "id", "id inválido"));
  if (revision.identityId !== identity.id) issues.push(issue("REVISION_INVALID", "identityId", "revisão não pertence à identidade"));
  if (!Number.isSafeInteger(revision.revision) || revision.revision < 1) issues.push(issue("REVISION_INVALID", "revision", "número de revisão deve ser inteiro ≥ 1"));
  if (revision.hashVersion !== TEMPLATE_HASH_VERSION) issues.push(issue("HASH_INVALID", "hashVersion", `versão de hash desconhecida: ${String(revision.hashVersion)}`));
  const catalogCheck = validateVariableCatalog(catalog);
  if (!catalogCheck.ok) issues.push(...catalogCheck.issues);
  if (revision.variableCatalogVersion !== catalog.version) {
    issues.push(issue("CATALOG_VERSION_MISMATCH", "variableCatalogVersion", `revisão usa ${revision.variableCatalogVersion}; catálogo informado é ${catalog.version}`));
  }
  const astCheck = validateTemplateAst(revision.ast, catalog);
  if (!astCheck.ok) issues.push(...astCheck.issues);
  if (!isSha256(revision.semanticHash) || revision.semanticHash !== revisionSemanticHash(revision)) {
    issues.push(issue("HASH_INVALID", "semanticHash", "semanticHash não corresponde ao AST canônico + catálogo"));
  }
  if (revision.status === "APPROVED" || revision.status === "PUBLISHED" || revision.status === "RETIRED") {
    if (!revision.approvalDecisionId) issues.push(issue("DECISION_REQUIRED", "approvalDecisionId", "revisão aprovada exige decisão de aprovação"));
  }
  if (revision.status === "PUBLISHED" || revision.status === "RETIRED") {
    if (!revision.publishDecisionId) issues.push(issue("DECISION_REQUIRED", "publishDecisionId", "revisão publicada exige decisão de publicação"));
  }
  return issues.length ? fail(issues) : ok(revision);
}

export interface NewRevisionInput {
  readonly id: string;
  readonly identity: TemplateIdentity;
  readonly revision: number;
  readonly ast: TemplateAST;
  readonly catalog: VariableCatalog;
  readonly sourceFormat: RevisionSourceFormat;
  /** Só para rejeitar explicitamente tentativas de criar fora de DRAFT (import nunca nasce publicado). */
  readonly requestedStatus?: RevisionStatus;
}

/** Cria uma revisão SEMPRE em DRAFT, com o hash semântico calculado aqui. */
export function createDraftRevision(input: NewRevisionInput): TemplateResult<TemplateRevision> {
  if (input.requestedStatus !== undefined && input.requestedStatus !== "DRAFT") {
    return fail([issue("IMPORT_MUST_START_AS_DRAFT", "status", "toda revisão nova (inclusive importada) nasce DRAFT")]);
  }
  const draft: TemplateRevision = {
    id: input.id,
    identityId: input.identity.id,
    organizationId: input.identity.organizationId,
    revision: input.revision,
    status: "DRAFT",
    ast: input.ast,
    variableCatalogVersion: input.catalog.version,
    semanticHash: revisionSemanticHash({ ast: input.ast, variableCatalogVersion: input.catalog.version }),
    hashVersion: TEMPLATE_HASH_VERSION,
    sourceFormat: input.sourceFormat,
  };
  return validateTemplateRevision(draft, input.identity, input.catalog);
}

export type RevisionTransition =
  | { readonly to: "APPROVED"; readonly approvalDecisionId: string }
  | { readonly to: "PUBLISHED"; readonly publishDecisionId: string }
  | { readonly to: "RETIRED" };

const ALLOWED: Record<RevisionStatus, RevisionStatus | null> = {
  DRAFT: "APPROVED", APPROVED: "PUBLISHED", PUBLISHED: "RETIRED", RETIRED: null,
};

/**
 * Transição de estado. A aprovação revalida a revisão inteira (AST, catálogo, hash): variável desconhecida ou
 * AST inválido bloqueia a submissão. Não existe transição que pule APPROVED.
 */
export function transitionRevision(
  revision: TemplateRevision, transition: RevisionTransition, identity: TemplateIdentity, catalog: VariableCatalog,
): TemplateResult<TemplateRevision> {
  if (ALLOWED[revision.status] !== transition.to) {
    return fail([issue("REVISION_TRANSITION_INVALID", "status", `transição ${revision.status} → ${transition.to} não permitida`)]);
  }
  let next: TemplateRevision;
  if (transition.to === "APPROVED") {
    if (!transition.approvalDecisionId) return fail([issue("DECISION_REQUIRED", "approvalDecisionId", "aprovação exige decisão institucional")]);
    next = { ...revision, status: "APPROVED", approvalDecisionId: transition.approvalDecisionId };
  } else if (transition.to === "PUBLISHED") {
    if (!transition.publishDecisionId) return fail([issue("DECISION_REQUIRED", "publishDecisionId", "publicação exige decisão institucional própria")]);
    if (transition.publishDecisionId === revision.approvalDecisionId) {
      return fail([issue("DECISION_REQUIRED", "publishDecisionId", "publicação não reutiliza a decisão de aprovação (APPROVED ≠ PUBLISHED)")]);
    }
    next = { ...revision, status: "PUBLISHED", publishDecisionId: transition.publishDecisionId };
  } else {
    next = { ...revision, status: "RETIRED" };
  }
  return validateTemplateRevision(next, identity, catalog);
}

/** Campos que nunca mudam depois de criados (qualquer estado). */
const IDENTITY_FIELDS = ["id", "identityId", "organizationId", "revision", "sourceFormat"] as const;
/** Conteúdo: só muda em DRAFT. */
const CONTENT_FIELDS = ["ast", "variableCatalogVersion", "semanticHash", "hashVersion"] as const;

/**
 * Regra de imutabilidade para uma atualização `before → after` que NÃO é transição de estado.
 * PUBLISHED (e APPROVED/RETIRED) recusam qualquer mudança de conteúdo: mudança = nova revisão.
 */
export function revisionUpdateIssues(before: TemplateRevision, after: TemplateRevision): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const same = (k: keyof TemplateRevision): boolean => templateCanonicalJson(before[k] ?? null) === templateCanonicalJson(after[k] ?? null);
  for (const k of IDENTITY_FIELDS) {
    if (!same(k)) issues.push(issue(k === "organizationId" ? "CROSS_TENANT_REFERENCE" : "REVISION_IMMUTABLE", k, `${k} é imutável`));
  }
  if (before.status !== after.status) issues.push(issue("REVISION_TRANSITION_INVALID", "status", "mudança de estado só via transitionRevision"));
  if (before.status !== "DRAFT") {
    for (const k of CONTENT_FIELDS) {
      if (!same(k)) issues.push(issue("REVISION_IMMUTABLE", k, `revisão ${before.status} é imutável; crie nova revisão`));
    }
    if (!same("approvalDecisionId") || !same("publishDecisionId")) {
      issues.push(issue("REVISION_IMMUTABLE", "decisions", "decisões registradas não são reescritas"));
    }
  }
  return issues;
}

/** INV-TPL-32: revisão referenciada por algum manifest nunca é removida. */
export function revisionDeletionIssues(revision: TemplateRevision, manifestReferenceCount: number): TemplateIssue[] {
  if (!Number.isSafeInteger(manifestReferenceCount) || manifestReferenceCount < 0) {
    return [issue("REVISION_IN_USE", "manifestReferenceCount", "contagem de uso desconhecida: remoção recusada (fail-closed)")];
  }
  return manifestReferenceCount > 0
    ? [issue("REVISION_IN_USE", "id", `revisão ${revision.id} é referenciada por ${manifestReferenceCount} manifest(s)`)]
    : [];
}
