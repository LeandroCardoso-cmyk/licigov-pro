/**
 * RC-4.5.1 — Institutional Corpus Framework · Knowledge Graph Projection (Part 7).
 *
 * Projeta o framework de corpus em nós/arestas para o Knowledge Graph: Corpus Nodes,
 * Collection Nodes, Ownership, Hierarchy e Grouping. NENHUM conhecimento novo é criado —
 * apenas a organização estrutural é projetada. Totalmente DETERMINÍSTICA (ordenação estável).
 * Alinha os ids de membros `legal_unit` com a projeção da Legal Knowledge Foundation (`lku:`).
 */

import type { CorpusFramework } from "./corpusFramework";

export interface CorpusGraphNode {
  readonly id: string;
  readonly semanticType: "corpus" | "collection";
  readonly attributes: Record<string, unknown>;
}
export interface CorpusGraphEdge {
  readonly from: string;
  readonly to: string;
  /** hierarchy (corpus→corpus), owns (corpus→collection), groups (collection→membro). */
  readonly type: "hierarchy" | "owns" | "groups";
}
export interface CorpusProjection {
  readonly nodes: readonly CorpusGraphNode[];
  readonly edges: readonly CorpusGraphEdge[];
}

function memberNodeId(kind: string, refId: string): string {
  return kind === "legal_unit" ? `lku:${refId}` : `${kind}:${refId}`;
}

/** Projeção determinística do framework de corpus. */
export function projectCorpusFramework(framework: CorpusFramework): CorpusProjection {
  const corpusNodes: CorpusGraphNode[] = framework.corpora.map(c => ({
    id: `corpus:${c.id}`,
    semanticType: "corpus" as const,
    attributes: { tenantId: c.tenantId, type: c.type, scope: c.scope, jurisdiction: c.jurisdiction, owner: c.owner, status: c.status, version: c.version, lineageId: c.lineageId },
  }));
  const collectionNodes: CorpusGraphNode[] = framework.collections.map(col => ({
    id: `collection:${col.id}`,
    semanticType: "collection" as const,
    attributes: { tenantId: col.tenantId, corpusId: col.corpusId, name: col.name, memberCount: col.members.length },
  }));
  const nodes = [...corpusNodes, ...collectionNodes].sort((a, b) => a.id.localeCompare(b.id));

  const edges: CorpusGraphEdge[] = [];
  // Hierarchy: pai → filho.
  for (const c of framework.corpora) {
    if (c.parentId) edges.push({ from: `corpus:${c.parentId}`, to: `corpus:${c.id}`, type: "hierarchy" });
  }
  // Ownership: corpus → coleção.
  for (const col of framework.collections) {
    edges.push({ from: `corpus:${col.corpusId}`, to: `collection:${col.id}`, type: "owns" });
    // Grouping: coleção → membro.
    for (const m of col.members) edges.push({ from: `collection:${col.id}`, to: memberNodeId(m.kind, m.refId), type: "groups" });
  }
  edges.sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));

  return { nodes, edges };
}
