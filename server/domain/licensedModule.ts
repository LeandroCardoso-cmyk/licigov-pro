/**
 * Sprint 5.0.1 — Licensed Module
 *
 * Representa um módulo (Business Domain) contratado por uma organização. Permite
 * que cada prefeitura licencie apenas os domínios que utiliza. Determinístico,
 * multi-tenant.
 */

import { createHash } from "crypto";
import type { BusinessDomainCode } from "./businessDomain";

export type LicensePlan = "trial" | "basic" | "professional" | "enterprise";

export interface LicensedModule {
  readonly id: string;
  readonly organizationId: number;
  readonly businessDomainCode: BusinessDomainCode;
  readonly plan: LicensePlan;
  readonly active: boolean;
  readonly activationDate: string;
  readonly expirationDate: string | null;
  readonly licensedFeatures: readonly string[];
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createLicensedModule(params: {
  organizationId: number;
  businessDomainCode: BusinessDomainCode;
  plan?: LicensePlan;
  activationDate: string;
  expirationDate?: string | null;
  licensedFeatures?: string[];
  correlationId?: string;
  createdAt?: string;
}): LicensedModule {
  const id = createHash("sha256")
    .update(`lm:${params.organizationId}:${params.businessDomainCode}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    businessDomainCode: params.businessDomainCode,
    plan: params.plan ?? "trial",
    active: true,
    activationDate: params.activationDate,
    expirationDate: params.expirationDate ?? null,
    licensedFeatures: params.licensedFeatures ?? [],
    correlationId: params.correlationId ?? "",
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Uma licença está expirada se há data de expiração e ela é anterior a `now`. */
export function isExpired(module: LicensedModule, now: string): boolean {
  if (!module.expirationDate) return false;
  return module.expirationDate < now;
}

/** Uma licença está válida quando ativa e não expirada. */
export function isLicenseActive(module: LicensedModule, now: string): boolean {
  return module.active && !isExpired(module, now);
}

export function deactivateModule(module: LicensedModule): LicensedModule {
  return { ...module, active: false };
}

export function hasFeature(module: LicensedModule, feature: string): boolean {
  return module.licensedFeatures.includes(feature);
}
