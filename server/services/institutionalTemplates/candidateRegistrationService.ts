/**
 * Registro CONTROLADO de um pacote CANDIDATO como DRAFT numa identidade existente (Services Layer).
 *
 * Por que existe: a API pública de registro só aceita pacotes vigentes (`modelKey`; `packageVersion` não faz parte do contrato) e o
 * `ModelRegistrationService` recusa candidatos sem `allowCandidatePackages`. Esta é a ÚNICA ponte autorizada: ferramenta operacional
 * (CLI `scripts/register-model-candidate.ts`), nunca uma rota, nunca um preset.
 *
 * Garantias:
 *  - `plan` é SOMENTE LEITURA: verifica o pacote (domínio puro), a identidade, a linha de base publicada, registros prévios e vínculos;
 *  - `register` só escreve DRAFT + procedência (via `ModelRegistrationService`, a mesma lógica do registro normal); NUNCA aprova, publica,
 *    vincula, liga flag, compõe documento ou toca processo;
 *  - exige que a identidade de destino contenha a Revisão 1 PUBLICADA com o hash de linha de base esperado (identidade errada ⇒ recusa);
 *  - idempotente: já existe revisão com o hash do candidato ⇒ nenhuma revisão nova (completa só a procedência, se faltar);
 *  - escopo de tenant (organização) em todas as leituras; ator humano e autoridade declarada vêm de quem executa (nada é inventado).
 */
import { serviceLogger } from "../observabilityService";
import { TemplateWorkflowError } from "./errors";
import type { DeclaredAuthority } from "./governanceService";
import { ModelRegistrationService, PACKAGE_SOURCE_FORMAT, summarizePackageInventory } from "./modelRegistrationService";
import { getModelPackage, getModelPackageVersion, type ModelPackage } from "./modelPackages";
import type { TemplateWorkflowPorts, WorkflowContext } from "./ports";
import { createHash } from "node:crypto";
import { verifyCandidatePackage, type PackageCheck } from "../../domain/institutionalTemplates/candidatePackage";
import { withDedicatedAdvisoryLock } from "../../db/advisoryLock";
import { IMPORT_PROVENANCE_SUBJECT } from "../../domain/institutionalTemplates/governance/importProvenance";
import { evaluateCandidateProvenance, type CandidateProvenanceReport, type CandidateProvenanceState, type ExpectedCandidateProvenance } from "../../domain/institutionalTemplates/governance/candidateProvenance";
import { readScope } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { PUBLICATION_VARIABLES } from "../../domain/institutionalTemplates/publicationSchedule";
import { BLL_MODEL_KEY } from "./modelPackages";

const log = serviceLogger("CandidateRegistration");

/** Pedido de LEITURA (plano): sem ator e sem autoridade — nada é escrito. */
export interface CandidatePlanRequest {
  readonly organizationId: number;
  readonly identityId: string;
  readonly runId: string;
  readonly modelKey: string;
  readonly packageVersion: string;
  /** Valores que a pessoa responsável conferiu e quer ver confirmados (ids exatos a conferir no momento da execução). */
  readonly expected: { readonly sourceSha256: string; readonly semanticHash: string; readonly baselineSemanticHash: string };
}

/** Pedido de ESCRITA: o ator é o usuário AUTENTICADO (nunca um id digitado) e a autoridade declarada vem amarrada a ele. */
export interface CandidateRegistrationRequest extends CandidatePlanRequest {
  readonly actorUserId: number;
  /** Autoridade DECLARADA por quem executa (nome/cargo/data/base/motivo). Nunca preenchida pela ferramenta. */
  readonly decision: DeclaredAuthority;
  /** Contexto operacional do executor (informativo, NÃO autenticado; vai só para o log estruturado). */
  readonly executorContext?: Readonly<Record<string, string | number>>;
}

export type CandidateAction = "REGISTER_DRAFT" | "RECORD_PROVENANCE" | "NONE";

export interface CandidatePlan {
  readonly organizationId: number;
  readonly identityId: string;
  readonly packageChecks: readonly PackageCheck[];
  readonly checks: readonly PackageCheck[];
  readonly ok: boolean;
  readonly action: CandidateAction;
  readonly identity: { readonly documentKind: string; readonly slug: string | null } | null;
  readonly revisions: readonly { readonly id: string; readonly revision: number; readonly status: string; readonly semanticHash: string; readonly catalogVersion: string }[];
  readonly baselineRevisionId: string | null;
  readonly candidateRevisionId: string | null;
  readonly candidateStatus: string | null;
  /** `true` somente quando a procedência corrente CONFERE com o pacote e a revisão exata (não basta existir). `null` ⇒ sem candidata registrada. */
  readonly candidateProvenanceRecorded: boolean | null;
  /** Relatório da validação INTEGRAL da procedência (estado, versões do ledger, divergências campo a campo). `null` ⇒ sem candidata registrada. */
  readonly candidateProvenance: CandidateProvenanceReport | null;
  readonly activeBindings: readonly { readonly id: string; readonly pinnedRevisionId: string | null; readonly scope: unknown; readonly effectiveFrom: string }[];
}

const ck = (id: string, ok: boolean, detail: string): PackageCheck => ({ id, ok, detail });

/**
 * Pinos CONGELADOS do conteúdo canônico dos catálogos (SHA-256 de `canonicalJson(catalog)`): o hash semântico da revisão cobre a AST e só a versão do
 * catálogo; estes pinos fecham a brecha de um catálogo com conteúdo diferente sob a mesma versão. Alterar o catálogo exige novo pacote/versão.
 */
export const CANDIDATE_CATALOG_PINS: Readonly<Record<string, { readonly catalogSha256: string; readonly baselineCatalogSha256: string }>> = Object.freeze({
  [`${BLL_MODEL_KEY}@1.0.2-draft`]: {
    catalogSha256: "2192916c61327fdd22905b85f672666973b804298ce75ec4ce1b3054809a0b88",
    baselineCatalogSha256: "793c02815da5d12ab8c2b872a188fb1fa292adf3144a76c3ca470047a4220510",
  },
});

/** Lock de registro por (organização, identidade): escopo EXATO, nome ≤ 64 caracteres, nunca global entre tenants independentes. */
export function candidateRegistrationLockName(organizationId: number, identityId: string): string {
  return `licigov_candreg_${createHash("sha256").update(`${organizationId}:${identityId}`).digest("hex").slice(0, 32)}`;
}
const LOCK_TIMEOUT_SECONDS = 60;
const PROVENANCE_ATTEMPTS = 3;

/**
 * Projeção ESPERADA da procedência da candidata: derivada do pacote versionado (mesmas funções do registro — nenhum segundo formato) e da revisão exata.
 * A procedência persistida é CONFRONTADA com ela (ver `evaluateCandidateProvenance`); existir não basta.
 */
export function expectedCandidateProvenance(pkg: ModelPackage, revisionId: string, revisionSemanticHash: string): ExpectedCandidateProvenance {
  return {
    revisionId, revisionSemanticHash,
    input: {
      templateKey: pkg.modelKey, displayName: pkg.displayName, sourceLogicalVersion: pkg.provenance.sourceLogicalVersion, sourceSha256: pkg.provenance.sourceSha256,
      sourceFormat: PACKAGE_SOURCE_FORMAT, scope: readScope(pkg.declaredScope), inventory: summarizePackageInventory(pkg),
    },
  };
}

async function candidateProvenanceOf(ports: Pick<TemplateWorkflowPorts, "governance">, organizationId: number, pkg: ModelPackage, revisionId: string, revisionSemanticHash: string): Promise<CandidateProvenanceReport | null> {
  if (!ports.governance) return null;
  const decisions = await ports.governance.listGovernanceDecisions(organizationId, IMPORT_PROVENANCE_SUBJECT, revisionId);
  return evaluateCandidateProvenance(expectedCandidateProvenance(pkg, revisionId, revisionSemanticHash), decisions, organizationId);
}

function packages(req: CandidatePlanRequest): { candidate: ModelPackage | null; baseline: ModelPackage | null } {
  return { candidate: getModelPackageVersion(req.modelKey, req.packageVersion), baseline: getModelPackage(req.modelKey) };
}

/** SOMENTE LEITURA. */
export async function planCandidateRegistration(ports: TemplateWorkflowPorts, req: CandidatePlanRequest): Promise<CandidatePlan> {
  const { candidate, baseline } = packages(req);
  const checks: PackageCheck[] = [];
  let packageChecks: readonly PackageCheck[] = [];
  if (req.modelKey !== BLL_MODEL_KEY) checks.push(ck("MODEL_SUPPORTED", false, `modelKey ${req.modelKey} fora do escopo desta ferramenta`));
  if (!candidate || !baseline) checks.push(ck("PACKAGES_RESOLVED", false, "pacote candidato ou linha de base não encontrado no servidor"));
  else {
    const pins = CANDIDATE_CATALOG_PINS[`${req.modelKey}@${req.packageVersion}`];
    if (!pins) checks.push(ck("CATALOG_PINS", false, "sem pino de conteúdo de catálogo para este pacote (versão não autorizada para registro)"));
    else {
      packageChecks = verifyCandidatePackage(candidate, baseline, {
        modelKey: req.modelKey, sourceLogicalVersion: req.packageVersion, sourceSha256: req.expected.sourceSha256,
        semanticHash: req.expected.semanticHash, baselineSemanticHash: req.expected.baselineSemanticHash, deferredVariables: PUBLICATION_VARIABLES, ...pins,
      });
      checks.push(...packageChecks);
    }
  }
  // flag institucional da organização EXATA (informativo no plano — leitura; a escrita a exige e relê)
  const flagOn = await ports.flag.isEnabled(req.organizationId);
  checks.push(ck("FLAG_ENABLED", flagOn, flagOn ? "FF_INSTITUTIONAL_TEMPLATES_V1 ligada para esta organização" : "FF_INSTITUTIONAL_TEMPLATES_V1 desligada para esta organização (o registro é recusado; plan/snapshot seguem somente leitura)"));

  const identity = await ports.repository.getIdentity(req.organizationId, req.identityId);
  const identityOk = !!identity && identity.organizationId === req.organizationId && identity.documentKind === "edital";
  checks.push(ck("IDENTITY_IN_TENANT", identityOk, identityOk ? "identidade de Edital encontrada nesta organização" : "identidade inexistente nesta organização ou não é de Edital"));
  const revisions = identityOk ? [...(await ports.repository.listRevisions(req.organizationId, req.identityId))] : [];
  const baselineRev = revisions.find((r) => r.status === "PUBLISHED" && r.semanticHash === req.expected.baselineSemanticHash) ?? null;
  checks.push(ck("BASELINE_PUBLISHED", !!baselineRev, baselineRev ? `Revisão 1 PUBLICADA com o hash esperado (${baselineRev.id})` : "a identidade não contém a revisão de linha de base PUBLICADA com o hash esperado"));
  const sameHash = revisions.filter((r) => r.semanticHash === req.expected.semanticHash);
  const existing = sameHash[0] ?? null;
  checks.push(ck("CANDIDATE_UNIQUE", sameHash.length <= 1, sameHash.length <= 1 ? "no máximo uma revisão com o hash da candidata nesta identidade" : `${sameHash.length} revisões com o hash da candidata (${sameHash.map((r) => `#${r.revision}`).join(", ")}): resolução humana necessária, nada será escrito`));
  const candidateCatalog = candidate?.catalog.version;
  const conflicting = candidateCatalog ? revisions.filter((r) => r.variableCatalogVersion === candidateCatalog && r.semanticHash !== req.expected.semanticHash) : [];
  checks.push(ck("NO_CONFLICTING_REVISION", conflicting.length === 0, conflicting.length === 0 ? "nenhuma revisão conflitante com o catálogo da candidata" : `revisão(ões) ${conflicting.map((r) => `#${r.revision}`).join(", ")} usam o catálogo da candidata com outro hash semântico`));
  let provenance: CandidateProvenanceReport | null = null;
  if (existing) {
    provenance = candidate ? await candidateProvenanceOf(ports, req.organizationId, candidate, existing.id, existing.semanticHash) : null;
    const p = provenance;
    checks.push(ck("PROVENANCE_VERIFIABLE", p !== null, p ? "procedência verificável (ledger de governança disponível)" : "a procedência não pôde ser verificada (registro de governança ou pacote indisponível): nada será escrito"));
    if (p) {
      checks.push(ck("PROVENANCE_DIVERGENT", p.state !== "DIVERGENT", p.state === "DIVERGENT" ? `${p.detail}. Nada será escrito nem sobrescrito: regularização HUMANA (nova versão do ledger) é necessária` : "procedência sem divergência"));
      checks.push(ck("PROVENANCE_MALFORMED", p.state !== "MALFORMED", p.state === "MALFORMED" ? `${p.detail}. Nada será escrito: resolução humana necessária` : "procedência legível"));
      const notResumable = p.state === "ABSENT" && existing.status !== "DRAFT";
      checks.push(ck("PROVENANCE_NOT_RESUMABLE", !notResumable, notResumable ? `a revisão está ${existing.status} sem procedência: só DRAFT é retomável; regularização humana necessária` : "procedência ausente só é recuperada em DRAFT"));
    }
  }
  const bindings = identityOk ? (await ports.repository.listBindings(req.organizationId, { documentKind: "edital", activeOnly: true })).filter((b) => b.identityId === req.identityId) : [];

  const ok = checks.every((c) => c.ok);
  const action: CandidateAction = !ok ? "NONE" : !existing ? "REGISTER_DRAFT" : existing.status === "DRAFT" && provenance?.state === "ABSENT" ? "RECORD_PROVENANCE" : "NONE";
  return {
    organizationId: req.organizationId, identityId: req.identityId, packageChecks, checks, ok, action,
    identity: identity ? { documentKind: identity.documentKind, slug: (identity as { slug?: string }).slug ?? null } : null,
    revisions: revisions.map((r) => ({ id: r.id, revision: r.revision, status: r.status, semanticHash: r.semanticHash, catalogVersion: r.variableCatalogVersion })),
    baselineRevisionId: baselineRev?.id ?? null, candidateRevisionId: existing?.id ?? null, candidateStatus: existing?.status ?? null,
    candidateProvenanceRecorded: provenance ? provenance.state === "CORRECT" : null, candidateProvenance: provenance,
    activeBindings: bindings.map((b) => ({ id: b.id, pinnedRevisionId: b.pinnedRevisionId ?? null, scope: b.scope, effectiveFrom: b.effectiveFrom })),
  };
}

export interface CandidateRegistrationResult {
  readonly plan: CandidatePlan;
  readonly performed: CandidateAction;
  readonly revisionId: string | null;
  readonly provenance: "RECORDED" | "ALREADY_RECORDED" | "FAILED" | "NOT_APPLICABLE";
}

/**
 * Escreve SOMENTE o que o plano diz (DRAFT + procedência). Idempotente e CONVERGENTE sob concorrência:
 *  - serializado por lock nomeado no escopo (organização, identidade) — outros escopos seguem em paralelo;
 *  - a flag é exigida e relida DENTRO do lock, antes da primeira escrita; o plano é refeito DENTRO do lock (a leitura prévia nunca é a proteção);
 *  - DRAFT já existente com o hash da candidata é reaproveitado; procedência ausente é completada (retry limitado, mesma chave de idempotência);
 *  - mais de uma revisão com o hash, ou revisão conflitante ⇒ recusa explícita sem escrever.
 * Revisões são imutáveis/append-only (não há como "apagar" um DRAFT): a recuperação de falha parcial é por convergência, nunca por rollback.
 */
export async function registerCandidateDraft(ports: TemplateWorkflowPorts, req: CandidateRegistrationRequest): Promise<CandidateRegistrationResult> {
  const ctx: WorkflowContext = { organizationId: req.organizationId, actor: { kind: "human", userId: req.actorUserId }, correlationId: `cand-reg-${req.runId}` };
  return withDedicatedAdvisoryLock(candidateRegistrationLockName(req.organizationId, req.identityId), LOCK_TIMEOUT_SECONDS, async (held) => {
    if (!(await ports.flag.isEnabled(req.organizationId))) {
      log.warn("model_candidate_registration_refused_flag_off", { organizationId: req.organizationId, identityId: req.identityId, actorUserId: req.actorUserId, correlationId: ctx.correlationId });
      throw new TemplateWorkflowError("MODULE_DISABLED", "o módulo de Modelos Institucionais está desligado para esta organização (FF_INSTITUTIONAL_TEMPLATES_V1); nada foi criado");
    }
    let plan = await planCandidateRegistration(ports, req);
    if (!plan.ok) {
      throw new TemplateWorkflowError("VALIDATION_FAILED", `registro do candidato recusado: ${plan.checks.filter((c) => !c.ok).map((c) => c.id).join(", ")} (nada foi criado)`,
        plan.checks.filter((c) => !c.ok).map((c) => ({ code: c.id, path: c.id, message: c.detail })));
    }
    if (plan.action === "NONE") return { plan, performed: "NONE" as CandidateAction, revisionId: plan.candidateRevisionId, provenance: plan.candidateProvenanceRecorded ? ("ALREADY_RECORDED" as const) : ("NOT_APPLICABLE" as const) };

    const pkg = packages(req).candidate!;
    const key = `cand-prov-${req.organizationId}-${req.identityId}-${req.expected.semanticHash.slice(0, 16)}`;
    const registration = new ModelRegistrationService(ports, { allowCandidatePackages: true });
    const input = {
      target: { kind: "EXISTING_IDENTITY" as const, identityId: req.identityId }, templateKey: pkg.modelKey, displayName: pkg.displayName, declaredScope: pkg.declaredScope,
      source: { kind: "MODEL_PACKAGE" as const, modelKey: pkg.modelKey, packageVersion: req.packageVersion }, sourceLogicalVersion: pkg.provenance.sourceLogicalVersion,
      sourceSha256: pkg.provenance.sourceSha256, confirm: true as const, idempotencyKey: key, decision: req.decision,
    };
    const performed = plan.action;
    // A integridade NÃO depende do lock (a sessão dele pode morrer): o DRAFT é criado por escrita transacional exclusiva por hash (`uniqueDraft`) e a procedência
    // tem chave de idempotência + CAS. `assertHeld` só interrompe cedo (fail-closed) quando a sessão do lock foi perdida, antes de cada fase de escrita.
    await held.assertHeld();
    let result = await registration.register(ctx, input, performed === "RECORD_PROVENANCE" ? { resumeDraftRevisionId: plan.candidateRevisionId! } : { uniqueDraft: true });
    // procedência que falhou depois do DRAFT persistido: retoma o MESMO DRAFT (retry limitado; chave de idempotência determinística)
    for (let attempt = 2; result.provenance.status !== "RECORDED" && attempt <= PROVENANCE_ATTEMPTS; attempt++) {
      log.warn("model_candidate_provenance_retry", { organizationId: req.organizationId, identityId: req.identityId, revisionId: result.revision.id, attempt, correlationId: ctx.correlationId });
      await held.assertHeld();
      result = await registration.register(ctx, input, { resumeDraftRevisionId: result.revision.id });
    }
    // pós-condição: exatamente UMA revisão com o hash da candidata (o defeito antigo criava #2 e #3)
    plan = await planCandidateRegistration(ports, req);
    const copies = plan.revisions.filter((r) => r.semanticHash === req.expected.semanticHash);
    if (copies.length !== 1) throw new TemplateWorkflowError("CONFLICT", `integridade: ${copies.length} revisões com o hash da candidata após o registro (esperado 1); resolução humana necessária`);
    log.info("model_candidate_draft_registered", {
      organizationId: req.organizationId, identityId: req.identityId, revisionId: result.revision.id, semanticHash: req.expected.semanticHash, packageVersion: req.packageVersion,
      action: performed, provenance: result.provenance.status, actorUserId: req.actorUserId, executor: req.executorContext ?? null, correlationId: ctx.correlationId,
    });
    return { plan, performed, revisionId: result.revision.id, provenance: result.provenance.status === "RECORDED" ? ("RECORDED" as const) : ("FAILED" as const) };
  }, {
    onLockLost: (i) => log.error("model_candidate_lock_lost", { organizationId: req.organizationId, identityId: req.identityId, lockName: i.lockName, reason: i.reason, actorUserId: req.actorUserId, correlationId: ctx.correlationId }),
    onReleaseFailed: (err) => log.warn("model_candidate_lock_release_failed", { organizationId: req.organizationId, identityId: req.identityId, message: err instanceof Error ? err.message : String(err), correlationId: ctx.correlationId }),
  });
}

// ─── Snapshot SOMENTE LEITURA de uma organização (preparação da execução; nada é gravado) ─────────────────────────────

export interface OrganizationTemplateSnapshot {
  readonly organizationId: number;
  readonly flag: { readonly name: string; readonly enabled: boolean };
  readonly identities: readonly {
    readonly id: string; readonly slug: string; readonly documentKind: string; readonly displayName: string | null;
    readonly revisions: readonly { readonly id: string; readonly revision: number; readonly status: string; readonly semanticHash: string; readonly catalogVersion: string }[];
    readonly activeBindings: readonly { readonly id: string; readonly pinnedRevisionId: string | null; readonly scope: Readonly<Record<"modality" | "form" | "platform" | "regime" | "criterion", string | null>>; readonly effectiveFrom: string }[];
    readonly hasBaselinePublished: boolean;
    readonly candidateRegistered: boolean;
    /** Estado da validação integral da procedência da candidata (somente se o chamador informar o pacote); `null` ⇒ sem candidata ou não verificável. */
    readonly candidateProvenance: CandidateProvenanceState | null;
  }[];
}

/** Lê identidades de Edital, revisões, vínculos ativos e a flag da organização. Não expõe conteúdo de modelo nem dados de processo. */
export async function snapshotOrganizationTemplates(
  ports: TemplateWorkflowPorts, organizationId: number, expected: { readonly baselineSemanticHash: string; readonly semanticHash: string }, flagEnabled: boolean,
  candidate?: { readonly modelKey: string; readonly packageVersion: string },
): Promise<OrganizationTemplateSnapshot> {
  const pkg = candidate ? getModelPackageVersion(candidate.modelKey, candidate.packageVersion) : null;
  const identities = await ports.repository.listIdentities(organizationId, { documentKind: "edital" });
  const bindings = await ports.repository.listBindings(organizationId, { documentKind: "edital", activeOnly: true });
  const out: OrganizationTemplateSnapshot["identities"][number][] = [];
  for (const id of [...identities].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const revisions = [...(await ports.repository.listRevisions(organizationId, id.id))];
    const candidateRev = revisions.find((r) => r.semanticHash === expected.semanticHash);
    const candidateProvenance = candidateRev && pkg ? ((await candidateProvenanceOf(ports, organizationId, pkg, candidateRev.id, candidateRev.semanticHash))?.state ?? null) : null;
    out.push({
      id: id.id, slug: id.slug, documentKind: id.documentKind, displayName: id.displayName ?? null,
      revisions: revisions.map((r) => ({ id: r.id, revision: r.revision, status: r.status, semanticHash: r.semanticHash, catalogVersion: r.variableCatalogVersion })),
      activeBindings: bindings.filter((b) => b.identityId === id.id).map((b) => ({
        id: b.id, pinnedRevisionId: b.pinnedRevisionId ?? null, effectiveFrom: b.effectiveFrom,
        scope: { modality: b.scope.modality ?? null, form: b.scope.form ?? null, platform: b.scope.platform ?? null, regime: b.scope.regime ?? null, criterion: b.scope.criterion ?? null },
      })),
      hasBaselinePublished: revisions.some((r) => r.status === "PUBLISHED" && r.semanticHash === expected.baselineSemanticHash),
      candidateRegistered: !!candidateRev, candidateProvenance,
    });
  }
  return { organizationId, flag: { name: "FF_INSTITUTIONAL_TEMPLATES_V1", enabled: flagEnabled }, identities: out };
}
