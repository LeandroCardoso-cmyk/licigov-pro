/**
 * Composition Manifest — CONTRATO de domínio (INV-TPL-10/11/20/29/31/35; T1_DESIGN_PACKAGE). Não persiste nada.
 *
 * Shape do T1, estendido onde o T1 não representava invariante congelada (reconciliação registrada):
 *  - `composedContentHash` (T1) → `composedOutputHash` (saída do composer) + `documentContentHash` (conteúdo
 *    emitido, só no estágio ISSUANCE): edição humana pode fazê-los divergir legitimamente, explicada por `humanEditRefs`;
 *  - `conditionalDecisions`, `templateIdentityId` e `canonicalRevalidation` (INV-TPL-10/35);
 *  - `officialDocRefs` ganham `role`/`order`/`title` (referência ao anexo); NENHUM render mode (INV-TPL-31).
 * Tempo (`createdAt`, `checkedAt`) nunca entra no hash semântico (INV-TPL-27).
 */
import { SOURCE_DIGEST_PREFIX } from "../sourceDigests";
import { templateHash } from "./semanticHash";
import { organizationIssues, sameOrganizationIssues } from "./tenant";
import type { TemplateRevision } from "./revision";
import { TEMPLATE_HASH_VERSION, fail, issue, isSha256, ok, type HashVersion, type OrgId, type Sha256, type TemplateIssue, type TemplateResult } from "./types";

export type ManifestSourceKey = "processo" | "dfd" | "etp" | "tr" | "itens" | "parametros";
export const MANIFEST_SOURCE_KEYS: readonly ManifestSourceKey[] = ["processo", "dfd", "etp", "tr", "itens", "parametros"];

export interface ManifestSourceRef {
  readonly key: ManifestSourceKey;
  /** Marcador `srcd:` já usado pelos source digests (pin exato da fonte). */
  readonly digest: string;
}

/** Referência institucional a documento oficial: QUAL documento/versão é (pin exato). Sem render mode. */
export interface OfficialDocumentReference {
  readonly role: string;
  readonly order: number;
  readonly documentId: string;
  readonly lineageId: string;
  readonly version: number;
  readonly contentHash: Sha256;
  readonly title: string;
}

export interface ConditionalDecisionRef {
  /** Caminho estrutural do nó `conditional` no AST. */
  readonly nodePath: string;
  readonly result: boolean;
  /** Hash canônico da trilha de explicação da avaliação. */
  readonly traceHash: Sha256;
}

export interface AiNarrativeRef {
  readonly slotKey: string;
  readonly executionId: string;
  readonly outputHash: Sha256;
  readonly humanAccepted: boolean;
}

export interface AnnexRef {
  readonly id: string;
  readonly contentHash: Sha256;
}

export interface HumanEditRef {
  /** Referência ao registro do ledger de edição governada (forma exata: G0). */
  readonly editRef: string;
  readonly resultingContentHash: Sha256;
}

export type RevalidationStatus = "PASSED" | "PASSED_WITH_ACKNOWLEDGED_STRUCTURAL_DEVIATIONS";

export interface CanonicalRevalidationRecord {
  /** FAILED nunca é persistido como emitido: só estados de aprovação existem aqui. */
  readonly status: RevalidationStatus;
  readonly validatorVersion: string;
  readonly checkedAuthorities: readonly { readonly authority: string; readonly sourceVersion: string; readonly sourceHash: Sha256 }[];
  readonly protectedNodes: readonly { readonly nodeId: string; readonly expectedFragmentHash: Sha256; readonly found: true }[];
  readonly structuralDeviations: readonly {
    readonly blockId: string;
    readonly kind: "INCLUDED_BLOCK_REMOVED" | "EXCLUDED_BLOCK_INSERTED";
    readonly acknowledgmentRef: string;
  }[];
  /** `canonicalJSON` do registro SEM `checkedAt` e sem o próprio `resultHash`. */
  readonly resultHash: Sha256;
  /** Metadado operacional; fora de qualquer hash semântico. */
  readonly checkedAt: string;
}

interface ManifestCore {
  readonly id: string;
  readonly organizationId: OrgId;
  readonly generatedDocumentId: string;
  readonly templateIdentityId: string;
  readonly templateRevisionId: string;
  readonly templateSemanticHash: Sha256;
  readonly hashVersion: HashVersion;
  readonly catalogVersion: string;
  readonly sources: readonly ManifestSourceRef[];
  readonly officialDocRefs: readonly OfficialDocumentReference[];
  readonly conditionalDecisions: readonly ConditionalDecisionRef[];
  readonly aiNarratives: readonly AiNarrativeRef[];
  readonly annexes: readonly AnnexRef[];
  /** = `official_document_artifacts.identity_fingerprint`. */
  readonly identityFingerprint: string;
  readonly composedOutputHash: Sha256;
  readonly manifestHash: Sha256;
  readonly createdAt: string;
}

/** M1 — manifest da geração (rascunho composto). */
export interface GenerationManifest extends ManifestCore {
  readonly stage: "GENERATION";
}

/** M2 — manifest derivado na emissão (`emitido`), após revisão humana e revalidação canônica. */
export interface IssuanceManifest extends ManifestCore {
  readonly stage: "ISSUANCE";
  readonly derivedFromManifestId: string;
  readonly documentContentHash: Sha256;
  readonly humanEditRefs: readonly HumanEditRef[];
  readonly canonicalRevalidation: CanonicalRevalidationRecord;
}

export type CompositionManifest = GenerationManifest | IssuanceManifest;

const REF_KEYS = ["role", "order", "documentId", "lineageId", "version", "contentHash", "title"] as const;

/** Conteúdo semântico do manifest: sem `id`, `createdAt`, `manifestHash` e sem `checkedAt`. */
export function manifestSemanticPayload(m: CompositionManifest): Record<string, unknown> {
  const { id: _id, createdAt: _createdAt, manifestHash: _hash, ...rest } = m;
  if (rest.stage === "ISSUANCE") {
    const { checkedAt: _checkedAt, ...revalidation } = rest.canonicalRevalidation;
    return { ...rest, canonicalRevalidation: revalidation };
  }
  return rest;
}

export function computeManifestHash(m: CompositionManifest): Sha256 {
  return templateHash(manifestSemanticPayload(m));
}

export function computeRevalidationResultHash(r: CanonicalRevalidationRecord): Sha256 {
  const { checkedAt: _checkedAt, resultHash: _resultHash, ...semantic } = r;
  return templateHash(semantic);
}

function referenceIssues(ref: OfficialDocumentReference, path: string): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  const extra = Object.keys(ref).filter((k) => !(REF_KEYS as readonly string[]).includes(k));
  if (extra.length) out.push(issue("MANIFEST_INVALID", path, `propriedade não permitida na referência: ${extra.join(", ")} (render mode pertence ao artefato)`));
  if (!ref.documentId || !ref.lineageId || !Number.isSafeInteger(ref.version) || ref.version < 1 || !isSha256(ref.contentHash)) {
    out.push(issue("REFERENCE_NOT_PINNED", path, "referência oficial exige documentId + lineageId + version + contentHash"));
  }
  if (!ref.role || !ref.title || !Number.isSafeInteger(ref.order) || ref.order < 1) {
    out.push(issue("MANIFEST_INVALID", path, "referência exige role, order (≥ 1) e title"));
  }
  return out;
}

function revalidationIssues(r: CanonicalRevalidationRecord, path: string): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  if (r.status !== "PASSED" && r.status !== "PASSED_WITH_ACKNOWLEDGED_STRUCTURAL_DEVIATIONS") {
    out.push(issue("MANIFEST_INVALID", `${path}.status`, "emissão só com revalidação aprovada"));
  }
  if (r.status === "PASSED" && r.structuralDeviations.length > 0) {
    out.push(issue("MANIFEST_INVALID", `${path}.structuralDeviations`, "PASSED não admite desvio estrutural"));
  }
  if (r.status === "PASSED_WITH_ACKNOWLEDGED_STRUCTURAL_DEVIATIONS" && r.structuralDeviations.length === 0) {
    out.push(issue("MANIFEST_INVALID", `${path}.structuralDeviations`, "status com desvios exige a lista de desvios reconhecidos"));
  }
  r.structuralDeviations.forEach((d, i) => {
    if (!d.acknowledgmentRef) out.push(issue("DECISION_REQUIRED", `${path}.structuralDeviations[${i}]`, "desvio estrutural exige reconhecimento registrado"));
  });
  r.protectedNodes.forEach((n, i) => {
    if (n.found !== true || !isSha256(n.expectedFragmentHash)) out.push(issue("MANIFEST_INVALID", `${path}.protectedNodes[${i}]`, "nó canônico protegido ausente ou sem hash"));
  });
  r.checkedAuthorities.forEach((a, i) => {
    if (!a.authority || !a.sourceVersion || !isSha256(a.sourceHash)) out.push(issue("MANIFEST_INVALID", `${path}.checkedAuthorities[${i}]`, "autoridade conferida exige versão e hash"));
  });
  if (!r.validatorVersion) out.push(issue("MANIFEST_INVALID", `${path}.validatorVersion`, "validatorVersion obrigatório"));
  if (r.resultHash !== computeRevalidationResultHash(r)) out.push(issue("MANIFEST_HASH_MISMATCH", `${path}.resultHash`, "resultHash não corresponde ao registro"));
  return out;
}

/** Validação estrutural + hash. Não consulta nenhuma fonte (as autoridades são conferidas antes, fora da transação). */
export function validateManifest(m: CompositionManifest): TemplateResult<CompositionManifest> {
  const issues: TemplateIssue[] = [...organizationIssues(m, "organizationId")];
  if (m.hashVersion !== TEMPLATE_HASH_VERSION) issues.push(issue("HASH_INVALID", "hashVersion", `versão de hash desconhecida: ${String(m.hashVersion)}`));
  for (const k of ["id", "generatedDocumentId", "templateIdentityId", "templateRevisionId", "catalogVersion", "identityFingerprint"] as const) {
    if (!m[k]) issues.push(issue("MANIFEST_INVALID", k, `${k} obrigatório`));
  }
  for (const k of ["templateSemanticHash", "composedOutputHash", "manifestHash"] as const) {
    if (!isSha256(m[k])) issues.push(issue("HASH_INVALID", k, `${k} deve ser sha256`));
  }

  const sourceKeys = new Set<string>();
  m.sources.forEach((s, i) => {
    if (!MANIFEST_SOURCE_KEYS.includes(s.key)) issues.push(issue("MANIFEST_INVALID", `sources[${i}].key`, `fonte fora do contrato: ${String(s.key)}`));
    if (sourceKeys.has(s.key)) issues.push(issue("MANIFEST_INVALID", `sources[${i}].key`, `fonte duplicada: ${s.key}`));
    sourceKeys.add(s.key);
    if (typeof s.digest !== "string" || !s.digest.startsWith(SOURCE_DIGEST_PREFIX)) issues.push(issue("REFERENCE_NOT_PINNED", `sources[${i}].digest`, "fonte sem digest srcd: (pin exato)"));
  });
  const orders = new Set<number>();
  m.officialDocRefs.forEach((r, i) => {
    issues.push(...referenceIssues(r, `officialDocRefs[${i}]`));
    if (orders.has(r.order)) issues.push(issue("MANIFEST_INVALID", `officialDocRefs[${i}].order`, "ordem de referência duplicada"));
    orders.add(r.order);
  });
  m.conditionalDecisions.forEach((d, i) => {
    if (!d.nodePath || typeof d.result !== "boolean" || !isSha256(d.traceHash)) issues.push(issue("MANIFEST_INVALID", `conditionalDecisions[${i}]`, "decisão condicional exige nodePath, result e traceHash"));
  });
  m.aiNarratives.forEach((n, i) => {
    if (!n.slotKey || !n.executionId || !isSha256(n.outputHash)) issues.push(issue("MANIFEST_INVALID", `aiNarratives[${i}]`, "narrativa de IA exige slotKey, executionId e outputHash"));
    if (m.stage === "ISSUANCE" && n.humanAccepted !== true) issues.push(issue("MANIFEST_INVALID", `aiNarratives[${i}].humanAccepted`, "documento emitido não contém narrativa de IA sem aceite humano"));
  });
  m.annexes.forEach((a, i) => {
    if (!a.id || !isSha256(a.contentHash)) issues.push(issue("MANIFEST_INVALID", `annexes[${i}]`, "anexo exige id e contentHash"));
  });

  if (m.stage === "ISSUANCE") {
    if (!m.derivedFromManifestId) issues.push(issue("MANIFEST_INVALID", "derivedFromManifestId", "manifest de emissão deriva do manifest de geração"));
    if (!isSha256(m.documentContentHash)) issues.push(issue("HASH_INVALID", "documentContentHash", "documentContentHash deve ser sha256"));
    m.humanEditRefs.forEach((e, i) => {
      if (!e.editRef || !isSha256(e.resultingContentHash)) issues.push(issue("MANIFEST_INVALID", `humanEditRefs[${i}]`, "edição humana exige editRef e hash resultante"));
    });
    if (m.documentContentHash !== m.composedOutputHash) {
      const last = m.humanEditRefs[m.humanEditRefs.length - 1];
      if (!last || last.resultingContentHash !== m.documentContentHash) {
        issues.push(issue("MANIFEST_INVALID", "humanEditRefs", "conteúdo emitido difere do composto sem edição humana registrada que o explique"));
      }
    }
    issues.push(...revalidationIssues(m.canonicalRevalidation, "canonicalRevalidation"));
  } else if (m.stage !== "GENERATION") {
    issues.push(issue("MANIFEST_INVALID", "stage", "estágio desconhecido"));
  }

  if (isSha256(m.manifestHash) && m.manifestHash !== computeManifestHash(m)) {
    issues.push(issue("MANIFEST_HASH_MISMATCH", "manifestHash", "manifestHash não corresponde ao conteúdo semântico"));
  }
  return issues.length ? fail(issues) : ok(m);
}

/** Consistência manifest × revisão usada: mesmo tenant, revisão exata, hash e catálogo idênticos. */
export function manifestRevisionIssues(m: CompositionManifest, revision: TemplateRevision): TemplateIssue[] {
  const out = sameOrganizationIssues(revision, m, "templateRevisionId");
  if (m.templateRevisionId !== revision.id) out.push(issue("REFERENCE_NOT_PINNED", "templateRevisionId", "manifest não aponta para a revisão exata"));
  if (m.templateIdentityId !== revision.identityId) out.push(issue("MANIFEST_INVALID", "templateIdentityId", "identidade divergente da revisão"));
  if (m.templateSemanticHash !== revision.semanticHash) out.push(issue("MANIFEST_HASH_MISMATCH", "templateSemanticHash", "hash semântico divergente da revisão"));
  if (m.catalogVersion !== revision.variableCatalogVersion) out.push(issue("CATALOG_VERSION_MISMATCH", "catalogVersion", "catálogo divergente da revisão"));
  if (revision.status !== "PUBLISHED" && revision.status !== "RETIRED") out.push(issue("BINDING_REVISION_NOT_PUBLISHED", "templateRevisionId", `revisão ${revision.status} não compõe documento`));
  return out;
}

export interface IssuanceDerivation {
  readonly id: string;
  readonly createdAt: string;
  readonly documentContentHash: Sha256;
  readonly humanEditRefs: readonly HumanEditRef[];
  readonly canonicalRevalidation: CanonicalRevalidationRecord;
}

/**
 * Deriva M2 a partir de M1 (INSERT-only: M1 não é alterado). `id`/`createdAt` vêm de quem chama — o domínio não
 * gera id nem lê relógio. O resultado é validado (falha fechada).
 */
export function deriveIssuanceManifest(generation: GenerationManifest, d: IssuanceDerivation): TemplateResult<IssuanceManifest> {
  const draft: IssuanceManifest = {
    ...generation,
    stage: "ISSUANCE",
    id: d.id,
    createdAt: d.createdAt,
    derivedFromManifestId: generation.id,
    documentContentHash: d.documentContentHash,
    humanEditRefs: d.humanEditRefs,
    canonicalRevalidation: d.canonicalRevalidation,
    manifestHash: "",
  };
  const sealed: IssuanceManifest = { ...draft, manifestHash: computeManifestHash(draft) };
  const checked = validateManifest(sealed);
  return checked.ok ? ok(sealed) : fail(checked.issues);
}

/** Sela M1: calcula o `manifestHash` a partir do conteúdo semântico e valida. */
export function sealGenerationManifest(draft: Omit<GenerationManifest, "manifestHash">): TemplateResult<GenerationManifest> {
  const withPlaceholder: GenerationManifest = { ...draft, manifestHash: "" };
  const sealed: GenerationManifest = { ...withPlaceholder, manifestHash: computeManifestHash(withPlaceholder) };
  const checked = validateManifest(sealed);
  return checked.ok ? ok(sealed) : fail(checked.issues);
}
