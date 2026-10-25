/**
 * Gemini — desligar "thinking" apenas em IDs CONCRETOS compatíveis (RC-PR-B-001).
 *
 * Aliases móveis (ex.: `gemini-flash-latest`) são EXCLUÍDOS: podem resolver para um
 * modelo que rejeita `thinkingConfig` no SDK legado → 400 INVALID_ARGUMENT. O payload
 * enviado para o alias NÃO pode conter `thinkingConfig`; para um id concreto compatível,
 * deve conter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock do SDK legado: captura os args de getGenerativeModel e devolve um generateContent stub.
type CapturedModelConfig = { generationConfig?: Record<string, unknown> };
const captured: CapturedModelConfig[] = [];
vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: class {
      getGenerativeModel(cfg: CapturedModelConfig) {
        captured.push(cfg);
        return {
          generateContent: async () => ({
            response: {
              text: () => "OK",
              candidates: [{ content: { parts: [{ text: "OK" }] } }],
              usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
            },
          }),
        };
      }
    },
    HarmCategory: {
      HARM_CATEGORY_HARASSMENT: "HARM_CATEGORY_HARASSMENT",
      HARM_CATEGORY_HATE_SPEECH: "HARM_CATEGORY_HATE_SPEECH",
      HARM_CATEGORY_SEXUALLY_EXPLICIT: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      HARM_CATEGORY_DANGEROUS_CONTENT: "HARM_CATEGORY_DANGEROUS_CONTENT",
    },
    HarmBlockThreshold: { BLOCK_NONE: "BLOCK_NONE" },
  };
});

import { shouldDisableThinking, THINKING_DISABLE_COMPATIBLE_MODELS, GeminiProvider } from "../../_core/ai/gemini";

type GenerateOptions = Parameters<GeminiProvider["generate"]>[0];

describe("Gemini · thinking budget — apenas em IDs concretos compatíveis", () => {
  it("NÃO desliga thinking para aliases móveis (evita 400 INVALID_ARGUMENT)", () => {
    expect(shouldDisableThinking("gemini-flash-latest")).toBe(false);
    expect(shouldDisableThinking("gemini-pro-latest")).toBe(false);
  });

  it("desliga thinking apenas para IDs concretos do allowlist", () => {
    expect(shouldDisableThinking("gemini-2.5-flash")).toBe(true);
    expect(shouldDisableThinking("gemini-2.5-flash-preview-05-20")).toBe(true);
    // qualquer id fora do conjunto (inclusive previews não verificados) → false
    expect(shouldDisableThinking("gemini-2.5-flash-preview-09-2025")).toBe(false);
    expect(shouldDisableThinking("gemini-2.5-pro")).toBe(false);
    expect(shouldDisableThinking("gemini-2.0-flash")).toBe(false);
    expect(shouldDisableThinking("  gemini-2.5-flash  ")).toBe(true); // trim
  });

  it("o allowlist contém somente IDs concretos (sem aliases '-latest')", () => {
    for (const id of THINKING_DISABLE_COMPATIBLE_MODELS) {
      expect(id).not.toContain("latest");
    }
  });
});

describe("Gemini · payload de generateContent (thinkingConfig)", () => {
  beforeEach(() => { captured.length = 0; });

  async function generateWith(model: string) {
    const provider = new GeminiProvider("test-key", model);
    await provider.generate({
      messages: [{ role: "user", content: "Responda apenas: OK" }],
      maxTokens: 1500,
    } as GenerateOptions);
    // o último getGenerativeModel com generationConfig é o da chamada .generate()
    return captured[captured.length - 1];
  }

  it("payload para o ALIAS gemini-flash-latest NÃO contém thinkingConfig", async () => {
    const cfg = await generateWith("gemini-flash-latest");
    expect(cfg.generationConfig).toBeTruthy();
    expect(cfg.generationConfig.maxOutputTokens).toBe(1500);
    expect(cfg.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("payload para o ID concreto gemini-2.5-flash CONTÉM thinkingConfig:{thinkingBudget:0}", async () => {
    const cfg = await generateWith("gemini-2.5-flash");
    expect(cfg.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
});

// SEC-AUD-2026-10 — aviso do Google AI Studio (07/10/2026): `thinking_budget`, `temperature`, `top_p` e
// `top_k` são depreciados e os próximos modelos recusam a requisição (400) quando presentes. O modelo
// canônico (gemini-3.8-flash) não pode recebê-los; os modelos 2.x continuam com o comportamento anterior.
import { supportsCustomSampling } from "../../_core/ai/gemini";
import { buildDocGenerationConfig } from "../../services/gemini";
import { CANONICAL_GEMINI_MODEL } from "../../config/ai";

describe("Gemini · parâmetros de amostragem depreciados (temperature/topP/topK)", () => {
  it("só IDs concretos 1.x/2.x aceitam amostragem customizada", () => {
    expect(supportsCustomSampling("gemini-2.5-flash")).toBe(true);
    expect(supportsCustomSampling("gemini-2.0-flash")).toBe(true);
    expect(supportsCustomSampling("gemini-1.5-pro")).toBe(true);
    expect(supportsCustomSampling(CANONICAL_GEMINI_MODEL)).toBe(false);
    expect(supportsCustomSampling("gemini-3.8-flash")).toBe(false);
    expect(supportsCustomSampling("gemini-4-argon")).toBe(false);
    expect(supportsCustomSampling("gemini-flash-latest")).toBe(false);
    expect(supportsCustomSampling("gemini-2.5-flash-latest")).toBe(false);
  });

  it("geração documental no modelo canônico NÃO envia temperature/topP/topK nem thinkingConfig", () => {
    const cfg = buildDocGenerationConfig(8192, CANONICAL_GEMINI_MODEL) as Record<string, unknown>;
    expect(cfg).toEqual({ maxOutputTokens: 8192 });
  });

  it("geração documental em gemini-2.5-flash mantém amostragem + thinkingBudget:0 (comportamento anterior)", () => {
    const cfg = buildDocGenerationConfig(4096, "gemini-2.5-flash") as Record<string, unknown>;
    expect(cfg).toEqual({ temperature: 0.3, topP: 0.8, topK: 40, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } });
  });

  it("GeminiProvider.generate no modelo canônico não envia parâmetros depreciados", async () => {
    captured.length = 0;
    const provider = new GeminiProvider("test-key", CANONICAL_GEMINI_MODEL);
    await provider.generate({ messages: [{ role: "user", content: "OK" }], maxTokens: 100 } as GenerateOptions);
    const gc = captured[captured.length - 1].generationConfig ?? {};
    for (const k of ["temperature", "topP", "topK", "thinkingConfig"]) expect(gc).not.toHaveProperty(k);
  });
});
