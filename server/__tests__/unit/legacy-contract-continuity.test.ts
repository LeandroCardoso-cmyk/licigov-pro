/**
 * Continuidade de contratos de processos legados — regras puras (sem I/O).
 * Declaração do usuário nunca vira verificação; término de vigência estruturado; histórico anterior rotulado.
 */
import { describe, it, expect } from "vitest";
import {
  DECLARED_OUTSIDE_SYSTEM, MAX_PRIOR_AMENDMENTS, buildPriorAmendmentRow, composeAddendumTerm, legacyRecordSourceReference,
  mergeLegacyRecordFields, validatePriorAmendments, type PriorAmendmentInput,
} from "../../domain/legacyContractContinuity";
import { buildAddendumTermContent, type AddendumData, type ContractHeader } from "../../domain/instrumentTerms";

describe("composeAddendumTerm", () => {
  it("sem data de término mantém o prazo digitado", () => {
    expect(composeAddendumTerm({ addendumType: "prazo", newTerm: " 12 meses " })).toEqual({ ok: true, newTerm: "12 meses" });
  });
  it("aditivo de prazo com término compõe texto auditável", () => {
    expect(composeAddendumTerm({ addendumType: "prazo", newTerm: "12 meses", newEndDate: "2027-03-31" })).toEqual({ ok: true, newTerm: "12 meses — término da vigência em 31/03/2027" });
    expect(composeAddendumTerm({ addendumType: "prazo", newEndDate: "2027-03-31" })).toEqual({ ok: true, newTerm: "Término da vigência em 31/03/2027" });
  });
  it("recusa término fora de aditivo de prazo, data inválida e texto longo demais", () => {
    expect(composeAddendumTerm({ addendumType: "valor", newEndDate: "2027-03-31" })).toEqual({ ok: false, issue: "END_DATE_ONLY_FOR_TERM_ADDENDUM" });
    expect(composeAddendumTerm({ addendumType: "prazo", newEndDate: "2027-02-30" })).toEqual({ ok: false, issue: "END_DATE_INVALID" });
    expect(composeAddendumTerm({ addendumType: "prazo", newTerm: "x".repeat(250), newEndDate: "2027-03-31" })).toEqual({ ok: false, issue: "TERM_TOO_LONG" });
  });
});

describe("validatePriorAmendments", () => {
  it("aceita lista vazia/indefinida e itens válidos", () => {
    expect(validatePriorAmendments(undefined)).toEqual([]);
    expect(validatePriorAmendments([{ type: "prazo", newTerm: "12 meses", signedOn: "2025-03-12" }])).toEqual([]);
  });
  it("aponta tipo, data, valor e excesso", () => {
    expect(validatePriorAmendments([{ type: "x" as never }])).toHaveLength(1);
    expect(validatePriorAmendments([{ type: "valor", signedOn: "2025-13-40" }])).toHaveLength(1);
    expect(validatePriorAmendments([{ type: "valor", newValue: -1 }])).toHaveLength(1);
    expect(validatePriorAmendments(Array.from({ length: MAX_PRIOR_AMENDMENTS + 1 }, () => ({ type: "prazo" as const })))).toHaveLength(1);
  });
});

describe("buildPriorAmendmentRow", () => {
  const input: PriorAmendmentInput = { type: "prazo", description: "Prorrogação por 12 meses", newTerm: "12 meses", signedOn: "2025-03-12", reference: "1º TA, publicado em 12/03/2025" };
  const base = { organizationId: 7, contractId: "ctr-1", sequence: 1, input, correlationId: "corr-1", createdAt: "2026-10-14 10:00:00.000" };
  it("linha finalizada, de origem externa, rotulada como DECLARADA e sem termo gerado", () => {
    const row = buildPriorAmendmentRow(base);
    expect(row).toMatchObject({ status: "finalizado", requestOrigin: "documento_externo", sequence: 1, addendumType: "prazo", documentReference: "1º TA, publicado em 12/03/2025" });
    expect(row.justification).toContain(DECLARED_OUTSIDE_SYSTEM);
    expect(row.justification).toContain("Assinado em 12/03/2025");
  });
  it("sem referência declarada usa o rótulo de declaração; id é determinístico (replay seguro)", () => {
    const a = buildPriorAmendmentRow({ ...base, input: { type: "valor", newValue: 100 } });
    expect(a.documentReference).toBe(DECLARED_OUTSIDE_SYSTEM);
    expect(buildPriorAmendmentRow(base).id).toBe(buildPriorAmendmentRow({ ...base, correlationId: "outra" }).id);
    expect(buildPriorAmendmentRow(base).id).not.toBe(buildPriorAmendmentRow({ ...base, sequence: 2 }).id);
  });
});

describe("mergeLegacyRecordFields", () => {
  const rec = { recordType: "processo_licitatorio_legado" as const, number: "45/2022", object: "Manutenção predial", modality: "Pregão Eletrônico" };
  it("reaproveita objeto e origem do registro quando o usuário não digitou", () => {
    expect(mergeLegacyRecordFields({}, rec)).toEqual({ object: "Manutenção predial", sourceReference: "Processo licitatório legado nº 45/2022 — Pregão Eletrônico", reused: ["object", "sourceReference"] });
  });
  it("o que o usuário digitou sempre prevalece", () => {
    expect(mergeLegacyRecordFields({ object: "Outro objeto", sourceReference: "Minha origem" }, rec)).toEqual({ object: "Outro objeto", sourceReference: "Minha origem", reused: [] });
  });
  it("registro sem número/modalidade gera origem enxuta", () => {
    expect(legacyRecordSourceReference({ recordType: "contrato_externo", number: "", modality: "" })).toBe("Contrato externo (cadastro rápido)");
  });
});

describe("termo aditivo — cláusula de alterações anteriores", () => {
  const c: ContractHeader = { contractNumber: "CT-1", contractor: "Fornecedor", object: "Objeto", term: "12 meses" };
  const a: AddendumData = { id: "a2", sequence: 2, addendumType: "prazo", justification: "Prorrogação", newValue: 0, newTerm: "24 meses", status: "finalizado" };
  it("sem histórico não há cláusula quinta", () => {
    expect(buildAddendumTermContent(c, a)).not.toContain("Das alterações anteriores");
  });
  it("histórico declarado sai rotulado; histórico do sistema não é rotulado como declarado", () => {
    const text = buildAddendumTermContent(c, a, [], [], [
      { sequence: 1, addendumType: "prazo", newTerm: "12 meses", newValue: 0, requestOrigin: "documento_externo" },
    ]);
    expect(text).toContain("Das alterações anteriores");
    expect(text).toContain("Termo Aditivo nº 1");
    expect(text).toContain("[DECLARADO pelo usuário — formalizado fora do sistema, não verificado]");
    const own = buildAddendumTermContent(c, a, [], [], [{ sequence: 1, addendumType: "prazo", newTerm: "12 meses", newValue: 0, requestOrigin: "interno" }]);
    expect(own).toContain("Termo Aditivo nº 1");
    expect(own).not.toContain("DECLARADO pelo usuário");
  });
});
