/**
 * Sprint 5.0.1 — Module Licensing Service
 *
 * Ativação, bloqueio, licenciamento, renovação e consulta de módulos (Business
 * Domains) por organização. Valida dependências entre domínios antes de ativar.
 * Degrada graciosamente sem DB.
 */

import {
  createLicensedModule,
  isLicenseActive,
  type LicensedModule,
  type LicensePlan,
} from "../domain/licensedModule";
import { getBusinessDomainDefinition, type BusinessDomainCode } from "../domain/businessDomain";
import {
  upsertLicensedModule,
  listLicensedModules,
  getLicensedModule,
  setModuleActive,
} from "../db/businessDomains";

export interface LicenseValidation {
  readonly licensed: boolean;
  readonly active: boolean;
  readonly missingDependencies: string[];
}

/** Ativa um módulo para a organização, validando dependências de domínio. */
export async function activateModule(params: {
  organizationId: number;
  businessDomainCode: BusinessDomainCode;
  plan?: LicensePlan;
  activationDate: string;
  expirationDate?: string | null;
  licensedFeatures?: string[];
  correlationId?: string;
}): Promise<{ module: LicensedModule; missingDependencies: string[] }> {
  // Verifica dependências de domínio (ex.: Contratos depende de Processo Licitatório)
  const def = getBusinessDomainDefinition(params.businessDomainCode);
  const licensed = await listLicensedModules(params.organizationId);
  const licensedCodes = new Set(licensed.filter(m => m.active).map(m => m.businessDomainCode));
  const missingDependencies = def.dependencies.filter(dep => !licensedCodes.has(dep));

  const module = createLicensedModule({
    organizationId: params.organizationId,
    businessDomainCode: params.businessDomainCode,
    plan: params.plan,
    activationDate: params.activationDate,
    expirationDate: params.expirationDate,
    licensedFeatures: params.licensedFeatures,
    correlationId: params.correlationId,
  });
  await upsertLicensedModule(module);
  return { module, missingDependencies };
}

export async function deactivateModule(organizationId: number, businessDomainCode: BusinessDomainCode): Promise<boolean> {
  return setModuleActive(organizationId, businessDomainCode, false);
}

export async function listOrganizationModules(organizationId: number) {
  return listLicensedModules(organizationId);
}

/** Valida a licença de um módulo para a organização em um dado instante. */
export async function validateLicense(
  organizationId: number,
  businessDomainCode: BusinessDomainCode,
  now: string,
): Promise<LicenseValidation> {
  const record = await getLicensedModule(organizationId, businessDomainCode);
  if (!record) return { licensed: false, active: false, missingDependencies: [] };
  // Reconstrói um LicensedModule mínimo para avaliar vigência
  const active = isLicenseActive(
    {
      id: record.id, organizationId, businessDomainCode,
      plan: record.plan as LicensePlan, active: record.active,
      activationDate: "", expirationDate: record.expirationDate,
      licensedFeatures: record.licensedFeatures, correlationId: "", createdAt: "",
    },
    now,
  );
  return { licensed: true, active, missingDependencies: [] };
}

/** Verdadeiro se o módulo está licenciado e ativo (para navegação/feature flags). */
export async function isModuleLicensed(organizationId: number, businessDomainCode: BusinessDomainCode, now: string): Promise<boolean> {
  const v = await validateLicense(organizationId, businessDomainCode, now);
  return v.licensed && v.active;
}
