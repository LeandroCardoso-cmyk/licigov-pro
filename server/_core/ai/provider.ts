import { ENV } from "../env";
import { GeminiProvider } from "./gemini";
import type { AIProvider } from "./types";

// Singleton — swap this export to change the active provider globally.
// Future: select provider via ENV.AI_PROVIDER ("gemini" | "openai" | "llama")
let _provider: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (!_provider) {
    _provider = new GeminiProvider(ENV.geminiApiKey);
  }
  return _provider;
}

/** Replace the active provider (useful in tests or for runtime switching). */
export function setProvider(provider: AIProvider): void {
  _provider = provider;
}

export type { AIProvider };
export type { AIGenerateOptions, AIGenerateResult, AIMessage, AITool } from "./types";
