/**
 * Modelos Institucionais — LANE C (workflow / API / UX / import / preview): PORTS estreitos.
 *
 * A persistência (Lane A) e o composer (Lane B) são implementados em paralelo; esta lane depende SÓ destes contratos.
 * A integration branch adapta os ports ao repositório real. Nenhum schema, FK ou SQL é definido aqui.
 *
 * Regras que todo adapter deve cumprir (a integração as verifica):
 *  - TODA leitura/escrita é escopada por `organizationId` (V1 organization-only; sem NULL/global);
 *  - `commitLifecycleTransition` grava a decisão institucional E a transição da revisão na MESMA transação local, com
 *    CAS no estado esperado (sem chamadas remotas dentro da transação);
 *  - revisão PUBLISHED/APPROVED/DEPRECATED nunca tem o conteúdo reescrito (`updateDraftContent` só atua em DRAFT).
 */
import type {
  BindingRequest, BindingResolution, ComposeInput, ComposeOutcome, CompositionManifest, OrgId, TemplateBinding,
  TemplateDocumentKind, TemplateIdentity, TemplateRevision, RevisionStatus, VariableCatalog,
} from "../../domain/institutionalTemplates";
import type { InstitutionalDecision } from "../../domain/institutionalDecision";

/** Ator HUMANO autenticado. IA/sistema NUNCA executa ação institucional (aprovar, publicar, depreciar, vincular). */
export interface HumanActor {
  readonly kind: "human";
  readonly userId: number;
}

export interface WorkflowContext {
  readonly organizationId: OrgId;
  readonly actor: HumanActor;
  readonly correlationId: string;
}

export interface IdentityListFilter {
  readonly documentKind?: TemplateDocumentKind;
}

export type LifecycleCommitResult =
  | { readonly status: "COMMITTED" | "REPLAYED"; readonly decision: InstitutionalDecision }
  | { readonly status: "STALE_STATUS"; readonly currentStatus: RevisionStatus }
  | { readonly status: "DECISION_IDEMPOTENCY_CONFLICT" };

export interface TemplateRepositoryPort {
  listIdentities(organizationId: OrgId, filter: IdentityListFilter): Promise<readonly TemplateIdentity[]>;
  getIdentity(organizationId: OrgId, identityId: string): Promise<TemplateIdentity | null>;
  findIdentityBySlug(organizationId: OrgId, documentKind: TemplateDocumentKind, slug: string): Promise<TemplateIdentity | null>;
  /** Lança `DuplicateTemplateIdentityError` quando (organização, tipo, slug) já existe. */
  insertIdentity(identity: TemplateIdentity): Promise<void>;

  listRevisions(organizationId: OrgId, identityId: string): Promise<readonly TemplateRevision[]>;
  getRevision(organizationId: OrgId, revisionId: string): Promise<TemplateRevision | null>;
  /** Insere SEMPRE em DRAFT. Lança `DuplicateTemplateRevisionError` se (identidade, nº da revisão) já existe. */
  insertDraftRevision(revision: TemplateRevision): Promise<void>;
  /** CAS pelo `semanticHash` anterior; só atua em DRAFT. `false` = conflito (outro editor ganhou) ou não-DRAFT. */
  updateDraftContent(organizationId: OrgId, before: TemplateRevision, after: TemplateRevision): Promise<boolean>;
  /** Transição + decisão institucional ATÔMICAS (mesma transação local). Replay idempotente pela chave da decisão. */
  commitLifecycleTransition(commit: LifecycleCommit): Promise<LifecycleCommitResult>;
  /** Quantas composições (manifests) referenciam a revisão — só leitura/explicação (uso histórico). */
  countManifestReferences(organizationId: OrgId, revisionId: string): Promise<number>;

  listBindings(organizationId: OrgId, filter: { readonly documentKind?: TemplateDocumentKind; readonly activeOnly?: boolean }): Promise<readonly TemplateBinding[]>;
  getBinding(organizationId: OrgId, bindingId: string): Promise<TemplateBinding | null>;
  insertBinding(binding: TemplateBinding): Promise<void>;
  /** Desativa (nunca apaga): o histórico do binding permanece. `false` = já inativo/inexistente. */
  deactivateBinding(organizationId: OrgId, bindingId: string): Promise<boolean>;
}

export interface LifecycleCommit {
  readonly organizationId: OrgId;
  readonly expectedStatus: RevisionStatus;
  readonly before: TemplateRevision;
  readonly after: TemplateRevision;
  /** Decisão a gravar no ledger existente (`institutional_decisions`); `planDecision` já a validou. */
  readonly decision: InstitutionalDecision;
}

export class DuplicateTemplateIdentityError extends Error {
  constructor() { super("Identidade de modelo duplicada na organização."); this.name = "DuplicateTemplateIdentityError"; }
}
export class DuplicateTemplateRevisionError extends Error {
  constructor() { super("Número de revisão já existe para a identidade."); this.name = "DuplicateTemplateRevisionError"; }
}

/** Catálogo de variáveis = CONTRATO DE CÓDIGO versionado (o catálogo de produção é das fases T4/T5). */
export interface VariableCatalogPort {
  current(): VariableCatalog;
  byVersion(version: string): VariableCatalog | null;
}

/**
 * Composição (Lane B). `previewComposition` é PURO e determinístico (mesma entrada ⇒ mesma saída). `resolveExactBinding`
 * é opcional: sem ele, a lane usa a resolução de domínio (`resolveTemplateBinding`) sobre o repositório.
 */
export interface CompositionPort {
  previewComposition(input: ComposeInput): ComposeOutcome | Promise<ComposeOutcome>;
  resolveExactBinding?(request: BindingRequest): Promise<BindingResolution>;
}

/** Leitura de manifest persistido (resumo para explicabilidade). */
export interface ManifestReadPort {
  getManifest(organizationId: OrgId, manifestId: string): Promise<CompositionManifest | null>;
}

/** Flag tenant-scoped (default OFF). Sem rollout percentual: ligado ou desligado por organização. */
export interface TemplatesFlagPort {
  isEnabled(organizationId: OrgId): Promise<boolean>;
}

export interface ClockPort { now(): string }
export interface IdPort { newId(prefix: "ti" | "tr" | "tb" | "td"): string }

export interface TemplateWorkflowPorts {
  readonly repository: TemplateRepositoryPort;
  readonly catalog: VariableCatalogPort;
  readonly composition: CompositionPort;
  readonly manifests?: ManifestReadPort;
  readonly flag: TemplatesFlagPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}
