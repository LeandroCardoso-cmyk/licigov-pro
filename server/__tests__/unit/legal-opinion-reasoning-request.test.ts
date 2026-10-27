/** Pedido ao Copiloto Jurídico do parecer: partes ausentes são omitidas — nunca "referente ao processo " vazio. */
import { describe, expect, it } from "vitest";
import { opinionReasoningRequest } from "../../services/legalOpinionWorkspaceService";

describe("opinionReasoningRequest", () => {
  it("com processo vinculado inclui a referência", () => {
    expect(opinionReasoningRequest({ requestId: "req-1", requestType: "parecer_inicial", referenceProcessId: "2026/0012" }))
      .toBe("Analisar juridicamente a solicitação req-1 (parecer_inicial) referente ao processo 2026/0012, com base na Lei 14.133/2021.");
  });
  it("sem processo (parecer avulso) omite a cláusula, sem presumir nada", () => {
    const t = opinionReasoningRequest({ requestId: "req-2", requestType: "parecer", referenceProcessId: "  " });
    expect(t).toBe("Analisar juridicamente a solicitação req-2 (parecer), com base na Lei 14.133/2021.");
    expect(t).not.toMatch(/referente ao processo/);
  });
  it("sem solicitação nem tipo ⇒ texto coerente com o tipo padrão", () => {
    expect(opinionReasoningRequest({})).toBe("Analisar juridicamente a solicitação (parecer), com base na Lei 14.133/2021.");
  });
});
