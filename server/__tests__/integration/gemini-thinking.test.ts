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
const captured: any[] = [];
vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: class {
      getGenerativeModel(cfg: any) {
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
    } as any);
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
