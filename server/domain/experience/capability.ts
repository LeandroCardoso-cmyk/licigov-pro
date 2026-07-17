/**
 * RC-X.1 — Institutional Experience Framework · Capability Matrix (Part 3).
 *
 * Cada Capability representa uma CAPACIDADE do sistema (Processos, TR, ETP, Pesquisa de Preços,
 * Contratos, Convênios, Painéis, Analytics, Copilot) — NUNCA um menu. O CapabilityResolver
 * determina, para um InstitutionContext, quais capacidades estão habilitadas (licenciamento +
 * módulos). Declarativo, determinístico, multi-tenant.
 */

import type { InstitutionContext } from "./institutionContext";

export type CapabilityCategory =
  | "operacional" | "documento" | "pesquisa" | "contrato" | "convenio"
  | "painel" | "analytics" | "copilot" | "governanca";

export interface Capability {
  readonly id: string;
  readonly name: string;
  readonly category: CapabilityCategory;
  readonly description: string;
  /** Módulo (licenciamento) que habilita esta capacidade. */
  readonly requiredModule: string;
}

export interface CapabilityRegistry {
  readonly capabilities: readonly Capability[];
}

export function createCapabilityRegistry(capabilities: Capability[] = []): CapabilityRegistry {
  const sorted = [...capabilities].sort((a, b) => a.id.localeCompare(b.id));
  return { capabilities: sorted };
}

/** Registra uma capacidade (append-only; idempotente por id). */
export function registerCapability(registry: CapabilityRegistry, capability: Capability): CapabilityRegistry {
  if (registry.capabilities.some(c => c.id === capability.id)) return registry;
  return createCapabilityRegistry([...registry.capabilities, capability]);
}

export function getCapability(registry: CapabilityRegistry, id: string): Capability | null {
  return registry.capabilities.find(c => c.id === id) ?? null;
}

export interface ResolvedCapability {
  readonly capability: Capability;
  readonly enabled: boolean;
  /** Explicação da resolução (explainability). */
  readonly reason: string;
}

/**
 * Resolve as capacidades para um contexto. Uma capacidade está habilitada se:
 *  (1) seu `requiredModule` está em `enabledModules`, E
 *  (2) seu id está em `capabilities` (contratadas).
 * Determinístico (ordenação estável por id).
 */
export function resolveCapabilities(registry: CapabilityRegistry, context: InstitutionContext): ResolvedCapability[] {
  return registry.capabilities.map(capability => {
    const hasModule = context.enabledModules.includes(capability.requiredModule);
    const contracted = context.capabilities.includes(capability.id);
    const enabled = hasModule && contracted;
    const reason = enabled
      ? `Habilitada: módulo "${capability.requiredModule}" ativo e capacidade contratada.`
      : !hasModule
        ? `Bloqueada: módulo "${capability.requiredModule}" não habilitado.`
        : `Bloqueada: capacidade "${capability.id}" não contratada.`;
    return { capability, enabled, reason };
  }).sort((a, b) => a.capability.id.localeCompare(b.capability.id));
}

/** Ids das capacidades habilitadas para o contexto. */
export function enabledCapabilityIds(registry: CapabilityRegistry, context: InstitutionContext): string[] {
  return resolveCapabilities(registry, context).filter(r => r.enabled).map(r => r.capability.id);
}
