import { createHash } from "crypto";

export type RelationshipType =
  | "regulates"
  | "references"
  | "supersedes"
  | "contradicts"
  | "supports"
  | "requires"
  | "part_of"
  | "instance_of"
  | "related_to"
  | "derived_from"
  | "applies_to"
  | "supplies"
  | "risks"
  | "mitigates"
  | "justifies"
  | "precedes"
  | "follows";

export type EdgeDirection = "unidirectional" | "bidirectional";

export type OntologyValidationOutcome = "valid" | "invalid" | "unvalidated";

export interface KnowledgeEdge {
  readonly id: string;
  readonly organizationId: number;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly relationshipType: RelationshipType;
  readonly weight: number;
  readonly confidence: number;
  readonly justification: string;
  readonly provenance: string;
  readonly direction: EdgeDirection;
  readonly active: boolean;
  // ─── Sprint 4.8.1 — operational wiring (ontology + replay safety) ──────────
  readonly ontologyValidationResult: OntologyValidationOutcome;
  readonly relationshipVersion: number;
  readonly deterministicKey: string;
  readonly replayHash: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

/** Chave determinística canônica de uma aresta (independe de weight/confidence). */
export function computeDeterministicKey(params: {
  organizationId: number;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: RelationshipType;
}): string {
  return createHash("sha256")
    .update(`ke:${params.organizationId}:${params.sourceNodeId}:${params.targetNodeId}:${params.relationshipType}`)
    .digest("hex").slice(0, 20);
}

export function createKnowledgeEdge(params: {
  organizationId: number;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: RelationshipType;
  weight?: number;
  confidence?: number;
  justification?: string;
  provenance?: string;
  direction?: EdgeDirection;
  ontologyValidationResult?: OntologyValidationOutcome;
  correlationId?: string;
  createdAt?: string;
}): KnowledgeEdge {
  const deterministicKey = computeDeterministicKey(params);
  const id = deterministicKey;
  const weight = params.weight ?? 1.0;
  const confidence = params.confidence ?? 1.0;
  // replayHash cobre o estado semântico completo da aresta de forma determinística
  const replayHash = createHash("sha256")
    .update(`${deterministicKey}:${weight}:${confidence}:${params.direction ?? "unidirectional"}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    sourceNodeId: params.sourceNodeId,
    targetNodeId: params.targetNodeId,
    relationshipType: params.relationshipType,
    weight,
    confidence,
    justification: params.justification ?? "",
    provenance: params.provenance ?? "manual",
    direction: params.direction ?? "unidirectional",
    active: true,
    ontologyValidationResult: params.ontologyValidationResult ?? "unvalidated",
    relationshipVersion: 1,
    deterministicKey,
    replayHash,
    correlationId: params.correlationId ?? "",
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

export function reverseEdge(edge: KnowledgeEdge): KnowledgeEdge {
  return {
    ...edge,
    sourceNodeId: edge.targetNodeId,
    targetNodeId: edge.sourceNodeId,
  };
}

export function strengthenEdge(edge: KnowledgeEdge, boost: number): KnowledgeEdge {
  return { ...edge, weight: Math.min(1.0, edge.weight + boost) };
}

export function deactivateEdge(edge: KnowledgeEdge): KnowledgeEdge {
  return { ...edge, active: false };
}
