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
import { AI_CONFIG, AI_ALLOW_MOCK_FALLBACK, mockFallbackAllowed } from "../../config/ai";
import { IS_DEVELOPMENT, ENV_TAG } from "../../config/env";
import type { ProviderName } from "./executionPolicy";
import type { AIProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { MockAIProvider } from "./mockProvider";

/**
 * AI-015 — Falha controlada quando nenhum provider de IA REAL está disponível e o fallback para mock
 * NÃO é permitido (staging/production, ou dev/test sem a flag). Interrompe a execução em vez de
 * servir uma resposta mock como oficial. Capturada pelos Business Domains (ex.: answerConsultation),
 * que registram a consulta como `failed` e NÃO persistem resposta oficial.
 */
export class NoRealAIProviderError extends Error {
  readonly code = "NO_REAL_AI_PROVIDER";
  constructor(message: string) { super(message); this.name = "NoRealAIProviderError"; }
}
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
 * Seleciona o provider seguindo a AI Execution Policy: tenta o preferido, depois o fallback REAL.
 * A decisão de provider vive AQUI — jamais nos Business Domains. Providers não implementados
 * (claude/openai) são pulados na seleção automática (mas continuam resolvíveis como contrato).
 *
 * AI-015 — FAIL-CLOSED: se nenhum provider real puder ser construído, o fallback para o mock só é
 * usado quando `mockFallbackAllowed` (dev/test + `AI_ALLOW_MOCK_FALLBACK=true`). Caso contrário
 * (staging/production, ou sem a flag), lança `NoRealAIProviderError` em vez de servir mock como
 * oficial. Um erro de RUNTIME do provider real (ex.: `generate()` falhando) NÃO é tratado aqui —
 * propaga para o chamador, jamais caindo para o mock.
 */
export function selectProvider(preferred: ProviderName, fallback: ProviderName): ProviderResolution {
  if (isProviderImplemented(preferred)) {
    try {
      return { provider: resolveProviderByName(preferred), selected: preferred, requested: preferred, usedFallback: false };
    } catch {
      /* provider preferido não pôde ser CONSTRUÍDO (ex.: chave ausente) — tenta o fallback real */
    }
  }
  if (isProviderImplemented(fallback)) {
    try {
      return { provider: resolveProviderByName(fallback), selected: fallback, requested: preferred, usedFallback: true };
    } catch {
      /* fallback real também indisponível */
    }
  }
  if (mockFallbackAllowed({ isDevelopment: IS_DEVELOPMENT, allowMockFlag: AI_ALLOW_MOCK_FALLBACK })) {
    return { provider: mockProvider(), selected: "mock", requested: preferred, usedFallback: true };
  }
  throw new NoRealAIProviderError(
    `Nenhum provider de IA real disponível (preferido=${preferred}, fallback=${fallback}) e o fallback ` +
    `para mock é proibido em ${ENV_TAG}. Configure a credencial do provider ` +
    `(${preferred === "gemini" ? "GEMINI_API_KEY" : preferred.toUpperCase() + "_API_KEY"}). ` +
    `O mock só é permitido em desenvolvimento/teste com AI_ALLOW_MOCK_FALLBACK=true.`
  );
}

export const ALL_PROVIDER_NAMES: ProviderName[] = Object.keys(PROVIDER_ADAPTERS) as ProviderName[];
