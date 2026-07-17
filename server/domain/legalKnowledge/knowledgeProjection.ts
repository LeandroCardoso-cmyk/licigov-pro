/**
 * RC-4.5 — Legal Knowledge Foundation · LegalKnowledgeProjection (Part 3).
 *
 * Projeta QUALQUER base de conhecimento jurídico em nós/arestas com atributos, peso,
 * importância e tipo semântico — para o Knowledge Graph. Totalmente DETERMINÍSTICA
 * (ordenação estável; importância derivada de hierarquia + grau de referência).
 */

import type { KnowledgeBase } from "./knowledgeBase";

export interface LegalKnowledgeNode {
  readonly id: string;
  readonly semanticType: string;
  readonly attributes: Record<string, unknown>;
  readonly weight: number;
  readonly importance: number;
}
export interface LegalKnowledgeEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
  readonly weight: number;
}
export interface LegalKnowledgeProjection {
  readonly nodes: readonly LegalKnowledgeNode[];
  readonly edges: readonly LegalKnowledgeEdge[];
}

/** Projeção determinística da base. Importância = f(hierarquia, grau de entrada). */
export function projectLegalKnowledge(base: KnowledgeBase): LegalKnowledgeProjection {
  // grau de entrada (quantas referências apontam para cada unidade)
  const inDegree = new Map<string, number>();
  for (const r of base.references) inDegree.set(r.to, (inDegree.get(r.to) ?? 0) + 1);

  const nodes: LegalKnowledgeNode[] = base.units.map(u => {
    const deg = inDegree.get(u.id) ?? 0;
    // hierarquia menor (mais alta) → maior importância; grau de entrada reforça.
    const importance = Math.round((1 / (u.hierarchy + 1) + deg * 0.1) * 1000) / 1000;
    return {
      id: `lku:${u.id}`,
      semanticType: u.type,
      attributes: { tenantId: u.tenantId, validity: u.validity, jurisdiction: u.jurisdiction, version: u.version, hierarchy: u.hierarchy, lineageId: u.lineageId },
      weight: Math.round((1 / (u.hierarchy + 1)) * 1000) / 1000,
      importance,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const edges: LegalKnowledgeEdge[] = base.references
    .map(r => ({ from: `lku:${r.from}`, to: `lku:${r.to}`, type: r.type, weight: r.strength }))
    .sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));

  return { nodes, edges };
}
