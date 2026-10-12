/**
 * Config de geração dos documentos legados (server/services/gemini.ts): sem parâmetros de amostragem
 * descontinuados pelo Google (temperature/topP/topK) e sem thinkingBudget em modelos 3.x.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/ai", () => ({ AI_CONFIG: { model: "gemini-3.8-flash", geminiApiKey: "k", timeoutMs: 1000 } }));
vi.mock("../../services/rag", () => ({ retrieveRelevantLaw: vi.fn(), formatRetrievedContext: vi.fn() }));
vi.mock("../../services/platformTemplates", () => ({ getPlatformInstructions: vi.fn() }));

import { buildDocGenerationConfig } from "../../services/gemini";
import { shouldDisableThinking, THINKING_DISABLE_COMPATIBLE_MODELS } from "../../_core/ai/gemini";

describe("buildDocGenerationConfig", () => {
  it.each([8192, 4096, 6144])("não envia temperature, topP nem topK (maxOutputTokens=%i)", (n) => {
    const cfg = buildDocGenerationConfig(n) as Record<string, unknown>;
    expect(cfg.maxOutputTokens).toBe(n);
    expect(cfg).not.toHaveProperty("temperature");
    expect(cfg).not.toHaveProperty("topP");
    expect(cfg).not.toHaveProperty("topK");
  });

  it("modelo padrão 3.x não recebe thinkingConfig (thinking padrão do modelo)", () => {
    expect(buildDocGenerationConfig(8192)).not.toHaveProperty("thinkingConfig");
  });

  it("nenhum modelo 3.x está na lista legada de thinkingBudget", () => {
    for (const id of THINKING_DISABLE_COMPATIBLE_MODELS) expect(id).toMatch(/^gemini-2\.5-/);
    expect(shouldDisableThinking("gemini-3.8-flash")).toBe(false);
  });
});
