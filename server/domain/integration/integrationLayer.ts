/**
 * RC-4.4.1 — Ontology Integration Layer (camada semântica permanente).
 *
 * Conecta a Ontologia Operacional (RC-4.3) e a Ontologia Jurídica (RC-4.4) SEM acoplá-las:
 * mapa semântico, cross references, consultas, projeção Knowledge Graph e validação. Responde
 * "qual objeto operacional se relaciona a quais conceitos jurídicos?" — sem leis, sem artigos,
 * sem conteúdo jurídico, sem IA/Provider/RAG. Declarativo, determinístico, explicável.
 */

import { createHash } from "crypto";
import { SEMANTIC_LINKS, type SemanticLink, type OntologyRef, type OperatingRefKind, type LegalRefKind } from "./ontologyLinks";
import { SEMANTIC_LINK_TYPES, ALL_SEMANTIC_LINK_TYPE_IDS, ALL_LINK_CARDINALITIES, isSemanticLinkType, type SemanticLinkTypeId } from "./semanticLinkTypes";
// Ontologias (somente leitura — baixo acoplamento).
import { isInstitutionalRole } from "../institutional/roles";
import { isInstitutionalObject } from "../institutional/objects";
import { isInstitutionalState } from "../institutional/states";
import { isInstitutionalEvent } from "../institutional/events";
import { isLegalConcept } from "../legal/legalConcepts";
import { isStructuralElement } from "../legal/normStructure";
import { isNormType, ALL_LEGAL_CLASSIFICATIONS } from "../legal/normTypes";

// ─── Integridade referencial dos endpoints ────────────────────────────────────

export function refExists(ref: OntologyRef): boolean {
  if (ref.domain === "operating") {
    switch (ref.kind as OperatingRefKind) {
      case "role": return isInstitutionalRole(ref.id);
      case "object": return isInstitutionalObject(ref.id);
      case "state": return isInstitutionalState(ref.id);
      case "event": return isInstitutionalEvent(ref.id);
      default: return false;
    }
  }
  switch (ref.kind as LegalRefKind) {
    case "concept": return isLegalConcept(ref.id);
    case "structure": return isStructuralElement(ref.id);
    case "norm_type": return isNormType(ref.id);
    case "classification": return (ALL_LEGAL_CLASSIFICATIONS as readonly string[]).includes(ref.id);
    default: return false;
  }
}

const refKey = (r: OntologyRef) => `${r.domain}:${r.kind}:${r.id}`;
const nodeId = (r: OntologyRef) => refKey(r);

// ─── Part 5 — Consultas semânticas (API para o Engine/domínios) ───────────────

/** Todas as ligações que tocam a referência (origem ou destino). */
export function linksFor(ref: OntologyRef): SemanticLink[] {
  const k = refKey(ref);
  return SEMANTIC_LINKS.filter(l => refKey(l.from) === k || refKey(l.to) === k);
}

export function linksByType(type: SemanticLinkTypeId): SemanticLink[] {
  return SEMANTIC_LINKS.filter(l => l.linkType === type);
}

/** Conceitos jurídicos relacionados a um objeto operacional. */
export function conceptsForObject(objectId: string): string[] {
  const from = `operating:object:${objectId}`;
  return [...new Set(SEMANTIC_LINKS.filter(l => refKey(l.from) === from && l.to.domain === "legal" && l.to.kind === "concept").map(l => l.to.id))].sort();
}

/** Objetos operacionais relacionados a um conceito jurídico. */
export function objectsForConcept(conceptId: string): string[] {
  const to = `legal:concept:${conceptId}`;
  return [...new Set(SEMANTIC_LINKS.filter(l => refKey(l.to) === to && l.from.domain === "operating" && l.from.kind === "object").map(l => l.from.id))].sort();
}

/** Papéis relacionados a um conceito jurídico. */
export function rolesForConcept(conceptId: string): string[] {
  const to = `legal:concept:${conceptId}`;
  return [...new Set(SEMANTIC_LINKS.filter(l => refKey(l.to) === to && l.from.domain === "operating" && l.from.kind === "role").map(l => l.from.id))].sort();
}

/** Eventos relacionados a um conceito jurídico. */
export function eventsForConcept(conceptId: string): string[] {
  const to = `legal:concept:${conceptId}`;
  return [...new Set(SEMANTIC_LINKS.filter(l => refKey(l.to) === to && l.from.domain === "operating" && l.from.kind === "event").map(l => l.from.id))].sort();
}

/** Estados relacionados a um conceito jurídico. */
export function statesForConcept(conceptId: string): string[] {
  const to = `legal:concept:${conceptId}`;
  return [...new Set(SEMANTIC_LINKS.filter(l => refKey(l.to) === to && l.from.domain === "operating" && l.from.kind === "state").map(l => l.from.id))].sort();
}

// ─── Part 4 — Cross references ─────────────────────────────────────────────────

export interface OperatingCrossRef { readonly object: string; readonly concepts: readonly string[]; readonly structures: readonly string[]; readonly classifications: readonly string[]; }
export interface LegalCrossRef { readonly concept: string; readonly objects: readonly string[]; readonly roles: readonly string[]; readonly events: readonly string[]; readonly states: readonly string[]; }

export function operatingCrossRef(objectId: string): OperatingCrossRef {
  const from = `operating:object:${objectId}`;
  const outbound = SEMANTIC_LINKS.filter(l => refKey(l.from) === from && l.to.domain === "legal");
  return {
    object: objectId,
    concepts: [...new Set(outbound.filter(l => l.to.kind === "concept").map(l => l.to.id))].sort(),
    structures: [...new Set(outbound.filter(l => l.to.kind === "structure").map(l => l.to.id))].sort(),
    classifications: [...new Set(outbound.filter(l => l.to.kind === "classification").map(l => l.to.id))].sort(),
  };
}

export function legalCrossRef(conceptId: string): LegalCrossRef {
  return { concept: conceptId, objects: objectsForConcept(conceptId), roles: rolesForConcept(conceptId), events: eventsForConcept(conceptId), states: statesForConcept(conceptId) };
}

// ─── Part 3 — Mapa semântico ───────────────────────────────────────────────────

export interface SemanticMap { readonly id: string; readonly name: string; readonly path: readonly OntologyRef[]; }

const O = (kind: OperatingRefKind, id: string): OntologyRef => ({ domain: "operating", kind, id });
const L = (kind: LegalRefKind, id: string): OntologyRef => ({ domain: "legal", kind, id });

export const SEMANTIC_MAPS: readonly SemanticMap[] = [
  { id: "tr_map", name: "TR → Requisito → Critério → Competência → Fundamentação", path: [O("object", "tr"), L("concept", "requisito"), L("concept", "criterio"), L("concept", "competencia"), L("concept", "fundamentacao")] },
  { id: "contrato_map", name: "Contrato → Obrigação → Execução → Aditivo → Rescisão", path: [O("object", "contrato"), L("concept", "obrigacao"), O("state", "em_execucao"), O("object", "aditivo"), O("event", "rescisao")] },
  { id: "processo_map", name: "DFD → Hipótese → Processo → Competência", path: [O("object", "dfd"), L("concept", "hipotese"), O("object", "processo"), L("concept", "competencia")] },
];

// ─── Part 6 — Projeção Knowledge Graph ─────────────────────────────────────────

export interface IntegrationNode { readonly id: string; readonly domain: string; readonly kind: string; readonly ref: string; }
export interface IntegrationEdge { readonly from: string; readonly to: string; readonly type: SemanticLinkTypeId; readonly weight: number; readonly category: string; }

export function toIntegrationNodes(): IntegrationNode[] {
  const seen = new Map<string, IntegrationNode>();
  for (const l of SEMANTIC_LINKS) for (const r of [l.from, l.to]) {
    const id = nodeId(r);
    if (!seen.has(id)) seen.set(id, { id, domain: r.domain, kind: r.kind, ref: r.id });
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function toIntegrationEdges(): IntegrationEdge[] {
  return SEMANTIC_LINKS
    .map(l => ({ from: nodeId(l.from), to: nodeId(l.to), type: l.linkType, weight: SEMANTIC_LINK_TYPES[l.linkType].weight, category: l.category }))
    .sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));
}

// ─── Part 7 — Modelo de integração único + fingerprint ────────────────────────

export const ONTOLOGY_INTEGRATION_MODEL = {
  linkTypes: SEMANTIC_LINK_TYPES,
  links: SEMANTIC_LINKS,
  maps: SEMANTIC_MAPS,
} as const;

export function integrationFingerprint(): string {
  const payload = JSON.stringify({ types: ALL_SEMANTIC_LINK_TYPE_IDS, links: SEMANTIC_LINKS.map(l => l.id).sort(), maps: SEMANTIC_MAPS.map(m => m.id) });
  return createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

// ─── Part 9 — Validação ────────────────────────────────────────────────────────

export interface IntegrationValidation { readonly valid: boolean; readonly errors: readonly string[]; }

export function validateIntegrationLayer(): IntegrationValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  const pairs = new Set<string>();

  for (const l of SEMANTIC_LINKS) {
    if (!isSemanticLinkType(l.linkType)) errors.push(`ligação com tipo inválido: ${l.linkType}`);
    // referências existem (nenhuma órfã / quebrada)
    if (!refExists(l.from)) errors.push(`ligação ${l.id}: origem inexistente ${refKey(l.from)}`);
    if (!refExists(l.to)) errors.push(`ligação ${l.id}: destino inexistente ${refKey(l.to)}`);
    // explainability obrigatória
    if (!l.reason || !l.category) errors.push(`ligação ${l.id} sem explainability (motivo/categoria)`);
    // sem circular inválida (origem === destino)
    if (refKey(l.from) === refKey(l.to)) errors.push(`ligação circular inválida: ${refKey(l.from)}`);
    // sem duplicação (id e par tipo|origem|destino)
    if (ids.has(l.id)) errors.push(`ligação duplicada (id): ${l.id}`);
    ids.add(l.id);
    const pk = `${l.linkType}|${refKey(l.from)}|${refKey(l.to)}`;
    if (pairs.has(pk)) errors.push(`ligação duplicada (par): ${pk}`);
    pairs.add(pk);
    // cardinalidade válida
    if (!ALL_LINK_CARDINALITIES.includes(SEMANTIC_LINK_TYPES[l.linkType].cardinality)) errors.push(`cardinalidade inválida em ${l.linkType}`);
  }

  // mapas semânticos: nós existentes
  for (const m of SEMANTIC_MAPS) for (const n of m.path) if (!refExists(n)) errors.push(`mapa ${m.id}: nó inexistente ${refKey(n)}`);

  return { valid: errors.length === 0, errors };
}
