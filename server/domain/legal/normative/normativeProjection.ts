/**
 * RC-4.6.1 — Federal Procurement Corpus · Graph Projection (Part 6).
 *
 * Projeta a árvore normativa para o Knowledge Graph: Hierarchy, Normative Nodes, Relationships,
 * References e Lineage. Determinística (ordenação estável). SEM conteúdo jurídico.
 */

import type { NormativeTree } from "./normativeTree";
import { normativeDepth } from "./normativeHierarchy";

export interface NormativeGraphNode {
  readonly id: string;
  readonly semanticType: string;
  readonly attributes: Record<string, unknown>;
  readonly weight: number;
}
export interface NormativeGraphEdge {
  readonly from: string;
  readonly to: string;
  /** contains (hierarquia), <tipo de referência> ou lineage. */
  readonly type: string;
}
export interface NormativeProjection {
  readonly nodes: readonly NormativeGraphNode[];
  readonly edges: readonly NormativeGraphEdge[];
}

/** Projeção determinística da árvore normativa. Peso = 1/(profundidade+1) (raiz mais pesada). */
export function projectNormativeTree(tree: NormativeTree): NormativeProjection {
  const nodes: NormativeGraphNode[] = tree.nodes.map(n => ({
    id: `nn:${n.id}`,
    semanticType: n.type,
    attributes: { tenantId: n.tenantId, normId: n.normId, identifier: n.identifier, order: n.order, authority: n.authority, scope: n.scope, version: n.version, lineageId: n.lineageId, knowledgeUnitId: n.knowledgeUnitId },
    weight: Math.round((1 / (normativeDepth(n.type) + 1)) * 1000) / 1000,
  })).sort((a, b) => a.id.localeCompare(b.id));

  const edges: NormativeGraphEdge[] = [];
  // Hierarquia (pai contém filho) + lineage (nó → linhagem).
  for (const n of tree.nodes) {
    if (n.parent) edges.push({ from: `nn:${n.parent}`, to: `nn:${n.id}`, type: "contains" });
    edges.push({ from: `nn:${n.id}`, to: `lineage:${n.lineageId}`, type: "lineage" });
  }
  // Referências/relações tipadas.
  for (const r of tree.references) edges.push({ from: `nn:${r.from}`, to: `nn:${r.to}`, type: r.type });

  edges.sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));
  return { nodes, edges };
}
