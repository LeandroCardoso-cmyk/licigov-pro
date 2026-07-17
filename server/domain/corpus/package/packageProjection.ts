/**
 * RC-4.6 — Federal Procurement Corpus Package · Knowledge Graph Projection (Part 7).
 *
 * Projeta um pacote de corpus em nós/arestas: Corpus Package node, Collection Nodes e Package
 * Dependencies. NENHUM conteúdo jurídico é criado. Determinística (ordenação estável).
 */

import type { CorpusPackage } from "./corpusPackage";

export interface PackageGraphNode {
  readonly id: string;
  readonly semanticType: "corpus_package" | "collection";
  readonly attributes: Record<string, unknown>;
}
export interface PackageGraphEdge {
  readonly from: string;
  readonly to: string;
  /** contains (package→collection), depends_on (collection→collection | package→package). */
  readonly type: "contains" | "depends_on";
}
export interface PackageProjection {
  readonly nodes: readonly PackageGraphNode[];
  readonly edges: readonly PackageGraphEdge[];
}

/** Projeção determinística de um pacote de corpus. */
export function projectCorpusPackage(pkg: CorpusPackage): PackageProjection {
  const packageNode: PackageGraphNode = {
    id: `pkg:${pkg.id}`,
    semanticType: "corpus_package",
    attributes: { tenantId: pkg.tenantId, name: pkg.manifest.name, version: pkg.version, authority: pkg.manifest.authority, jurisdiction: pkg.manifest.jurisdiction, scope: pkg.manifest.scope, lifecycle: pkg.lifecycle },
  };
  const collectionNodes: PackageGraphNode[] = pkg.collections.map(c => ({
    id: `col:${c.id}`,
    semanticType: "collection" as const,
    attributes: { tenantId: c.tenantId, name: c.name, category: c.category, version: c.version, authority: c.authority, knowledgeUnits: c.knowledgeUnits.length },
  }));
  const nodes = [packageNode, ...collectionNodes].sort((a, b) => a.id.localeCompare(b.id));

  const edges: PackageGraphEdge[] = [];
  // Package contém suas coleções.
  for (const c of pkg.collections) edges.push({ from: `pkg:${pkg.id}`, to: `col:${c.id}`, type: "contains" });
  // Dependências entre coleções.
  for (const c of pkg.collections) {
    for (const dep of c.dependencies) edges.push({ from: `col:${c.id}`, to: `col:${dep}`, type: "depends_on" });
  }
  // Dependências entre pacotes (declarativas).
  for (const d of pkg.manifest.dependencies) edges.push({ from: `pkg:${pkg.id}`, to: `pkgdep:${d.packageName}`, type: "depends_on" });

  edges.sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));
  return { nodes, edges };
}
