/**
 * RC-3.5.1 — Provider Adapter (componente PERMANENTE do Cognitive Kernel).
 *
 * ÚNICA porta de acesso aos modelos de IA e ÚNICO ponto que instancia providers:
 *   AIExecutionEngine → Provider Adapter → Gemini | Claude | OpenAI | Mock | Future
 *
 * Regras:
 * - Nenhum outro componente instancia providers diretamente.
 * - Gemini e Mock são implementados; Claude/OpenAI existem como contratos
 *   (placeholders) que lançam ProviderNotImplemented se usados.
 * - Toda seleção de provider ocorre aqui (via AI Execution Policy) — nunca nos domínios.
 * - Mantém compatibilidade: getActiveProvider/setActiveProvider (reexportados por
 *   `provider.ts` como getProvider/setProvider) alimentam invokeLLM/generateText.
 */

import { ENV } from "../env";
import { AI_CONFIG } from "../../config/ai";
import type { ProviderName } from "./executionPolicy";
import type { AIProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { MockAIProvider } from "./mockProvider";
import { ClaudeProvider, OpenAIProvider } from "./placeholderProviders";

export interface ProviderAdapterInfo {
  readonly name: ProviderName;
  /** true → adaptador implementado e utilizável; false → contrato preparado (Future Evolution). */
  readonly implemented: boolean;
  readonly description: string;
}

/** Registro oficial dos adaptadores de provider. */
export const PROVIDER_ADAPTERS: Record<ProviderName, ProviderAdapterInfo> = {
  gemini: { name: "gemini", implemented: true, description: "Google Gemini — provider canônico ativo (via @google/generative-ai)." },
  mock:   { name: "mock",   implemented: true, description: "Provider determinístico para testes e fallback offline." },
  claude: { name: "claude", implemented: false, description: "Anthropic Claude — contrato preparado (Future Evolution)." },
  openai: { name: "openai", implemented: false, description: "OpenAI — contrato preparado (Future Evolution)." },
};

// ─── Provider ativo (singleton) — ÚNICO ponto de instanciação do Gemini ───────

let _active: AIProvider | null = null;
let _mock: MockAIProvider | null = null;

function mockProvider(): MockAIProvider {
  if (!_mock) _mock = new MockAIProvider();
  return _mock;
}

/**
 * Constrói o provider PRIMÁRIO conforme a configuração (AI_PROVIDER/AI_MODEL). Gemini está
 * implementado; Claude/OpenAI têm contrato preparado (lançam ProviderNotImplemented se usados) —
 * ativar cada um é implementar seu adaptador, sem tocar nos Business Domains.
 */
function buildPrimaryProvider(): AIProvider {
  switch (AI_CONFIG.provider) {
    case "claude":
      return new ClaudeProvider();
    case "openai":
      return new OpenAIProvider();
    case "gemini":
    default:
      return new GeminiProvider(ENV.geminiApiKey, AI_CONFIG.model);
  }
}

/** Provider primário ativo (definido por AI_PROVIDER/AI_MODEL). Pode ser trocado em testes via setActiveProvider. */
export function getActiveProvider(): AIProvider {
  if (!_active) _active = buildPrimaryProvider();
  return _active;
}

/** Substitui o provider ativo (testes / troca em runtime). */
export function setActiveProvider(provider: AIProvider | null): void {
  _active = provider;
}

export function isProviderImplemented(name: ProviderName): boolean {
  return PROVIDER_ADAPTERS[name]?.implemented ?? false;
}

/**
 * Resolve o AIProvider concreto para um provider nomeado. Único lugar autorizado a
 * instanciar/entregar providers.
 * - `gemini` → provider canônico ativo.
 * - `mock`   → provider determinístico.
 * - `claude`/`openai` → contrato preparado (lança ProviderNotImplemented se usado).
 */
export function resolveProviderByName(name: ProviderName): AIProvider {
  switch (name) {
    case "gemini":
      return getActiveProvider();
    case "mock":
      return mockProvider();
    case "claude":
      return new ClaudeProvider();
    case "openai":
      return new OpenAIProvider();
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
 * jamais nos Business Domains. Providers não implementados (claude/openai) são
 * pulados na seleção automática (mas continuam resolvíveis como contrato).
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
