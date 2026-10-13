/**
 * Verificação do pacote CANDIDATO (Revisão 2 do BLL) contra a Revisão 1 — domínio puro. Falha fechada para qualquer desvio.
 */
import { describe, expect, it } from "vitest";
import { allChecksPass, DEFERRED_FIELD_CONTRACT, verifyCandidatePackage, type CandidatePackageLike } from "../../domain/institutionalTemplates/candidatePackage";
import { PUBLICATION_VARIABLES } from "../../domain/institutionalTemplates/publicationSchedule";
import { canonicalJson, sha256Hex } from "../../domain/canonicalJson";
import { CANDIDATE_CATALOG_PINS } from "../../services/institutionalTemplates/candidateRegistrationService";
import { BLL_MODEL_KEY, MODEL_PACKAGES, getModelPackage, getModelPackageVersion } from "../../services/institutionalTemplates/modelPackages";

const R1 = getModelPackage(BLL_MODEL_KEY)!;
const R2 = getModelPackageVersion(BLL_MODEL_KEY, "1.0.2-draft")!;
const EXP = {
  modelKey: BLL_MODEL_KEY, sourceLogicalVersion: "1.0.2-draft", sourceSha256: "6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904",
  semanticHash: "33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd", baselineSemanticHash: "e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d",
  deferredVariables: PUBLICATION_VARIABLES, ...CANDIDATE_CATALOG_PINS[`${BLL_MODEL_KEY}@1.0.2-draft`],
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

describe("integridade do catálogo — conteúdo efetivo, não só o hash declarado", () => {
  const SIX = Object.entries(DEFERRED_FIELD_CONTRACT).filter(([, c]) => c.renderable).map(([n]) => n);
  const mutate = (name: string, f: (v: Record<string, unknown>) => void) => { const c = clone(R2); f(c.catalog.vars.find((v) => v.name === name) as unknown as Record<string, unknown>); return c; };

  it("os pinos de conteúdo do catálogo coincidem com os catálogos reais (Revisão 1 e candidata)", () => {
    expect(sha256Hex(canonicalJson(R2.catalog as never))).toBe(EXP.catalogSha256);
    expect(sha256Hex(canonicalJson(R1.catalog as never))).toBe(EXP.baselineCatalogSha256);
  });
  it("o contrato tem exatamente as 7 variáveis aprovadas: 6 renderizáveis com o texto governado e 1 de controle sem absentText", () => {
    expect(Object.keys(DEFERRED_FIELD_CONTRACT).sort()).toEqual([...PUBLICATION_VARIABLES].sort());
    expect(SIX).toHaveLength(6);
    for (const n of SIX) expect(DEFERRED_FIELD_CONTRACT[n].absentText).toBe("A DEFINIR PARA PUBLICAÇÃO");
    expect(DEFERRED_FIELD_CONTRACT["controle.dataDivulgacaoPrevista"]).toEqual({ renderable: false, absentText: null });
  });
  it("absentText alterado: o hash semântico DECLARADO continua correto (cego ao conteúdo do catálogo) e MESMO ASSIM o pacote é recusado", () => {
    for (const n of SIX) {
      for (const bad of ["A definir para publicação", "A DEFINIR PARA PUBLICACAO", "A DEFINIR PARA PUBLICAÇÃO ", "A DEFINIR", "[REVISAR]"]) {
        const c = mutate(n, (v) => { v.absentText = bad; });
        const checks = verifyCandidatePackage(as(c), as(R1), EXP);
        expect(checks.find((x) => x.id === "CANDIDATE_SEMANTIC_HASH")!.ok, "o hash semântico é cego ao catálogo").toBe(true);
        const failedIds = checks.filter((x) => !x.ok).map((x) => x.id);
        expect(failedIds, `${n} / ${bad}`).toEqual(expect.arrayContaining([`DEFERRED_FIELD:${n}`, "CATALOG_CONTENT_SHA256"]));
      }
    }
  });
  it("campo omitido (absentText/completionPolicy), required true ou renderable invertido em CADA uma das 7 variáveis ⇒ recusa nomeando a variável", () => {
    for (const n of PUBLICATION_VARIABLES) {
      for (const [label, f] of [
        ["absentText omitido", (v: Record<string, unknown>) => { delete v.absentText; }],
        ["completionPolicy omitida", (v: Record<string, unknown>) => { delete v.completionPolicy; }],
        ["required=true", (v: Record<string, unknown>) => { v.required = true; }],
        ["renderable invertido", (v: Record<string, unknown>) => { v.renderable = !v.renderable; }],
      ] as const) {
        if (label === "absentText omitido" && DEFERRED_FIELD_CONTRACT[n].absentText === null) continue;       // o controle não tem absentText: omitir é o contrato (mutação nula)
        const bad = verifyCandidatePackage(as(mutate(n, f)), as(R1), EXP);
        expect(bad.find((x) => x.id === `DEFERRED_FIELD:${n}`)!.ok, `${n}: ${label}`).toBe(false);
        expect(bad.find((x) => x.id === "CATALOG_CONTENT_SHA256")!.ok, `${n}: ${label}`).toBe(false);
      }
    }
  });
  it("absentText no controle (não renderizável) ⇒ recusa", () => {
    const c = mutate("controle.dataDivulgacaoPrevista", (v) => { v.absentText = "A DEFINIR PARA PUBLICAÇÃO"; });
    expect(failed(as(c))).toEqual(expect.arrayContaining(["DEFERRED_FIELD:controle.dataDivulgacaoPrevista", "CATALOG_CONTENT_SHA256"]));
  });
  it("catálogo da Revisão 1 (base) adulterado ⇒ recusa (Revisão 1 preservada)", () => {
    const base = clone(R1);
    (base.catalog.vars[0] as unknown as Record<string, unknown>).description = "alterada";
    const checks = verifyCandidatePackage(as(R2), as(base), EXP);
    expect(checks.find((x) => x.id === "BASELINE_CATALOG_SHA256")!.ok).toBe(false);
  });
  it("hash declarado correto com payload divergente em OUTRA variável do catálogo ⇒ recusa pelo conteúdo", () => {
    const c = mutate("julgamento.valorEstimado", (v) => { v.description = "outra descrição"; });
    expect(failed(as(c))).toEqual(expect.arrayContaining(["CATALOG_CONTENT_SHA256", "CATALOG_ONLY_COMPLETION_POLICY"]));
  });
});
