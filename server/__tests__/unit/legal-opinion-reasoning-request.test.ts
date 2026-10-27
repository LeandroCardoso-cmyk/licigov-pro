/**
 * Pedido ao Copiloto Jurídico do parecer: partes ausentes são omitidas — nunca "referente ao processo " vazio — e (M8) a origem
 * entra pelo RÓTULO humano resolvido no tenant, nunca pelo id técnico do workspace de origem como se fosse número de processo.
 */
import { describe, expect, it } from "vitest";
import { opinionReasoningRequest } from "../../services/legalOpinionWorkspaceService";
import { opinionReferenceLabel } from "../../services/legalOpinionReference";

describe("opinionReasoningRequest", () => {
  it("com origem identificada inclui o rótulo humano", () => {
    expect(opinionReasoningRequest({ requestId: "req-1", requestType: "parecer_inicial", referenceLabel: "Processo nº 2026/0012" }))
      .toBe("Analisar juridicamente a solicitação req-1 (parecer_inicial) referente a Processo nº 2026/0012, com base na Lei 14.133/2021.");
  });
  it("sem origem identificada (parecer avulso / origem ilegível) omite a cláusula, sem presumir nada", () => {
    const t = opinionReasoningRequest({ requestId: "req-2", requestType: "parecer", referenceLabel: "  " });
    expect(t).toBe("Analisar juridicamente a solicitação req-2 (parecer), com base na Lei 14.133/2021.");
    expect(t).not.toMatch(/referente/);
  });
  it("sem solicitação nem tipo ⇒ texto coerente com o tipo padrão", () => {
    expect(opinionReasoningRequest({})).toBe("Analisar juridicamente a solicitação (parecer), com base na Lei 14.133/2021.");
  });
});

describe("opinionReferenceLabel — origem legível, sem inventar processo", () => {
  it("contrato vinculado a processo licitatório ⇒ contrato + número do processo de origem", () => {
    expect(opinionReferenceLabel({ sourceDomain: "contratos", contract: { contractNumber: "CT-12/2026", originType: "processo_licitatorio" }, originProcessNumber: "1461/2026" }))
      .toBe("Contrato nº CT-12/2026 — Processo nº 1461/2026");
  });
  it("contrato de contratação direta ⇒ contrato + número da contratação direta", () => {
    expect(opinionReferenceLabel({ sourceDomain: "contratos", contract: { contractNumber: "CT-3", originType: "contratacao_direta" }, originProcessNumber: "DL-7/2026" }))
      .toBe("Contrato nº CT-3 — Contratação direta nº DL-7/2026");
  });
  it("contrato legado/externo/avulso (sem processo no sistema) ⇒ só o contrato; nunca o id técnico", () => {
    for (const originType of ["legado", "externo", "avulso"]) {
      expect(opinionReferenceLabel({ sourceDomain: "contratos", contract: { contractNumber: "CT-HV-1461", originType }, originProcessNumber: null }))
        .toBe("Contrato nº CT-HV-1461");
    }
  });
  it("referência inválida ou ausente ⇒ null (ausência declarada)", () => {
    expect(opinionReferenceLabel({ sourceDomain: "contratos", contract: null })).toBeNull();
    expect(opinionReferenceLabel({ sourceDomain: "contratos", contract: { contractNumber: "  ", originType: "legado" } })).toBeNull();
    expect(opinionReferenceLabel({ sourceDomain: "processo_licitatorio", procurementProcessNumber: null })).toBeNull();
    expect(opinionReferenceLabel({ sourceDomain: "gestao_departamento" })).toBeNull();
    expect(opinionReferenceLabel({ sourceDomain: null })).toBeNull();
  });
  it("processo licitatório e contratação direta como origem direta", () => {
    expect(opinionReferenceLabel({ sourceDomain: "processo_licitatorio", procurementProcessNumber: "4256/2026" })).toBe("Processo nº 4256/2026");
    expect(opinionReferenceLabel({ sourceDomain: "contratacao_direta", directProcessNumber: "IN-2/2026" })).toBe("Contratação direta nº IN-2/2026");
  });
});
