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

export interface TraversalResult {
  readonly visitedNodes: string[];
  readonly visitedEdges: string[];
  readonly depth: number;
  readonly totalWeight: number;
}

export interface PathResult {
  readonly path: string[];
  readonly edges: string[];
  readonly totalWeight: number;
  readonly found: boolean;
}

function getActiveEdgesForOrg(edges: GraphEdge[], orgId: number): GraphEdge[] {
  return edges.filter(e => e.organizationId === orgId && e.active);
}

function getAdjacentEdges(edges: GraphEdge[], nodeId: string): GraphEdge[] {
  return edges.filter(e => e.sourceNodeId === nodeId || e.targetNodeId === nodeId);
}

function getOtherNode(edge: GraphEdge, nodeId: string): string {
  return edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId;
}

export function bfs(
  nodes: GraphNode[],
  edges: GraphEdge[],
  startId: string,
  orgId: number,
  maxDepth?: number
): TraversalResult {
  const activeEdges = getActiveEdgesForOrg(edges, orgId);
  const activeNodeIds = new Set(nodes.filter(n => n.organizationId === orgId && n.active).map(n => n.id));

  const visited = new Set<string>();
  const visitedEdges: string[] = [];
  const visitedNodes: string[] = [];
  let totalWeight = 0;
  let currentDepth = 0;
  const limit = maxDepth ?? 10;

  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startId, depth: 0 }];
  visited.add(startId);
  visitedNodes.push(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= limit) continue;
    currentDepth = Math.max(currentDepth, current.depth);

    const adjacent = getAdjacentEdges(activeEdges, current.nodeId);
    for (const edge of adjacent) {
      const neighbor = getOtherNode(edge, current.nodeId);
      if (!visited.has(neighbor) && activeNodeIds.has(neighbor)) {
        visited.add(neighbor);
        visitedNodes.push(neighbor);
        visitedEdges.push(edge.id);
        totalWeight += edge.weight;
        queue.push({ nodeId: neighbor, depth: current.depth + 1 });
      }
    }
  }

  return { visitedNodes, visitedEdges, depth: currentDepth, totalWeight };
}

export function dfs(
  nodes: GraphNode[],
  edges: GraphEdge[],
  startId: string,
  orgId: number,
  maxDepth?: number
): TraversalResult {
  const activeEdges = getActiveEdgesForOrg(edges, orgId);
  const activeNodeIds = new Set(nodes.filter(n => n.organizationId === orgId && n.active).map(n => n.id));

  const visited = new Set<string>();
  const visitedEdges: string[] = [];
  const visitedNodes: string[] = [];
  let totalWeight = 0;
  let maxReachedDepth = 0;
  const limit = maxDepth ?? 10;

  function visit(nodeId: string, depth: number): void {
    visited.add(nodeId);
    visitedNodes.push(nodeId);
    maxReachedDepth = Math.max(maxReachedDepth, depth);

    if (depth >= limit) return;

    const adjacent = getAdjacentEdges(activeEdges, nodeId);
    for (const edge of adjacent) {
      const neighbor = getOtherNode(edge, nodeId);
      if (!visited.has(neighbor) && activeNodeIds.has(neighbor)) {
        visitedEdges.push(edge.id);
        totalWeight += edge.weight;
        visit(neighbor, depth + 1);
      }
    }
  }

  visit(startId, 0);

  return { visitedNodes, visitedEdges, depth: maxReachedDepth, totalWeight };
}

export function shortestPath(
  nodes: GraphNode[],
  edges: GraphEdge[],
  startId: string,
  endId: string,
  orgId: number
): PathResult {
  const activeEdges = getActiveEdgesForOrg(edges, orgId);
  const activeNodeIds = new Set(nodes.filter(n => n.organizationId === orgId && n.active).map(n => n.id));

  if (!activeNodeIds.has(startId) || !activeNodeIds.has(endId)) {
    return { path: [], edges: [], totalWeight: 0, found: false };
  }

  if (startId === endId) {
    return { path: [startId], edges: [], totalWeight: 0, found: true };
  }

  const visited = new Set<string>();
  const parent = new Map<string, { nodeId: string; edgeId: string; weight: number }>();
  const queue: string[] = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const adjacent = getAdjacentEdges(activeEdges, current);

    for (const edge of adjacent) {
      const neighbor = getOtherNode(edge, current);
      if (!visited.has(neighbor) && activeNodeIds.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, { nodeId: current, edgeId: edge.id, weight: edge.weight });

        if (neighbor === endId) {
          // Reconstruct path
          const path: string[] = [];
          const pathEdges: string[] = [];
          let totalWeight = 0;
          let node = endId;

          while (node !== startId) {
            path.unshift(node);
            const p = parent.get(node)!;
            pathEdges.unshift(p.edgeId);
            totalWeight += p.weight;
            node = p.nodeId;
          }
          path.unshift(startId);

          return { path, edges: pathEdges, totalWeight, found: true };
        }

        queue.push(neighbor);
      }
    }
  }

  return { path: [], edges: [], totalWeight: 0, found: false };
}

export function weightedTraversal(
  nodes: GraphNode[],
  edges: GraphEdge[],
  startId: string,
  orgId: number,
  maxDepth?: number
): TraversalResult {
  const activeEdges = getActiveEdgesForOrg(edges, orgId);
  const activeNodeIds = new Set(nodes.filter(n => n.organizationId === orgId && n.active).map(n => n.id));

  const visited = new Set<string>();
  const visitedEdges: string[] = [];
  const visitedNodes: string[] = [];
  let totalWeight = 0;
  let maxReachedDepth = 0;
  const limit = maxDepth ?? 10;

  const queue: Array<{ nodeId: string; depth: number; weight: number }> = [
    { nodeId: startId, depth: 0, weight: 0 },
  ];
  visited.add(startId);
  visitedNodes.push(startId);

  while (queue.length > 0) {
    // Sort by weight descending (highest weight first)
    queue.sort((a, b) => b.weight - a.weight);
    const current = queue.shift()!;

    if (current.depth >= limit) continue;
    maxReachedDepth = Math.max(maxReachedDepth, current.depth);

    const adjacent = getAdjacentEdges(activeEdges, current.nodeId);
    // Sort edges by weight descending
    const sortedEdges = [...adjacent].sort((a, b) => b.weight - a.weight);

    for (const edge of sortedEdges) {
      const neighbor = getOtherNode(edge, current.nodeId);
      if (!visited.has(neighbor) && activeNodeIds.has(neighbor)) {
        visited.add(neighbor);
        visitedNodes.push(neighbor);
        visitedEdges.push(edge.id);
        totalWeight += edge.weight;
        queue.push({ nodeId: neighbor, depth: current.depth + 1, weight: edge.weight });
      }
    }
  }

  return { visitedNodes, visitedEdges, depth: maxReachedDepth, totalWeight };
}

export function explainPath(nodes: GraphNode[], edges: GraphEdge[], path: string[]): string {
  if (path.length === 0) return "Empty path.";
  if (path.length === 1) {
    const node = nodes.find(n => n.id === path[0]);
    return node ? `Single node: ${node.title}` : `Single node: ${path[0]}`;
  }

  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const node = nodes.find(n => n.id === path[i]);
    const title = node ? node.title : path[i];

    if (i < path.length - 1) {
      const nextNodeId = path[i + 1];
      const connectingEdge = edges.find(
        e =>
          (e.sourceNodeId === path[i] && e.targetNodeId === nextNodeId) ||
          (e.targetNodeId === path[i] && e.sourceNodeId === nextNodeId)
      );
      const rel = connectingEdge ? connectingEdge.relationshipType : "relates_to";
      parts.push(`${title} -[${rel}]-> `);
    } else {
      parts.push(title);
    }
  }

  return parts.join("");
}
