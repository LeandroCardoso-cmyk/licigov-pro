/**
 * Verificação do pacote CANDIDATO (Revisão 2 do BLL) contra a Revisão 1 — domínio puro. Falha fechada para qualquer desvio.
 */
import { describe, expect, it } from "vitest";
import { allChecksPass, verifyCandidatePackage, type CandidatePackageLike } from "../../domain/institutionalTemplates/candidatePackage";
import { PUBLICATION_VARIABLES } from "../../domain/institutionalTemplates/publicationSchedule";
import { BLL_MODEL_KEY, MODEL_PACKAGES, getModelPackage, getModelPackageVersion } from "../../services/institutionalTemplates/modelPackages";

const R1 = getModelPackage(BLL_MODEL_KEY)!;
const R2 = getModelPackageVersion(BLL_MODEL_KEY, "1.0.2-draft")!;
const EXP = {
  modelKey: BLL_MODEL_KEY, sourceLogicalVersion: "1.0.2-draft", sourceSha256: "6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904",
  semanticHash: "33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd", baselineSemanticHash: "e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d",
  deferredVariables: PUBLICATION_VARIABLES,
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const as = (p: unknown) => p as CandidatePackageLike;
const failed = (c: CandidatePackageLike, exp = EXP) => verifyCandidatePackage(c, as(R1), exp).filter((x) => !x.ok).map((x) => x.id);

describe("pacote candidato — Revisão 2 do BLL", () => {
  it("o pacote real passa em TODAS as verificações (hashes exatos, mesma AST/fonte, só 7 variáveis de política)", () => {
    const checks = verifyCandidatePackage(as(R2), as(R1), EXP);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(allChecksPass(checks)).toBe(true);
    expect(checks.map((c) => c.id)).toEqual(expect.arrayContaining(["SAME_AST", "SAME_MAPPING", "SAME_APPROVED_PACKAGE", "DEFERRED_SET_EXACT", "RULES_ONLY_CATALOG_VERSION", "CANDIDATE_SEMANTIC_HASH", "BASELINE_SEMANTIC_HASH"]));
  });
  it("o pacote vigente NÃO é candidato; só existe UM candidato e ele nunca é devolvido como pacote vigente", () => {
    expect(R1.candidate).not.toBe(true);
    expect(MODEL_PACKAGES.filter((p) => p.candidate).map((p) => p.provenance.sourceLogicalVersion)).toEqual(["1.0.2-draft"]);
    expect(getModelPackage(BLL_MODEL_KEY)).toBe(R1);
  });
  it("hash/versão/SHA esperados errados ⇒ recusa", () => {
    expect(failed(as(R2), { ...EXP, semanticHash: "0".repeat(64) })).toContain("CANDIDATE_SEMANTIC_HASH");
    expect(failed(as(R2), { ...EXP, baselineSemanticHash: "0".repeat(64) })).toContain("BASELINE_SEMANTIC_HASH");
    expect(failed(as(R2), { ...EXP, sourceLogicalVersion: "1.0.3-draft" })).toContain("LOGICAL_VERSION");
    expect(failed(as(R2), { ...EXP, sourceSha256: "1".repeat(64) })).toContain("SOURCE_SHA256");
  });
  it("AST diferente da Revisão 1 ⇒ recusa", () => {
    const c = clone(R2) as unknown as { ast: { body?: unknown[] } };
    (c.ast as unknown as Record<string, unknown>).__tamper = 1;
    expect(failed(as(c))).toEqual(expect.arrayContaining(["SAME_AST", "CANDIDATE_SEMANTIC_HASH"]));
  });
  it("fonte jurídica congelada diferente ⇒ recusa", () => {
    const c = clone(R2) as unknown as { approvedPackage: Record<string, unknown> };
    c.approvedPackage.status = "OUTRO";
    expect(failed(as(c))).toContain("SAME_APPROVED_PACKAGE");
  });
  it("uma 8ª variável com DEFERRED_PUBLICATION, ou uma das 7 sem, ⇒ recusa", () => {
    const more = clone(R2);
    const extra = more.catalog.vars.find((v) => v.name === "julgamento.valorEstimado")!;
    (extra as unknown as Record<string, unknown>).required = false; (extra as unknown as Record<string, unknown>).completionPolicy = "DEFERRED_PUBLICATION";
    expect(failed(as(more))).toEqual(expect.arrayContaining(["DEFERRED_SET_EXACT", "CHANGED_EQUALS_DEFERRED"]));
    const less = clone(R2);
    delete (less.catalog.vars.find((v) => v.name === "processo.numeroPregao") as unknown as Record<string, unknown>).completionPolicy;
    expect(failed(as(less))).toContain("DEFERRED_SET_EXACT");
  });
  it("mudança do catálogo FORA da política de completude (tipo, fonte, requiredWhen…) ⇒ recusa", () => {
    const c = clone(R2);
    (c.catalog.vars.find((v) => v.name === "processo.numeroPregao") as unknown as Record<string, unknown>).type = "integer";
    (c.catalog.vars.find((v) => v.name === "julgamento.valorEstimado") as unknown as Record<string, unknown>).description = "alterada";
    expect(failed(as(c))).toContain("CATALOG_ONLY_COMPLETION_POLICY");
  });
  it("regras do modelo diferentes (além da versão do catálogo) ⇒ recusa", () => {
    const c = clone(R2) as unknown as { rules: { rules: unknown[] } };
    c.rules.rules = c.rules.rules.slice(1);
    expect(failed(as(c))).toContain("RULES_ONLY_CATALOG_VERSION");
  });
  it("candidato com a flag removida (pacote vigente) ⇒ recusa", () => {
    const c = clone(R2) as unknown as Record<string, unknown>;
    delete c.candidate;
    expect(failed(as(c))).toContain("CANDIDATE_FLAG");
  });
});
