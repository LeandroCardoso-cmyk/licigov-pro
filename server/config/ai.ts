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
  gemini: "gemini-2.5-flash",
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
};
