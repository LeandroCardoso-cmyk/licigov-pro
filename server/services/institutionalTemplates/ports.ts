/**
 * Institutional Templates — PORTS de dependência da Lane B (composição/emissão).
 *
 * A persistência física (tabelas, migration 0316, FKs compostas de tenant — HD-26 OPTION_A) é da Lane A. Esta lane
 * NÃO inventa tabelas: depende só destes contratos estreitos, que a integração final adapta ao repositório da Lane A.
 * Regras que todo adaptador deve cumprir (testadas aqui com fakes; em MySQL real, pela Lane A):
 *  - toda leitura é escopada por `organizationId` vindo do contexto autoritativo; registro de outro tenant = ausente;
 *  - manifests são INSERT-only (M1 nunca é reescrito; M2 é registro novo derivado do M1);
 *  - escrita que recebe `executor` participa da MESMA transação do chamador (a da geração/emissão), que pode ser
 *    repetida inteira pelo retry de deadlock do SEM-084 — nada é gravado fora dela;
 *  - sem backing disponível ⇒ falha fechada (`createUnavailableTemplatePorts`), nunca fallback silencioso.
 */
import type { DocRefKind } from "../../domain/institutionalTemplates/ast";
import type { TemplateBinding } from "../../domain/institutionalTemplates/binding";
import type { AiNarrativeOutput, CanonicalSourceSnapshot, OfficialDocumentPin } from "../../domain/institutionalTemplates/composer";
import type { GenerationManifest, IssuanceManifest } from "../../domain/institutionalTemplates/manifest";
import type { AiNarrativeAcceptance, HumanEditLink, StructuralDeviationAcknowledgment } from "../../domain/institutionalTemplates/revalidation";
import type { TemplateIdentity, TemplateRevision } from "../../domain/institutionalTemplates/revision";
import type { OrgId, TemplateDocumentKind } from "../../domain/institutionalTemplates/types";
import type { VariableCatalog, VariableSource } from "../../domain/institutionalTemplates/variableCatalog";
import type { OfficialDocsExecutor } from "../../db/officialDocuments";

/** Executor transacional (o mesmo do Document Engine/Lifecycle). */
export type TemplateTxExecutor = OfficialDocsExecutor;

/** Habilitação por organização. Padrão: NENHUMA (nenhum tenant é habilitado por esta lane). */
export interface TemplateEnablementPort {
  isEnabled(organizationId: OrgId): Promise<boolean>;
}

/** Leitura exata de identidade/revisão (nunca "latest"). */
export interface TemplateRevisionPort {
  loadIdentity(organizationId: OrgId, identityId: string): Promise<TemplateIdentity | null>;
  loadExactRevision(organizationId: OrgId, identityId: string, revisionId: string): Promise<TemplateRevision | null>;
}

/** Candidatos de binding do tenant para o tipo documental (a resolução é a regra pura do T1). */
export interface TemplateBindingPort {
  listCandidates(organizationId: OrgId, documentKind: TemplateDocumentKind): Promise<{
    readonly bindings: readonly TemplateBinding[];
    readonly revisions: readonly TemplateRevision[];
  }>;
}

/** Catálogo de variáveis = contrato de CÓDIGO versionado (INV-TPL-24/25), não tabela. */
export interface VariableCatalogPort {
  getCatalog(version: string): VariableCatalog | null;
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

/** Manifests M1/M2 — INSERT-only. */
export interface TemplateManifestPort {
  getGenerationManifest(organizationId: OrgId, manifestId: string, executor?: TemplateTxExecutor): Promise<GenerationManifest | null>;
  /** M1 mais recente associado ao rascunho (o que a revisão humana está revisando). */
  findGenerationManifestForDraft(organizationId: OrgId, generatedDocumentId: string): Promise<GenerationManifest | null>;
  insertGenerationManifest(manifest: GenerationManifest, link: { readonly officialDocumentId: string; readonly officialVersion: number }, executor: TemplateTxExecutor): Promise<void>;
  insertIssuanceManifest(manifest: IssuanceManifest, link: { readonly officialDocumentId: string; readonly officialVersion: number }, executor: TemplateTxExecutor): Promise<void>;
}

/** Saídas de IA auditáveis (por `executionId`) e decisões humanas de revisão vinculadas ao M1. */
export interface TemplateReviewPort {
  loadAiOutputs(organizationId: OrgId, executionIds: readonly string[]): Promise<readonly AiNarrativeOutput[]>;
  listAiAcceptances(organizationId: OrgId, generationManifestId: string): Promise<readonly AiNarrativeAcceptance[]>;
  listDeviationAcknowledgments(organizationId: OrgId, generationManifestId: string): Promise<readonly StructuralDeviationAcknowledgment[]>;
  /** Cadeia de edições humanas governadas do rascunho a partir do texto composto. */
  listHumanEdits(organizationId: OrgId, generatedDocumentId: string, fromContentHash: string): Promise<readonly HumanEditLink[]>;
}

/** Relógio operacional (fora de qualquer hash semântico). */
export interface TemplateClockPort {
  nowIso(): string;
}

/** Transação dona da escrita, com o retry de deadlock do SEM-084 (repete a transação INTEIRA). */
export interface TemplateTransactionPort {
  run<T>(label: string, organizationId: OrgId, correlationId: string, fn: (tx: TemplateTxExecutor) => Promise<T>): Promise<T>;
}

export interface TemplatePorts {
  readonly enablement: TemplateEnablementPort;
  readonly revisions: TemplateRevisionPort;
  readonly bindings: TemplateBindingPort;
  readonly catalogs: VariableCatalogPort;
  readonly canonical: CanonicalReferencePort;
  readonly drafts: TemplateDraftPort;
  readonly manifests: TemplateManifestPort;
  readonly review: TemplateReviewPort;
  readonly clock: TemplateClockPort;
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
 * Ports SEM backing (estado atual: a Lane A ainda não integrou). Habilitação = false para todo tenant; qualquer
 * outra chamada falha fechado. Nenhum caminho produtivo novo funciona com estes ports.
 */
export function createUnavailableTemplatePorts(): TemplatePorts {
  return {
    enablement: { isEnabled: async () => false },
    revisions: { loadIdentity: unavailable("revisions"), loadExactRevision: unavailable("revisions") },
    bindings: { listCandidates: unavailable("bindings") },
    catalogs: { getCatalog: () => null },
    canonical: { resolveSources: unavailable("canonical"), resolveOfficialDocuments: unavailable("canonical"), identityFingerprint: unavailable("canonical") },
    drafts: { reserveDraftId: unavailable("drafts"), writeDraft: unavailable("drafts") },
    manifests: {
      getGenerationManifest: unavailable("manifests"), findGenerationManifestForDraft: unavailable("manifests"),
      insertGenerationManifest: unavailable("manifests"), insertIssuanceManifest: unavailable("manifests"),
    },
    review: {
      loadAiOutputs: unavailable("review"), listAiAcceptances: unavailable("review"),
      listDeviationAcknowledgments: unavailable("review"), listHumanEdits: unavailable("review"),
    },
    clock: { nowIso: () => { throw new TemplatePersistenceUnavailableError("clock"); } },
    transactions: { run: unavailable("transactions") },
  };
}
