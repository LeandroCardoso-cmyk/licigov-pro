import { createHash } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EvidenceEdgeRelationship =
  | "supports"
  | "contradicts"
  | "elaborates"
  | "supersedes";

export interface EvidenceNode {
  readonly id: string;
  readonly type: string;
  readonly content: string;
  readonly confidence: number;
  readonly source: string;
}

export interface EvidenceEdge {
  readonly from: string;
  readonly to: string;
  readonly relationship: EvidenceEdgeRelationship;
}

export interface EvidenceGraph {
  readonly nodes: readonly EvidenceNode[];
  readonly edges: readonly EvidenceEdge[];
}

export interface GroundingSession {
  readonly id: string;
  readonly organizationId: number;
  readonly queryId: string;
  readonly providerExecutionId: string | null;
  readonly groundingVersion: string;
  readonly evidenceGraph: EvidenceGraph;
  readonly finalPrompt: string;
  readonly groundingScore: number;
  readonly confidenceScore: number;
  readonly replaySnapshot: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

// ─── Functions ──────────────────────────────────────────────────────────────

export function createGroundingSession(params: {
  organizationId: number;
  queryId: string;
  providerExecutionId?: string | null;
  evidenceGraph?: EvidenceGraph;
  finalPrompt: string;
  groundingScore?: number;
  confidenceScore: number;
  correlationId: string;
}): GroundingSession {
  const id = createHash("sha256")
    .update(`gs:${params.organizationId}:${params.queryId}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  const graph = params.evidenceGraph ?? { nodes: [], edges: [] };
  const groundingScore = params.groundingScore ?? computeGroundingScore(graph);
  const session: GroundingSession = {
    id,
    organizationId: params.organizationId,
    queryId: params.queryId,
    providerExecutionId: params.providerExecutionId ?? null,
    groundingVersion: "1.0.0",
    evidenceGraph: graph,
    finalPrompt: params.finalPrompt,
    groundingScore,
    confidenceScore: params.confidenceScore,
    replaySnapshot: "",
    correlationId: params.correlationId,
    createdAt: new Date().toISOString(),
  };
  const snapshot = generateReplaySnapshot(session);
  return { ...session, replaySnapshot: snapshot };
}

export function buildEvidenceGraph(
  evidences: readonly { id: string; type: string; content: string; confidence: number; source: string }[],
  legalRefs: readonly { id: string; content: string; confidence: number; source: string }[],
): EvidenceGraph {
  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];

  for (const ev of evidences) {
    nodes.push({
      id: ev.id,
      type: ev.type,
      content: ev.content,
      confidence: ev.confidence,
      source: ev.source,
    });
  }

  for (const ref of legalRefs) {
    nodes.push({
      id: ref.id,
      type: "legal_reference",
      content: ref.content,
      confidence: ref.confidence,
      source: ref.source,
    });
  }

  // Create "supports" edges between items from the same source
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].source === nodes[j].source) {
        edges.push({
          from: nodes[i].id,
          to: nodes[j].id,
          relationship: "supports",
        });
      }
    }
  }

  return { nodes, edges };
}

export function computeGroundingScore(graph: EvidenceGraph): number {
  if (graph.nodes.length === 0) return 0;
  const totalConfidence = graph.nodes.reduce((sum, node) => sum + node.confidence, 0);
  return totalConfidence / graph.nodes.length;
}

export function generateReplaySnapshot(session: GroundingSession): string {
  const sortedKeys: Record<string, unknown> = {
    correlationId: session.correlationId,
    groundingVersion: session.groundingVersion,
    nodeIds: [...session.evidenceGraph.nodes.map(n => n.id)].sort(),
    organizationId: session.organizationId,
    queryId: session.queryId,
  };
  return JSON.stringify(sortedKeys);
}

export function verifyReplay(session: GroundingSession, snapshot: string): boolean {
  return generateReplaySnapshot(session) === snapshot;
}
