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

export interface GraphMetric {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly tags: Record<string, string>;
  readonly organizationId: number;
  readonly recordedAt: string;
}

export interface GraphHealth {
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly orphanNodes: number;
  readonly avgDegree: number;
  readonly coverage: number;
  readonly healthScore: number;
}

export function recordGraphMetric(metric: GraphMetric): void {
  console.info(JSON.stringify({
    event: "graph_metric",
    name: metric.name,
    value: metric.value,
    unit: metric.unit,
    tags: metric.tags,
    organizationId: metric.organizationId,
    recordedAt: metric.recordedAt,
  }));
}

export function recordTraversalLatency(correlationId: string, ms: number, orgId: number): void {
  console.info(JSON.stringify({
    event: "traversal_latency",
    correlationId,
    latencyMs: ms,
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  }));
}

export function recordNodeCreation(correlationId: string, nodeType: string, orgId: number): void {
  console.info(JSON.stringify({
    event: "node_creation",
    correlationId,
    nodeType,
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  }));
}

export function recordEdgeCreation(correlationId: string, relType: string, orgId: number): void {
  console.info(JSON.stringify({
    event: "edge_creation",
    correlationId,
    relationshipType: relType,
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  }));
}

export function recordResolutionAttempt(correlationId: string, success: boolean, orgId: number): void {
  console.info(JSON.stringify({
    event: "resolution_attempt",
    correlationId,
    success,
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  }));
}

export function recordRecommendation(correlationId: string, count: number, orgId: number): void {
  console.info(JSON.stringify({
    event: "recommendation",
    correlationId,
    count,
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  }));
}

export function computeGraphHealth(nodes: GraphNode[], edges: GraphEdge[], orgId: number): GraphHealth {
  const activeNodes = nodes.filter(n => n.organizationId === orgId && n.active);
  const activeEdges = edges.filter(e => e.organizationId === orgId && e.active);

  const totalNodes = activeNodes.length;
  const totalEdges = activeEdges.length;

  // Find orphan nodes (nodes with no edges)
  const connectedNodeIds = new Set<string>();
  for (const edge of activeEdges) {
    connectedNodeIds.add(edge.sourceNodeId);
    connectedNodeIds.add(edge.targetNodeId);
  }

  let orphanNodes = 0;
  for (const node of activeNodes) {
    if (!connectedNodeIds.has(node.id)) {
      orphanNodes++;
    }
  }

  const avgDegree = totalNodes > 0 ? (totalEdges * 2) / totalNodes : 0;
  const coverage = totalNodes > 0 ? (totalNodes - orphanNodes) / totalNodes : 0;
  const healthScore = totalNodes > 0 ? 1.0 - (orphanNodes / totalNodes) : 0;

  return {
    totalNodes,
    totalEdges,
    orphanNodes,
    avgDegree,
    coverage,
    healthScore,
  };
}
