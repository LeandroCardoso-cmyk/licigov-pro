import { createHash } from "crypto";

export interface GraphNode {
  readonly id: string;
  readonly organizationId: number;
  readonly nodeType: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly confidence: number;
  readonly active: boolean;
}

export interface GraphEdge {
  readonly id: string;
  readonly organizationId: number;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly relationshipType: string;
  readonly weight: number;
  readonly confidence: number;
  readonly active: boolean;
}

export interface LegalRef {
  readonly id: string;
  readonly type: string;
  readonly numero: string;
  readonly ano: number;
  readonly artigo?: string;
}

export interface LegalHierarchyNode {
  readonly ref: LegalRef;
  readonly children: LegalHierarchyNode[];
}

export function buildLegalHierarchy(refs: LegalRef[]): LegalHierarchyNode[] {
  // Group: top-level is Lei/Decreto (no artigo), children are those with artigo matching the same type+numero+ano
  const topLevel = refs.filter(r => !r.artigo);
  const withArticle = refs.filter(r => !!r.artigo);

  const hierarchy: LegalHierarchyNode[] = [];

  for (const parent of topLevel) {
    const children = withArticle
      .filter(r => r.type === parent.type && r.numero === parent.numero && r.ano === parent.ano)
      .map(child => ({ ref: child, children: [] as LegalHierarchyNode[] }));

    hierarchy.push({ ref: parent, children });
  }

  // Orphan articles (no matching parent)
  const assignedIds = new Set<string>();
  for (const node of hierarchy) {
    for (const child of node.children) {
      assignedIds.add(child.ref.id);
    }
  }
  for (const ref of withArticle) {
    if (!assignedIds.has(ref.id)) {
      hierarchy.push({ ref, children: [] });
    }
  }

  return hierarchy;
}

export function findRelatedJurisprudence(
  articleId: string,
  allEdges: GraphEdge[],
  allNodes: GraphNode[],
  orgId: number
): GraphNode[] {
  const relatedNodeIds = new Set<string>();

  for (const edge of allEdges) {
    if (edge.organizationId !== orgId || !edge.active) continue;
    if (edge.sourceNodeId === articleId) relatedNodeIds.add(edge.targetNodeId);
    if (edge.targetNodeId === articleId) relatedNodeIds.add(edge.sourceNodeId);
  }

  return allNodes.filter(
    n => relatedNodeIds.has(n.id) && n.organizationId === orgId && n.active && n.nodeType === "jurisprudence"
  );
}

export function traceLegalPath(
  startRef: string,
  endRef: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  orgId: number
): string[] {
  const activeEdges = edges.filter(e => e.organizationId === orgId && e.active);
  const activeNodeIds = new Set(nodes.filter(n => n.organizationId === orgId && n.active).map(n => n.id));

  if (!activeNodeIds.has(startRef) || !activeNodeIds.has(endRef)) return [];
  if (startRef === endRef) return [startRef];

  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [startRef];
  visited.add(startRef);

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const edge of activeEdges) {
      let neighbor: string | null = null;
      if (edge.sourceNodeId === current) neighbor = edge.targetNodeId;
      else if (edge.targetNodeId === current) neighbor = edge.sourceNodeId;

      if (neighbor && !visited.has(neighbor) && activeNodeIds.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);

        if (neighbor === endRef) {
          const path: string[] = [];
          let node = endRef;
          while (node !== startRef) {
            path.unshift(node);
            node = parent.get(node)!;
          }
          path.unshift(startRef);
          return path;
        }

        queue.push(neighbor);
      }
    }
  }

  return [];
}

export function classifyLegalAuthority(refType: string): number {
  const normalized = refType.toLowerCase().replace(/[_\s-]+/g, "_").trim();

  const weights: Record<string, number> = {
    constituicao: 10,
    lei_complementar: 9,
    lei: 8,
    decreto: 7,
    portaria: 6,
    resolucao: 5,
  };

  return weights[normalized] ?? 3;
}

export function detectLegalConflicts(
  nodes: GraphNode[],
  edges: GraphEdge[],
  orgId: number
): Array<{ nodeA: string; nodeB: string; reason: string }> {
  const conflicts: Array<{ nodeA: string; nodeB: string; reason: string }> = [];

  const legalNodeIds = new Set(
    nodes.filter(n => n.organizationId === orgId && n.active && (n.nodeType === "legislation" || n.nodeType === "legal"))
      .map(n => n.id)
  );

  for (const edge of edges) {
    if (edge.organizationId !== orgId || !edge.active) continue;
    if (edge.relationshipType !== "contradicts") continue;
    if (legalNodeIds.has(edge.sourceNodeId) && legalNodeIds.has(edge.targetNodeId)) {
      conflicts.push({
        nodeA: edge.sourceNodeId,
        nodeB: edge.targetNodeId,
        reason: `Contradiction detected via edge ${edge.id} (relationship: contradicts)`,
      });
    }
  }

  return conflicts;
}
