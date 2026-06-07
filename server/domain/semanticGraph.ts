import { createHash } from "crypto";

// ─── ID gen ────────────────────────────────────────────────────────────────────

let _counter = 0;

function genId(prefix: string): string {
  return createHash("sha256")
    .update(`${prefix}:${++_counter}:${Date.now()}`)
    .digest("hex")
    .slice(0, 20);
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type NodeType =
  | "item_tr"
  | "catmat"
  | "clause"
  | "justification"
  | "workflow"
  | "approval"
  | "parecer"
  | "decision"
  | "memory"
  | "document"
  | "evidence";

export type EdgeType =
  | "relates_to"
  | "supports"
  | "contradicts"
  | "references"
  | "derives_from"
  | "part_of"
  | "similar_to"
  | "precedes"
  | "approves"
  | "cites";

export interface SemanticNode {
  id: string;
  organizationId: number;
  type: NodeType;
  label: string;
  content: string;
  metadata: Record<string, unknown>;
  relevanceScore: number;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticEdge {
  id: string;
  organizationId: number;
  fromNodeId: string;
  toNodeId: string;
  edgeType: EdgeType;
  weight: number;
  evidence: string;
  lineage: string[];
  createdAt: string;
}

export interface SemanticGraph {
  id: string;
  organizationId: number;
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface PropagationResult {
  nodeId: string;
  propagatedScore: number;
  hops: number;
  path: string[];
}

// ─── In-memory store ───────────────────────────────────────────────────────────

const _graphs = new Map<number, SemanticGraph>();

// ─── Functions ─────────────────────────────────────────────────────────────────

export function getOrCreateGraph(organizationId: number): SemanticGraph {
  const existing = _graphs.get(organizationId);
  if (existing !== undefined) return existing;
  const now = new Date().toISOString();
  const graph: SemanticGraph = {
    id: genId("graph"),
    organizationId,
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  _graphs.set(organizationId, graph);
  return graph;
}

export function addNode(
  graph: SemanticGraph,
  params: {
    type: NodeType;
    label: string;
    content: string;
    relevanceScore?: number;
    confidence?: number;
    metadata?: Record<string, unknown>;
  },
): SemanticGraph {
  const now = new Date().toISOString();
  const node: SemanticNode = {
    id: genId("node"),
    organizationId: graph.organizationId,
    type: params.type,
    label: params.label,
    content: params.content,
    metadata: params.metadata ?? {},
    relevanceScore: params.relevanceScore ?? 0.5,
    confidence: params.confidence ?? 0.5,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...graph,
    nodes: [...graph.nodes, node],
    updatedAt: now,
  };
}

export function addEdge(
  graph: SemanticGraph,
  fromNodeId: string,
  toNodeId: string,
  edgeType: EdgeType,
  weight: number,
  evidence: string,
): SemanticGraph {
  const fromExists = graph.nodes.some(n => n.id === fromNodeId);
  const toExists = graph.nodes.some(n => n.id === toNodeId);
  if (!fromExists) throw new Error(`Node not found: ${fromNodeId}`);
  if (!toExists) throw new Error(`Node not found: ${toNodeId}`);

  const now = new Date().toISOString();
  const edge: SemanticEdge = {
    id: genId("edge"),
    organizationId: graph.organizationId,
    fromNodeId,
    toNodeId,
    edgeType,
    weight,
    evidence,
    lineage: [],
    createdAt: now,
  };
  return {
    ...graph,
    edges: [...graph.edges, edge],
    updatedAt: now,
  };
}

export function propagateRelevance(
  graph: SemanticGraph,
  nodeId: string,
  maxHops = 3,
): PropagationResult[] {
  const originNode = graph.nodes.find(n => n.id === nodeId);
  if (originNode === undefined) return [];

  const results = new Map<string, PropagationResult>();

  interface QueueEntry {
    nodeId: string;
    score: number;
    hops: number;
    path: string[];
  }

  const queue: QueueEntry[] = [
    { nodeId, score: originNode.relevanceScore, hops: 0, path: [nodeId] },
  ];
  const visited = new Set<string>([nodeId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.hops >= maxHops) continue;

    const outgoing = graph.edges.filter(e => e.fromNodeId === current.nodeId);

    for (const edge of outgoing) {
      if (visited.has(edge.toNodeId)) continue;
      visited.add(edge.toNodeId);

      const nextHops = current.hops + 1;
      const propagated = current.score * edge.weight * Math.pow(0.8, nextHops);
      const path = [...current.path, edge.toNodeId];

      results.set(edge.toNodeId, {
        nodeId: edge.toNodeId,
        propagatedScore: propagated,
        hops: nextHops,
        path,
      });

      queue.push({ nodeId: edge.toNodeId, score: propagated, hops: nextHops, path });
    }
  }

  return Array.from(results.values());
}

export function findRelated(
  graph: SemanticGraph,
  nodeId: string,
  edgeTypes?: EdgeType[],
  minWeight = 0,
): SemanticNode[] {
  const relevantEdges = graph.edges.filter(e => {
    if (e.fromNodeId !== nodeId) return false;
    if (e.weight < minWeight) return false;
    if (edgeTypes !== undefined && edgeTypes.length > 0 && !edgeTypes.includes(e.edgeType)) return false;
    return true;
  });

  const relatedIds = new Set(relevantEdges.map(e => e.toNodeId));
  return graph.nodes.filter(n => relatedIds.has(n.id));
}

export function computeGraphMetrics(graph: SemanticGraph): {
  nodeCount: number;
  edgeCount: number;
  avgDegree: number;
  mostConnected: SemanticNode | null;
  isolatedNodes: number;
} {
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const avgDegree = nodeCount === 0 ? 0 : (edgeCount * 2) / nodeCount;

  const degreeMap = new Map<string, number>();
  for (const node of graph.nodes) {
    degreeMap.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    degreeMap.set(edge.fromNodeId, (degreeMap.get(edge.fromNodeId) ?? 0) + 1);
    degreeMap.set(edge.toNodeId, (degreeMap.get(edge.toNodeId) ?? 0) + 1);
  }

  let mostConnected: SemanticNode | null = null;
  let maxDegree = -1;
  let isolatedNodes = 0;

  for (const node of graph.nodes) {
    const degree = degreeMap.get(node.id) ?? 0;
    if (degree === 0) isolatedNodes += 1;
    if (degree > maxDegree) {
      maxDegree = degree;
      mostConnected = node;
    }
  }

  return { nodeCount, edgeCount, avgDegree, mostConnected, isolatedNodes };
}

export function saveGraph(graph: SemanticGraph): void {
  _graphs.set(graph.organizationId, graph);
}

export function getGraph(organizationId: number): SemanticGraph | null {
  return _graphs.get(organizationId) ?? null;
}
