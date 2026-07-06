/**
 * Sprint 5.0.1 — Feature Flag
 *
 * Toda funcionalidade da plataforma é governada por feature flags. Nunca usar
 * verificações espalhadas no código — sempre consultar o featureFlagService.
 * Determinístico, multi-tenant.
 */

import { createHash } from "crypto";
import type { BusinessDomainCode } from "./businessDomain";

export type RolloutStrategy = "off" | "on" | "org_scoped";

export interface FeatureFlag {
  readonly id: string;
  readonly organizationId: number;
  readonly businessDomainCode: BusinessDomainCode | null;
  readonly featureKey: string;
  readonly enabled: boolean;
  readonly rolloutStrategy: RolloutStrategy;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createFeatureFlag(params: {
  organizationId: number;
  featureKey: string;
  businessDomainCode?: BusinessDomainCode | null;
  enabled?: boolean;
  rolloutStrategy?: RolloutStrategy;
  correlationId?: string;
  createdAt?: string;
}): FeatureFlag {
  const id = createHash("sha256")
    .update(`ff:${params.organizationId}:${params.featureKey}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    businessDomainCode: params.businessDomainCode ?? null,
    featureKey: params.featureKey,
    enabled: params.enabled ?? false,
    rolloutStrategy: params.rolloutStrategy ?? "off",
    correlationId: params.correlationId ?? "",
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Avalia se uma flag está efetivamente habilitada conforme sua estratégia. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  switch (flag.rolloutStrategy) {
    case "on": return true;
    case "off": return false;
    case "org_scoped": return flag.enabled;
    default: return false;
  }
}

export function toggleFeature(flag: FeatureFlag, enabled: boolean): FeatureFlag {
  return { ...flag, enabled, rolloutStrategy: enabled ? "org_scoped" : "off" };
}
