/**
 * R5 / R5.1 — guard transversal de hidratação (INV-05): funções puras de `formHydration`.
 */
import { describe, it, expect } from "vitest";
import { buildSavePatch, hydrateFormState, hydrationKey } from "./formHydration";

const EMPTY = { report: "", conclusionType: "" };

describe("formHydration (R5.1)", () => {
  it("hidrata a partir do PERSISTIDO; ausente ⇒ vazio neutro (nunca default decisório)", () => {
    expect(hydrateFormState(null, EMPTY)).toEqual(EMPTY);
    expect(hydrateFormState({ report: "Relatório salvo", conclusionType: null }, EMPTY)).toEqual({ report: "Relatório salvo", conclusionType: "" });
    expect(hydrateFormState({ conclusionType: "desfavoravel" }, EMPTY)).toEqual({ report: "", conclusionType: "desfavoravel" });
  });

  it("patch só com campos alterados e não vazios: salvar em branco nunca apaga", () => {
    const server = { report: "Relatório salvo", conclusionType: "favoravel" };
    expect(buildSavePatch(server, { report: "", conclusionType: "favoravel" })).toEqual({});
    expect(buildSavePatch(server, { report: "   ", conclusionType: "desfavoravel" })).toEqual({ conclusionType: "desfavoravel" });
    expect(buildSavePatch(server, { ...server })).toEqual({});
    expect(buildSavePatch(null, { report: "Novo", conclusionType: "" })).toEqual({ report: "Novo" });
  });

  it("chave muda com a versão persistida (re-hidrata após outra pessoa salvar)", () => {
    expect(hydrationKey("ws", 1, null)).toBe("ws|1|∅");
    expect(hydrationKey("ws", 1)).not.toBe(hydrationKey("ws", 2));
  });
});
