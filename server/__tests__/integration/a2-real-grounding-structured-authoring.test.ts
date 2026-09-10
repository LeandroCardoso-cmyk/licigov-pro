/**
 * V1 PRE-PILOT CLOSURE — Fase A2 (fechamento jurídico) — REAL GROUNDING & STRUCTURED AUTHORING.
 *
 * Cobre o contrato A2 FINAL contra o CORPUS REAL + fixtures determinísticos:
 *   - contrato legal ETP (13 incisos; mínimos I/IV/VI/VIII/XIII) e TR (alíneas a–j incl. j);
 *   - structured output produzido pelo PROVIDER (parse+Zod; inválido/omissão sem justificativa → fail);
 *   - grounding POR LOCATOR + degradação por citação rejeitada + cobertura por mínimos legais;
 *   - validação legal GRANULAR (§/inciso/alínea) + parser diploma-first;
 *   - temporalidade: normativo "publicado" NÃO fundamenta; manual "publicado" apenas complementar.
 */
import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildOfficialKnowledgeCorpus, MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";
import { createContextPackage, type ContextPackage } from "../../domain/institutionalIntegration/contextPackage";
import { evidenceRefsFromContextPackage, isNormativeCurrent, isSupplementalAvailable } from "../../domain/institutionalIntegration/evidenceFromContext";
import { parseLegalReferences } from "../../domain/institutionalIntegration/canonicalLocator";
import { buildCorpusLegalIndex, validateCitedLegalReferences, verifySubLocatorPath, locatorExistsAndCurrent } from "../../services/authoring/legalReferenceValidationService";
import { validateStructuredAuthoring, AuthoringContractError, AUTHORING_CONTRACT_VERSION, ETP_CANONICAL_SECTIONS, TR_CANONICAL_SECTIONS } from "../../domain/authoring/authoringSchema";
import { generateStructuredAuthoring, assessSectionCoverage, buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";

const corpus = buildOfficialKnowledgeCorpus({ correlationId: "a2-test-corpus" });
const legalIndex = buildCorpusLegalIndex(corpus);
const fixtureCorpus = buildOfficialKnowledgeCorpus({ correlationId: "a2-fixture", dataDir: join(process.cwd(), "server/__tests__/fixtures/a2-corpus") });
const fixtureIndex = buildCorpusLegalIndex(fixtureCorpus);

function doc(normId: string, status: string) {
  return { documentId: `d:${normId}`, normId, title: normId, authority: "x", jurisdiction: "federal", version: "1.0.0", bindingLevel: "mandatory", status };
}
function passage(normId: string, identifier: string, text = "t", score = 0.8) {
  return { documentId: `d:${normId}`, normId, blockId: `b:${normId}:${identifier}`, identifier, text, score };
}
function pkg(params: { documents: ReturnType<typeof doc>[]; passages: ReturnType<typeof passage>[] }): ContextPackage {
  return createContextPackage({
    correlationId: "c", tenantId: 1, taskType: "etp", hierarchy: ["federal"],
    documents: params.documents, retrievedPassages: params.passages, citations: [], explainability: [],
    metadata: { coverageRatio: 0.9 },
  });
}
const gen = (kind: "etp" | "tr", raw: string, org = 500) =>
  generateStructuredAuthoring({ organizationId: org, kind, object: "Compra X", correlationId: `a2-${kind}-${Math.random()}`, actorUserId: 1, corpus, invoke: async () => raw });

describe("A2 — contrato legal ETP (13 incisos, mínimos §2º)", () => {
  it("13 incisos representados; mínimos I/IV/VI/VIII/XIII marcados mustProvide", () => {
    expect(ETP_CANONICAL_SECTIONS.length).toBe(13);
    const mins = ETP_CANONICAL_SECTIONS.filter((s) => s.mustProvide).map((s) => s.legalAnchorLabel);
    expect(mins).toEqual(["Art. 18, §1º, I", "Art. 18, §1º, IV", "Art. 18, §1º, VI", "Art. 18, §1º, VIII", "Art. 18, §1º, XIII"]);
    // VIII NÃO é opcional; II/X/XI/XII existem no contrato.
    expect(ETP_CANONICAL_SECTIONS.find((s) => s.key === "parcelamento")!.mustProvide).toBe(true);
    for (const k of ["previsao_pca", "providencias_previas", "contratacoes_correlatas", "impactos_ambientais"]) {
      expect(ETP_CANONICAL_SECTIONS.some((s) => s.key === k)).toBe(true);
    }
  });
  it("elemento não mínimo omitido COM justificativa → PASS", async () => {
    const raw = buildMockProviderAuthoring("etp", { previsao_pca: { contentMode: "omitted_with_justification", omissionJustification: "Órgão sem PCA elaborado no exercício." } });
    const r = await gen("etp", raw);
    expect(r.structured.sections.find((s) => s.key === "previsao_pca")!.contentMode).toBe("omitted_with_justification");
  });
  it("elemento não mínimo omitido SEM justificativa → FAIL-CLOSED", async () => {
    const sections = ETP_CANONICAL_SECTIONS.map((s) => s.key === "previsao_pca"
      ? { key: s.key, contentMode: "omitted_with_justification", prose: "", omissionJustification: "" }
      : { key: s.key, contentMode: "provided", prose: "conteúdo", omissionJustification: "" });
    await expect(gen("etp", JSON.stringify({ sections }))).rejects.toBeInstanceOf(AuthoringContractError);
  });
  it("mínimo legal (VIII) omitido com justificativa → FAIL-CLOSED", async () => {
    const raw = buildMockProviderAuthoring("etp", { parcelamento: { contentMode: "omitted_with_justification", omissionJustification: "x" } });
    await expect(gen("etp", raw)).rejects.toBeInstanceOf(AuthoringContractError);
  });
});

describe("A2 — contrato legal TR (alíneas a–j)", () => {
  it("a–j representados; al-j (adequação orçamentária) existe e é comprovada no corpus", () => {
    expect(TR_CANONICAL_SECTIONS.length).toBe(10);
    expect(TR_CANONICAL_SECTIONS.some((s) => s.key === "adequacao_orcamentaria" && s.legalAnchor === "lei-14133-2021:art-6:inc-xxiii:al-j")).toBe(true);
    expect(locatorExistsAndCurrent(legalIndex, "lei-14133-2021", "art-6:inc-xxiii:al-j")).toBe(true);
  });
  it("ausência silenciosa de j (provider não representa) → FAIL-CLOSED", async () => {
    const sections = TR_CANONICAL_SECTIONS.filter((s) => s.key !== "adequacao_orcamentaria").map((s) => ({ key: s.key, contentMode: "provided", prose: "c", omissionJustification: "" }));
    await expect(gen("tr", JSON.stringify({ sections }))).rejects.toBeInstanceOf(AuthoringContractError);
  });
  it("elemento não aplicável COM justificativa → PASS", async () => {
    const raw = buildMockProviderAuthoring("tr", { modelo_gestao: { contentMode: "not_applicable_with_justification", omissionJustification: "Objeto de entrega única, sem gestão continuada." } });
    const r = await gen("tr", raw);
    expect(r.structured.sections.find((s) => s.key === "modelo_gestao")!.contentMode).toBe("not_applicable_with_justification");
  });
});

describe("A2 — validação legal granular + parser diploma-first", () => {
  it("§1º inciso IX existe; XXIX não; §99 não; alínea j existe, z não", () => {
    const art18 = legalIndex.diplomas.get("lei-14133-2021")!.articles.get("18")!.text;
    const art6 = legalIndex.diplomas.get("lei-14133-2021")!.articles.get("6")!.text;
    expect(verifySubLocatorPath(art18, ["par-1", "inc-ix"])).toBe(true);
    expect(verifySubLocatorPath(art18, ["par-1", "inc-xxix"])).toBe(false);
    expect(verifySubLocatorPath(art18, ["par-99"])).toBe(false);
    expect(verifySubLocatorPath(art6, ["inc-xxiii", "al-j"])).toBe(true);
    expect(verifySubLocatorPath(art6, ["inc-xxiii", "al-z"])).toBe(false);
  });
  it("Art. 999 da Lei 14.133/2021 → rejeitado", () => {
    expect(validateCitedLegalReferences(legalIndex, "Art. 999 da Lei 14.133/2021").rejected.length).toBe(1);
  });
  it("Lei nº 14.133/2021, art. 18 → válido; Lei nº 14.133/2021, art. 999 → rejeitado (diploma-first)", () => {
    expect(parseLegalReferences("Lei nº 14.133/2021, art. 18").some((r) => r.diplomaHint === "lei-14133-2021" && r.article === "18")).toBe(true);
    expect(validateCitedLegalReferences(legalIndex, "Conforme a Lei nº 14.133/2021, art. 18.").valid.length).toBe(1);
    expect(validateCitedLegalReferences(legalIndex, "Conforme a Lei nº 14.133/2021, art. 999.").rejected.length).toBe(1);
  });
});

describe("A2 — temporalidade (normativo × complementar)", () => {
  it("helpers: publicado é disponibilidade complementar, não vigência normativa", () => {
    expect(isNormativeCurrent("vigente")).toBe(true);
    expect(isNormativeCurrent("publicado")).toBe(false);
    expect(isSupplementalAvailable("publicado")).toBe(true);
    expect(isNormativeCurrent("revogado")).toBe(false);
  });
  it("NORMATIVA + publicado NÃO satisfaz âncora legal do ETP", () => {
    const cov = assessSectionCoverage("etp", pkg({ documents: [doc("lei-14133-2021", "publicado")], passages: [passage("lei-14133-2021", "Art. 18")] }), legalIndex);
    expect(cov.groundingState).toBe("ungrounded");
  });
  it("MANUAL + publicado é evidência disponível, mas NÃO satisfaz âncora normativa", () => {
    const p = pkg({ documents: [doc("manual-tcu-licitacoes-5ed", "publicado")], passages: [passage("manual-tcu-licitacoes-5ed", "Trecho 1")] });
    expect(isSupplementalAvailable("publicado")).toBe(true);
    expect(assessSectionCoverage("etp", p, legalIndex).groundingState).toBe("ungrounded");
  });
  it("fonte revogada não vira evidência; status desconhecido também não", () => {
    const evs = evidenceRefsFromContextPackage(pkg({ documents: [doc("lei-14133-2021", "vigente"), doc("lei-8666-1993", "revogado")], passages: [passage("lei-14133-2021", "Art. 18"), passage("lei-8666-1993", "Art. 6"), passage("norma-desconhecida", "Art. 1")] }));
    expect(evs.map((e) => e.sourceId)).toEqual(["lei-14133-2021"]);
  });
});

describe("A2 — grounding por locator + degradação por citação rejeitada", () => {
  it("evidência de art. 40 NÃO fundamenta ETP (âncora art. 18)", () => {
    const cov = assessSectionCoverage("etp", pkg({ documents: [doc("lei-14133-2021", "vigente")], passages: [passage("lei-14133-2021", "Art. 40")] }), legalIndex);
    expect(cov.groundingState).toBe("ungrounded");
  });
  it("art. 18 fundamenta os mínimos do ETP → grounded", async () => {
    const r = await gen("etp", buildMockProviderAuthoring("etp"));
    expect(r.groundingState).toBe("grounded");
    expect(r.evidenceComplete).toBe(true);
  });
  it("fixture truncado (§1º só I e III) → PARCIAL (mínimos IV/VI/VIII/XIII ausentes)", () => {
    const cov = assessSectionCoverage("etp", pkg({ documents: [doc("lei-14133-2021", "vigente")], passages: [passage("lei-14133-2021", "Art. 18")] }), fixtureIndex);
    expect(cov.groundingState).toBe("partially_grounded");
    expect(cov.groundedByKey.get("necessidade")).toBe(true);
    expect(cov.groundedByKey.get("requisitos")).toBe(true);
    expect(cov.groundedByKey.get("estimativa_quantidades")).toBe(false);
  });
  it("âncora recuperada + provider cita Art. 999 → seção NÃO grounded; doc NÃO grounded/evidenceComplete", async () => {
    const raw = buildMockProviderAuthoring("etp", { necessidade: { prose: "A necessidade fundamenta-se no Art. 999 da Lei 14.133/2021 conforme diretriz." } });
    const r = await gen("etp", raw);
    const nec = r.structured.sections.find((s) => s.key === "necessidade")!;
    expect(nec.grounded).toBe(false);                 // degradada pela citação rejeitada
    expect(r.content).not.toContain("Art. 999");      // citação falsa removida
    expect(r.evidenceComplete).toBe(false);           // recalculado após validação do provider
    expect(r.groundingState).not.toBe("grounded");
  });
});

describe("A2 — contrato Zod + structured output do provider (A)", () => {
  it("estrutura válida (todas as seções representadas) passa; provider omite seção → FAIL", async () => {
    const r = await gen("etp", buildMockProviderAuthoring("etp"));
    expect(r.structured.contract).toBe(AUTHORING_CONTRACT_VERSION);
    expect(r.content).toContain("Revisão OBRIGATÓRIA");
    await expect(gen("etp", JSON.stringify({ sections: [{ key: "necessidade", contentMode: "provided", prose: "x" }] }))).rejects.toBeInstanceOf(AuthoringContractError);
  });
  it("seção desconhecida / JSON malformado / prose acima do limite → FAIL", async () => {
    await expect(gen("etp", JSON.stringify({ sections: [{ key: "secao_inventada", contentMode: "provided", prose: "x" }] }))).rejects.toBeInstanceOf(AuthoringContractError);
    await expect(gen("etp", "não é json")).rejects.toBeInstanceOf(AuthoringContractError);
    const big = buildMockProviderAuthoring("etp", { necessidade: { prose: "x".repeat(9000) } });
    await expect(gen("etp", big)).rejects.toBeInstanceOf(AuthoringContractError);
  });
  it("validateStructuredAuthoring: mínimo legal sem conteúdo → fail-closed", () => {
    const sections = ETP_CANONICAL_SECTIONS.map((s) => ({ key: s.key, title: s.title, legalAnchorLabel: s.legalAnchorLabel, contentMode: "provided", prose: s.mustProvide ? "" : "c", omissionJustification: "", grounded: false, legalReferences: [] }));
    const cand = { contract: AUTHORING_CONTRACT_VERSION, kind: "etp", object: "X", sections, groundingState: "ungrounded", evidenceCount: 0, evidenceComplete: false, usedSourceIds: [], evidenceFingerprint: null, corpusFingerprint: "c", limitations: [], reviewNotice: "Revisão." };
    expect(() => validateStructuredAuthoring(cand)).toThrow(AuthoringContractError);
  });
});

describe("A2 — isolamento multi-tenant", () => {
  it("norma municipal NÃO é usada como evidência de outro tenant", async () => {
    const other = await generateStructuredAuthoring({ organizationId: 999999, kind: "etp", object: "Compra genérica", correlationId: "a2-tenant", actorUserId: 1, corpus, invoke: async () => buildMockProviderAuthoring("etp") });
    expect(other.structured.usedSourceIds).not.toContain("lei-municipal-769-2021-moreira-sales");
  });
  it("tenant de Moreira Sales existe no corpus", () => {
    expect(MOREIRA_SALES_TENANT_ID).toBe(700001);
    expect(corpus.ingested.some((d) => d.official.normId === "lei-municipal-769-2021-moreira-sales")).toBe(true);
  });
});
