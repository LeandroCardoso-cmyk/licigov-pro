/**
 * Template Governance V2 — DOMÍNIO PURO: política do órgão, origem (ownership/source/lineage), camadas de prontidão e testemunha.
 * Compatibilidade: sem política, a matriz é EXATAMENTE a de antes (evidência jurídica exigida).
 */
import { describe, it, expect } from "vitest";
import type { InstitutionalDecision } from "../../domain/institutionalDecision";
import { createDraftRevision, type TemplateIdentity } from "../../domain/institutionalTemplates";
import { BASELINE_CAPABILITIES_D4BB209 } from "../../domain/institutionalTemplates/governance/capabilities";
import { decodeImportProvenance, encodeImportProvenance, IMPORT_PROVENANCE_DECISION_TYPE, IMPORT_PROVENANCE_OUTCOME, IMPORT_PROVENANCE_SUBJECT, validateImportProvenanceInput } from "../../domain/institutionalTemplates/governance/importProvenance";
import { decodeLegalEvidence, encodeLegalEvidence, LEGAL_EVIDENCE_DECISION_TYPE, LEGAL_EVIDENCE_OUTCOME, LEGAL_EVIDENCE_SUBJECT } from "../../domain/institutionalTemplates/governance/legalEvidence";
import { evaluateReadiness, READINESS_CHECK_IDS, READINESS_CHECK_LAYER, type ReadinessInput } from "../../domain/institutionalTemplates/governance/readinessMatrix";
import { buildReadinessWitness, witnessDrift, witnessRefs } from "../../domain/institutionalTemplates/governance/readinessWitness";
import { inventoryCounts, inventoryHash } from "../../domain/institutionalTemplates/governance/sourceInventory";
import {
  decodeTemplateOrigin, encodeTemplateOrigin, encodeTemplateGovernancePolicy, inferOriginFromRegistration, originChangeIssue, PLATFORM_DEFAULT_EFFECTIVE, PLATFORM_DEFAULT_POLICY,
  PUBLICATION_KINDS, REVISION_PUBLISH_MEANING, resolveEffectiveTemplateGovernancePolicy, roleMeetsFloor, STRICT_FALLBACK_POLICY, TEMPLATE_POLICY_SUBJECT_ID,
  validateTemplateGovernancePolicy, validateTemplateOrigin, type TemplateGovernancePolicy, type TemplateOrigin,
} from "../../domain/institutionalTemplates/governance/templateGovernanceV2";
import { buildPilotAst, buildPilotCatalog, buildPilotInventory, PILOT_SOURCE_LOGICAL_VERSION, pilotSourceSha256 } from "../../services/institutionalTemplates/pilot/editalPilotFixture";

const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
const decision = (over: Partial<InstitutionalDecision>): InstitutionalDecision => ({
  id: "idc_x", organizationId: 1, subjectType: LEGAL_EVIDENCE_SUBJECT, subjectId: "tr1", decisionType: LEGAL_EVIDENCE_DECISION_TYPE, outcome: LEGAL_EVIDENCE_OUTCOME,
  revision: 1, supersedesDecisionId: null, decidedByName: "Gestor", decidedByRole: "Secretário", decidedByUserId: null, decidedAt: "2026-10-05",
  basisReference: "Ato", reason: "Motivo", evidence: [], recordedByUserId: 7, authorityValidation: "NOT_VALIDATED_POLICY_PENDING",
  correlationId: "c", idempotencyKey: "idem-key-1", requestHash: "h", ...over,
});
const policyDecision = (p: TemplateGovernancePolicy, revision = 1, id = `pol${revision}`): InstitutionalDecision => decision({
  id, revision, subjectType: "institutional.policy", subjectId: TEMPLATE_POLICY_SUBJECT_ID, decisionType: "institutional_policy", outcome: "estabelecida", evidence: encodeTemplateGovernancePolicy(p),
});

describe("separação conceitual: publicar template ≠ publicar documento oficial", () => {
  it("a transição PUBLISHED de uma revisão de modelo significa SEMPRE publicação no catálogo interno de elaboração", () => {
    expect(PUBLICATION_KINDS).toEqual(["TEMPLATE_CATALOG_PUBLICATION", "OFFICIAL_DOCUMENT_PUBLICATION"]);
    expect(REVISION_PUBLISH_MEANING).toBe("TEMPLATE_CATALOG_PUBLICATION");
  });
  it("camadas: tudo é técnico (indispensável) exceto a evidência jurídica prévia, que é política do órgão", () => {
    for (const id of READINESS_CHECK_IDS) expect(READINESS_CHECK_LAYER[id]).toBe(id === "LEGAL_APPROVAL_EVIDENCE" ? "TENANT_TEMPLATE_POLICY" : "TECHNICAL_TEMPLATE_READINESS");
  });
});

describe("política do órgão — padrão da plataforma, validação e resolução", () => {
  it("padrão da plataforma PRESERVA o comportamento anterior: evidência exigida, aprovar/publicar a partir de manager", () => {
    expect(PLATFORM_DEFAULT_POLICY).toEqual({ legalEvidence: "REQUIRED", approveMinRole: "manager", publishMinRole: "manager" });
    expect(PLATFORM_DEFAULT_EFFECTIVE).toMatchObject({ kind: "PLATFORM_DEFAULT", decisionId: null, version: 0, malformed: false });
  });
  it("validação: OPTIONAL é admissível; pisos só manager|owner (nunca abaixo de manager); valores desconhecidos recusados", () => {
    expect(validateTemplateGovernancePolicy({ legalEvidence: "OPTIONAL", approveMinRole: "owner", publishMinRole: "manager" })).toEqual([]);
    expect(validateTemplateGovernancePolicy({ legalEvidence: "NEVER", approveMinRole: "operator", publishMinRole: "viewer" } as never).map((i) => i.field)).toEqual(["legalEvidence", "approveMinRole", "publishMinRole"]);
  });
  it("sem registros ⇒ padrão da plataforma; corrente válida ⇒ TENANT_DEFINED (a MAIOR versão decide); histórico não relaxa nada sozinho", () => {
    expect(resolveEffectiveTemplateGovernancePolicy([])).toBe(PLATFORM_DEFAULT_EFFECTIVE);
    const v1 = policyDecision({ legalEvidence: "OPTIONAL", approveMinRole: "manager", publishMinRole: "manager" }, 1);
    const v2 = policyDecision({ legalEvidence: "REQUIRED", approveMinRole: "owner", publishMinRole: "owner" }, 2);
    expect(resolveEffectiveTemplateGovernancePolicy([v1])).toMatchObject({ kind: "TENANT_DEFINED", version: 1, decisionId: "pol1", policy: { legalEvidence: "OPTIONAL" } });
    expect(resolveEffectiveTemplateGovernancePolicy([v1, v2])).toMatchObject({ kind: "TENANT_DEFINED", version: 2, policy: { legalEvidence: "REQUIRED", approveMinRole: "owner" } });
  });
  it("registro corrente ILEGÍVEL ou de outro assunto ⇒ padrão ESTRITO + malformed (nunca relaxa em silêncio)", () => {
    const bad = decision({ id: "bad", revision: 3, subjectType: "institutional.policy", subjectId: TEMPLATE_POLICY_SUBJECT_ID, decisionType: "institutional_policy", outcome: "estabelecida", evidence: ["schema=tpl-governance-policy/1", "legalEvidence=OPTIONAL"] });
    const r = resolveEffectiveTemplateGovernancePolicy([policyDecision({ legalEvidence: "OPTIONAL", approveMinRole: "manager", publishMinRole: "manager" }, 1), bad]);
    expect(r).toMatchObject({ malformed: true, decisionId: "bad", version: 3, policy: STRICT_FALLBACK_POLICY });
    expect(r.policy.legalEvidence).toBe("REQUIRED");
    const wrongSubject = { ...policyDecision({ legalEvidence: "OPTIONAL", approveMinRole: "manager", publishMinRole: "manager" }), subjectId: "governed-fields" };
    expect(resolveEffectiveTemplateGovernancePolicy([wrongSubject]).malformed).toBe(true);
  });
  it("roleMeetsFloor: ranking fixo; papel ausente/desconhecido nunca atende", () => {
    expect(roleMeetsFloor("owner", "manager")).toBe(true);
    expect(roleMeetsFloor("manager", "owner")).toBe(false);
    expect(roleMeetsFloor("operator", "manager")).toBe(false);
    expect(roleMeetsFloor(null, "manager")).toBe(false);
    expect(roleMeetsFloor("admin", "manager")).toBe(false);
  });
});

describe("origem do template — ownership · source · lineage", () => {
  const pkgLineage = { kind: "PLATFORM_PACKAGE" as const, packageKey: "EDITAL_PREGAO_ELETRONICO_BLL", packageVersion: "1.0.1-draft", sourceSha256: SHA };
  const original = { sha256: SHA2, sizeBytes: 1234, filename: "edital-modelo.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", storageKey: "institutional-templates/1/ti1/123-edital-modelo.docx" };
  it("origem é INFERIDA pelo servidor do tipo de registro: pacote ⇒ PLATFORM; DOCX/Markdown ⇒ TENANT enviado; AST ⇒ TENANT redigido", () => {
    expect(inferOriginFromRegistration({ kind: "MODEL_PACKAGE", packageKey: pkgLineage.packageKey, packageVersion: pkgLineage.packageVersion, sourceSha256: SHA })).toMatchObject({ ownership: "PLATFORM", source: "PLATFORM_CATALOG", lineage: pkgLineage });
    expect(inferOriginFromRegistration({ kind: "DOCX", original })).toMatchObject({ ownership: "TENANT", source: "TENANT_UPLOAD", lineage: null, original });
    expect(inferOriginFromRegistration({ kind: "AST" }, "Secretaria X")).toMatchObject({ ownership: "TENANT", source: "TENANT_AUTHORED", declaredAuthor: "Secretaria X" });
  });
  const valid: TemplateOrigin[] = [
    { ownership: "PLATFORM", source: "PLATFORM_CATALOG", lineage: pkgLineage, original: null, declaredAuthor: null },
    { ownership: "TENANT", source: "TENANT_UPLOAD", lineage: null, original, declaredAuthor: "Setor de Licitações" },
    { ownership: "TENANT", source: "TENANT_AUTHORED", lineage: null, original: null, declaredAuthor: null },
    { ownership: "DERIVED", source: "TENANT_AUTHORED", lineage: { kind: "TENANT_REVISION", identityId: "ti1", revisionId: "tr1", semanticHash: SHA }, original: null, declaredAuthor: null },
    { ownership: "DERIVED", source: "TENANT_AUTHORED", lineage: pkgLineage, original: null, declaredAuthor: null },
  ];
  it.each(valid.map((o, i) => [i, o] as const))("origem válida #%i: valida, codifica e decodifica sem perda", (_i, o) => {
    expect(validateTemplateOrigin(o)).toEqual([]);
    expect(decodeTemplateOrigin(encodeTemplateOrigin(o))).toEqual({ origin: o, malformed: false });
  });
  it("combinações inválidas são recusadas (PLATFORM sem catálogo, DERIVED sem lineage, TENANT com lineage, upload sem original, original sem upload, SHA inválido)", () => {
    const bad = (o: Partial<TemplateOrigin>) => validateTemplateOrigin({ ownership: "TENANT", source: "TENANT_AUTHORED", lineage: null, original: null, declaredAuthor: null, ...o }).map((i) => i.field);
    expect(bad({ ownership: "PLATFORM", source: "TENANT_UPLOAD" })).toContain("source");
    expect(bad({ ownership: "DERIVED" })).toContain("lineage");
    expect(bad({ lineage: pkgLineage })).toContain("lineage");
    expect(bad({ source: "TENANT_UPLOAD" })).toContain("original");
    expect(bad({ original })).toContain("original");
    expect(bad({ source: "TENANT_UPLOAD", original: { ...original, sha256: "x" } })).toContain("original.sha256");
    expect(bad({ declaredAuthor: "linha1\nlinha2" })).toContain("declaredAuthor");
  });
  it("sem linhas de origem ⇒ registro LEGADO (null, não malformado); linhas ilegíveis ⇒ malformado (nunca 'meio válido')", () => {
    expect(decodeTemplateOrigin(["templateKey=X"])).toEqual({ origin: null, malformed: false });
    expect(decodeTemplateOrigin(["origin.ownership=TENANT", "origin.source=TENANT_UPLOAD"]).malformed).toBe(true);        // upload sem original
    expect(decodeTemplateOrigin(["origin.ownership=ALIEN", "origin.source=TENANT_AUTHORED"]).malformed).toBe(true);
    expect(decodeTemplateOrigin(["origin.ownership=DERIVED", "origin.source=TENANT_AUTHORED", "origin.lineage.kind=OUTRO"]).malformed).toBe(true);
  });
  it("imutabilidade: repetir a origem é ok; classificar um legado (sem origem) é ok; alterar ou remover é recusado", () => {
    const [platform, upload] = valid;
    expect(originChangeIssue(null, platform)).toBeNull();
    expect(originChangeIssue(platform, platform)).toBeNull();
    expect(originChangeIssue(platform, upload)).toMatch(/imutável/);
    expect(originChangeIssue(platform, null)).toMatch(/imutável/);
    expect(originChangeIssue(upload, { ...upload, original: { ...upload.original!, sha256: SHA } })).toMatch(/imutável/);
  });
  it("a origem viaja na procedência (mesmo ledger): round-trip, legado sem origem e validação", () => {
    const input = {
      templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", displayName: "Edital", sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, sourceFormat: "NATIVE",
      scope: { modality: "pregao" }, origin: valid[1],
    };
    expect(validateImportProvenanceInput(input)).toEqual([]);
    const lines = encodeImportProvenance(input, { revisionSemanticHash: SHA2, recordedAt: "t" });
    const d = decision({ subjectType: IMPORT_PROVENANCE_SUBJECT, decisionType: IMPORT_PROVENANCE_DECISION_TYPE, outcome: IMPORT_PROVENANCE_OUTCOME, evidence: lines });
    expect(decodeImportProvenance(d)).toMatchObject({ origin: valid[1], originMalformed: false });
    const legacy = decodeImportProvenance({ ...d, evidence: encodeImportProvenance({ ...input, origin: undefined }, { revisionSemanticHash: SHA2, recordedAt: "t" }) });
    expect(legacy).toMatchObject({ origin: null, originMalformed: false });
    expect(validateImportProvenanceInput({ ...input, origin: { ...valid[1], original: null } }).map((i) => i.field)).toContain("origin.original");
  });
});

// ─── prontidão por camada / política ─────────────────────────────────────────────────────────────────────────────────
const identity: TemplateIdentity = { id: "ti1", organizationId: 1, documentKind: "edital", slug: "edital-pregao-eletronico-bll", createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
function readinessInput(opts: { evidence?: "valid" | "stale" | "none"; policy?: ReadinessInput["policy"]; noInventory?: boolean } = {}): ReadinessInput {
  const catalog = buildPilotCatalog(); const ast = buildPilotAst();
  const created = createDraftRevision({ id: "tr1", identity, revision: 1, ast, catalog, sourceFormat: "NATIVE" });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  const revision = created.value;
  const inv = buildPilotInventory(ast);
  const provenance = decodeImportProvenance(decision({
    subjectType: IMPORT_PROVENANCE_SUBJECT, decisionType: IMPORT_PROVENANCE_DECISION_TYPE, outcome: IMPORT_PROVENANCE_OUTCOME,
    evidence: encodeImportProvenance({ templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", displayName: "x", sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast), sourceFormat: "NATIVE", inventory: { sha256: inventoryHash(inv), ...inventoryCounts(inv) }, scope: {} }, { revisionSemanticHash: revision.semanticHash, recordedAt: "t" }),
  }))!;
  const ev = opts.evidence ?? "valid";
  const legalEvidence = ev === "none" ? null : decodeLegalEvidence(decision({
    id: "ev1", evidence: encodeLegalEvidence({ sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast) }, { revisionSemanticHash: ev === "stale" ? SHA2 : revision.semanticHash, recordedAt: "t" }),
  }));
  return { revision, catalog, provenance, legalEvidence, inventory: opts.noInventory ? null : inv, capabilities: BASELINE_CAPABILITIES_D4BB209, ...(opts.policy ? { policy: opts.policy } : {}) };
}
const OPTIONAL = resolveEffectiveTemplateGovernancePolicy([policyDecision({ legalEvidence: "OPTIONAL", approveMinRole: "manager", publishMinRole: "manager" })]);
const REQUIRED_DEFINED = resolveEffectiveTemplateGovernancePolicy([policyDecision({ legalEvidence: "REQUIRED", approveMinRole: "manager", publishMinRole: "manager" })]);
const status = (m: ReturnType<typeof evaluateReadiness>, id: string) => m.checks.find((c) => c.id === id)!.status;

describe("prontidão: a evidência jurídica prévia é POLÍTICA, não universal", () => {
  it("COMPATIBILIDADE: sem política (ou com o padrão explícito da plataforma) a matriz é idêntica à de antes — sem evidência ⇒ BLOCKED", () => {
    const legacy = evaluateReadiness(readinessInput({ evidence: "none" }));
    const explicit = evaluateReadiness(readinessInput({ evidence: "none", policy: PLATFORM_DEFAULT_EFFECTIVE }));
    expect(status(legacy, "LEGAL_APPROVAL_EVIDENCE")).toBe("BLOCKED");
    expect(legacy.overall).toBe("BLOCKED");
    expect(explicit.checks).toEqual(legacy.checks);
    expect(explicit.matrixHash).toBe(legacy.matrixHash);
    expect(legacy.policy).toMatchObject({ kind: "PLATFORM_DEFAULT", legalEvidence: "REQUIRED", malformed: false });
  });
  it("REQUIRED definida pelo órgão: mesmo comportamento rígido (evidência ausente/obsoleta ⇒ BLOCKED)", () => {
    expect(status(evaluateReadiness(readinessInput({ evidence: "none", policy: REQUIRED_DEFINED })), "LEGAL_APPROVAL_EVIDENCE")).toBe("BLOCKED");
    expect(status(evaluateReadiness(readinessInput({ evidence: "stale", policy: REQUIRED_DEFINED })), "LEGAL_APPROVAL_EVIDENCE")).toBe("BLOCKED");
    expect(evaluateReadiness(readinessInput({ evidence: "valid", policy: REQUIRED_DEFINED })).overall).toBe("READY");
  });
  it("OPTIONAL: sem evidência ⇒ NOT_APPLICABLE (explicado) e a matriz fica READY; nada é fabricado", () => {
    const m = evaluateReadiness(readinessInput({ evidence: "none", policy: OPTIONAL }));
    const c = m.checks.find((x) => x.id === "LEGAL_APPROVAL_EVIDENCE")!;
    expect(c).toMatchObject({ status: "NOT_APPLICABLE", layer: "TENANT_TEMPLATE_POLICY" });
    expect(c.detail).toMatch(/política do órgão.*NÃO exigida/);
    expect(m.overall).toBe("READY");
    expect(m.policy).toMatchObject({ kind: "TENANT_DEFINED", legalEvidence: "OPTIONAL", decisionId: "pol1" });
    expect(m.matrixHash).not.toBe(evaluateReadiness(readinessInput({ evidence: "none" })).matrixHash);
  });
  it("OPTIONAL: evidência VÁLIDA continua PASS (auditável); evidência obsoleta é mostrada como aviso e NÃO considerada", () => {
    expect(status(evaluateReadiness(readinessInput({ evidence: "valid", policy: OPTIONAL })), "LEGAL_APPROVAL_EVIDENCE")).toBe("PASS");
    const stale = evaluateReadiness(readinessInput({ evidence: "stale", policy: OPTIONAL }));
    const c = stale.checks.find((x) => x.id === "LEGAL_APPROVAL_EVIDENCE")!;
    expect(c.status).toBe("NOT_APPLICABLE");
    expect(c.detail).toMatch(/não é considerada.*mudou depois do registro/);
    expect(c.findings.length).toBeGreaterThan(0);
  });
  it("a camada TÉCNICA nunca é dispensada pela política: inventário ausente continua BLOCKED mesmo com OPTIONAL", () => {
    const m = evaluateReadiness(readinessInput({ evidence: "none", policy: OPTIONAL, noInventory: true }));
    expect(status(m, "INPUTS_ACCOUNTED")).toBe("BLOCKED");
    expect(m.overall).toBe("BLOCKED");
    expect(m.checks.filter((c) => c.status === "BLOCKED").every((c) => c.layer === "TECHNICAL_TEMPLATE_READINESS")).toBe(true);
  });
  it("registro de política ilegível ⇒ política estrita: evidência exigida (e o aviso aparece na matriz)", () => {
    const malformed = resolveEffectiveTemplateGovernancePolicy([decision({ id: "bad", subjectType: "institutional.policy", subjectId: TEMPLATE_POLICY_SUBJECT_ID, decisionType: "institutional_policy", outcome: "estabelecida", evidence: ["x=1"] })]);
    const m = evaluateReadiness(readinessInput({ evidence: "none", policy: malformed }));
    expect(status(m, "LEGAL_APPROVAL_EVIDENCE")).toBe("BLOCKED");
    expect(m.policy.malformed).toBe(true);
  });
  it("a testemunha inclui a política: política alterada entre o cálculo e o COMMIT ⇒ deriva 'policy'; sem política o hash da testemunha é o legado", () => {
    const m1 = evaluateReadiness(readinessInput({ evidence: "none" }));
    const m2 = evaluateReadiness(readinessInput({ evidence: "none", policy: OPTIONAL }));
    expect(m1.witness.policyDecisionId ?? null).toBeNull();
    expect(m2.witness.policyDecisionId).toBe("pol1");
    expect(witnessDrift(witnessRefs(m2.witness), { ...witnessRefs(m2.witness), policyDecisionId: "pol2" })).toEqual(["policy"]);
    expect(witnessDrift(witnessRefs(m2.witness), { ...witnessRefs(m2.witness), policyDecisionId: null })).toEqual(["policy"]);
    expect(witnessDrift(witnessRefs(m1.witness), { ...witnessRefs(m1.witness), policyDecisionId: undefined })).toEqual([]);
    const legacyShape = buildReadinessWitness({ revisionId: "r", revisionSemanticHash: SHA, catalogVersion: "c", catalogHash: null, capabilitiesHash: SHA, inventoryHash: null, provenanceDecisionId: null, legalEvidenceDecisionId: null, matrixHash: SHA });
    const withNull = buildReadinessWitness({ revisionId: "r", revisionSemanticHash: SHA, catalogVersion: "c", catalogHash: null, capabilitiesHash: SHA, inventoryHash: null, provenanceDecisionId: null, legalEvidenceDecisionId: null, policyDecisionId: null, matrixHash: SHA });
    expect(withNull.witnessHash).toBe(legacyShape.witnessHash);
  });
});
