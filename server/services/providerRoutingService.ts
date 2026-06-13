import { type AIProvider } from "../domain/aiProvider";
import { type RoutingStrategy, type FallbackStrategy, createRouting, selectProvider, getFallbackChain, type ProviderRouting } from "../domain/providerRouting";
import { listProviders } from "./providerRegistryService";

const _routings = new Map<number, ProviderRouting>();

export function getOrCreateRouting(organizationId: number, strategy?: RoutingStrategy): ProviderRouting {
  const existing = _routings.get(organizationId);
  if (existing) return existing;
  const routing = createRouting({ organizationId, routingStrategy: strategy ?? "deterministic_priority", resilienceMode: true });
  _routings.set(organizationId, routing);
  return routing;
}

export function selectProviderForOrg(organizationId: number, requiredCapability?: string, strategy?: RoutingStrategy): AIProvider | null {
  const routing = getOrCreateRouting(organizationId, strategy);
  const providers = listProviders(organizationId);
  return selectProvider(routing, providers, requiredCapability);
}

export function buildFallbackChain(organizationId: number, excludeId?: string): AIProvider[] {
  const routing = getOrCreateRouting(organizationId);
  const providers = listProviders(organizationId);
  return getFallbackChain(routing, providers, excludeId);
}

export function routeByCapability(organizationId: number, capability: string): AIProvider | null {
  return selectProviderForOrg(organizationId, capability, "capability_match");
}

export function routeWithFallback(organizationId: number, requiredCapability?: string): AIProvider[] {
  const primary = selectProviderForOrg(organizationId, requiredCapability);
  if (!primary) return buildFallbackChain(organizationId);
  return [primary, ...buildFallbackChain(organizationId, primary.id)];
}
