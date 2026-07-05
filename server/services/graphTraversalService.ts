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

/**
 * Constrói um índice de adjacência O(E) para permitir traversal O(V+E) em vez
 * de O(V·E). Cada nó mapeia para as arestas incidentes (source e target).
 */
export function buildAdjacencyMap(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const map = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    (map.get(edge.sourceNodeId) ?? map.set(edge.sourceNodeId, []).get(edge.sourceNodeId)!).push(edge);
    (map.get(edge.targetNodeId) ?? map.set(edge.targetNodeId, []).get(edge.targetNodeId)!).push(edge);
  }
  return map;
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

/**
 * DFS iterativo (stack explícita) — elimina o risco de stack overflow do DFS
 * recursivo em grafos grandes/profundos. Usa adjacency map O(V+E).
 */
export function dfs(
  nodes: GraphNode[],
  edges: GraphEdge[],
  startId: string,
  orgId: number,
  maxDepth?: number
): TraversalResult {
  const activeEdges = getActiveEdgesForOrg(edges, orgId);
  const activeNodeIds = new Set(nodes.filter(n => n.organizationId === orgId && n.active).map(n => n.id));
  const adjacency = buildAdjacencyMap(activeEdges);

  const visited = new Set<string>();
  const visitedEdges: string[] = [];
  const visitedNodes: string[] = [];
  let totalWeight = 0;
  let maxReachedDepth = 0;
  const limit = maxDepth ?? 10;

  const stack: Array<{ nodeId: string; depth: number }> = [{ nodeId: startId, depth: 0 }];
  visited.add(startId);

  while (stack.length > 0) {
    const current = stack.pop()!;
    visitedNodes.push(current.nodeId);
    maxReachedDepth = Math.max(maxReachedDepth, current.depth);

    if (current.depth >= limit) continue;

    const adjacent = adjacency.get(current.nodeId) ?? [];
    // Push em ordem reversa para preservar ordem de visita pré-ordem
    for (let i = adjacent.length - 1; i >= 0; i--) {
      const edge = adjacent[i];
      const neighbor = getOtherNode(edge, current.nodeId);
      if (!visited.has(neighbor) && activeNodeIds.has(neighbor)) {
        visited.add(neighbor);
        visitedEdges.push(edge.id);
        totalWeight += edge.weight;
        stack.push({ nodeId: neighbor, depth: current.depth + 1 });
      }
    }
  }

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

export interface WeightedPathResult {
  readonly path: string[];
  readonly edges: string[];
  readonly totalCost: number;
  readonly totalWeight: number;
  readonly found: boolean;
}

/**
 * Weighted shortest path via Dijkstra. Como `weight` representa FORÇA da relação
 * (0-1, maior = mais forte), o custo de percorrer uma aresta é `1 - weight`
 * (arestas mais fortes = caminho "mais curto"/preferencial). Custos são sempre
 * não-negativos, garantindo a corretude do Dijkstra.
 */
export function dijkstra(
  nodes: GraphNode[],
  edges: GraphEdge[],
  startId: string,
  endId: string,
  orgId: number
): WeightedPathResult {
  const activeEdges = getActiveEdgesForOrg(edges, orgId);
  const activeNodeIds = new Set(nodes.filter(n => n.organizationId === orgId && n.active).map(n => n.id));

  if (!activeNodeIds.has(startId) || !activeNodeIds.has(endId)) {
    return { path: [], edges: [], totalCost: 0, totalWeight: 0, found: false };
  }
  if (startId === endId) {
    return { path: [startId], edges: [], totalCost: 0, totalWeight: 0, found: true };
  }

  const adjacency = buildAdjacencyMap(activeEdges);
  const dist = new Map<string, number>();
  const prev = new Map<string, { nodeId: string; edgeId: string; weight: number }>();
  const visited = new Set<string>();
  dist.set(startId, 0);

  // Fila de prioridade simples (array + extração do mínimo). Suficiente e
  // determinística; para grafos muito grandes trocar por heap binário.
  const pending = new Set<string>([startId]);

  while (pending.size > 0) {
    // Extrai nó com menor distância acumulada (tiebreak por id p/ determinismo)
    let current: string | null = null;
    let best = Infinity;
    for (const nodeId of pending) {
      const d = dist.get(nodeId) ?? Infinity;
      if (d < best || (d === best && (current === null || nodeId < current))) {
        best = d;
        current = nodeId;
      }
    }
    if (current === null) break;
    pending.delete(current);
    visited.add(current);

    if (current === endId) break;

    const adjacent = adjacency.get(current) ?? [];
    for (const edge of adjacent) {
      const neighbor = getOtherNode(edge, current);
      if (!activeNodeIds.has(neighbor) || visited.has(neighbor)) continue;
      const cost = 1 - Math.max(0, Math.min(1, edge.weight));
      const alt = (dist.get(current) ?? Infinity) + cost;
      if (alt < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, alt);
        prev.set(neighbor, { nodeId: current, edgeId: edge.id, weight: edge.weight });
        pending.add(neighbor);
      }
    }
  }

  if (!prev.has(endId)) {
    return { path: [], edges: [], totalCost: 0, totalWeight: 0, found: false };
  }

  const path: string[] = [];
  const pathEdges: string[] = [];
  let totalWeight = 0;
  let node = endId;
  while (node !== startId) {
    path.unshift(node);
    const p = prev.get(node)!;
    pathEdges.unshift(p.edgeId);
    totalWeight += p.weight;
    node = p.nodeId;
  }
  path.unshift(startId);

  return {
    path,
    edges: pathEdges,
    totalCost: dist.get(endId) ?? 0,
    totalWeight,
    found: true,
  };
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
