/**
 * Sprint 5.0.1 — Module Dependency
 *
 * Representa dependências entre módulos e do módulo para o Kernel. Ex.: o TR
 * depende do Processo Licitatório; CATMAT depende do Kernel. Determinístico.
 */

import { createHash } from "crypto";
import type { BusinessDomainCode } from "./businessDomain";
import type { KernelServiceId } from "./cognitiveKernel";

export type DependencyKind = "domain" | "kernel";

export interface ModuleDependency {
  readonly id: string;
  readonly dependentCode: BusinessDomainCode;
  readonly kind: DependencyKind;
  /** Código do domínio (kind=domain) ou id do serviço de Kernel (kind=kernel). */
  readonly dependsOn: string;
  readonly required: boolean;
  readonly createdAt: string;
}

export function createModuleDependency(params: {
  dependentCode: BusinessDomainCode;
  kind: DependencyKind;
  dependsOn: BusinessDomainCode | KernelServiceId;
  required?: boolean;
  createdAt?: string;
}): ModuleDependency {
  const id = createHash("sha256")
    .update(`md:${params.dependentCode}:${params.kind}:${params.dependsOn}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    dependentCode: params.dependentCode,
    kind: params.kind,
    dependsOn: params.dependsOn,
    required: params.required ?? true,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Resolve as dependências de domínio de um módulo, retornando os códigos de
 * domínio que precisam estar licenciados. Detecta dependências não satisfeitas.
 */
export function resolveDomainDependencies(
  dependencies: readonly ModuleDependency[],
  licensedCodes: ReadonlySet<string>,
): { satisfied: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const dep of dependencies) {
    if (dep.kind === "domain" && dep.required && !licensedCodes.has(dep.dependsOn)) {
      missing.push(dep.dependsOn);
    }
  }
  return { satisfied: missing.length === 0, missing };
}
