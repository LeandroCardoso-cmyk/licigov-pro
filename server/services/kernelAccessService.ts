/**
 * Sprint 5.0.1 — Kernel Access Service
 *
 * Única porta de acesso dos Business Domains ao Kernel Cognitivo. Nenhum domínio
 * pode acessar componentes internos do Kernel diretamente (providers, RAG, KG,
 * timeline, CATMAT, replay, explainability); todo acesso passa por aqui e é
 * validado contra os serviços que o domínio declara exigir.
 */

import type { BusinessDomainCode } from "../domain/businessDomain";
import { getBusinessDomainDefinition } from "../domain/businessDomain";
import type { KernelServiceId } from "../domain/cognitiveKernel";
import { ALL_KERNEL_SERVICE_IDS, isKernelService } from "../domain/cognitiveKernel";

export interface KernelAccessResult {
  readonly allowed: boolean;
  readonly reason: string;
}

/** Serviços do Kernel que um domínio está autorizado a usar (os que declarou exigir). */
export function listKernelServicesForDomain(code: BusinessDomainCode): KernelServiceId[] {
  return [...getBusinessDomainDefinition(code).requiredKernelServices];
}

/** Verifica se um domínio pode acessar um serviço do Kernel. */
export function checkKernelAccess(code: BusinessDomainCode, serviceId: string): KernelAccessResult {
  if (!isKernelService(serviceId)) {
    return { allowed: false, reason: `"${serviceId}" não é um serviço do Kernel.` };
  }
  const required = getBusinessDomainDefinition(code).requiredKernelServices;
  if (!required.includes(serviceId)) {
    return { allowed: false, reason: `O domínio "${code}" não declarou o serviço "${serviceId}" em requiredKernelServices.` };
  }
  return { allowed: true, reason: "Acesso autorizado pelo Kernel." };
}

/** Impõe o acesso: lança se o domínio não puder usar o serviço. */
export function assertKernelAccess(code: BusinessDomainCode, serviceId: KernelServiceId): void {
  const result = checkKernelAccess(code, serviceId);
  if (!result.allowed) {
    throw new Error(`Acesso ao Kernel negado: ${result.reason}`);
  }
}

/** Lista todos os serviços do Kernel (catálogo oficial). */
export function listAllKernelServices(): KernelServiceId[] {
  return [...ALL_KERNEL_SERVICE_IDS];
}
