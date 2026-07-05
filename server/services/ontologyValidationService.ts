/**
 * Sprint 4.8.1 — Ontology Validation Engine
 *
 * Impede a criação de relacionamentos inválidos no Knowledge Graph ANTES da
 * persistência. Implementa uma matriz de compatibilidade (sourceType,
 * relationshipType, targetType) refletindo a cadeia documental de licitações:
 *
 *   Lei → Artigo → Inciso → Acórdão → Parecer → Cláusula → TR → Processo → Contrato
 *
 * Funções puras, determinísticas, sem I/O. Multi-tenant é responsabilidade da
 * camada de persistência/router; aqui validamos apenas semântica de ontologia.
 */

import type { NodeType } from "../domain/knowledgeNode";
import type { RelationshipType } from "../domain/knowledgeEdge";

export interface OntologyValidationResult {
  readonly valid: boolean;
  readonly violations: string[];
  readonly relationshipType: RelationshipType;
  readonly sourceNodeType: string;
  readonly targetNodeType: string;
}

type NodeMatcher = NodeType | "*";

interface CompatPair {
  readonly source: NodeMatcher;
  readonly target: NodeMatcher;
}

/**
 * Matriz de compatibilidade. Para cada relationshipType, a lista de pares
 * (source, target) permitidos. "*" é curinga. Relações genéricas (references,
 * related_to) são permitidas entre quaisquer tipos; relações estruturais têm
 * pares específicos que refletem a hierarquia jurídico-documental.
 */
const COMPATIBILITY_MATRIX: Record<RelationshipType, CompatPair[]> = {
  // Genéricas — permitidas entre quaisquer nós
  references: [{ source: "*", target: "*" }],
  related_to: [{ source: "*", target: "*" }],

  regulates: [
    { source: "legislation", target: "article" },
    { source: "legislation", target: "clause" },
    { source: "legislation", target: "process" },
    { source: "legislation", target: "contract" },
    { source: "legislation", target: "concept" },
    { source: "article", target: "clause" },
    { source: "article", target: "technical_requirement" },
    { source: "article", target: "tr_item" },
  ],

  supersedes: [
    { source: "legislation", target: "legislation" },
    { source: "article", target: "article" },
    { source: "clause", target: "clause" },
    { source: "jurisprudence", target: "jurisprudence" },
    { source: "parecer", target: "parecer" },
  ],

  contradicts: [
    { source: "legislation", target: "legislation" },
    { source: "article", target: "article" },
    { source: "jurisprudence", target: "jurisprudence" },
    { source: "jurisprudence", target: "legislation" },
    { source: "jurisprudence", target: "article" },
    { source: "parecer", target: "parecer" },
  ],

  supports: [
    { source: "jurisprudence", target: "article" },
    { source: "jurisprudence", target: "legislation" },
    { source: "parecer", target: "clause" },
    { source: "parecer", target: "process" },
    { source: "document", target: "*" },
    { source: "ata", target: "process" },
  ],

  requires: [
    { source: "technical_requirement", target: "clause" },
    { source: "process", target: "technical_requirement" },
    { source: "process", target: "document" },
    { source: "clause", target: "clause" },
    { source: "contract", target: "clause" },
    { source: "tr_item", target: "catmat_item" },
    { source: "tr_item", target: "catser_item" },
  ],

  part_of: [
    { source: "article", target: "legislation" },
    { source: "clause", target: "technical_requirement" },
    { source: "clause", target: "contract" },
    { source: "technical_requirement", target: "process" },
    { source: "tr_item", target: "technical_requirement" },
    { source: "catmat_item", target: "tr_item" },
    { source: "catser_item", target: "tr_item" },
  ],

  instance_of: [
    { source: "*", target: "concept" },
    { source: "concept", target: "concept" },
  ],

  derived_from: [
    { source: "clause", target: "legislation" },
    { source: "clause", target: "article" },
    { source: "technical_requirement", target: "legislation" },
    { source: "technical_requirement", target: "document" },
    { source: "process", target: "technical_requirement" },
    { source: "contract", target: "process" },
    { source: "parecer", target: "jurisprudence" },
    { source: "ata", target: "process" },
  ],

  applies_to: [
    { source: "clause", target: "technical_requirement" },
    { source: "clause", target: "process" },
    { source: "clause", target: "contract" },
    { source: "legislation", target: "process" },
    { source: "article", target: "process" },
    { source: "jurisprudence", target: "process" },
    { source: "concept", target: "*" },
  ],

  supplies: [
    { source: "supplier", target: "contract" },
    { source: "supplier", target: "process" },
    { source: "supplier", target: "tr_item" },
    { source: "supplier", target: "catmat_item" },
    { source: "supplier", target: "catser_item" },
  ],

  risks: [
    { source: "risk", target: "process" },
    { source: "risk", target: "contract" },
    { source: "risk", target: "technical_requirement" },
    { source: "risk", target: "clause" },
  ],

  mitigates: [
    { source: "clause", target: "risk" },
    { source: "technical_requirement", target: "risk" },
    { source: "process", target: "risk" },
    { source: "parecer", target: "risk" },
  ],

  justifies: [
    { source: "parecer", target: "process" },
    { source: "parecer", target: "contract" },
    { source: "document", target: "process" },
    { source: "technical_requirement", target: "process" },
    { source: "article", target: "clause" },
    { source: "legislation", target: "clause" },
  ],

  precedes: [
    { source: "process", target: "contract" },
    { source: "technical_requirement", target: "process" },
    { source: "document", target: "document" },
  ],

  follows: [
    { source: "contract", target: "process" },
    { source: "process", target: "technical_requirement" },
    { source: "document", target: "document" },
  ],
};

/** Relações que NUNCA podem ser auto-referências (loop no mesmo nó). */
const NO_SELF_LOOP: ReadonlySet<RelationshipType> = new Set<RelationshipType>([
  "supersedes",
  "contradicts",
  "part_of",
  "derived_from",
  "precedes",
  "follows",
  "regulates",
]);

function pairMatches(pair: CompatPair, source: string, target: string): boolean {
  const sourceOk = pair.source === "*" || pair.source === source;
  const targetOk = pair.target === "*" || pair.target === target;
  return sourceOk && targetOk;
}

/**
 * Valida se um relacionamento é semanticamente aceitável na ontologia.
 * Retorna todas as violações encontradas (vazio = válido).
 */
export function validateEdge(
  sourceNodeType: string,
  targetNodeType: string,
  relationshipType: RelationshipType,
): OntologyValidationResult {
  const violations: string[] = [];

  const allowedPairs = COMPATIBILITY_MATRIX[relationshipType];
  if (!allowedPairs) {
    violations.push(
      `Relationship type desconhecido na ontologia: "${relationshipType}".`,
    );
    return {
      valid: false,
      violations,
      relationshipType,
      sourceNodeType,
      targetNodeType,
    };
  }

  const compatible = allowedPairs.some(pair =>
    pairMatches(pair, sourceNodeType, targetNodeType),
  );

  if (!compatible) {
    violations.push(
      `Relacionamento "${relationshipType}" não é permitido de "${sourceNodeType}" para "${targetNodeType}" pela ontologia de licitações.`,
    );
  }

  return {
    valid: violations.length === 0,
    violations,
    relationshipType,
    sourceNodeType,
    targetNodeType,
  };
}

/**
 * Valida uma aresta concreta, incluindo checagem de auto-referência.
 */
export function validateEdgeInstance(params: {
  sourceNodeId: string;
  targetNodeId: string;
  sourceNodeType: string;
  targetNodeType: string;
  relationshipType: RelationshipType;
}): OntologyValidationResult {
  const base = validateEdge(
    params.sourceNodeType,
    params.targetNodeType,
    params.relationshipType,
  );
  const violations = [...base.violations];

  if (
    params.sourceNodeId === params.targetNodeId &&
    NO_SELF_LOOP.has(params.relationshipType)
  ) {
    violations.push(
      `Auto-referência não permitida para o relacionamento "${params.relationshipType}".`,
    );
  }

  return {
    valid: violations.length === 0,
    violations,
    relationshipType: params.relationshipType,
    sourceNodeType: params.sourceNodeType,
    targetNodeType: params.targetNodeType,
  };
}

/** Lista os relationshipTypes válidos entre dois tipos de nó (para UI/sugestão). */
export function allowedRelationships(
  sourceNodeType: string,
  targetNodeType: string,
): RelationshipType[] {
  const result: RelationshipType[] = [];
  for (const rel of Object.keys(COMPATIBILITY_MATRIX) as RelationshipType[]) {
    if (validateEdge(sourceNodeType, targetNodeType, rel).valid) {
      result.push(rel);
    }
  }
  return result;
}
