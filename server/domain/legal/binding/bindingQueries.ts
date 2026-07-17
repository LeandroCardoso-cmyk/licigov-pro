/**
 * RC-4.6.2 — Knowledge Binding Framework · Declarative Queries (Part 7).
 *
 * Consultas declarativas sobre um KnowledgeBindingRegistry. Sem banco. Determinísticas.
 * Buscar binding por artigo, por tipo, KnowledgeUnits de um artigo, artigo de uma KnowledgeUnit,
 * listar versões e lineage.
 */

import type { KnowledgeBindingRegistry } from "./knowledgeBindingRegistry";
import type { KnowledgeBinding, BindingType } from "./knowledgeBinding";
import { buildBindingChains, type BindingVersion } from "./bindingVersion";
import { findByNode, findByKnowledgeUnit, listVersions } from "./knowledgeBindingResolver";

/** Bindings de um artigo (nó normativo). */
export function bindingsByArticle(registry: KnowledgeBindingRegistry, normativeNodeId: string): KnowledgeBinding[] {
  return findByNode(registry, normativeNodeId);
}

/** Bindings de um tipo específico. */
export function bindingsByType(registry: KnowledgeBindingRegistry, type: BindingType): KnowledgeBinding[] {
  return registry.bindings.filter(b => b.bindingType === type).sort((a, b) => a.bindingId.localeCompare(b.bindingId));
}

/** Ids das KnowledgeUnits vinculadas a um artigo (únicos, ordenados). */
export function knowledgeUnitsOfArticle(registry: KnowledgeBindingRegistry, normativeNodeId: string): string[] {
  return [...new Set(findByNode(registry, normativeNodeId).map(b => b.knowledgeUnitId))].sort((a, b) => a.localeCompare(b));
}

/** Ids dos artigos (nós normativos) vinculados a uma KnowledgeUnit (únicos, ordenados). */
export function articlesOfKnowledgeUnit(registry: KnowledgeBindingRegistry, knowledgeUnitId: string): string[] {
  return [...new Set(findByKnowledgeUnit(registry, knowledgeUnitId).map(b => b.normativeNodeId))].sort((a, b) => a.localeCompare(b));
}

/** Lista as versões de uma linhagem de binding. */
export function versionsOfLineage(registry: KnowledgeBindingRegistry, lineageId: string): BindingVersion[] {
  return listVersions(registry, lineageId);
}

/** Lista todas as linhagens presentes no registro (ordenadas). */
export function listLineages(registry: KnowledgeBindingRegistry): string[] {
  return buildBindingChains(registry.bindings).map(c => c.lineageId);
}
