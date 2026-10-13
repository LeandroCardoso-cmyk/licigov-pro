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
import { TemplateGovernanceService, type DeclaredAuthority } from "./governanceService";
import { ModelRegistrationService } from "./modelRegistrationService";
import { getModelPackage, getModelPackageVersion, type ModelPackage } from "./modelPackages";
import type { TemplateWorkflowPorts, WorkflowContext } from "./ports";
import { verifyCandidatePackage, type PackageCheck } from "../../domain/institutionalTemplates/candidatePackage";
import { PUBLICATION_VARIABLES } from "../../domain/institutionalTemplates/publicationSchedule";
import { BLL_MODEL_KEY } from "./modelPackages";

const log = serviceLogger("CandidateRegistration");

export interface CandidateRegistrationRequest {
  readonly organizationId: number;
  readonly identityId: string;
  readonly actorUserId: number;
  readonly runId: string;
  readonly modelKey: string;
  readonly packageVersion: string;
  /** Valores que a pessoa responsável conferiu e quer ver confirmados (ids exatos a conferir no momento da execução). */
  readonly expected: { readonly sourceSha256: string; readonly semanticHash: string; readonly baselineSemanticHash: string };
  /** Autoridade DECLARADA por quem executa (nome/cargo/data/base/motivo). Nunca preenchida pela ferramenta. */
  readonly decision: DeclaredAuthority;
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
  readonly candidateProvenanceRecorded: boolean | null;
  readonly activeBindings: readonly { readonly id: string; readonly pinnedRevisionId: string | null; readonly scope: unknown; readonly effectiveFrom: string }[];
}

const ck = (id: string, ok: boolean, detail: string): PackageCheck => ({ id, ok, detail });

function packages(req: CandidateRegistrationRequest): { candidate: ModelPackage | null; baseline: ModelPackage | null } {
  return { candidate: getModelPackageVersion(req.modelKey, req.packageVersion), baseline: getModelPackage(req.modelKey) };
}

/** SOMENTE LEITURA. */
export async function planCandidateRegistration(ports: TemplateWorkflowPorts, req: CandidateRegistrationRequest): Promise<CandidatePlan> {
  const { candidate, baseline } = packages(req);
  const checks: PackageCheck[] = [];
  let packageChecks: readonly PackageCheck[] = [];
  if (req.modelKey !== BLL_MODEL_KEY) checks.push(ck("MODEL_SUPPORTED", false, `modelKey ${req.modelKey} fora do escopo desta ferramenta`));
  if (!candidate || !baseline) checks.push(ck("PACKAGES_RESOLVED", false, "pacote candidato ou linha de base não encontrado no servidor"));
  else {
    packageChecks = verifyCandidatePackage(candidate, baseline, {
      modelKey: req.modelKey, sourceLogicalVersion: req.packageVersion, sourceSha256: req.expected.sourceSha256,
      semanticHash: req.expected.semanticHash, baselineSemanticHash: req.expected.baselineSemanticHash, deferredVariables: PUBLICATION_VARIABLES,
    });
    checks.push(...packageChecks);
  }

  const identity = await ports.repository.getIdentity(req.organizationId, req.identityId);
  const identityOk = !!identity && identity.organizationId === req.organizationId && identity.documentKind === "edital";
  checks.push(ck("IDENTITY_IN_TENANT", identityOk, identityOk ? "identidade de Edital encontrada nesta organização" : "identidade inexistente nesta organização ou não é de Edital"));
  const revisions = identityOk ? [...(await ports.repository.listRevisions(req.organizationId, req.identityId))] : [];
  const baselineRev = revisions.find((r) => r.status === "PUBLISHED" && r.semanticHash === req.expected.baselineSemanticHash) ?? null;
  checks.push(ck("BASELINE_PUBLISHED", !!baselineRev, baselineRev ? `Revisão 1 PUBLICADA com o hash esperado (${baselineRev.id})` : "a identidade não contém a revisão de linha de base PUBLICADA com o hash esperado"));
  const existing = revisions.find((r) => r.semanticHash === req.expected.semanticHash) ?? null;
  let provenanceRecorded: boolean | null = null;
  if (existing) {
    const gov = ports.governance ? await new TemplateGovernanceService(ports).get({ organizationId: req.organizationId, actor: { kind: "human", userId: req.actorUserId }, correlationId: `cand-plan-${req.runId}` }, existing.id) : null;
    provenanceRecorded = !!gov?.provenance;
  }
  const bindings = identityOk ? (await ports.repository.listBindings(req.organizationId, { documentKind: "edital", activeOnly: true })).filter((b) => b.identityId === req.identityId) : [];

  const ok = checks.every((c) => c.ok);
  const action: CandidateAction = !ok ? "NONE" : !existing ? "REGISTER_DRAFT" : existing.status === "DRAFT" && provenanceRecorded === false ? "RECORD_PROVENANCE" : "NONE";
  return {
    organizationId: req.organizationId, identityId: req.identityId, packageChecks, checks, ok, action,
    identity: identity ? { documentKind: identity.documentKind, slug: (identity as { slug?: string }).slug ?? null } : null,
    revisions: revisions.map((r) => ({ id: r.id, revision: r.revision, status: r.status, semanticHash: r.semanticHash, catalogVersion: r.variableCatalogVersion })),
    baselineRevisionId: baselineRev?.id ?? null, candidateRevisionId: existing?.id ?? null, candidateStatus: existing?.status ?? null, candidateProvenanceRecorded: provenanceRecorded,
    activeBindings: bindings.map((b) => ({ id: b.id, pinnedRevisionId: b.pinnedRevisionId ?? null, scope: b.scope, effectiveFrom: b.effectiveFrom })),
  };
}

export interface CandidateRegistrationResult {
  readonly plan: CandidatePlan;
  readonly performed: CandidateAction;
  readonly revisionId: string | null;
  readonly provenance: "RECORDED" | "ALREADY_RECORDED" | "FAILED" | "NOT_APPLICABLE";
}

/** Escreve SOMENTE o que o plano diz (DRAFT + procedência). Idempotente. */
export async function registerCandidateDraft(ports: TemplateWorkflowPorts, req: CandidateRegistrationRequest): Promise<CandidateRegistrationResult> {
  const plan = await planCandidateRegistration(ports, req);
  if (!plan.ok) {
    throw new TemplateWorkflowError("VALIDATION_FAILED", `registro do candidato recusado: ${plan.checks.filter((c) => !c.ok).map((c) => c.id).join(", ")} (nada foi criado)`,
      plan.checks.filter((c) => !c.ok).map((c) => ({ code: c.id, path: c.id, message: c.detail })));
  }
  if (plan.action === "NONE") return { plan, performed: "NONE", revisionId: plan.candidateRevisionId, provenance: plan.candidateProvenanceRecorded ? "ALREADY_RECORDED" : "NOT_APPLICABLE" };
  const { candidate } = packages(req);
  const pkg = candidate!;
  const ctx: WorkflowContext = { organizationId: req.organizationId, actor: { kind: "human", userId: req.actorUserId }, correlationId: `cand-reg-${req.runId}` };
  const key = `cand-prov-${req.organizationId}-${req.identityId}-${req.expected.semanticHash.slice(0, 16)}`;
  const result = await new ModelRegistrationService(ports, { allowCandidatePackages: true }).register(ctx, {
    target: { kind: "EXISTING_IDENTITY", identityId: req.identityId }, templateKey: pkg.modelKey, displayName: pkg.displayName, declaredScope: pkg.declaredScope,
    source: { kind: "MODEL_PACKAGE", modelKey: pkg.modelKey, packageVersion: req.packageVersion }, sourceLogicalVersion: pkg.provenance.sourceLogicalVersion,
    sourceSha256: pkg.provenance.sourceSha256, confirm: true, idempotencyKey: key, decision: req.decision,
  }, plan.action === "RECORD_PROVENANCE" ? { resumeDraftRevisionId: plan.candidateRevisionId! } : {});
  log.info("model_candidate_draft_registered", {
    organizationId: req.organizationId, identityId: req.identityId, revisionId: result.revision.id, packageVersion: req.packageVersion,
    action: plan.action, provenance: result.provenance.status, actorUserId: req.actorUserId, correlationId: ctx.correlationId,
  });
  return { plan, performed: plan.action, revisionId: result.revision.id, provenance: result.provenance.status === "RECORDED" ? "RECORDED" : "FAILED" };
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
  }[];
}

/** Lê identidades de Edital, revisões, vínculos ativos e a flag da organização. Não expõe conteúdo de modelo nem dados de processo. */
export async function snapshotOrganizationTemplates(
  ports: TemplateWorkflowPorts, organizationId: number, expected: { readonly baselineSemanticHash: string; readonly semanticHash: string }, flagEnabled: boolean,
): Promise<OrganizationTemplateSnapshot> {
  const identities = await ports.repository.listIdentities(organizationId, { documentKind: "edital" });
  const bindings = await ports.repository.listBindings(organizationId, { documentKind: "edital", activeOnly: true });
  const out: OrganizationTemplateSnapshot["identities"][number][] = [];
  for (const id of [...identities].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const revisions = [...(await ports.repository.listRevisions(organizationId, id.id))];
    out.push({
      id: id.id, slug: id.slug, documentKind: id.documentKind, displayName: id.displayName ?? null,
      revisions: revisions.map((r) => ({ id: r.id, revision: r.revision, status: r.status, semanticHash: r.semanticHash, catalogVersion: r.variableCatalogVersion })),
      activeBindings: bindings.filter((b) => b.identityId === id.id).map((b) => ({
        id: b.id, pinnedRevisionId: b.pinnedRevisionId ?? null, effectiveFrom: b.effectiveFrom,
        scope: { modality: b.scope.modality ?? null, form: b.scope.form ?? null, platform: b.scope.platform ?? null, regime: b.scope.regime ?? null, criterion: b.scope.criterion ?? null },
      })),
      hasBaselinePublished: revisions.some((r) => r.status === "PUBLISHED" && r.semanticHash === expected.baselineSemanticHash),
      candidateRegistered: revisions.some((r) => r.semanticHash === expected.semanticHash),
    });
  }
  return { organizationId, flag: { name: "FF_INSTITUTIONAL_TEMPLATES_V1", enabled: flagEnabled }, identities: out };
}
