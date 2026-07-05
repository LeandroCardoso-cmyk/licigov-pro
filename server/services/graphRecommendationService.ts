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

export interface Recommendation {
  readonly nodeId: string;
  readonly title: string;
  readonly score: number;
  readonly path: string[];
  readonly reason: string;
  readonly confidence: number;
}

function getActiveEdges(edges: GraphEdge[], orgId: number): GraphEdge[] {
  return edges.filter(e => e.organizationId === orgId && e.active);
}

function getActiveNodes(nodes: GraphNode[], orgId: number): GraphNode[] {
  return nodes.filter(n => n.organizationId === orgId && n.active);
}

function bfsWithPaths(
  nodes: GraphNode[],
  edges: GraphEdge[],
  startId: string,
  orgId: number,
  maxDepth: number
): Map<string, { path: string[]; totalWeight: number; confidence: number }> {
  const activeEdges = getActiveEdges(edges, orgId);
  const activeNodeIds = new Set(getActiveNodes(nodes, orgId).map(n => n.id));
  const results = new Map<string, { path: string[]; totalWeight: number; confidence: number }>();
  const visited = new Set<string>();

  const queue: Array<{ nodeId: string; path: string[]; weight: number; confidence: number; depth: number }> = [
    { nodeId: startId, path: [startId], weight: 0, confidence: 1.0, depth: 0 },
  ];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    for (const edge of activeEdges) {
      let neighbor: string | null = null;
      if (edge.sourceNodeId === current.nodeId) neighbor = edge.targetNodeId;
      else if (edge.targetNodeId === current.nodeId) neighbor = edge.sourceNodeId;

      if (neighbor && !visited.has(neighbor) && activeNodeIds.has(neighbor)) {
        visited.add(neighbor);
        const newPath = [...current.path, neighbor];
        const newWeight = current.weight + edge.weight;
        const newConfidence = current.confidence * edge.confidence;

        results.set(neighbor, {
          path: newPath,
          totalWeight: newWeight,
          confidence: newConfidence,
        });

        queue.push({
          nodeId: neighbor,
          path: newPath,
          weight: newWeight,
          confidence: newConfidence,
          depth: current.depth + 1,
        });
      }
    }
  }

  return results;
}

export function recommendRelated(
  nodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  orgId: number,
  maxResults?: number
): Recommendation[] {
  const limit = maxResults ?? 10;
  const reachable = bfsWithPaths(nodes, edges, nodeId, orgId, 3);
  const activeNodes = getActiveNodes(nodes, orgId);
  const nodeMap = new Map(activeNodes.map(n => [n.id, n]));

  const recommendations: Recommendation[] = [];

  for (const [nId, data] of reachable.entries()) {
    const node = nodeMap.get(nId);
    if (!node) continue;

    const score = data.totalWeight * data.confidence;
    recommendations.push({
      nodeId: nId,
      title: node.title,
      score,
      path: data.path,
      reason: `Related via ${data.path.length - 1} hop(s) with cumulative weight ${data.totalWeight.toFixed(2)}`,
      confidence: data.confidence,
    });
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function recommendClauses(
  processType: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  orgId: number
): Recommendation[] {
  const activeNodes = getActiveNodes(nodes, orgId);
  const clauseNodes = activeNodes.filter(n => n.nodeType === "clause");

  // Find nodes matching the process type
  const processNodes = activeNodes.filter(
    n => n.nodeType === "process_type" && n.normalizedTitle.includes(processType.toLowerCase())
  );

  if (processNodes.length === 0) {
    return clauseNodes.slice(0, 5).map(n => ({
      nodeId: n.id,
      title: n.title,
      score: n.confidence * 0.5,
      path: [n.id],
      reason: "General clause recommendation (no specific process type match)",
      confidence: n.confidence * 0.5,
    }));
  }

  const allRecommendations: Recommendation[] = [];

  for (const processNode of processNodes) {
    const reachable = bfsWithPaths(nodes, edges, processNode.id, orgId, 3);
    for (const [nId, data] of reachable.entries()) {
      const node = activeNodes.find(n => n.id === nId);
      if (!node || node.nodeType !== "clause") continue;

      const score = data.totalWeight * data.confidence;
      allRecommendations.push({
        nodeId: nId,
        title: node.title,
        score,
        path: data.path,
        reason: `Clause linked to process type "${processType}" via ${data.path.length - 1} hop(s)`,
        confidence: data.confidence,
      });
    }
  }

  return allRecommendations.sort((a, b) => b.score - a.score).slice(0, 10);
}

export function recommendLegalBasis(
  nodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  orgId: number
): Recommendation[] {
  const reachable = bfsWithPaths(nodes, edges, nodeId, orgId, 3);
  const activeNodes = getActiveNodes(nodes, orgId);
  const nodeMap = new Map(activeNodes.map(n => [n.id, n]));

  const recommendations: Recommendation[] = [];

  for (const [nId, data] of reachable.entries()) {
    const node = nodeMap.get(nId);
    if (!node || (node.nodeType !== "legislation" && node.nodeType !== "legal")) continue;

    const score = data.totalWeight * data.confidence;
    recommendations.push({
      nodeId: nId,
      title: node.title,
      score,
      path: data.path,
      reason: `Legal basis linked via ${data.path.length - 1} hop(s)`,
      confidence: data.confidence,
    });
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 10);
}

export function recommendRisks(
  nodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  orgId: number
): Recommendation[] {
  const reachable = bfsWithPaths(nodes, edges, nodeId, orgId, 3);
  const activeNodes = getActiveNodes(nodes, orgId);
  const nodeMap = new Map(activeNodes.map(n => [n.id, n]));

  const recommendations: Recommendation[] = [];

  for (const [nId, data] of reachable.entries()) {
    const node = nodeMap.get(nId);
    if (!node || node.nodeType !== "risk") continue;

    const score = data.totalWeight * data.confidence;
    recommendations.push({
      nodeId: nId,
      title: node.title,
      score,
      path: data.path,
      reason: `Risk identified via ${data.path.length - 1} hop(s) from source node`,
      confidence: data.confidence,
    });
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 10);
}

export function explainRecommendation(
  rec: Recommendation,
  nodes: GraphNode[],
  edges: GraphEdge[]
): string {
  if (rec.path.length <= 1) {
    return `Recommended "${rec.title}" (score: ${rec.score.toFixed(2)}). ${rec.reason}`;
  }

  const pathTitles: string[] = [];
  for (const nodeId of rec.path) {
    const node = nodes.find(n => n.id === nodeId);
    pathTitles.push(node ? node.title : nodeId);
  }

  const pathDescription = pathTitles.join(" -> ");
  return `Recommended "${rec.title}" (score: ${rec.score.toFixed(2)}, confidence: ${rec.confidence.toFixed(2)}). Path: ${pathDescription}. ${rec.reason}`;
}
