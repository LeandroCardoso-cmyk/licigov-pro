/**
 * RC-3.5.1 — Compatibilidade da camada de provider.
 *
 * O ÚNICO ponto de instanciação/seleção de providers é o Provider Adapter
 * (`providerAdapter.ts`). Este módulo apenas reexporta o provider ativo para
 * manter compatibilidade com `invokeLLM`/`generateText` (llm.ts) e testes:
 *   getProvider = provider canônico ativo (Gemini) via Provider Adapter.
 */

import { getActiveProvider, setActiveProvider } from "./providerAdapter";
import type { AIProvider } from "./types";

/** Provider canônico ativo, resolvido exclusivamente pelo Provider Adapter. */
export function getProvider(): AIProvider {
  return getActiveProvider();
}

/** Substitui o provider ativo (útil em testes ou troca em runtime). */
export function setProvider(provider: AIProvider): void {
  setActiveProvider(provider);
}

export type { AIProvider };
export type { AIGenerateOptions, AIGenerateResult, AIMessage, AITool } from "./types";
