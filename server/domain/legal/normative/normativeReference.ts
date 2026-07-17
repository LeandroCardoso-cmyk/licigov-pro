/**
 * RC-4.6.1 — Federal Procurement Corpus · Cross References & Relationships (Part 5).
 *
 * Suporte declarativo para referências internas, remissões, dependências, correlação entre artigos
 * e normas regulamentadoras — SEM conteúdo. Determinístico. Reutilizável para qualquer norma.
 */

import { createHash } from "crypto";

/** Tipos de referência/relação entre nós normativos. */
export type NormativeReferenceType =
  | "referencia_interna" | "remissao" | "dependencia" | "correlacao" | "regulamentadora";

export type NormativeReferenceDirection = "unidirectional" | "bidirectional";

export interface NormativeReference {
  readonly id: string;
  /** Nó de origem. */
  readonly from: string;
  /** Nó de destino (pode ser de outra norma — compatibilidade futura, Part 10). */
  readonly to: string;
  readonly type: NormativeReferenceType;
  readonly direction: NormativeReferenceDirection;
  /** Explicação (explainability) — nunca implícita. */
  readonly explanation: string;
}

/**
 * NormativeRelationship — relação declarada explicitamente entre nós (correlação/dependência),
 * com força opcional. Reutiliza os mesmos tipos das referências.
 */
export interface NormativeRelationship {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: NormativeReferenceType;
  readonly strength: number;
  readonly explanation: string;
}

export const ALL_REFERENCE_TYPES: NormativeReferenceType[] = [
  "referencia_interna", "remissao", "dependencia", "correlacao", "regulamentadora",
];

const DEFAULT_DIRECTION: Record<NormativeReferenceType, NormativeReferenceDirection> = {
  referencia_interna: "unidirectional", remissao: "unidirectional", dependencia: "unidirectional",
  correlacao: "bidirectional", regulamentadora: "unidirectional",
};

export function createNormativeReference(p: {
  from: string; to: string; type: NormativeReferenceType; direction?: NormativeReferenceDirection; explanation: string;
}): NormativeReference {
  const id = createHash("sha256").update(`nref:${p.type}:${p.from}:${p.to}`).digest("hex").slice(0, 20);
  return { id, from: p.from, to: p.to, type: p.type, direction: p.direction ?? DEFAULT_DIRECTION[p.type], explanation: p.explanation };
}

export function createNormativeRelationship(p: {
  source: string; target: string; type: NormativeReferenceType; strength?: number; explanation: string;
}): NormativeRelationship {
  const id = createHash("sha256").update(`nrel:${p.type}:${p.source}:${p.target}`).digest("hex").slice(0, 20);
  return { id, source: p.source, target: p.target, type: p.type, strength: p.strength ?? 0.8, explanation: p.explanation };
}

export function isReferenceType(t: string): t is NormativeReferenceType {
  return (ALL_REFERENCE_TYPES as readonly string[]).includes(t);
}
