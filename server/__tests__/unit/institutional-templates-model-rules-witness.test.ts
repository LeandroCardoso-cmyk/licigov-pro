import { describe, it, expect } from "vitest";
import rulesJson from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/rules.json";
import catalogJson from "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/catalog.v2.json";
import { evaluateModelRules, validateModelRules, type ModelRules, type VariableCatalog2 } from "../../domain/institutionalTemplates";
import { buildReadinessWitness, witnessDrift, witnessRefs } from "../../domain/institutionalTemplates/governance/readinessWitness";

const rules = rulesJson as unknown as ModelRules;
const catalog = catalogJson as unknown as VariableCatalog2;
const codes = (v: Record<string, unknown>) => evaluateModelRules(rules, v).map((f) => `${f.id}:${f.code}`);

describe("tpl-model-rules/1 — regras governadas do modelo BLL", () => {
  it("o conjunto é válido contra o catálogo v2 e o catálogo declarado é o do modelo", () => {
    expect(rules.catalogVersion).toBe(catalog.version);
    expect(validateModelRules(rules, catalog).ok).toBe(true);
  });

  it("maior desconto + orçamento sigiloso ⇒ MODEL_RULE_VIOLATED; orçamento público ⇒ nenhuma violação", () => {
    expect(codes({ "julgamento.criterioJulgamento": "maior desconto", "controle.orcamentoSigilosoSimNao": true })).toContain("R_DESCONTO_EXIGE_ORCAMENTO_PUBLICO:MODEL_RULE_VIOLATED");
    expect(codes({ "julgamento.criterioJulgamento": "maior desconto", "controle.orcamentoSigilosoSimNao": false })).toEqual([]);
  });

  it("tetos paramétricos (garantia 10, capital/PL 10, cota 25)", () => {
    expect(codes({ "contratacao.percentualGarantiaContratual": 11 })).toContain("R_GARANTIA_TETO:MODEL_RULE_VIOLATED");
    expect(codes({ "habilitacao.percentualCapitalPlMinimo": 10 })).toEqual([]);
    expect(codes({ "participacao.percentualCotaReservada": 26 })).toContain("R_COTA_RESERVADA_TETO:MODEL_RULE_VIOLATED");
  });

  it("autoridade indisponível com cenário ativo ⇒ RULE_VALIDATION_UNAVAILABLE (fail-closed); inativo ⇒ silêncio", () => {
    expect(codes({ "decisao.cotaReservada": true })).toContain("R_COTA_RESERVADA_BEM_DIVISIVEL:RULE_VALIDATION_UNAVAILABLE");
    expect(codes({ "decisao.cotaReservada": false })).toEqual([]);
    expect(codes({ "decisao.exigeGarantiaContratual": true, "contratacao.percentualGarantiaContratual": 7 })).toContain("R_GARANTIA_ACIMA_DE_5_EXIGE_JUSTIFICATIVA:RULE_VALIDATION_UNAVAILABLE");
    expect(codes({ "decisao.exigeGarantiaContratual": true, "contratacao.percentualGarantiaContratual": 5 })).toEqual([]);
  });

  it("canal único: alternativas separadas por 'ou' ou ';' violam", () => {
    expect(codes({ "instituicao.canalEsclarecimentos": "a@x.gov.br ou b@x.gov.br" })).toContain("R_CANAL_ESCLARECIMENTOS_UNICO:MODEL_RULE_VIOLATED");
    expect(codes({ "instituicao.canalEsclarecimentos": "a@x.gov.br" })).toEqual([]);
  });
});

describe("readiness witness — TPL-ED-PUB-TOCTOU-001", () => {
  const base = { revisionId: "r1", catalogVersion: "c/1", catalogHash: "h", capabilitiesHash: "cap", inventoryHash: "inv", matrixHash: "m", revisionSemanticHash: "s1", provenanceDecisionId: "p1", legalEvidenceDecisionId: "l1" };

  it("é determinístico e o hash cobre todo o conteúdo", () => {
    expect(buildReadinessWitness(base).witnessHash).toBe(buildReadinessWitness({ ...base }).witnessHash);
    expect(buildReadinessWitness({ ...base, matrixHash: "m2" }).witnessHash).not.toBe(buildReadinessWitness(base).witnessHash);
  });

  it("deriva exatamente os campos que mudaram entre a prontidão e o COMMIT", () => {
    const refs = witnessRefs(buildReadinessWitness(base));
    expect(witnessDrift(refs, { ...refs })).toEqual([]);
    expect(witnessDrift(refs, { ...refs, legalEvidenceDecisionId: "l2" })).toEqual(["legalEvidence"]);
    expect(witnessDrift(refs, { revisionSemanticHash: "s2", provenanceDecisionId: null, legalEvidenceDecisionId: "l1" })).toEqual(["revisionSemanticHash", "provenance"]);
  });
});
