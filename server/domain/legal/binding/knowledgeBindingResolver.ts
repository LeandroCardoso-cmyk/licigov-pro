/**
 * RC-4.6.2 — Knowledge Binding Framework · Resolution (Part 5).
 *
 * Resolve bindings a partir do registro: bindings ativos, versões, por nó normativo (artigo),
 * por KnowledgeUnit e múltiplos bindings. Determinístico. Sem banco.
 */

import type { KnowledgeBindingRegistry } from "./knowledgeBindingRegistry";
import type { KnowledgeBinding } from "./knowledgeBinding";
import { buildBindingChains, latestBindingVersion, type BindingVersion } from "./bindingVersion";

/** Última versão de cada linhagem com status "active". Determinístico. */
export function resolveActiveBindings(registry: KnowledgeBindingRegistry): KnowledgeBinding[] {
  const byId = new Map(registry.bindings.map(b => [b.bindingId, b]));
  const active: KnowledgeBinding[] = [];
  for (const chain of buildBindingChains(registry.bindings)) {
    const latest = latestBindingVersion(chain);
    if (latest && byId.get(latest.bindingId)?.status === "active") active.push(byId.get(latest.bindingId)!);
  }
  return active.sort((a, b) => a.bindingId.localeCompare(b.bindingId));
}

/** Todas as versões de uma linhagem (ordem crescente). */
export function listVersions(registry: KnowledgeBindingRegistry, lineageId: string): BindingVersion[] {
  const chain = buildBindingChains(registry.bindings).find(c => c.lineageId === lineageId);
  return chain ? [...chain.versions] : [];
}

/** Bindings de um nó normativo (artigo). */
export function findByNode(registry: KnowledgeBindingRegistry, normativeNodeId: string): KnowledgeBinding[] {
  return registry.bindings.filter(b => b.normativeNodeId === normativeNodeId).sort((a, b) => a.bindingId.localeCompare(b.bindingId));
}

/** Bindings de uma KnowledgeUnit. */
export function findByKnowledgeUnit(registry: KnowledgeBindingRegistry, knowledgeUnitId: string): KnowledgeBinding[] {
  return registry.bindings.filter(b => b.knowledgeUnitId === knowledgeUnitId).sort((a, b) => a.bindingId.localeCompare(b.bindingId));
}

/** Resolve múltiplos bindings ativos para um conjunto de nós normativos. */
export function resolveMultiple(registry: KnowledgeBindingRegistry, normativeNodeIds: readonly string[]): KnowledgeBinding[] {
  const active = resolveActiveBindings(registry);
  const wanted = new Set(normativeNodeIds);
  return active.filter(b => wanted.has(b.normativeNodeId)).sort((a, b) => a.bindingId.localeCompare(b.bindingId));
}

/** Binding ativo (última versão active) de uma linhagem, se houver. */
export function resolveActiveForLineage(registry: KnowledgeBindingRegistry, lineageId: string): KnowledgeBinding | null {
  return resolveActiveBindings(registry).find(b => b.lineageId === lineageId) ?? null;
}
