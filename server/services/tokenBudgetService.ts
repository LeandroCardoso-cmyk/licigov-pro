import { createHash } from "crypto";
import { AVAILABLE_MODELS } from "./aiProviderAbstractionService.ts";

export interface TokenBudget {
  id: string;
  organizationId: number;
  sessionId: string;
  maxTokens: number;
  usedTokens: number;
  reservedTokens: number;
  availableTokens: number;
  costEstimateUsd: number;
  model: string;
  warnings: string[];
  hardLimit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TokenEstimation {
  text: string;
  estimatedTokens: number;
  model: string;
  method: "char_div_4" | "tiktoken_approx";
  confidence: number;
}

export interface CostForecast {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  currency: "USD";
  breakdown: {
    inputCost: number;
    outputCost: number;
  };
  forecastedAt: string;
}

function generateId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function computeAvailable(budget: TokenBudget): number {
  return Math.max(0, budget.maxTokens - budget.usedTokens - budget.reservedTokens);
}

export function createBudget(
  organizationId: number,
  sessionId: string,
  maxTokens: number,
  model: string
): TokenBudget {
  const now = new Date().toISOString();
  const id = generateId(`${organizationId}:${sessionId}:${model}:${now}`);

  const budget: TokenBudget = {
    id,
    organizationId,
    sessionId,
    maxTokens,
    usedTokens: 0,
    reservedTokens: 0,
    availableTokens: maxTokens,
    costEstimateUsd: 0,
    model,
    warnings: [],
    hardLimit: true,
    createdAt: now,
    updatedAt: now,
  };

  return budget;
}

export function consumeTokens(
  budget: TokenBudget,
  tokens: number,
  reason?: string
): TokenBudget {
  if (budget.hardLimit && budget.usedTokens + tokens > budget.maxTokens) {
    throw new Error(
      `Token budget exhausted: attempted to consume ${tokens} tokens but only ${budget.availableTokens} available`
    );
  }

  const warnings = [...budget.warnings];
  const newUsed = budget.usedTokens + tokens;
  const utilizationAfter = (newUsed / budget.maxTokens) * 100;

  if (utilizationAfter >= 90 && budget.usedTokens / budget.maxTokens < 0.9) {
    warnings.push(`Token usage reached 90% of budget${reason ? ` (${reason})` : ""}`);
  } else if (utilizationAfter >= 75 && budget.usedTokens / budget.maxTokens < 0.75) {
    warnings.push(`Token usage reached 75% of budget${reason ? ` (${reason})` : ""}`);
  }

  const forecast = forecastCost(newUsed, 0, budget.model);

  const updated: TokenBudget = {
    ...budget,
    usedTokens: newUsed,
    availableTokens: 0,
    costEstimateUsd: forecast.estimatedCostUsd,
    warnings,
    updatedAt: new Date().toISOString(),
  };

  updated.availableTokens = computeAvailable(updated);
  return updated;
}

export function reserveTokens(budget: TokenBudget, tokens: number): TokenBudget {
  const updated: TokenBudget = {
    ...budget,
    reservedTokens: budget.reservedTokens + tokens,
    updatedAt: new Date().toISOString(),
  };
  updated.availableTokens = computeAvailable(updated);
  return updated;
}

export function releaseReservedTokens(budget: TokenBudget, tokens: number): TokenBudget {
  const newReserved = Math.max(0, budget.reservedTokens - tokens);
  const updated: TokenBudget = {
    ...budget,
    reservedTokens: newReserved,
    updatedAt: new Date().toISOString(),
  };
  updated.availableTokens = computeAvailable(updated);
  return updated;
}

export function estimateTokens(text: string, model?: string): TokenEstimation {
  return {
    text,
    estimatedTokens: Math.ceil(text.length / 4),
    model: model ?? "default",
    method: "char_div_4",
    confidence: 0.85,
  };
}

export function forecastCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): CostForecast {
  const modelInfo = AVAILABLE_MODELS[model];
  const inputRate = modelInfo?.costPer1kInputTokens ?? 0.001;
  const outputRate = modelInfo?.costPer1kOutputTokens ?? 0.002;

  const inputCost = (inputTokens / 1000) * inputRate;
  const outputCost = (outputTokens / 1000) * outputRate;

  return {
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: inputCost + outputCost,
    currency: "USD",
    breakdown: {
      inputCost,
      outputCost,
    },
    forecastedAt: new Date().toISOString(),
  };
}

export function truncateToFit(
  text: string,
  maxTokens: number
): { text: string; truncated: boolean; removedTokens: number } {
  const maxChars = maxTokens * 4;

  if (text.length <= maxChars) {
    return { text, truncated: false, removedTokens: 0 };
  }

  const truncated = text.slice(0, maxChars) + "...";
  const removedChars = text.length - maxChars;
  const removedTokens = Math.ceil(removedChars / 4);

  return { text: truncated, truncated: true, removedTokens };
}

export function isBudgetExhausted(budget: TokenBudget): boolean {
  return budget.availableTokens <= 0;
}

export function getBudgetUtilization(budget: TokenBudget): number {
  if (budget.maxTokens === 0) return 0;
  return Math.min(100, (budget.usedTokens / budget.maxTokens) * 100);
}
