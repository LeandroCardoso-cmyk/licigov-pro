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

export interface GraphQuery {
  readonly organizationId: number;
  readonly nodeType?: string;
  readonly query?: string;
  readonly maxResults?: number;
}

export function addNode(nodes: GraphNode[], node: GraphNode): GraphNode[] {
  const existing = nodes.find(n => n.id === node.id);
  if (existing) return nodes;
  return [...nodes, node];
}

export function addEdge(edges: GraphEdge[], edge: GraphEdge): GraphEdge[] {
  const existing = edges.find(e => e.id === edge.id);
  if (existing) return edges;
  return [...edges, edge];
}

export function searchNodes(nodes: GraphNode[], query: GraphQuery): GraphNode[] {
  let filtered = nodes.filter(n => n.organizationId === query.organizationId && n.active);
  if (query.nodeType) filtered = filtered.filter(n => n.nodeType === query.nodeType);
  if (query.query) {
    const q = query.query.toLowerCase();
    filtered = filtered.filter(n => n.normalizedTitle.includes(q) || n.title.toLowerCase().includes(q));
  }
  const max = query.maxResults ?? 20;
  return filtered.slice(0, max);
}

export function getNeighbors(nodes: GraphNode[], edges: GraphEdge[], nodeId: string, orgId: number): GraphNode[] {
  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (e.organizationId !== orgId || !e.active) continue;
    if (e.sourceNodeId === nodeId) neighborIds.add(e.targetNodeId);
    if (e.targetNodeId === nodeId) neighborIds.add(e.sourceNodeId);
  }
  return nodes.filter(n => neighborIds.has(n.id) && n.active);
}

export function getEdgesForNode(edges: GraphEdge[], nodeId: string, orgId: number): GraphEdge[] {
  return edges.filter(e => e.organizationId === orgId && e.active && (e.sourceNodeId === nodeId || e.targetNodeId === nodeId));
}

export function removeNode(nodes: GraphNode[], nodeId: string): GraphNode[] {
  return nodes.map(n => n.id === nodeId ? { ...n, active: false } : n);
}

export function removeEdge(edges: GraphEdge[], edgeId: string): GraphEdge[] {
  return edges.map(e => e.id === edgeId ? { ...e, active: false } : e);
}

export function graphStats(nodes: GraphNode[], edges: GraphEdge[], orgId: number): { nodeCount: number; edgeCount: number; avgDegree: number } {
  const activeNodes = nodes.filter(n => n.organizationId === orgId && n.active);
  const activeEdges = edges.filter(e => e.organizationId === orgId && e.active);
  return {
    nodeCount: activeNodes.length,
    edgeCount: activeEdges.length,
    avgDegree: activeNodes.length > 0 ? (activeEdges.length * 2) / activeNodes.length : 0,
  };
}
