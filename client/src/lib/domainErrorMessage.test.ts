import { describe, it, expect } from "vitest";
import { domainErrorMessage } from "./domainErrorMessage";

describe("domainErrorMessage", () => {
  it("remove o código estável e mantém a frase institucional", () => {
    expect(domainErrorMessage("PLANNED_QUANTITY_REQUIRED: Defina a quantidade prevista dos itens antes de gerar o Edital.", "x"))
      .toBe("Defina a quantidade prevista dos itens antes de gerar o Edital.");
  });
  it("mensagem sem código fica intacta; vazia ⇒ fallback", () => {
    expect(domainErrorMessage("Falha de rede", "x")).toBe("Falha de rede");
    expect(domainErrorMessage("", "Falha ao gerar o TR.")).toBe("Falha ao gerar o TR.");
    expect(domainErrorMessage(undefined, "Falha ao gerar o TR.")).toBe("Falha ao gerar o TR.");
  });
  it("LICIGOV-FAST S3: falta de informação nos Itens mostra só a orientação (geração e emissão por modelo)", () => {
    const gen = "TEMPLATE_SOURCE_UNAVAILABLE: ITEMS — CANONICAL_ITEMS_REQUIRED: Ainda não existem itens cadastrados para esta contratação. Cadastre-os em Itens da contratação.";
    expect(domainErrorMessage(gen, "x")).toBe("Ainda não existem itens cadastrados para esta contratação. Cadastre-os em Itens da contratação.");
    const issue = "TEMPLATE_ISSUANCE_BLOCKED: SOURCE_UNAVAILABLE — ITEMS — PLANNED_QUANTITY_MISSING: A quantidade prevista precisa ser informada em Itens da contratação (2 item(ns) sem quantidade prevista ou com registros divergentes).";
    expect(domainErrorMessage(issue, "x")).toMatch(/^A quantidade prevista precisa ser informada em Itens da contratação/);
  });
  it("LICIGOV-FAST S3: falha técnica/integridade/escopo NÃO vira pendência do usuário", () => {
    expect(domainErrorMessage("TEMPLATE_SOURCE_UNAVAILABLE: ITEMS — PROCESS_NOT_FOUND: processo inexistente nesta organização", "x"))
      .toBe("ITEMS — PROCESS_NOT_FOUND: processo inexistente nesta organização");
    expect(domainErrorMessage("TEMPLATE_SOURCE_UNAVAILABLE: GOVERNED_FIELDS — EVIDENCE_CORRUPT: o registro não passa na verificação de integridade", "x"))
      .toMatch(/EVIDENCE_CORRUPT/);
    // O caminho legado (sem modelo) já traz a frase institucional após o código — inalterado.
    expect(domainErrorMessage('CANONICAL_ITEMS_REQUIRED: cadastre os "Itens da contratação" com a quantidade prevista antes de gerar o Edital.', "x"))
      .toBe('cadastre os "Itens da contratação" com a quantidade prevista antes de gerar o Edital.');
  });
});
