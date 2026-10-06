/**
 * Institutional Templates — PORTS (contrato ÚNICO das lanes B e C sobre a persistência da Lane A).
 *
 * Reconciliação (integração final) — REUSE > CONSOLIDATE > EXTEND > CREATE:
 *  - UM repositório (`TemplateRepositoryPort`) para identidades, revisões, bindings e ciclo de vida; a composição (B) lê por
 *    ele (não há `revisions`/`bindings` paralelos);
 *  - UM manifest port (`TemplateManifestPort`): leitura (explicabilidade, C) + INSERT-only de M1/M2 (composição/emissão, B);
 *  - UM relógio (`ClockPort`), UM catálogo (`VariableCatalogPort`), UMA habilitação (`TemplateEnablementPort`, flag tenant-scoped).
 *  Duas agregações finas (`TemplateWorkflowPorts` para o workflow/API; `TemplatePorts` para composição/emissão) escolhem
 *  os membros de que cada serviço precisa; os adapters reais (`adapters.ts`) implementam cada membro UMA vez, sobre
 *  `server/db/institutionalTemplates/**`.
 *
 * Regras de todo adapter (verificadas em MySQL real pelos testes de integração):
 *  - toda leitura/escrita é escopada por `organizationId` do contexto autoritativo; registro de outro tenant = ausente;
 *  - manifests são INSERT-only (M1 nunca é reescrito; M2 é registro novo derivado do M1);
 *  - escrita que recebe `executor` participa da MESMA transação do chamador (a da geração/emissão), repetida inteira pelo
 *    retry de deadlock do SEM-084 — nada é gravado fora dela;
 *  - `commitLifecycleTransition` grava decisão institucional + transição da revisão + evento na MESMA transação, com CAS;
 *  - sem backing disponível ⇒ falha fechada (`createUnavailableTemplatePorts` / `PORTS_NOT_CONFIGURED`), nunca fallback.
 */
import type { DocRefKind } from "../../domain/institutionalTemplates/ast";
import type {
  BindingRequest, BindingResolution, ComposeInput, ComposeOutcome, CompositionManifest, OrgId, TemplateBinding,
  TemplateDocumentKind, TemplateIdentity, TemplateRevision, RevisionStatus, VariableCatalog,
} from "../../domain/institutionalTemplates";
import type { AiNarrativeOutput, CanonicalSourceSnapshot, OfficialDocumentPin } from "../../domain/institutionalTemplates/composer";
import type { GenerationManifest, IssuanceManifest } from "../../domain/institutionalTemplates/manifest";
import type { AiNarrativeAcceptance, HumanEditLink, StructuralDeviationAcknowledgment } from "../../domain/institutionalTemplates/revalidation";
import type { VariableSource } from "../../domain/institutionalTemplates/variableCatalog";
import type { InstitutionalDecision } from "../../domain/institutionalDecision";
import type { OfficialDocsExecutor } from "../../db/officialDocuments";

/** Executor transacional (o mesmo do Document Engine/Lifecycle e dos repositórios da Lane A). */
export type TemplateTxExecutor = OfficialDocsExecutor;

// ─── Primitivas compartilhadas (uma definição cada) ─────────────────────────────────────────────────────────────

/** Habilitação por organização (flag tenant-scoped, default OFF). Sem rollout percentual. */
export interface TemplateEnablementPort {
  isEnabled(organizationId: OrgId): Promise<boolean>;
}

/** Catálogo de variáveis = CONTRATO DE CÓDIGO versionado (o catálogo de produção é das fases T4/T5). */
export interface VariableCatalogPort {
  current(): VariableCatalog;
  byVersion(version: string): VariableCatalog | null;
}

/** Relógio operacional (fora de qualquer hash semântico). */
export interface ClockPort { now(): string }
export interface IdPort { newId(prefix: "ti" | "tr" | "tb" | "td"): string }

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

// ─── Repositório (identidades · revisões · bindings · ciclo de vida) ────────────────────────────────────────────

export interface IdentityListFilter {
  readonly documentKind?: TemplateDocumentKind;
}

export type LifecycleCommitResult =
  | { readonly status: "COMMITTED" | "REPLAYED"; readonly decision: InstitutionalDecision }
  | { readonly status: "STALE_STATUS"; readonly currentStatus: RevisionStatus }
  | { readonly status: "DECISION_IDEMPOTENCY_CONFLICT" };

export interface LifecycleCommit {
  readonly organizationId: OrgId;
  /** Ator HUMANO que registra a decisão (autoritativo; o mesmo de `decision.recordedByUserId`). */
  readonly actorUserId: number;
  readonly correlationId: string;
  readonly expectedStatus: RevisionStatus;
  readonly before: TemplateRevision;
  readonly after: TemplateRevision;
  /** Decisão a gravar no ledger existente (`institutional_decisions`); `planDecision` já a validou. */
  readonly decision: InstitutionalDecision;
}

export interface TemplateRepositoryPort {
  listIdentities(organizationId: OrgId, filter: IdentityListFilter): Promise<readonly TemplateIdentity[]>;
  getIdentity(organizationId: OrgId, identityId: string): Promise<TemplateIdentity | null>;
  findIdentityBySlug(organizationId: OrgId, documentKind: TemplateDocumentKind, slug: string): Promise<TemplateIdentity | null>;
  /** Lança `DuplicateTemplateIdentityError` quando (organização, tipo, slug) já existe. */
  insertIdentity(identity: TemplateIdentity, ctx: PersistenceContext): Promise<void>;

  listRevisions(organizationId: OrgId, identityId: string): Promise<readonly TemplateRevision[]>;
  getRevision(organizationId: OrgId, revisionId: string): Promise<TemplateRevision | null>;
  /** Insere SEMPRE em DRAFT. Lança `DuplicateTemplateRevisionError` se (identidade, nº da revisão) já existe. */
  insertDraftRevision(revision: TemplateRevision, ctx: PersistenceContext): Promise<void>;
  /** CAS pelo `semanticHash` anterior; só atua em DRAFT. `false` = conflito (outro editor ganhou) ou não-DRAFT. */
  updateDraftContent(organizationId: OrgId, before: TemplateRevision, after: TemplateRevision, ctx: PersistenceContext): Promise<boolean>;
  /** Decisão + transição + evento ATÔMICOS (mesma transação local). Replay idempotente pela chave da decisão. */
  commitLifecycleTransition(commit: LifecycleCommit): Promise<LifecycleCommitResult>;
  /** Replay do ciclo de vida: a decisão já gravada para a chave (mesma organização), se existir. */
  getDecisionByIdempotencyKey(organizationId: OrgId, idempotencyKey: string): Promise<InstitutionalDecision | null>;
  /** Quantas composições (manifests) referenciam a revisão — só leitura/explicação (uso histórico). */
  countManifestReferences(organizationId: OrgId, revisionId: string): Promise<number>;

  listBindings(organizationId: OrgId, filter: { readonly documentKind?: TemplateDocumentKind; readonly activeOnly?: boolean }): Promise<readonly TemplateBinding[]>;
  getBinding(organizationId: OrgId, bindingId: string): Promise<TemplateBinding | null>;
  /** Cria o binding; com `replacesBindingId` desativa o anterior na MESMA transação (nunca fica sem binding nem com dois). */
  insertBinding(binding: TemplateBinding, ctx: PersistenceContext, replacesBindingId?: string): Promise<void>;
  /** Desativa (nunca apaga): o histórico do binding permanece. `false` = já inativo/inexistente. */
  deactivateBinding(organizationId: OrgId, bindingId: string, ctx: PersistenceContext): Promise<boolean>;
}

/** Contexto autoritativo de escrita (ator humano + correlação), vindo do workflow — nunca do cliente. */
export interface PersistenceContext {
  readonly actorUserId: number;
  readonly correlationId: string;
}

export class DuplicateTemplateIdentityError extends Error {
  constructor() { super("Identidade de modelo duplicada na organização."); this.name = "DuplicateTemplateIdentityError"; }
}
export class DuplicateTemplateRevisionError extends Error {
  constructor() { super("Número de revisão já existe para a identidade."); this.name = "DuplicateTemplateRevisionError"; }
}

// ─── Manifests M1/M2 ────────────────────────────────────────────────────────────────────────────────────────────

/** Manifests M1/M2 — INSERT-only; leitura tenant-scoped. */
export interface TemplateManifestPort {
  getManifest(organizationId: OrgId, manifestId: string, executor?: TemplateTxExecutor): Promise<CompositionManifest | null>;
  /** M1 mais recente associado ao rascunho (o que a revisão humana está revisando). */
  findGenerationManifestForDraft(organizationId: OrgId, generatedDocumentId: string): Promise<GenerationManifest | null>;
  /** `created = false` ⇒ o MESMO M1 já existia (replay/concorrência convergente): quem chama não repete nenhum efeito. */
  insertGenerationManifest(manifest: GenerationManifest, ctx: PersistenceContext, executor: TemplateTxExecutor): Promise<{ readonly created: boolean }>;
  insertIssuanceManifest(manifest: IssuanceManifest, link: { readonly officialDocumentId: string; readonly officialVersion: number }, ctx: PersistenceContext, executor: TemplateTxExecutor): Promise<void>;
}

// ─── Composição (B) ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pré-visualização (C). PURA e determinística. `resolveExactBinding` é opcional: sem ele, a lane usa a resolução de domínio
 * (`resolveTemplateBinding`) sobre o repositório.
 */
export interface CompositionPort {
  previewComposition(input: ComposeInput & { readonly identity?: TemplateIdentity }): ComposeOutcome | Promise<ComposeOutcome>;
  resolveExactBinding?(request: BindingRequest): Promise<BindingResolution>;
}

/** Referências canônicas do domínio institucional (DOMAIN = TRUTH), lidas fora de transação. */
export interface CanonicalReferencePort {
  resolveSources(organizationId: OrgId, subjectId: string, sources: readonly VariableSource[]): Promise<Partial<Record<VariableSource, CanonicalSourceSnapshot>>>;
  /** Pin exato (documento + linhagem + versão + hash) da versão oficial autoritativa de cada tipo referenciado. */
  resolveOfficialDocuments(organizationId: OrgId, subjectId: string, kinds: readonly DocRefKind[]): Promise<Partial<Record<DocRefKind, OfficialDocumentPin>>>;
  identityFingerprint(organizationId: OrgId): Promise<string>;
}

/** Rascunho operacional (`generated_documents`) que recebe o conteúdo composto. */
export interface TemplateDraftPort {
  /** Id do rascunho do (sujeito, tipo) — existente ou reservado — ANTES da transação (entra no M1). */
  reserveDraftId(organizationId: OrgId, subjectId: string, documentType: string): Promise<string>;
  writeDraft(draft: {
    readonly id: string; readonly organizationId: OrgId; readonly subjectId: string; readonly documentType: string;
    readonly title: string; readonly content: string; readonly actorUserId: number; readonly correlationId: string;
    readonly generationManifestId: string;
  }, executor: TemplateTxExecutor): Promise<void>;
}

/** Saídas de IA auditáveis (por `executionId`) e decisões humanas de revisão vinculadas ao M1. */
export interface TemplateReviewPort {
  loadAiOutputs(organizationId: OrgId, executionIds: readonly string[]): Promise<readonly AiNarrativeOutput[]>;
  listAiAcceptances(organizationId: OrgId, generationManifestId: string): Promise<readonly AiNarrativeAcceptance[]>;
  listDeviationAcknowledgments(organizationId: OrgId, generationManifestId: string): Promise<readonly StructuralDeviationAcknowledgment[]>;
  /** Cadeia de edições humanas governadas do rascunho a partir do texto composto. */
  listHumanEdits(organizationId: OrgId, generatedDocumentId: string, fromContentHash: string): Promise<readonly HumanEditLink[]>;
}

/** Transação dona da escrita, com o retry de deadlock do SEM-084 (repete a transação INTEIRA). */
export interface TemplateTransactionPort {
  run<T>(label: string, organizationId: OrgId, correlationId: string, fn: (tx: TemplateTxExecutor) => Promise<T>): Promise<T>;
}

// ─── Agregações ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Workflow / API (Lane C). */
export interface TemplateWorkflowPorts {
  readonly repository: TemplateRepositoryPort;
  readonly catalog: VariableCatalogPort;
  readonly composition: CompositionPort;
  readonly manifests?: Pick<TemplateManifestPort, "getManifest">;
  readonly flag: TemplateEnablementPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

/** Composição e emissão governadas (Lane B). */
export interface TemplatePorts {
  readonly enablement: TemplateEnablementPort;
  readonly repository: Pick<TemplateRepositoryPort, "getIdentity" | "getRevision" | "listRevisions" | "listBindings">;
  readonly catalog: VariableCatalogPort;
  readonly canonical: CanonicalReferencePort;
  readonly drafts: TemplateDraftPort;
  readonly manifests: TemplateManifestPort;
  readonly review: TemplateReviewPort;
  readonly clock: ClockPort;
  readonly transactions: TemplateTransactionPort;
}

export const TEMPLATE_PERSISTENCE_UNAVAILABLE = "TEMPLATE_PERSISTENCE_UNAVAILABLE";

export class TemplatePersistenceUnavailableError extends Error {
  constructor(port: string) {
    super(`${TEMPLATE_PERSISTENCE_UNAVAILABLE}: ${port} sem backing de persistência — nenhuma composição/emissão por template (fail-closed).`);
    this.name = "TemplatePersistenceUnavailableError";
  }
}

const unavailable = (port: string) => async (): Promise<never> => { throw new TemplatePersistenceUnavailableError(port); };

/**
 * Ports SEM backing: habilitação = false para todo tenant; qualquer outra chamada falha fechado. Nenhum caminho produtivo
 * novo funciona com estes ports (usado quando os adapters reais não estão configurados).
 */
export function createUnavailableTemplatePorts(): TemplatePorts {
  return {
    enablement: { isEnabled: async () => false },
    repository: { getIdentity: unavailable("repository"), getRevision: unavailable("repository"), listRevisions: unavailable("repository"), listBindings: unavailable("repository") },
    catalog: { current: () => { throw new TemplatePersistenceUnavailableError("catalog"); }, byVersion: () => null },
    canonical: { resolveSources: unavailable("canonical"), resolveOfficialDocuments: unavailable("canonical"), identityFingerprint: unavailable("canonical") },
    drafts: { reserveDraftId: unavailable("drafts"), writeDraft: unavailable("drafts") },
    manifests: {
      getManifest: unavailable("manifests"), findGenerationManifestForDraft: unavailable("manifests"),
      insertGenerationManifest: unavailable("manifests"), insertIssuanceManifest: unavailable("manifests"),
    },
    review: {
      loadAiOutputs: unavailable("review"), listAiAcceptances: unavailable("review"),
      listDeviationAcknowledgments: unavailable("review"), listHumanEdits: unavailable("review"),
    },
    clock: { now: () => { throw new TemplatePersistenceUnavailableError("clock"); } },
    transactions: { run: unavailable("transactions") },
  };
}
