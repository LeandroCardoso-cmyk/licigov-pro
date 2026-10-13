/**
 * Validação INTEGRAL da procedência do candidato (domínio puro): ausente / correta / divergente / ilegível, campo a campo.
 */
import { describe, expect, it } from "vitest";
import { diffImportProvenance, evaluateCandidateProvenance, type ExpectedCandidateProvenance } from "../../domain/institutionalTemplates/governance/candidateProvenance";
import { encodeImportProvenance, IMPORT_PROVENANCE_DECISION_TYPE, IMPORT_PROVENANCE_OUTCOME, IMPORT_PROVENANCE_SUBJECT, type ImportProvenanceInput } from "../../domain/institutionalTemplates/governance/importProvenance";
import type { InstitutionalDecision } from "../../domain/institutionalDecision";

const H = (c: string) => c.repeat(64);
const input: ImportProvenanceInput = {
  templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", displayName: "Edital — Pregão Eletrônico (BLL)", sourceLogicalVersion: "1.0.2-draft", sourceSha256: H("a"), sourceFormat: "NATIVE",
  scope: { modality: "pregao", form: "eletronica", platform: "bll" }, inventory: { sha256: H("b"), inputsTotal: 160, controlOnlyInputs: 3, conditionTypes: 12 },
};
const expected: ExpectedCandidateProvenance = { revisionId: "tr1", revisionSemanticHash: H("c"), input };

function decision(over: Partial<ImportProvenanceInput> = {}, ctx: { revisionSemanticHash?: string; org?: number; subjectId?: string; revision?: number; evidence?: string[] } = {}): InstitutionalDecision {
  return {
    id: "d1", organizationId: ctx.org ?? 7, subjectType: IMPORT_PROVENANCE_SUBJECT, subjectId: ctx.subjectId ?? "tr1", decisionType: IMPORT_PROVENANCE_DECISION_TYPE, outcome: IMPORT_PROVENANCE_OUTCOME,
    revision: ctx.revision ?? 1, supersedesDecisionId: null, decidedByName: "n", decidedByRole: "r", decidedByUserId: null, decidedAt: "2026-10-13", basisReference: "b", reason: "r",
    evidence: ctx.evidence ?? encodeImportProvenance({ ...input, ...over }, { revisionSemanticHash: ctx.revisionSemanticHash ?? H("c"), recordedAt: "2026-10-13T00:00:00.000Z" }),
    recordedByUserId: 1, authorityValidation: {} as never, correlationId: "c", idempotencyKey: "k", requestHash: H("d"),
  } as InstitutionalDecision;
}

describe("evaluateCandidateProvenance", () => {
  it("ABSENT sem decisões; CORRECT quando todos os campos conferem", () => {
    expect(evaluateCandidateProvenance(expected, [], 7)).toMatchObject({ state: "ABSENT", versions: 0 });
    expect(evaluateCandidateProvenance(expected, [decision()], 7)).toMatchObject({ state: "CORRECT", versions: 1, diffs: [] });
  });
  it.each<[string, Partial<ImportProvenanceInput>]>([
    ["templateKey", { templateKey: "OUTRO_MODELO" }], ["displayName", { displayName: "Outro" }], ["sourceLogicalVersion", { sourceLogicalVersion: "1.0.1" }],
    ["sourceSha256", { sourceSha256: H("e") }], ["sourceFormat", { sourceFormat: "MARKDOWN_IMPORT" }], ["scope.platform", { scope: { modality: "pregao", form: "eletronica", platform: "licitanet" } }],
    ["scope.regime", { scope: { modality: "pregao", form: "eletronica", platform: "bll", regime: "fornecimento" } }], ["inventory.sha256", { inventory: { ...input.inventory!, sha256: H("f") } }],
    ["inventory.conditionTypes", { inventory: { ...input.inventory!, conditionTypes: 13 } }], ["inventory", { inventory: undefined }],
  ])("DIVERGENT quando %s difere", (field, over) => {
    const r = evaluateCandidateProvenance(expected, [decision(over)], 7);
    expect(r.state).toBe("DIVERGENT");
    expect(r.diffs.map((d) => d.field)).toContain(field);
  });
  it("DIVERGENT quando a procedência é de OUTRO conteúdo (hash semântico diferente, p.ex. o da Revisão 1)", () => {
    expect(evaluateCandidateProvenance(expected, [decision({}, { revisionSemanticHash: H("9") })], 7).diffs.map((d) => d.field)).toEqual(["revisionSemanticHash"]);
  });
  it("MALFORMED: ilegível, de outro tenant ou de outro assunto (nunca tratado como ausente)", () => {
    expect(evaluateCandidateProvenance(expected, [decision({}, { evidence: ["lixo=1"] })], 7).state).toBe("MALFORMED");
    expect(evaluateCandidateProvenance(expected, [decision({}, { org: 8 })], 7).state).toBe("MALFORMED");
    expect(evaluateCandidateProvenance(expected, [decision({}, { subjectId: "tr-outra" })], 7).state).toBe("MALFORMED");
  });
  it("só a versão CORRENTE decide: regularização humana (v2 correta) supera a v1 divergente; o histórico é preservado", () => {
    const v1 = decision({ sourceSha256: H("e") }, { revision: 1 }); const v2 = decision({}, { revision: 2 });
    expect(evaluateCandidateProvenance(expected, [v1, v2], 7)).toMatchObject({ state: "CORRECT", versions: 2 });
    expect(evaluateCandidateProvenance(expected, [v2, v1], 7).state).toBe("DIVERGENT");
  });
  it("diffImportProvenance é vazio para procedência equivalente e nomeia o campo esperado × encontrado", () => {
    const ok = evaluateCandidateProvenance(expected, [decision()], 7);
    expect(ok.diffs).toEqual([]);
    const d = diffImportProvenance(expected, { decisionId: "d", revisionId: "tr1", templateKey: "X", displayName: input.displayName, sourceLogicalVersion: input.sourceLogicalVersion, sourceSha256: input.sourceSha256, sourceFormat: "NATIVE", revisionSemanticHash: H("c"), recordedByUserId: 1, recordedAt: "t", inventory: input.inventory!, scope: input.scope });
    expect(d).toEqual([{ field: "templateKey", expected: "EDITAL_PREGAO_ELETRONICO_BLL", actual: "X" }]);
  });
});
