/**
 * Configuração de IA — provider e modelo primários, dirigidos por variáveis de ambiente.
 *
 * Preparado para MULTI-PROVIDER (Gemini | Claude | OpenAI): trocar de provider/modelo no futuro é
 * uma mudança de ENV, não de código. Hoje apenas Gemini está implementado; Claude/OpenAI têm o
 * contrato preparado (Provider Adapter) e passam a funcionar quando seus adaptadores forem ativados.
 *
 * ENV:
 *   AI_PROVIDER = gemini | claude | openai   (default: gemini)
 *   AI_MODEL    = id do modelo               (default: o modelo padrão do provider ativo)
 *   GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY
 */

export type AIProviderName = "gemini" | "claude" | "openai";

/** Modelo padrão de cada provider (custo-benefício atual; sobrescrevível por AI_MODEL). */
export const DEFAULT_MODEL_BY_PROVIDER: Record<AIProviderName, string> = {
  // Alias auto-atualizável: aponta sempre para o Flash estável atual — evita descontinuações de
  // versões específicas (ex.: gemini-2.5-flash saiu do free tier para contas novas). Se a sua conta
  // suportar outro modelo, defina AI_MODEL (use `pnpm ai:models` para listar os disponíveis).
  gemini: "gemini-flash-latest",
  claude: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
};

/** Resolve provider + modelo primários a partir do ambiente. Puro e determinístico (testável). */
export function resolveAiRuntime(env: { AI_PROVIDER?: string; AI_MODEL?: string }): {
  provider: AIProviderName;
  model: string;
} {
  const raw = (env.AI_PROVIDER ?? "gemini").trim().toLowerCase();
  const provider: AIProviderName = raw === "claude" || raw === "openai" ? raw : "gemini";
  const model = env.AI_MODEL && env.AI_MODEL.trim().length > 0 ? env.AI_MODEL.trim() : DEFAULT_MODEL_BY_PROVIDER[provider];
  return { provider, model };
}

/**
 * IDs de modelo CONFIRMADAMENTE descontinuados — cresce só com entradas confirmadas,
 * nunca precisa ser atualizada quando um modelo NOVO é lançado (não é allowlist).
 * O incidente que originou este arquivo: "gemini-2.0-flash-exp" (experimental,
 * descontinuado) ficou hardcoded em 2 serviços e todas as gerações falhavam.
 */
export const KNOWN_DEAD_MODEL_IDS: ReadonlySet<string> = new Set(["gemini-2.0-flash-exp"]);

/** Prefixo minimamente esperado do id do modelo, por provider (checagem leve de formato). */
const MODEL_ID_PREFIX_BY_PROVIDER: Record<AIProviderName, RegExp> = {
  gemini: /^gemini-/,
  claude: /^claude-/,
  openai: /^(gpt-|o1-|o3-|o4-)/,
};

/**
 * Valida o runtime de IA resolvido — chamada no boot (server/bootstrap.ts), NÃO em
 * cada request. Pura e testável. NÃO é allowlist rígida (não valida contra uma lista
 * de modelos "permitidos", que ficaria obsoleta a cada lançamento) — apenas: (1) modelo
 * não vazio, (2) formato minimamente plausível para o provider, (3) não está na
 * denylist de modelos confirmadamente mortos. Lança erro descritivo no boot em vez de
 * deixar a primeira geração de documento falhar silenciosamente em produção.
 */
export function validateAiRuntime(runtime: { provider: AIProviderName; model: string }): void {
  const model = runtime.model.trim();
  if (!model) {
    throw new Error(
      `[BOOT] AI_MODEL resolvido para o provider "${runtime.provider}" está vazio. Defina AI_MODEL ou verifique DEFAULT_MODEL_BY_PROVIDER.`
    );
  }
  if (KNOWN_DEAD_MODEL_IDS.has(model)) {
    throw new Error(
      `[BOOT] AI_MODEL="${model}" é um modelo CONHECIDAMENTE DESCONTINUADO. Defina AI_MODEL com um modelo ativo ` +
      `(ex.: "${DEFAULT_MODEL_BY_PROVIDER[runtime.provider]}") — use \`pnpm ai:models\` para listar os disponíveis.`
    );
  }
  const expectedPrefix = MODEL_ID_PREFIX_BY_PROVIDER[runtime.provider];
  if (!expectedPrefix.test(model)) {
    throw new Error(
      `[BOOT] AI_MODEL="${model}" não tem o formato esperado para o provider "${runtime.provider}" ` +
      `(esperado prefixo ${expectedPrefix}). Verifique a variável AI_MODEL.`
    );
  }
}

/**
 * RAG-QUALITY-003 — Orçamento de tokens de SAÍDA para a tarefa cognitiva LEGAL_ANALYSIS (usada pelo
 * "Tirar Dúvidas"). Medido em staging: respostas com evidência de múltiplos artigos vinham cortadas
 * no meio da frase/lista com o teto anterior (1500) — o modelo consome parte do orçamento em
 * raciocínio interno antes do texto visível, e evidência mais rica tende a gerar respostas mais
 * longas mesmo com a instrução de objetividade. Configurável (custo por chamada) via
 * LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS; default aumentado com folga para cobrir esse caso sem exigir
 * ajuste manual em produção.
 */
const DEFAULT_LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS = 3000;
export function resolveLegalAnalysisMaxOutputTokens(env: { LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS?: string }): number {
  const raw = env.LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS?.trim();
  if (!raw) return DEFAULT_LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS;
}
export const LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS = resolveLegalAnalysisMaxOutputTokens({ LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS: process.env.LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS });

/**
 * AI-015 — Política de fallback para o MockAIProvider. O mock JAMAIS pode ser servido como resposta
 * oficial em staging/production (era o defeito AI-015: quando a chave Gemini falhava, `selectProvider`
 * caía silenciosamente no mock e a resposta mock era apresentada como oficial/"Fundamentada").
 *
 * Regra: o fallback automático para mock é permitido SOMENTE em desenvolvimento/teste E mediante a
 * flag explícita `AI_ALLOW_MOCK_FALLBACK=true` (default FALSE). Em staging/production não há flag que
 * o autorize — a ausência de provider real é uma falha controlada (fail-closed). Neste projeto os
 * testes rodam com `APP_ENV=development` (vitest), portanto "development/test" ⇒ `isDevelopment`.
 */
export function resolveAllowMockFallback(env: { AI_ALLOW_MOCK_FALLBACK?: string }): boolean {
  return (env.AI_ALLOW_MOCK_FALLBACK ?? "").trim().toLowerCase() === "true";
}
export const AI_ALLOW_MOCK_FALLBACK = resolveAllowMockFallback({ AI_ALLOW_MOCK_FALLBACK: process.env.AI_ALLOW_MOCK_FALLBACK });

/** Decide se o fallback automático para mock é permitido. Puro/testável. Default fail-closed. */
export function mockFallbackAllowed(opts: { isDevelopment: boolean; allowMockFlag: boolean }): boolean {
  return opts.isDevelopment === true && opts.allowMockFlag === true;
}

/**
 * PR D / AI-014 — Timeout e re-tentativas para chamadas de IA. Antes NÃO existia qualquer limite:
 * uma chamada ao provider podia pendurar indefinidamente e falhas transitórias derrubavam a operação
 * inteira. Configurável por ENV; defaults conservadores. O retry só ocorre para erros TRANSITÓRIOS
 * (ver `_core/ai/aiResilience.ts`) — nunca para erros determinísticos (entrada/auth/política).
 */
const DEFAULT_AI_TIMEOUT_MS = 30_000;
const DEFAULT_AI_MAX_ATTEMPTS = 2; // 1 tentativa + 1 re-tentativa

export function resolveAiTimeoutMs(env: { AI_TIMEOUT_MS?: string }): number {
  const n = parseInt((env.AI_TIMEOUT_MS ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AI_TIMEOUT_MS;
}
export function resolveAiMaxAttempts(env: { AI_MAX_ATTEMPTS?: string }): number {
  const n = parseInt((env.AI_MAX_ATTEMPTS ?? "").trim(), 10);
  // Limite defensivo: no mínimo 1 tentativa, no máximo 5 (evita loop de retry custoso).
  if (!Number.isFinite(n) || n < 1) return DEFAULT_AI_MAX_ATTEMPTS;
  return Math.min(n, 5);
}
export const AI_TIMEOUT_MS = resolveAiTimeoutMs({ AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS });
export const AI_MAX_ATTEMPTS = resolveAiMaxAttempts({ AI_MAX_ATTEMPTS: process.env.AI_MAX_ATTEMPTS });

const runtime = resolveAiRuntime({ AI_PROVIDER: process.env.AI_PROVIDER, AI_MODEL: process.env.AI_MODEL });

export const AI_CONFIG = {
  // Chaves por provider (prontas para o futuro; só Gemini implementado hoje).
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",

  /** True quando a chave do Gemini está presente (semântica histórica preservada). */
  isConfigured: !!process.env.GEMINI_API_KEY?.trim(),

  /** Provider primário ativo (gemini | claude | openai). Default: gemini. */
  provider: runtime.provider,
  /** Modelo padrão do provider primário (AI_MODEL sobrescreve; senão o default do provider). */
  model: runtime.model,
  /** Catálogo de modelos padrão por provider — útil para uma futura UI de seleção. */
  defaultModels: DEFAULT_MODEL_BY_PROVIDER,

  /** AI-014 — timeout (ms) por chamada ao provider e nº máximo de tentativas (incl. a 1ª). */
  timeoutMs: AI_TIMEOUT_MS,
  maxAttempts: AI_MAX_ATTEMPTS,
};
