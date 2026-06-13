import { createHash } from "crypto";
import { type AIProvider, type ProviderType, createProvider, updateProviderHealth, openCircuitBreaker, isProviderAvailable } from "../domain/aiProvider";

const _registry = new Map<number, AIProvider[]>();

export function registerProvider(input: { organizationId: number; providerType: ProviderType; providerName: string; priority?: number; supportedCapabilities?: string[] }): AIProvider {
  const p = createProvider(input);
  const existing = _registry.get(input.organizationId) ?? [];
  const filtered = existing.filter(e => e.id !== p.id);
  _registry.set(input.organizationId, [...filtered, p]);
  return p;
}

export function unregisterProvider(organizationId: number, providerId: string): boolean {
  const existing = _registry.get(organizationId) ?? [];
  const filtered = existing.filter(p => p.id !== providerId);
  _registry.set(organizationId, filtered);
  return filtered.length < existing.length;
}

export function getProvider(organizationId: number, providerId: string): AIProvider | null {
  return (_registry.get(organizationId) ?? []).find(p => p.id === providerId) ?? null;
}

export function listProviders(organizationId: number): AIProvider[] {
  return _registry.get(organizationId) ?? [];
}

export function updateHealth(organizationId: number, providerId: string, health: { healthStatus: "healthy"|"degraded"|"unavailable"|"unknown"; latencyScore?: number; reliabilityScore?: number }): AIProvider | null {
  const existing = _registry.get(organizationId) ?? [];
  const idx = existing.findIndex(p => p.id === providerId);
  if (idx === -1) return null;
  const updated = updateProviderHealth(existing[idx]!, health);
  const newList = [...existing];
  newList[idx] = updated;
  _registry.set(organizationId, newList);
  return updated;
}

export function getAvailableProviders(organizationId: number): AIProvider[] {
  return (listProviders(organizationId)).filter(isProviderAvailable);
}

export function registerDefaultProviders(organizationId: number): AIProvider[] {
  const mockProvider = registerProvider({ organizationId, providerType: "mock", providerName: "Mock Provider", priority: 1, supportedCapabilities: ["inference","embedding","completion","classification"] });
  const updated = updateHealth(organizationId, mockProvider.id, { healthStatus: "healthy", latencyScore: 1.0, reliabilityScore: 1.0 });
  return [updated ?? mockProvider];
}
