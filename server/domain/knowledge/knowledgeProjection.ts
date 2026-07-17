/**
 * RC-4.7 — Institutional Knowledge Framework · Graph Projection (Part 8).
 *
 * Projeta um KnowledgeDocument para o Knowledge Graph: Document, Block, Relationship, Reference,
 * Lifecycle, Version e Health. Determinística (ordenação estável). SEM conteúdo jurídico.
 */

import type { KnowledgeDocument } from "./knowledgeDocument";
import { allBlocks } from "./knowledgeDocument";
import { computeQuality } from "./knowledgeQuality";

export interface KnowledgeGraphNode {
  readonly id: string;
  readonly semanticType: "document" | "block" | "lifecycle" | "version" | "health";
  readonly attributes: Record<string, unknown>;
}
export interface KnowledgeGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}
export interface KnowledgeGraphProjection {
  readonly nodes: readonly KnowledgeGraphNode[];
  readonly edges: readonly KnowledgeGraphEdge[];
}

/** Projeção determinística de um documento de conhecimento. */
export function projectKnowledgeDocument(doc: KnowledgeDocument): KnowledgeGraphProjection {
  const docNode = `kdoc:${doc.id}`;
  const nodes: KnowledgeGraphNode[] = [{
    id: docNode, semanticType: "document",
    attributes: { tenantId: doc.tenantId, docKey: doc.docKey, title: doc.title, semver: doc.semver, revision: doc.revision, lineageId: doc.lineageId },
  }];
  const edges: KnowledgeGraphEdge[] = [];

  // Blocos.
  for (const b of allBlocks(doc)) {
    const bn = `kblock:${b.id}`;
    nodes.push({ id: bn, semanticType: "block", attributes: { kind: b.kind, order: b.order, fragments: b.fragments.length } });
    edges.push({ from: docNode, to: bn, type: "contains" });
  }
  // Lifecycle / Version / Health.
  nodes.push({ id: `klife:${doc.lifecycleState}`, semanticType: "lifecycle", attributes: {} });
  edges.push({ from: docNode, to: `klife:${doc.lifecycleState}`, type: "lifecycle" });
  nodes.push({ id: `kver:${doc.lineageId}:${doc.revision}`, semanticType: "version", attributes: { semver: doc.semver, revision: doc.revision } });
  edges.push({ from: docNode, to: `kver:${doc.lineageId}:${doc.revision}`, type: "version" });
  const health = computeQuality(doc).health;
  nodes.push({ id: `khealth:${doc.id}`, semanticType: "health", attributes: { status: health.status, score: health.score } });
  edges.push({ from: docNode, to: `khealth:${doc.id}`, type: "health" });

  // Referências / relacionamentos (tipados).
  for (const r of doc.references) edges.push({ from: docNode, to: `kref:${r.to}`, type: r.type });
  for (const r of doc.relationships) edges.push({ from: docNode, to: `krel:${r.target}`, type: r.type });

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));
  return { nodes, edges };
}
