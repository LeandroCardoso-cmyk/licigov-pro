/**
 * Configuração de IA — provider/modelo primários dirigidos por ENV (preparação multi-provider).
 * Garante o default Gemini 2.5 Flash e a possibilidade de escolher provider/modelo por ambiente.
 */

import { describe, it, expect } from "vitest";
import { resolveAiRuntime, DEFAULT_MODEL_BY_PROVIDER } from "../../config/ai";
import { getCognitiveTask } from "../../domain/cognitiveTask";

describe("Config de IA — resolução de provider/modelo por ENV", () => {
  it("default: gemini + gemini-flash-latest (alias auto-atualizável)", () => {
    expect(resolveAiRuntime({})).toEqual({ provider: "gemini", model: "gemini-flash-latest" });
  });

  it("AI_PROVIDER=claude → claude + modelo padrão do claude", () => {
    expect(resolveAiRuntime({ AI_PROVIDER: "claude" })).toEqual({ provider: "claude", model: DEFAULT_MODEL_BY_PROVIDER.claude });
  });

  it("AI_PROVIDER=openai → openai + modelo padrão do openai", () => {
    expect(resolveAiRuntime({ AI_PROVIDER: "openai" })).toEqual({ provider: "openai", model: DEFAULT_MODEL_BY_PROVIDER.openai });
  });

  it("AI_MODEL sobrescreve o modelo padrão (ex.: escolher um Gemini melhor)", () => {
    expect(resolveAiRuntime({ AI_MODEL: "gemini-2.5-pro" })).toEqual({ provider: "gemini", model: "gemini-2.5-pro" });
  });

  it("provider desconhecido cai em gemini; AI_MODEL em branco usa o default", () => {
    expect(resolveAiRuntime({ AI_PROVIDER: "xpto", AI_MODEL: "  " })).toEqual({ provider: "gemini", model: "gemini-flash-latest" });
  });

  it("case-insensitive e com trim", () => {
    expect(resolveAiRuntime({ AI_PROVIDER: " Claude " })).toEqual({ provider: "claude", model: DEFAULT_MODEL_BY_PROVIDER.claude });
  });
});

describe("Config de IA — políticas cognitivas usam o modelo configurado", () => {
  it("LEGAL_ANALYSIS deixa de usar gemini-2.5-pro e usa o modelo primário (gemini-flash-latest por padrão)", () => {
    expect(getCognitiveTask("LEGAL_ANALYSIS").policy.model).toBe("gemini-flash-latest");
  });
});
