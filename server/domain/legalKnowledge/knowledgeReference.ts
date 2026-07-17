/**
 * RC-4.5 — Legal Knowledge Foundation · KnowledgeReference (estrutura).
 *
 * Relação declarativa entre unidades de conhecimento jurídico. Cada referência tem força,
 * direção e EXPLICAÇÃO (explainability). Sem leis reais. Determinística.
 */

import { createHash } from "crypto";

export type KnowledgeReferenceType =
  | "supports" | "depends_on" | "derived_from" | "revokes" | "amends"
  | "interprets" | "implements" | "requires";

export type ReferenceDirection = "unidirectional" | "bidirectional";

export interface KnowledgeReference {
  readonly id: string;
  /** Unidade de origem. */
  readonly from: string;
  /** Unidade de destino. */
  readonly to: string;
  readonly type: KnowledgeReferenceType;
  /** Força da relação (0..1). */
  readonly strength: number;
  readonly direction: ReferenceDirection;
  /** Explicação (explainability) — nunca implícita. */
  readonly explanation: string;
}

export const ALL_REFERENCE_TYPES: KnowledgeReferenceType[] = [
  "supports", "depends_on", "derived_from", "revokes", "amends", "interprets", "implements", "requires",
];

const DEFAULT_DIRECTION: Record<KnowledgeReferenceType, ReferenceDirection> = {
  supports: "unidirectional", depends_on: "unidirectional", derived_from: "unidirectional", revokes: "unidirectional",
  amends: "unidirectional", interprets: "unidirectional", implements: "unidirectional", requires: "unidirectional",
};

export interface CreateKnowledgeReferenceParams {
  from: string; to: string; type: KnowledgeReferenceType;
  strength?: number; direction?: ReferenceDirection; explanation: string;
}

export function createKnowledgeReference(p: CreateKnowledgeReferenceParams): KnowledgeReference {
  const id = createHash("sha256").update(`kref:${p.type}:${p.from}:${p.to}`).digest("hex").slice(0, 20);
  return {
    id, from: p.from, to: p.to, type: p.type,
    strength: p.strength ?? 0.8, direction: p.direction ?? DEFAULT_DIRECTION[p.type], explanation: p.explanation,
  };
}

export function isReferenceType(t: string): t is KnowledgeReferenceType {
  return (ALL_REFERENCE_TYPES as readonly string[]).includes(t);
}
