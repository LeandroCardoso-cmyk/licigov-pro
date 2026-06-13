import { createHash } from "crypto";
import { type AIProvider, isProviderAvailable, getProviderScore } from "./aiProvider";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export type RoutingStrategy = "lowest_latency" | "lowest_cost" | "highest_reliability" | "deterministic_priority" | "capability_match";
export type FallbackStrategy = "next_provider" | "mock_fallback" | "fail_fast" | "degraded_mode";

export interface ProviderRouting {
  readonly id: string;
  readonly organizationId: number;
  readonly routingStrategy: RoutingStrategy;
  readonly fallbackStrategy: FallbackStrategy;
  readonly preferredProviders: string[]; // provider IDs in priority order
  readonly capabilityRouting: Record<string, string>; // capability -> providerId
  readonly costOptimization: boolean;
  readonly latencyOptimization: boolean;
  readonly resilienceMode: boolean;
  readonly active: boolean;
  readonly createdAt: string;
}

export function createRouting(params: {
  organizationId: number;
  routingStrategy?: RoutingStrategy;
  fallbackStrategy?: FallbackStrategy;
  preferredProviders?: string[];
  capabilityRouting?: Record<string, string>;
  costOptimization?: boolean;
  latencyOptimization?: boolean;
  resilienceMode?: boolean;
}): ProviderRouting {
  const now = new Date().toISOString();
  const id = sha256(`routing:${params.organizationId}:${params.routingStrategy ?? "deterministic_priority"}:${now}`).slice(0,20);
  return {
    id,
    organizationId: params.organizationId,
    routingStrategy: params.routingStrategy ?? "deterministic_priority",
    fallbackStrategy: params.fallbackStrategy ?? "next_provider",
    preferredProviders: params.preferredProviders ?? [],
    capabilityRouting: params.capabilityRouting ?? {},
    costOptimization: params.costOptimization ?? false,
    latencyOptimization: params.latencyOptimization ?? false,
    resilienceMode: params.resilienceMode ?? true,
    active: true,
    createdAt: now,
  };
}

export function selectProvider(routing: ProviderRouting, providers: AIProvider[], requiredCapability?: string): AIProvider | null {
  const available = providers.filter(isProviderAvailable).filter(p =>
    !requiredCapability || p.supportedCapabilities.includes(requiredCapability)
  );
  if (available.length === 0) return null;

  switch (routing.routingStrategy) {
    case "lowest_latency":
      return available.sort((a, b) => b.latencyScore - a.latencyScore)[0] ?? null;
    case "lowest_cost":
      return available.sort((a, b) => b.costScore - a.costScore)[0] ?? null;
    case "highest_reliability":
      return available.sort((a, b) => b.reliabilityScore - a.reliabilityScore)[0] ?? null;
    case "capability_match": {
      if (requiredCapability && routing.capabilityRouting[requiredCapability]) {
        const preferred = available.find(p => p.id === routing.capabilityRouting[requiredCapability]);
        if (preferred) return preferred;
      }
      return available.sort((a, b) => b.priority - a.priority)[0] ?? null;
    }
    case "deterministic_priority":
    default: {
      if (routing.preferredProviders.length > 0) {
        for (const pid of routing.preferredProviders) {
          const p = available.find(pp => pp.id === pid);
          if (p) return p;
        }
      }
      return available.sort((a, b) => b.priority - a.priority)[0] ?? null;
    }
  }
}

export function getFallbackChain(routing: ProviderRouting, providers: AIProvider[], excludeId?: string): AIProvider[] {
  const available = providers.filter(isProviderAvailable).filter(p => p.id !== excludeId);
  return available.sort((a, b) => b.priority - a.priority);
}
