/**
 * RC-4.6.2 — Knowledge Binding Framework · Binding Registry (Part 1).
 *
 * Registro APPEND-ONLY e multi-tenant de bindings. Nunca sobrescreve — novas versões acumulam.
 * Determinístico. Sem banco.
 */

import { type KnowledgeBinding } from "./knowledgeBinding";

export interface KnowledgeBindingRegistry {
  readonly bindings: readonly KnowledgeBinding[];
}

export function createKnowledgeBindingRegistry(bindings: KnowledgeBinding[] = []): KnowledgeBindingRegistry {
  const sorted = [...bindings].sort((a, b) => a.bindingId.localeCompare(b.bindingId));
  return { bindings: sorted };
}

/**
 * Adiciona um binding (append-only; idempotente por bindingId). Isolamento multi-tenant:
 * bindings de tenants distintos convivem, mas cada operação usa o tenant do binding.
 */
export function addBinding(registry: KnowledgeBindingRegistry, binding: KnowledgeBinding): KnowledgeBindingRegistry {
  if (registry.bindings.some(b => b.bindingId === binding.bindingId)) return registry;
  return createKnowledgeBindingRegistry([...registry.bindings, binding]);
}

export function getBinding(registry: KnowledgeBindingRegistry, bindingId: string): KnowledgeBinding | null {
  return registry.bindings.find(b => b.bindingId === bindingId) ?? null;
}

/** Bindings de um tenant (isolamento). */
export function bindingsForTenant(registry: KnowledgeBindingRegistry, tenantId: number): KnowledgeBinding[] {
  return registry.bindings.filter(b => b.tenantId === tenantId).sort((a, b) => a.bindingId.localeCompare(b.bindingId));
}
