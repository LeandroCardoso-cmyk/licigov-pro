import { createHash } from "crypto";
import { type AIProvider, openCircuitBreaker, halfOpenCircuitBreaker } from "../domain/aiProvider";
import { listProviders, updateHealth, registerDefaultProviders, getAvailableProviders } from "./providerRegistryService";
import { buildFallbackChain } from "./providerRoutingService";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export interface FailoverEvent {
  readonly id: string;
  readonly organizationId: number;
  readonly failedProviderId: string;
  readonly newProviderId: string | null;
  readonly reason: string;
  readonly occurredAt: string;
}

const _failoverEvents = new Map<number, FailoverEvent[]>();
const _degradedOrgs = new Set<number>();

export function triggerFailover(organizationId: number, failedProviderId: string, reason: string): { newProvider: AIProvider | null; event: FailoverEvent } {
  // Open circuit breaker on failed provider
  const providers = listProviders(organizationId);
  const failed = providers.find(p => p.id === failedProviderId);
  if (failed) {
    const opened = openCircuitBreaker(failed);
    updateHealth(organizationId, failedProviderId, { healthStatus: "unavailable" });
  }

  // Build fallback chain excluding failed provider
  const chain = buildFallbackChain(organizationId, failedProviderId);
  const newProvider = chain[0] ?? null;

  const event: FailoverEvent = { id: sha256(`failover:${organizationId}:${failedProviderId}:${Date.now()}`).slice(0,20), organizationId, failedProviderId, newProviderId: newProvider?.id ?? null, reason, occurredAt: new Date().toISOString() };
  const existing = _failoverEvents.get(organizationId) ?? [];
  _failoverEvents.set(organizationId, [...existing, event]);

  return { newProvider, event };
}

export function getFailoverChain(organizationId: number): string[] {
  const available = getAvailableProviders(organizationId);
  const order = ["openai","claude","gemini","mock"];
  return order.filter(t => available.some(p => (p as any).providerType === t));
}

export function enterDegradedMode(organizationId: number): void {
  _degradedOrgs.add(organizationId);
  registerDefaultProviders(organizationId);
}

export function exitDegradedMode(organizationId: number): void {
  _degradedOrgs.delete(organizationId);
}

export function getDegradedOrgs(): number[] {
  return [..._degradedOrgs];
}

export function recordFailoverEvent(organizationId: number, event: Omit<FailoverEvent, "id" | "occurredAt">): FailoverEvent {
  const full: FailoverEvent = { ...event, id: sha256(`failover:${organizationId}:${Date.now()}`).slice(0,20), occurredAt: new Date().toISOString() };
  const existing = _failoverEvents.get(organizationId) ?? [];
  _failoverEvents.set(organizationId, [...existing, full]);
  return full;
}

export function getFailoverHistory(organizationId: number): FailoverEvent[] {
  return _failoverEvents.get(organizationId) ?? [];
}
