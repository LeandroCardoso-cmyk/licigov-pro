import { createHash } from "crypto";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export interface LatencyRecord { organizationId: number; providerId: string; model: string; latencyMs: number; correlationId: string; recordedAt: string; }
export interface TokenUsageRecord { organizationId: number; providerId: string; promptTokens: number; completionTokens: number; correlationId: string; recordedAt: string; }
export interface ErrorRecord { organizationId: number; providerId: string; errorMessage: string; correlationId: string; recordedAt: string; }
export interface FallbackRecord { organizationId: number; fromProviderId: string; toProviderId: string; reason: string; correlationId: string; recordedAt: string; }

const _latency = new Map<number, LatencyRecord[]>();
const _tokenUsage = new Map<number, TokenUsageRecord[]>();
const _errors = new Map<number, ErrorRecord[]>();
const _fallbacks = new Map<number, FallbackRecord[]>();

function append<T>(map: Map<number, T[]>, orgId: number, val: T) {
  map.set(orgId, [...(map.get(orgId) ?? []), val]);
}

export function recordLatency(input: Omit<LatencyRecord, "recordedAt">): void {
  append(_latency, input.organizationId, { ...input, recordedAt: new Date().toISOString() });
}

export function recordTokenUsage(input: Omit<TokenUsageRecord, "recordedAt">): void {
  append(_tokenUsage, input.organizationId, { ...input, recordedAt: new Date().toISOString() });
}

export function recordError(input: Omit<ErrorRecord, "recordedAt">): void {
  append(_errors, input.organizationId, { ...input, recordedAt: new Date().toISOString() });
}

export function recordFallback(input: Omit<FallbackRecord, "recordedAt">): void {
  append(_fallbacks, input.organizationId, { ...input, recordedAt: new Date().toISOString() });
}

export function getProviderHealth(organizationId: number, providerId: string): { healthScore: number; avgLatencyMs: number; errorRate: number; fallbackRate: number } {
  const latencies = (_latency.get(organizationId) ?? []).filter(r => r.providerId === providerId);
  const errors = (_errors.get(organizationId) ?? []).filter(r => r.providerId === providerId);
  const avgLatencyMs = latencies.length > 0 ? latencies.reduce((s, r) => s + r.latencyMs, 0) / latencies.length : 0;
  const totalOps = latencies.length || 1;
  const errorRate = errors.length / totalOps;
  const fallbackRate = (_fallbacks.get(organizationId) ?? []).filter(r => r.fromProviderId === providerId).length / totalOps;
  const healthScore = Math.max(0, 1 - errorRate - fallbackRate * 0.5);
  return { healthScore, avgLatencyMs, errorRate, fallbackRate };
}

export function getExecutionLineage(organizationId: number, correlationId: string): Array<LatencyRecord | TokenUsageRecord | ErrorRecord | FallbackRecord> {
  const lat = (_latency.get(organizationId) ?? []).filter(r => r.correlationId === correlationId);
  const tok = (_tokenUsage.get(organizationId) ?? []).filter(r => r.correlationId === correlationId);
  const err = (_errors.get(organizationId) ?? []).filter(r => r.correlationId === correlationId);
  const fal = (_fallbacks.get(organizationId) ?? []).filter(r => r.correlationId === correlationId);
  return [...lat, ...tok, ...err, ...fal];
}

export function getProviderMetrics(organizationId: number): { totalRequests: number; totalErrors: number; totalFallbacks: number; avgLatencyMs: number } {
  const latencies = _latency.get(organizationId) ?? [];
  const errors = _errors.get(organizationId) ?? [];
  const fallbacks = _fallbacks.get(organizationId) ?? [];
  const avgLatencyMs = latencies.length > 0 ? latencies.reduce((s, r) => s + r.latencyMs, 0) / latencies.length : 0;
  return { totalRequests: latencies.length, totalErrors: errors.length, totalFallbacks: fallbacks.length, avgLatencyMs };
}

export function computeReliabilityScore(organizationId: number, providerId: string): number {
  const health = getProviderHealth(organizationId, providerId);
  return health.healthScore;
}
