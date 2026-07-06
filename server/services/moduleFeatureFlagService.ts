/**
 * Sprint 5.0.1 — Module Feature Flag Service
 *
 * Camada ÚNICA de consulta de funcionalidades dos Business Domains (distinta do
 * featureFlagService de plataforma pré-existente). Toda funcionalidade de módulo
 * deve consultar este serviço — nunca verificações espalhadas. Degrada
 * graciosamente sem DB (flag ausente = desabilitada, default seguro).
 */

import { createFeatureFlag, isFeatureEnabled, type FeatureFlag, type RolloutStrategy } from "../domain/featureFlag";
import type { BusinessDomainCode } from "../domain/businessDomain";
import { upsertFeatureFlag, getFeatureFlag, listFeatureFlags } from "../db/businessDomains";

export async function setFlag(params: {
  organizationId: number;
  featureKey: string;
  businessDomainCode?: BusinessDomainCode | null;
  enabled: boolean;
  correlationId?: string;
}): Promise<FeatureFlag> {
  const flag = createFeatureFlag({
    organizationId: params.organizationId,
    featureKey: params.featureKey,
    businessDomainCode: params.businessDomainCode,
    enabled: params.enabled,
    rolloutStrategy: params.enabled ? "org_scoped" : "off",
    correlationId: params.correlationId,
  });
  await upsertFeatureFlag(flag);
  return flag;
}

/** Fonte única para checar se uma funcionalidade de módulo está habilitada. */
export async function isModuleFeatureEnabled(organizationId: number, featureKey: string): Promise<boolean> {
  const row = await getFeatureFlag(organizationId, featureKey);
  if (!row) return false;
  const flag = createFeatureFlag({
    organizationId,
    featureKey,
    enabled: row.enabled,
    rolloutStrategy: row.rolloutStrategy as RolloutStrategy,
  });
  return isFeatureEnabled(flag);
}

export async function listFlags(organizationId: number) {
  return listFeatureFlags(organizationId);
}
