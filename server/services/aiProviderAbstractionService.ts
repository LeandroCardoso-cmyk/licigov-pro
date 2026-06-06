import { createHash } from "crypto";

export type AIProvider = "openai" | "anthropic" | "gemini" | "local" | "mock";

export interface AIModel {
  provider: AIProvider;
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
}

export const AVAILABLE_MODELS: Record<string, AIModel> = {
  "gpt-4o": {
    provider: "openai",
    modelId: "gpt-4o",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1kInputTokens: 0.005,
    costPer1kOutputTokens: 0.015,
  },
  "gpt-4o-mini": {
    provider: "openai",
    modelId: "gpt-4o-mini",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1kInputTokens: 0.00015,
    costPer1kOutputTokens: 0.0006,
  },
  "claude-sonnet-4-6": {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
  },
  "claude-haiku-4-5": {
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0.00025,
    costPer1kOutputTokens: 0.00125,
  },
  "gemini-1.5-pro": {
    provider: "gemini",
    modelId: "gemini-1.5-pro",
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    costPer1kInputTokens: 0.00125,
    costPer1kOutputTokens: 0.005,
  },
  "local-mock": {
    provider: "local",
    modelId: "local-mock",
    contextWindow: 8192,
    maxOutputTokens: 2048,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
  },
  "mock-default": {
    provider: "mock",
    modelId: "mock-default",
    contextWindow: 32768,
    maxOutputTokens: 4096,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
  },
};

export interface AIExecutionRequest {
  provider: AIProvider;
  modelId: string;
  prompt: string;
  systemPrompt: string | null;
  maxTokens: number;
  temperature: number;
  organizationId: number;
  sessionId: string;
  replayKey: string;
}

export interface AIExecutionResult {
  provider: AIProvider;
  modelId: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  finishReason: "stop" | "max_tokens" | "error";
  replayKey: string;
  executedAt: string;
}

const _executionCache = new Map<string, AIExecutionResult>();

function deterministicInt(seed: string, min: number, max: number): number {
  const hash = createHash("sha256").update(seed).digest("hex");
  const numeric = parseInt(hash.slice(0, 8), 16);
  return min + (numeric % (max - min + 1));
}

export async function executeWithProvider(
  request: AIExecutionRequest
): Promise<AIExecutionResult> {
  const { provider, modelId, prompt, replayKey, organizationId } = request;

  if (_executionCache.has(replayKey)) {
    return _executionCache.get(replayKey)!;
  }

  const content = `[MOCK ${provider}/${modelId}] Resposta simulada para: ${prompt.slice(0, 50)}`;
  const inputTokens = Math.ceil(prompt.length / 4);

  const outputSeed = createHash("sha256")
    .update(`${replayKey}::outputTokens::${organizationId}`)
    .digest("hex");
  const outputBase = parseInt(outputSeed.slice(0, 8), 16);
  const outputTokens = 50 + (outputBase % 200) + 1;

  const durationMs = deterministicInt(`${modelId}::duration`, 100, 2000);

  const result: AIExecutionResult = {
    provider,
    modelId,
    content,
    inputTokens,
    outputTokens,
    durationMs,
    finishReason: "stop",
    replayKey,
    executedAt: new Date().toISOString(),
  };

  _executionCache.set(replayKey, result);
  return result;
}

export function getModelInfo(modelId: string): AIModel | null {
  return AVAILABLE_MODELS[modelId] ?? null;
}

export function listAvailableModels(provider?: AIProvider): AIModel[] {
  const all = Object.values(AVAILABLE_MODELS);
  if (provider === undefined) return all;
  return all.filter((m) => m.provider === provider);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
