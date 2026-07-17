/**
 * RC-4.6.2 — Knowledge Binding Framework · Graph Projection (Part 6).
 *
 * Projeta os bindings para o Knowledge Graph: Binding, Knowledge Unit, Normative Node, Binding
 * Type e Lineage. Determinística (ordenação estável). Alinha ids de nó (`nn:`) com a projeção da
 * Normative Foundation (RC-4.6.1). SEM conteúdo jurídico.
 */

import type { KnowledgeBindingRegistry } from "./knowledgeBindingRegistry";

export interface BindingGraphNode {
  readonly id: string;
  readonly semanticType: "binding" | "knowledge_unit" | "normative_node" | "binding_type";
  readonly attributes: Record<string, unknown>;
}
export interface BindingGraphEdge {
  readonly from: string;
  readonly to: string;
  /** binds_node (binding→nó), binds_unit (binding→unidade), typed_as (binding→tipo), lineage. */
  readonly type: "binds_node" | "binds_unit" | "typed_as" | "lineage";
}
export interface BindingProjection {
  readonly nodes: readonly BindingGraphNode[];
  readonly edges: readonly BindingGraphEdge[];
}

/** Projeção determinística do registro de bindings. */
export function projectBindings(registry: KnowledgeBindingRegistry): BindingProjection {
  const nodeMap = new Map<string, BindingGraphNode>();
  const edges: BindingGraphEdge[] = [];

  for (const b of registry.bindings) {
    const bindingNodeId = `bind:${b.bindingId}`;
    nodeMap.set(bindingNodeId, {
      id: bindingNodeId, semanticType: "binding",
      attributes: { tenantId: b.tenantId, bindingType: b.bindingType, version: b.version, status: b.status, authority: b.authority, scope: b.scope, lineageId: b.lineageId },
    });
    nodeMap.set(`nn:${b.normativeNodeId}`, { id: `nn:${b.normativeNodeId}`, semanticType: "normative_node", attributes: { tenantId: b.tenantId } });
    nodeMap.set(`lku:${b.knowledgeUnitId}`, { id: `lku:${b.knowledgeUnitId}`, semanticType: "knowledge_unit", attributes: { tenantId: b.tenantId } });
    nodeMap.set(`btype:${b.bindingType}`, { id: `btype:${b.bindingType}`, semanticType: "binding_type", attributes: {} });

    edges.push({ from: bindingNodeId, to: `nn:${b.normativeNodeId}`, type: "binds_node" });
    edges.push({ from: bindingNodeId, to: `lku:${b.knowledgeUnitId}`, type: "binds_unit" });
    edges.push({ from: bindingNodeId, to: `btype:${b.bindingType}`, type: "typed_as" });
    edges.push({ from: bindingNodeId, to: `lineage:${b.lineageId}`, type: "lineage" });
  }

  const nodes = [...nodeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));
  return { nodes, edges };
}
