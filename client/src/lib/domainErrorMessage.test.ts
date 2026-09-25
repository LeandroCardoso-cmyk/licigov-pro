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
});
