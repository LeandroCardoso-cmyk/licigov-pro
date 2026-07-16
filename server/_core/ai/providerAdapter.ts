/**
 * RC-3.5 — Provider Adapter (componente PERMANENTE do Cognitive Kernel).
 *
 * Camada ÚNICA e agnóstica de resolução de provider:
 *   AIExecutionEngine → Provider Adapter → Gemini | Claude | OpenAI | Future
 *
 * Os Business Domains NUNCA falam diretamente com um provider — falam com o
 * AIExecutionEngine, que resolve o provider aqui a partir da AI Execution Policy.
 * Gemini é o provider canônico ativo; Claude/OpenAI ficam PREPARADOS como
 * adaptadores (Future Evolution) — a arquitetura existe, a implementação não.
 *
 * Consolidação: unifica o caminho `_core/ai` (invokeLLM/getProvider) sem remover
 * o suporte existente nem quebrar compatibilidade.
 */

import type { ProviderName } from "./executionPolicy";
import type { AIProvider } from "./types";
import { getProvider } from "./provider";
import { MockAIProvider } from "./mockProvider";

export interface ProviderAdapterInfo {
  readonly name: ProviderName;
  /** true → adaptador implementado e utilizável; false → preparado (Future Evolution). */
  readonly implemented: boolean;
  readonly description: string;
}

/** Registro oficial dos adaptadores de provider. */
export const PROVIDER_ADAPTERS: Record<ProviderName, ProviderAdapterInfo> = {
  gemini: { name: "gemini", implemented: true, description: "Google Gemini — provider canônico ativo (via @google/generative-ai)." },
  mock:   { name: "mock",   implemented: true, description: "Provider determinístico para testes e fallback offline." },
  claude: { name: "claude", implemented: false, description: "Anthropic Claude — adaptador preparado (Future Evolution)." },
  openai: { name: "openai", implemented: false, description: "OpenAI — adaptador preparado (Future Evolution)." },
};

let _mock: MockAIProvider | null = null;
function mockProvider(): MockAIProvider {
  if (!_mock) _mock = new MockAIProvider();
  return _mock;
}

export function isProviderImplemented(name: ProviderName): boolean {
  return PROVIDER_ADAPTERS[name]?.implemented ?? false;
}

/**
 * Resolve o AIProvider concreto para um provider nomeado.
 * - `gemini` → provider canônico ativo (getProvider()).
 * - `mock`   → provider determinístico.
 * - `claude`/`openai` → NÃO implementados nesta fase → lança (o Adapter faz fallback).
 */
export function resolveProviderByName(name: ProviderName): AIProvider {
  switch (name) {
    case "gemini":
      return getProvider();
    case "mock":
      return mockProvider();
    case "claude":
    case "openai":
      throw new Error(
        `Provider "${name}" ainda não implementado (Future Evolution). Adaptador preparado, sem execução.`
      );
    default:
      throw new Error(`Provider desconhecido: "${String(name)}".`);
  }
}

export interface ProviderResolution {
  readonly provider: AIProvider;
  readonly selected: ProviderName;
  readonly requested: ProviderName;
  readonly usedFallback: boolean;
}

/**
 * Seleciona o provider seguindo a AI Execution Policy: tenta o preferido, cai no
 * fallback e, por fim, no mock determinístico. A decisão de provider vive AQUI —
 * jamais nos Business Domains.
 */
export function selectProvider(preferred: ProviderName, fallback: ProviderName): ProviderResolution {
  if (isProviderImplemented(preferred)) {
    try {
      return { provider: resolveProviderByName(preferred), selected: preferred, requested: preferred, usedFallback: false };
    } catch {
      /* cai para o fallback */
    }
  }
  if (isProviderImplemented(fallback)) {
    try {
      return { provider: resolveProviderByName(fallback), selected: fallback, requested: preferred, usedFallback: true };
    } catch {
      /* cai para o mock */
    }
  }
  return { provider: mockProvider(), selected: "mock", requested: preferred, usedFallback: true };
}

export const ALL_PROVIDER_NAMES: ProviderName[] = Object.keys(PROVIDER_ADAPTERS) as ProviderName[];
