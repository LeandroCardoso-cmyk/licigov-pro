/**
 * Sprint 5.0.1 — Business Domain Registry Service
 *
 * Registra oficialmente todos os Business Domains e Kernel Services. Fonte única
 * de verdade sobre quais domínios existem e de quais serviços do Kernel dependem.
 */

import {
  listBusinessDomains,
  createBusinessDomain,
  getBusinessDomainDefinition,
  ALL_BUSINESS_DOMAIN_CODES,
  type BusinessDomain,
  type BusinessDomainCode,
} from "../domain/businessDomain";
import { createModuleDependency, type ModuleDependency } from "../domain/moduleDependency";
import { ALL_KERNEL_SERVICE_IDS, createKernelServiceRecord } from "../domain/cognitiveKernel";
import {
  upsertBusinessDomain,
  upsertModuleDependency,
  upsertKernelService,
} from "../db/businessDomains";

/** Registra (persiste) todos os domínios, dependências e serviços de Kernel. */
export async function registerAll(): Promise<{ domains: number; dependencies: number; kernelServices: number }> {
  const domains = listBusinessDomains();
  for (const d of domains) await upsertBusinessDomain(d);

  const deps = buildAllDependencies();
  for (const dep of deps) await upsertModuleDependency(dep);

  for (const sid of ALL_KERNEL_SERVICE_IDS) await upsertKernelService(createKernelServiceRecord(sid));

  return { domains: domains.length, dependencies: deps.length, kernelServices: ALL_KERNEL_SERVICE_IDS.length };
}

/** Deriva as dependências (domínio→domínio e domínio→kernel) das definições. */
export function buildAllDependencies(): ModuleDependency[] {
  const deps: ModuleDependency[] = [];
  for (const code of ALL_BUSINESS_DOMAIN_CODES) {
    const def = getBusinessDomainDefinition(code);
    for (const dep of def.dependencies) {
      deps.push(createModuleDependency({ dependentCode: code, kind: "domain", dependsOn: dep }));
    }
    for (const svc of def.requiredKernelServices) {
      deps.push(createModuleDependency({ dependentCode: code, kind: "kernel", dependsOn: svc }));
    }
  }
  return deps;
}

export function listDomains(): BusinessDomain[] {
  return listBusinessDomains();
}

export function getDomain(code: BusinessDomainCode): BusinessDomain {
  return createBusinessDomain(code);
}

export function getDomainDependencies(code: BusinessDomainCode): ModuleDependency[] {
  return buildAllDependencies().filter(d => d.dependentCode === code);
}
