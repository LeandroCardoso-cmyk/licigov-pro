import { createHash } from "crypto";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export type ProviderType = "openai" | "claude" | "gemini" | "mock";
export type HealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";
export type CircuitBreakerState = "closed" | "open" | "half_open";

export interface RateLimitConfig {
  readonly requestsPerMinute: number;
  readonly tokensPerMinute: number;
  readonly concurrentRequests: number;
}

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly backoffMs: number;
  readonly maxBackoffMs: number;
}

export interface AIProvider {
  readonly id: string;
  readonly organizationId: number;
  readonly providerType: ProviderType;
  readonly providerName: string;
  readonly enabled: boolean;
  readonly priority: number; // 1-10
  readonly supportedCapabilities: string[];
  readonly healthStatus: HealthStatus;
  readonly latencyScore: number; // 0-1
  readonly reliabilityScore: number; // 0-1
  readonly costScore: number; // 0-1 (higher = cheaper)
  readonly rateLimitConfig: RateLimitConfig;
  readonly retryPolicy: RetryPolicy;
  readonly circuitBreakerState: CircuitBreakerState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createProvider(params: {
  organizationId: number;
  providerType: ProviderType;
  providerName: string;
  priority?: number;
  supportedCapabilities?: string[];
  rateLimitConfig?: Partial<RateLimitConfig>;
  retryPolicy?: Partial<RetryPolicy>;
}): AIProvider {
  const now = new Date().toISOString();
  const id = sha256(`provider:${params.organizationId}:${params.providerType}:${params.providerName}`).slice(0,20);
  const defaults: Record<ProviderType, Partial<AIProvider>> = {
    openai:  { latencyScore: 0.8, reliabilityScore: 0.9, costScore: 0.5 },
    claude:  { latencyScore: 0.85, reliabilityScore: 0.92, costScore: 0.6 },
    gemini:  { latencyScore: 0.9, reliabilityScore: 0.85, costScore: 0.7 },
    mock:    { latencyScore: 1.0, reliabilityScore: 1.0, costScore: 1.0 },
  };
  const d = defaults[params.providerType];
  return {
    id,
    organizationId: params.organizationId,
    providerType: params.providerType,
    providerName: params.providerName,
    enabled: true,
    priority: params.priority ?? 5,
    supportedCapabilities: params.supportedCapabilities ?? ["inference","embedding","completion"],
    healthStatus: "unknown",
    latencyScore: d.latencyScore ?? 0.7,
    reliabilityScore: d.reliabilityScore ?? 0.8,
    costScore: d.costScore ?? 0.5,
    rateLimitConfig: {
      requestsPerMinute: params.rateLimitConfig?.requestsPerMinute ?? 60,
      tokensPerMinute: params.rateLimitConfig?.tokensPerMinute ?? 100000,
      concurrentRequests: params.rateLimitConfig?.concurrentRequests ?? 10,
    },
    retryPolicy: {
      maxRetries: params.retryPolicy?.maxRetries ?? 3,
      backoffMs: params.retryPolicy?.backoffMs ?? 1000,
      maxBackoffMs: params.retryPolicy?.maxBackoffMs ?? 10000,
    },
    circuitBreakerState: "closed",
    createdAt: now,
    updatedAt: now,
  };
}

export function updateProviderHealth(provider: AIProvider, health: {
  healthStatus: HealthStatus;
  latencyScore?: number;
  reliabilityScore?: number;
}): AIProvider {
  return { ...provider, healthStatus: health.healthStatus, latencyScore: health.latencyScore ?? provider.latencyScore, reliabilityScore: health.reliabilityScore ?? provider.reliabilityScore, updatedAt: new Date().toISOString() };
}

export function openCircuitBreaker(provider: AIProvider): AIProvider {
  return { ...provider, circuitBreakerState: "open", healthStatus: "unavailable", updatedAt: new Date().toISOString() };
}

export function closeCircuitBreaker(provider: AIProvider): AIProvider {
  return { ...provider, circuitBreakerState: "closed", healthStatus: "healthy", updatedAt: new Date().toISOString() };
}

export function halfOpenCircuitBreaker(provider: AIProvider): AIProvider {
  return { ...provider, circuitBreakerState: "half_open", healthStatus: "degraded", updatedAt: new Date().toISOString() };
}

export function isProviderAvailable(provider: AIProvider): boolean {
  return provider.enabled && provider.circuitBreakerState === "closed" && provider.healthStatus !== "unavailable";
}

export function getProviderScore(provider: AIProvider): number {
  return provider.latencyScore * 0.3 + provider.reliabilityScore * 0.4 + provider.costScore * 0.3;
}
