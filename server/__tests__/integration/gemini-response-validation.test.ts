/**
 * Fronteira de validação da resposta do provider (server/services/gemini.ts).
 *
 * Nenhuma das 7 funções de geração documental pode considerar sucesso um texto
 * vazio, só-espaços, ou ausência de candidato — mesmo quando o provider "respondeu"
 * sem lançar exceção. Testa a lógica pura (extractValidatedText), sem chamar o SDK.
 */

import { describe, it, expect } from "vitest";
import type { GenerateContentResult } from "@google/generative-ai";
import { extractValidatedText } from "../../services/gemini";

function fakeResult(opts: { candidates?: unknown[]; text: string }): GenerateContentResult {
  return {
    response: {
      candidates: opts.candidates,
      text: () => opts.text,
    },
  } as unknown as GenerateContentResult;
}

describe("gemini.ts · extractValidatedText — fronteira do provider", () => {
  it("aceita texto não-vazio com candidato presente", () => {
    const result = fakeResult({ candidates: [{}], text: "# Estudo Técnico Preliminar\n\nConteúdo real." });
    expect(extractValidatedText(result, "ETP")).toBe("# Estudo Técnico Preliminar\n\nConteúdo real.");
  });

  it("rejeita ausência de candidato (resposta bloqueada/sem conteúdo utilizável)", () => {
    const result = fakeResult({ candidates: undefined, text: "" });
    expect(() => extractValidatedText(result, "ETP")).toThrow(/não retornou conteúdo/);
  });

  it("rejeita candidates: [] (array vazio, mesmo com texto não-nulo)", () => {
    const result = fakeResult({ candidates: [], text: "algo" });
    expect(() => extractValidatedText(result, "TR")).toThrow(/não retornou conteúdo/);
  });

  it("rejeita texto vazio mesmo com candidato presente ('sucesso' vazio)", () => {
    const result = fakeResult({ candidates: [{}], text: "" });
    expect(() => extractValidatedText(result, "DFD")).toThrow(/conteúdo vazio/);
  });

  it("rejeita texto só-espaços/quebras de linha (equivalente a vazio)", () => {
    const result = fakeResult({ candidates: [{}], text: "   \n\n\t  " });
    expect(() => extractValidatedText(result, "Edital")).toThrow(/conteúdo vazio/);
  });

  it("a mensagem de erro identifica o tipo documental (Ata/Parecer inclusos)", () => {
    expect(() => extractValidatedText(fakeResult({ candidates: [{}], text: "" }), "Ata")).toThrow(/Ata/);
    expect(() => extractValidatedText(fakeResult({ candidates: [{}], text: "" }), "Parecer")).toThrow(/Parecer/);
  });
});
