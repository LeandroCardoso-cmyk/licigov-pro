/**
 * RC-4.4 — Institutional Legal Ontology (ontologia jurídica permanente).
 *
 * Modelo ÚNICO da ESTRUTURA do conhecimento jurídico das contratações públicas:
 * Hierarquia → Conceitos → Estruturas → Relacionamentos → Dependências → Classificações.
 * Totalmente DECLARATIVO, determinístico e INDEPENDENTE de qualquer lei/tribunal/país.
 * NÃO ensina conteúdo jurídico. Reutilizável por KG, AIExecutionEngine, Prompt Builders,
 * Copilotos, Business Domains, Institutional Reasoning e Document Engine — somente consulta.
 */

import { createHash } from "crypto";
import {
  NORM_TYPES, ALL_NORM_TYPE_IDS, NORMATIVE_HIERARCHY, ALL_LEGAL_CLASSIFICATIONS,
  isNormType, normsByClassification, type NormTypeId, type LegalClassification,
} from "./normTypes";
import { NORM_STRUCTURE, ALL_STRUCTURAL_ELEMENT_IDS, isStructuralElement, type StructuralElementId } from "./normStructure";
import { LEGAL_CONCEPTS, ALL_LEGAL_CONCEPT_IDS, isLegalConcept } from "./legalConcepts";

// ─── Part 4 — Relacionamentos jurídicos ───────────────────────────────────────

export type LegalRelationshipKind =
  | "complementa" | "revoga" | "altera" | "regulamenta" | "referencia" | "fundamenta"
  | "contradiz" | "excepciona" | "detalha" | "depende" | "hierarquia";

export interface LegalRelationship { readonly kind: LegalRelationshipKind; readonly from: NormTypeId; readonly to: NormTypeId; }

export const LEGAL_RELATIONSHIPS: readonly LegalRelationship[] = [
  // hierarquia (superior → inferior)
  { kind: "hierarquia", from: "lei", to: "decreto" },
  { kind: "hierarquia", from: "decreto", to: "instrucao_normativa" },
  { kind: "hierarquia", from: "instrucao_normativa", to: "portaria" },
  { kind: "hierarquia", from: "portaria", to: "orientacao_tecnica" },
  { kind: "hierarquia", from: "orientacao_tecnica", to: "manual" },
  { kind: "hierarquia", from: "manual", to: "nota_tecnica" },
  // regulamenta / detalha / complementa
  { kind: "regulamenta", from: "decreto", to: "lei" },
  { kind: "regulamenta", from: "regulamento", to: "lei" },
  { kind: "detalha", from: "instrucao_normativa", to: "decreto" },
  { kind: "detalha", from: "portaria", to: "instrucao_normativa" },
  { kind: "complementa", from: "resolucao", to: "portaria" },
  // fundamenta / referencia
  { kind: "fundamenta", from: "acordao", to: "lei" },
  { kind: "fundamenta", from: "jurisprudencia", to: "lei" },
  { kind: "fundamenta", from: "parecer", to: "lei" },
  { kind: "referencia", from: "nota_tecnica", to: "manual" },
  { kind: "referencia", from: "doutrina", to: "lei" },
  // altera / revoga / excepciona (entre normas do mesmo nível)
  { kind: "altera", from: "lei", to: "lei" },
  { kind: "revoga", from: "lei", to: "lei" },
  { kind: "excepciona", from: "lei", to: "lei" },
  // contradiz (relação possível entre complementares)
  { kind: "contradiz", from: "portaria", to: "resolucao" },
  // depende
  { kind: "depende", from: "decreto", to: "lei" },
];

export const ALL_LEGAL_RELATIONSHIP_KINDS: LegalRelationshipKind[] = [
  "complementa", "revoga", "altera", "regulamenta", "referencia", "fundamenta",
  "contradiz", "excepciona", "detalha", "depende", "hierarquia",
];

export function getLegalRelationships(kind?: LegalRelationshipKind): readonly LegalRelationship[] {
  return kind ? LEGAL_RELATIONSHIPS.filter(r => r.kind === kind) : LEGAL_RELATIONSHIPS;
}

// ─── Part 9 — Consulta (query API para o Engine/domínios) ────────────────────

export function getHierarchyLevel(id: NormTypeId): number { return NORM_TYPES[id].hierarchyLevel; }
export function getNormDependencies(id: NormTypeId): NormTypeId[] { return [...NORM_TYPES[id].dependsOn]; }
export { getNormType } from "./normTypes";
export { getStructuralElement, structuralPath } from "./normStructure";
export { getLegalConcept } from "./legalConcepts";
export { normsByClassification };

// ─── Part 7 — Modelo jurídico único ───────────────────────────────────────────

export const LEGAL_ONTOLOGY = {
  normTypes: NORM_TYPES,
  structure: NORM_STRUCTURE,
  concepts: LEGAL_CONCEPTS,
  relationships: LEGAL_RELATIONSHIPS,
  classifications: ALL_LEGAL_CLASSIFICATIONS,
  hierarchy: NORMATIVE_HIERARCHY,
} as const;

export function legalOntologyFingerprint(): string {
  const payload = JSON.stringify({
    norms: ALL_NORM_TYPE_IDS, structure: ALL_STRUCTURAL_ELEMENT_IDS, concepts: ALL_LEGAL_CONCEPT_IDS,
    relationships: LEGAL_RELATIONSHIPS.length, classifications: ALL_LEGAL_CLASSIFICATIONS,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

// ─── Part 8 — Projeção Knowledge Graph ────────────────────────────────────────

export type LegalNodeType = "norm_type" | "structure" | "concept" | "classification";
export interface LegalOntologyNode { readonly id: string; readonly type: LegalNodeType; readonly category: string; readonly label: string; readonly level?: number; }
export interface LegalOntologyEdge { readonly from: string; readonly to: string; readonly type: string; }

export function toLegalOntologyNodes(): LegalOntologyNode[] {
  const nodes: LegalOntologyNode[] = [
    ...ALL_NORM_TYPE_IDS.map(id => ({ id: `norm:${id}`, type: "norm_type" as const, category: NORM_TYPES[id].classification, label: NORM_TYPES[id].name, level: NORM_TYPES[id].hierarchyLevel })),
    ...ALL_STRUCTURAL_ELEMENT_IDS.map(id => ({ id: `struct:${id}`, type: "structure" as const, category: "estrutura", label: NORM_STRUCTURE[id].name, level: NORM_STRUCTURE[id].level })),
    ...ALL_LEGAL_CONCEPT_IDS.map(id => ({ id: `concept:${id}`, type: "concept" as const, category: LEGAL_CONCEPTS[id].category, label: LEGAL_CONCEPTS[id].name })),
    ...ALL_LEGAL_CLASSIFICATIONS.map(c => ({ id: `class:${c}`, type: "classification" as const, category: "taxonomia", label: c })),
  ];
  return nodes.sort((a, b) => a.id.localeCompare(b.id));
}

export function toLegalOntologyEdges(): LegalOntologyEdge[] {
  const edges: LegalOntologyEdge[] = [];
  for (const r of LEGAL_RELATIONSHIPS) edges.push({ from: `norm:${r.from}`, to: `norm:${r.to}`, type: r.kind });
  for (const id of ALL_NORM_TYPE_IDS) {
    for (const dep of NORM_TYPES[id].dependsOn) edges.push({ from: `norm:${id}`, to: `norm:${dep}`, type: "depends_on" });
    edges.push({ from: `norm:${id}`, to: `class:${NORM_TYPES[id].classification}`, type: "classified_as" });
  }
  for (const id of ALL_STRUCTURAL_ELEMENT_IDS) {
    for (const child of NORM_STRUCTURE[id].children) edges.push({ from: `struct:${id}`, to: `struct:${child}`, type: "contains" });
  }
  return edges.sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));
}

// ─── Part 10 — Validação de consistência (hierarquia válida, zero ciclos) ─────

function detectCycle(adjacency: Record<string, readonly string[]>): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  const ids = Object.keys(adjacency);
  for (const id of ids) color[id] = WHITE;
  const dfs = (id: string): boolean => {
    color[id] = GRAY;
    for (const dep of adjacency[id] ?? []) { if (color[dep] === GRAY) return true; if (color[dep] === WHITE && dfs(dep)) return true; }
    color[id] = BLACK; return false;
  };
  return ids.some(id => color[id] === WHITE && dfs(id));
}

export interface LegalOntologyValidation { readonly valid: boolean; readonly errors: readonly string[]; }

export function validateLegalOntology(): LegalOntologyValidation {
  const errors: string[] = [];

  // Tipos normativos: classificação/dependências válidas + hierarquia monotônica.
  for (const id of ALL_NORM_TYPE_IDS) {
    const n = NORM_TYPES[id];
    if (!ALL_LEGAL_CLASSIFICATIONS.includes(n.classification)) errors.push(`norma ${id} com classificação inválida: ${n.classification}`);
    for (const dep of n.dependsOn) {
      if (!isNormType(dep)) { errors.push(`norma ${id} → dependência inválida ${dep}`); continue; }
      if (NORM_TYPES[dep].hierarchyLevel >= n.hierarchyLevel) errors.push(`hierarquia inválida: ${id}(${n.hierarchyLevel}) depende de ${dep}(${NORM_TYPES[dep].hierarchyLevel})`);
    }
  }
  // Dependências normativas acíclicas.
  const normAdj: Record<string, readonly string[]> = {};
  for (const id of ALL_NORM_TYPE_IDS) normAdj[id] = NORM_TYPES[id].dependsOn;
  if (detectCycle(normAdj)) errors.push("ciclo no grafo de dependências normativas");

  // Estrutura: pai/filho consistentes + árvore acíclica.
  for (const id of ALL_STRUCTURAL_ELEMENT_IDS) {
    const s = NORM_STRUCTURE[id];
    if (s.parent !== null && !isStructuralElement(s.parent)) errors.push(`estrutura ${id} → pai inválido ${s.parent}`);
    for (const c of s.children) {
      if (!isStructuralElement(c)) { errors.push(`estrutura ${id} → filho inválido ${c}`); continue; }
      if (NORM_STRUCTURE[c].parent !== id) errors.push(`estrutura ${id}→${c}: filho não reconhece o pai`);
    }
  }
  const structAdj: Record<string, readonly string[]> = {};
  for (const id of ALL_STRUCTURAL_ELEMENT_IDS) structAdj[id] = NORM_STRUCTURE[id].children;
  if (detectCycle(structAdj)) errors.push("ciclo na árvore estrutural da norma");

  // Conceitos: categoria presente.
  for (const id of ALL_LEGAL_CONCEPT_IDS) if (!LEGAL_CONCEPTS[id].category) errors.push(`conceito ${id} sem categoria`);

  // Relacionamentos: extremos válidos.
  for (const r of LEGAL_RELATIONSHIPS) {
    if (!isNormType(r.from)) errors.push(`relacionamento com origem inválida: ${r.from}`);
    if (!isNormType(r.to)) errors.push(`relacionamento com destino inválido: ${r.to}`);
  }

  return { valid: errors.length === 0, errors };
}

// Re-exports para consulta/validação externa.
export {
  ALL_NORM_TYPE_IDS, ALL_LEGAL_CLASSIFICATIONS, NORMATIVE_HIERARCHY, isNormType,
} from "./normTypes";
export { ALL_STRUCTURAL_ELEMENT_IDS, isStructuralElement } from "./normStructure";
export { ALL_LEGAL_CONCEPT_IDS, isLegalConcept, conceptsByCategory } from "./legalConcepts";
