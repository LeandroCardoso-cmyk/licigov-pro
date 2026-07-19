/**
 * Gemini — desligar "thinking" nos modelos Flash 2.5 (evita truncar a resposta + reduz custo).
 */

import { describe, it, expect } from "vitest";
import { shouldDisableThinking } from "../../_core/ai/gemini";

describe("Gemini · thinking budget", () => {
  it("desliga o thinking nos Flash 2.5 (padrão atual)", () => {
    expect(shouldDisableThinking("gemini-flash-latest")).toBe(true);
    expect(shouldDisableThinking("gemini-2.5-flash")).toBe(true);
    expect(shouldDisableThinking("gemini-2.5-flash-preview-09-2025")).toBe(true);
  });

  it("NÃO aplica em modelos que não suportam thinkingBudget:0 (Pro / 2.0)", () => {
    expect(shouldDisableThinking("gemini-2.5-pro")).toBe(false);
    expect(shouldDisableThinking("gemini-pro-latest")).toBe(false);
    expect(shouldDisableThinking("gemini-2.0-flash")).toBe(false);
  });
});
