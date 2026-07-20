/**
 * Configuração de IA — provider/modelo primários dirigidos por ENV (preparação multi-provider).
 * Garante o default Gemini 2.5 Flash e a possibilidade de escolher provider/modelo por ambiente.
 */

import { describe, it, expect } from "vitest";
import { resolveAiRuntime, validateAiRuntime, DEFAULT_MODEL_BY_PROVIDER, KNOWN_DEAD_MODEL_IDS } from "../../config/ai";
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

describe("Config de IA — validateAiRuntime (guarda de boot, sem allowlist rígida)", () => {
  it("aceita o runtime default (gemini + gemini-flash-latest)", () => {
    expect(() => validateAiRuntime(resolveAiRuntime({}))).not.toThrow();
  });

  it("aceita qualquer modelo Gemini com o formato esperado, mesmo um NUNCA visto antes (não é allowlist)", () => {
    expect(() => validateAiRuntime({ provider: "gemini", model: "gemini-3.0-flash-hipotetico" })).not.toThrow();
  });

  it("rejeita modelo vazio", () => {
    expect(() => validateAiRuntime({ provider: "gemini", model: "" })).toThrow(/vazio/);
    expect(() => validateAiRuntime({ provider: "gemini", model: "   " })).toThrow(/vazio/);
  });

  it("rejeita o incidente que originou esta guarda: gemini-2.0-flash-exp (descontinuado)", () => {
    expect(KNOWN_DEAD_MODEL_IDS.has("gemini-2.0-flash-exp")).toBe(true);
    expect(() => validateAiRuntime({ provider: "gemini", model: "gemini-2.0-flash-exp" })).toThrow(/DESCONTINUADO/);
  });

  it("rejeita formato incompatível com o provider (ex.: modelo Claude sob provider gemini)", () => {
    expect(() => validateAiRuntime({ provider: "gemini", model: "claude-sonnet-4-5" })).toThrow(/formato esperado/);
  });

  it("aceita formatos válidos de claude/openai quando esses providers estiverem ativos", () => {
    expect(() => validateAiRuntime({ provider: "claude", model: DEFAULT_MODEL_BY_PROVIDER.claude })).not.toThrow();
    expect(() => validateAiRuntime({ provider: "openai", model: DEFAULT_MODEL_BY_PROVIDER.openai })).not.toThrow();
  });
});
