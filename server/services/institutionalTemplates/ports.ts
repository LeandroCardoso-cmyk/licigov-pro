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
import type { DocRefKind2 } from "../../domain/institutionalTemplates/ast2";
import type { AnyVariableCatalog } from "../../domain/institutionalTemplates/astVersions";
import type {
  BindingRequest, BindingResolution, ComposeInput, ComposeOutcome, CompositionManifest, OrgId, TemplateBinding,
  TemplateDocumentKind, TemplateIdentity, TemplateRevision, RevisionStatus, VariableCatalog,
} from "../../domain/institutionalTemplates";
import type { AiNarrativeOutput, CanonicalSourceSnapshot, OfficialDocumentPin } from "../../domain/institutionalTemplates/composer";
import type { GenerationManifest, IssuanceManifest } from "../../domain/institutionalTemplates/manifest";
import type { AiNarrativeAcceptance, HumanEditLink, StructuralDeviationAcknowledgment } from "../../domain/institutionalTemplates/revalidation";
import type { VariableSource2 } from "../../domain/institutionalTemplates/variableCatalog2";
import type { DecisionRequest, DecisionSubjectType, InstitutionalDecision } from "../../domain/institutionalDecision";
import type { TemplateCapabilities } from "../../domain/institutionalTemplates/governance/capabilities";
import type { ReadinessMatrix } from "../../domain/institutionalTemplates/governance/readinessMatrix";
import type { ReadinessWitnessRefs } from "../../domain/institutionalTemplates/governance/readinessWitness";
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
  byVersion(version: string): AnyVariableCatalog | null;
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
  /** O estado em que a prontidão foi provada mudou antes do COMMIT (rollback total; nada foi gravado). */
  | { readonly status: "READINESS_STALE"; readonly drift: readonly string[] }
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
  /**
   * Publicação sob gate de prontidão: referências do estado em que a matriz foi provada. A transação (linha da revisão travada)
   * RELÊ revisão + procedência + evidência e compara; divergiu ⇒ `READINESS_STALE` e nada é gravado.
   */
  readonly readinessWitness?: ReadinessWitnessRefs;
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

// ─── Governança do modelo (procedência da importação · evidência jurídica) ─────────────────────────────────────

export type GovernanceCommitResult =
  | { readonly status: "COMMITTED" | "REPLAYED"; readonly decision: InstitutionalDecision }
  | { readonly status: "SUBJECT_NOT_FOUND" }
  | { readonly status: "STALE_VERSION"; readonly currentVersion: number }
  | { readonly status: "DECISION_IDEMPOTENCY_CONFLICT" };

/**
 * Registros de governança SOBRE uma revisão exata, no ledger institucional EXISTENTE (append-only). Não há transição da
 * revisão: procedência e evidência jurídica NÃO são status do ciclo de vida. O adapter trava a linha da revisão
 * (`lockDecisionSubject`), faz replay pela chave de idempotência, CAS pela versão corrente e INSERT — numa transação.
 */
export interface TemplateGovernancePort {
  /** `request` já validado (`validateDecisionRequest`). `request.expectedRevision` é a versão corrente que o chamador viu (0 = nenhuma). */
  recordGovernanceDecision(request: DecisionRequest): Promise<GovernanceCommitResult>;
  /** Histórico completo (v1…corrente) do assunto (= revisão), tenant-scoped. Revisão de outro tenant ⇒ lista vazia. */
  listGovernanceDecisions(organizationId: OrgId, subjectType: DecisionSubjectType, revisionId: string): Promise<readonly InstitutionalDecision[]>;
}

/**
 * Port ESTREITO de prontidão para a publicação. O backend recalcula a matriz com o estado AUTORITATIVO atual (revisão, procedência
 * e evidência do ledger, capacidades do sistema) — nunca aceita matriz enviada pelo cliente. Não decide nada: devolve fatos
 * (PASS/BLOCKED/NOT_APPLICABLE); quem bloqueia a transição APPROVED → PUBLISHED é o workflow. Ausente/indisponível ⇒ publicação falha
 * fechada (`READINESS_UNAVAILABLE`).
 */
export interface TemplateReadinessPort {
  evaluateForPublication(ctx: WorkflowContext, input: { readonly revisionId: string; readonly inventory?: unknown }): Promise<ReadinessMatrix>;
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

/** Pin PEDIDO por quem gera (escolha humana do documento oficial exato): documento + versão + hash do conteúdo. */
export interface RequestedOfficialPin {
  readonly documentId: string;
  readonly version: number;
  readonly contentHash: string;
}

/**
 * Referências canônicas do domínio institucional (DOMAIN = TRUTH), lidas fora de transação.
 * Fonte sem backing ou fora do contrato ⇒ `TemplateSourceUnavailableError` (falha FECHADA; nunca omitida em silêncio).
 */
export interface CanonicalReferencePort {
  /**
   * `catalog` = o catálogo da REVISÃO (v1 ⇒ comportamento histórico; v2 ⇒ fontes por caminhos do catálogo).
   * `official` = os documentos oficiais EXATOS já resolvidos para esta composição (pin validado na geração; autoridade atual na
   * revalidação). Projeções que vêm de um documento oficial (ex.: objeto do TR) derivam DESSE documento — nunca de "o último".
   */
  resolveSources(
    organizationId: OrgId, subjectId: string, sources: readonly VariableSource2[], catalog: AnyVariableCatalog,
    official?: Partial<Record<DocRefKind2, OfficialDocumentPin>>,
  ): Promise<Partial<Record<VariableSource2, CanonicalSourceSnapshot>>>;
  /**
   * AUTORIDADE ATUAL: pin exato (documento + linhagem + versão + hash) da versão oficial EMITIDA mais recente de cada tipo.
   * Usado pela REVALIDAÇÃO para detectar que o documento oficial referenciado mudou (SOURCE_CHANGED).
   */
  resolveOfficialDocuments(organizationId: OrgId, subjectId: string, kinds: readonly DocRefKind2[]): Promise<Partial<Record<DocRefKind2, OfficialDocumentPin>>>;
  /**
   * GERAÇÃO: o chamador informa o documento oficial EXATO (id + versão + hash). O adapter só ACEITA o pin se ele for um
   * documento `emitido` do MESMO tenant e da MESMA origem, com versão e hash conferidos e ainda vigente como a última versão
   * emitida do tipo. Sem pin informado, de rascunho/`gerado`, de outra origem/tenant, divergente ou superado ⇒ falha fechada.
   * Nunca "o último TR" escolhido pelo servidor.
   */
  pinOfficialDocuments(
    organizationId: OrgId, subjectId: string, kinds: readonly DocRefKind2[], requested: Partial<Record<DocRefKind2, RequestedOfficialPin>>,
  ): Promise<Partial<Record<DocRefKind2, OfficialDocumentPin>>>;
  identityFingerprint(organizationId: OrgId): Promise<string>;
}

export const TEMPLATE_SOURCE_UNAVAILABLE = "TEMPLATE_SOURCE_UNAVAILABLE";

/** Fonte canônica indisponível/fora do contrato (ex.: ITEMS sem Itens da contratação; NORMATIVE sem reference set ativo). */
export class TemplateSourceUnavailableError extends Error {
  constructor(readonly source: string, readonly reason: string, readonly detail: string) {
    super(`${TEMPLATE_SOURCE_UNAVAILABLE}: ${source} — ${reason}: ${detail}`);
    this.name = "TemplateSourceUnavailableError";
  }
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
  /** Procedência + evidência jurídica (ledger existente). Ausente ⇒ essas operações falham fechado (`PORTS_NOT_CONFIGURED`). */
  readonly governance?: TemplateGovernancePort;
  /** Capacidades reais do sistema (matriz de prontidão, dimensões de escopo). Ausente ⇒ `INTEGRATED_CAPABILITIES`. */
  readonly capabilities?: TemplateCapabilities;
  /** Prontidão para publicar. Ausente ⇒ publicar revisão de tipo sob `READINESS_GATED_KINDS` falha fechada (`READINESS_UNAVAILABLE`). */
  readonly readiness?: TemplateReadinessPort;
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
    canonical: { resolveSources: unavailable("canonical"), resolveOfficialDocuments: unavailable("canonical"), pinOfficialDocuments: unavailable("canonical"), identityFingerprint: unavailable("canonical") },
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
