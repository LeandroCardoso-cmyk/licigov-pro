/**
 * RC-3.5 — Mock AI Provider (determinístico).
 *
 * Implementação do contrato AIProvider sem chamadas externas. Usado em testes e
 * como último recurso do Provider Adapter quando nenhum provider real está
 * configurado. Saída determinística (replay-safe) via sha256.
 */

import { createHash } from "crypto";
import type { AIGenerateOptions, AIGenerateResult, AIProvider } from "./types";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateText(prompt: string): Promise<string> {
    return `mock:${sha256(prompt).slice(0, 24)}`;
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const joined = options.messages.map((m) => `${m.role}:${m.content}`).join("\n");
    const text = `mock:${sha256(joined).slice(0, 24)}`;
    const inputTokens = Math.ceil(joined.length / 4);
    return {
      text,
      finishReason: "stop",
      usage: { inputTokens, outputTokens: 8, totalTokens: inputTokens + 8 },
    };
  }
}
