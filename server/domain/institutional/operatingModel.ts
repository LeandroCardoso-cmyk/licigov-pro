/**
 * RC-4.3 — Institutional Operating Model (ontologia operacional permanente).
 *
 * Modelo institucional ÚNICO do Departamento de Licitações: Papéis → Objetos → Estados →
 * Eventos → Dependências → Relacionamentos → Regras. Totalmente DECLARATIVO e determinístico
 * — nada executável. Reutilizável por Business Domains, Knowledge Graph, AIExecutionEngine,
 * Copilotos, Document Engine e Reasoning Framework (somente consulta; sem alterar o Kernel).
 */

import { createHash } from "crypto";
import { INSTITUTIONAL_ROLES, ALL_ROLE_IDS, getInstitutionalRole, isInstitutionalRole, type InstitutionalRoleId } from "./roles";
import { INSTITUTIONAL_OBJECTS, ALL_OBJECT_IDS, getInstitutionalObject, isInstitutionalObject, type InstitutionalObjectId } from "./objects";
import { INSTITUTIONAL_STATES, ALL_STATE_IDS, isInstitutionalState } from "./states";
import { INSTITUTIONAL_EVENTS, ALL_EVENT_IDS, type InstitutionalEventId } from "./events";
import { OPERATIONAL_RULES, ALL_OPERATIONAL_RULE_IDS } from "./operationalRules";

// ─── Part 3 — Relacionamentos (declarativos) ──────────────────────────────────

export type RelationshipKind = "cria" | "altera" | "aprova" | "consulta" | "referencia" | "depende" | "substitui" | "encerra";

export interface InstitutionalRelationship {
  readonly kind: RelationshipKind;
  /** Sujeito (papel ou objeto). */
  readonly from: string;
  /** Objeto alvo. */
  readonly to: InstitutionalObjectId;
}

export const INSTITUTIONAL_RELATIONSHIPS: readonly InstitutionalRelationship[] = [
  // cria
  { kind: "cria", from: "solicitante", to: "dfd" },
  { kind: "cria", from: "agente_contratacao", to: "tr" },
  { kind: "cria", from: "agente_contratacao", to: "edital" },
  { kind: "cria", from: "comissao", to: "ata" },
  { kind: "cria", from: "assessoria_juridica", to: "parecer" },
  { kind: "cria", from: "gestor_contrato", to: "aditivo" },
  { kind: "cria", from: "departamento_licitacoes", to: "processo" },
  // altera
  { kind: "altera", from: "aditivo", to: "contrato" },
  { kind: "altera", from: "apostilamento", to: "contrato" },
  // aprova
  { kind: "aprova", from: "autoridade_competente", to: "edital" },
  { kind: "aprova", from: "autoridade_competente", to: "contrato" },
  { kind: "aprova", from: "prefeito", to: "contratacao_direta" },
  { kind: "aprova", from: "secretario", to: "dfd" },
  // consulta
  { kind: "consulta", from: "controle_interno", to: "processo" },
  { kind: "consulta", from: "assessoria_juridica", to: "processo" },
  // referencia
  { kind: "referencia", from: "publicacao", to: "edital" },
  { kind: "referencia", from: "empenho", to: "contrato" },
  { kind: "referencia", from: "aviso", to: "edital" },
  // depende
  { kind: "depende", from: "etp", to: "dfd" },
  { kind: "depende", from: "tr", to: "etp" },
  { kind: "depende", from: "edital", to: "tr" },
  { kind: "depende", from: "sessao", to: "edital" },
  { kind: "depende", from: "ata", to: "sessao" },
  { kind: "depende", from: "contrato", to: "processo" },
  // substitui
  { kind: "substitui", from: "aditivo", to: "aditivo" },
  // encerra
  { kind: "encerra", from: "gestor_contrato", to: "contrato" },
  { kind: "encerra", from: "departamento_licitacoes", to: "processo" },
];

// ─── Part 5 — Dependências (cadeia canônica) ──────────────────────────────────

/** Cadeia operacional canônica (declarativa, acíclica). */
export const CANONICAL_DEPENDENCY_CHAIN: readonly InstitutionalObjectId[] = [
  "dfd", "etp", "tr", "pesquisa_precos", "edital", "sessao", "ata", "contrato",
];

/** Objetos dos quais um objeto depende (dependência operacional direta). */
export function getObjectDependencies(objectId: InstitutionalObjectId): InstitutionalObjectId[] {
  return [...getInstitutionalObject(objectId).dependsOn];
}

/** Objetos que dependem (direta ou transitivamente) de um objeto. */
export function getDependents(objectId: InstitutionalObjectId): InstitutionalObjectId[] {
  const result = new Set<InstitutionalObjectId>();
  const visit = (target: InstitutionalObjectId) => {
    for (const id of ALL_OBJECT_IDS) {
      if (getInstitutionalObject(id).dependsOn.includes(target) && !result.has(id)) {
        result.add(id); visit(id);
      }
    }
  };
  visit(objectId);
  return [...result].sort();
}

// ─── Part 10 — Consulta (query API para o Engine/domínios) ────────────────────

export function getEventsForObject(objectId: InstitutionalObjectId): InstitutionalEventId[] {
  return ALL_EVENT_IDS.filter(e => INSTITUTIONAL_EVENTS[e].relatedObjects.includes(objectId)).sort();
}

export function getRolesForObject(objectId: InstitutionalObjectId): InstitutionalRoleId[] {
  return ALL_ROLE_IDS.filter(r => getInstitutionalRole(r).documents.includes(objectId)).sort();
}

export function getRelationships(kind?: RelationshipKind): readonly InstitutionalRelationship[] {
  return kind ? INSTITUTIONAL_RELATIONSHIPS.filter(r => r.kind === kind) : INSTITUTIONAL_RELATIONSHIPS;
}

// ─── Part 9 — Projeção para Knowledge Graph (preparação; não alimenta jurídico) ─

export type OntologyNodeType = "role" | "object" | "state" | "event";
export interface OntologyNode { readonly id: string; readonly type: OntologyNodeType; readonly category: string; readonly label: string; }
export interface OntologyEdge { readonly from: string; readonly to: string; readonly type: string; }

/** Nós da ontologia (papéis/objetos/estados/eventos) — determinístico (ordenado). */
export function toOntologyNodes(): OntologyNode[] {
  const nodes: OntologyNode[] = [
    ...ALL_ROLE_IDS.map(id => ({ id: `role:${id}`, type: "role" as const, category: "papel", label: INSTITUTIONAL_ROLES[id].name })),
    ...ALL_OBJECT_IDS.map(id => ({ id: `object:${id}`, type: "object" as const, category: INSTITUTIONAL_OBJECTS[id].category, label: INSTITUTIONAL_OBJECTS[id].name })),
    ...ALL_STATE_IDS.map(id => ({ id: `state:${id}`, type: "state" as const, category: "estado", label: INSTITUTIONAL_STATES[id].name })),
    ...ALL_EVENT_IDS.map(id => ({ id: `event:${id}`, type: "event" as const, category: "evento", label: INSTITUTIONAL_EVENTS[id].name })),
  ];
  return nodes.sort((a, b) => a.id.localeCompare(b.id));
}

/** Arestas da ontologia (relacionamentos + dependências + estados + eventos) — determinístico. */
export function toOntologyEdges(): OntologyEdge[] {
  const edges: OntologyEdge[] = [];
  for (const r of INSTITUTIONAL_RELATIONSHIPS) {
    const fromPrefix = isInstitutionalRole(r.from) ? "role" : "object";
    edges.push({ from: `${fromPrefix}:${r.from}`, to: `object:${r.to}`, type: r.kind });
  }
  for (const id of ALL_OBJECT_IDS) {
    for (const dep of INSTITUTIONAL_OBJECTS[id].dependsOn) edges.push({ from: `object:${id}`, to: `object:${dep}`, type: "depends_on" });
    for (const st of INSTITUTIONAL_OBJECTS[id].possibleStates) edges.push({ from: `object:${id}`, to: `state:${st}`, type: "has_state" });
  }
  for (const e of ALL_EVENT_IDS) {
    for (const obj of INSTITUTIONAL_EVENTS[e].relatedObjects) edges.push({ from: `event:${e}`, to: `object:${obj}`, type: "event_relates" });
  }
  return edges.sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));
}

// ─── Part 8 — Modelo operacional único ────────────────────────────────────────

export const INSTITUTIONAL_OPERATING_MODEL = {
  roles: INSTITUTIONAL_ROLES,
  objects: INSTITUTIONAL_OBJECTS,
  states: INSTITUTIONAL_STATES,
  events: INSTITUTIONAL_EVENTS,
  relationships: INSTITUTIONAL_RELATIONSHIPS,
  rules: OPERATIONAL_RULES,
} as const;

/** Fingerprint determinístico da ontologia (para versionamento/observabilidade). */
export function operatingModelFingerprint(): string {
  const payload = JSON.stringify({
    roles: ALL_ROLE_IDS, objects: ALL_OBJECT_IDS, states: ALL_STATE_IDS, events: ALL_EVENT_IDS,
    rules: ALL_OPERATIONAL_RULE_IDS, nodes: toOntologyNodes().length, edges: toOntologyEdges().length,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

// ─── Part 11 — Validação de consistência (zero ciclos) ────────────────────────

export interface OperatingModelValidation { readonly valid: boolean; readonly errors: readonly string[]; }

/** Detecta ciclo no grafo de dependências (dependsOn). Retorna true se houver ciclo. */
function hasDependencyCycle(): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  for (const id of ALL_OBJECT_IDS) color[id] = WHITE;
  const dfs = (id: InstitutionalObjectId): boolean => {
    color[id] = GRAY;
    for (const dep of getInstitutionalObject(id).dependsOn) {
      if (color[dep] === GRAY) return true;
      if (color[dep] === WHITE && dfs(dep)) return true;
    }
    color[id] = BLACK;
    return false;
  };
  return ALL_OBJECT_IDS.some(id => color[id] === WHITE && dfs(id));
}

/** Valida a consistência integral do modelo operacional. */
export function validateOperatingModel(): OperatingModelValidation {
  const errors: string[] = [];

  for (const rid of ALL_ROLE_IDS) {
    const role = INSTITUTIONAL_ROLES[rid];
    if (role.responsibilities.length === 0) errors.push(`papel ${rid} sem responsabilidades`);
    for (const d of role.documents) if (!isInstitutionalObject(d)) errors.push(`papel ${rid} referencia objeto inválido: ${d}`);
    for (const dep of role.dependencies) if (!isInstitutionalRole(dep)) errors.push(`papel ${rid} depende de papel inválido: ${dep}`);
  }
  for (const oid of ALL_OBJECT_IDS) {
    const obj = INSTITUTIONAL_OBJECTS[oid];
    for (const s of obj.possibleStates) if (!isInstitutionalState(s)) errors.push(`objeto ${oid} com estado inválido: ${s}`);
    for (const d of obj.dependsOn) if (!isInstitutionalObject(d)) errors.push(`objeto ${oid} depende de objeto inválido: ${d}`);
    for (const rel of obj.relationships) if (!isInstitutionalObject(rel)) errors.push(`objeto ${oid} relaciona objeto inválido: ${rel}`);
  }
  for (const sid of ALL_STATE_IDS) {
    for (const t of INSTITUTIONAL_STATES[sid].transitions) if (!isInstitutionalState(t)) errors.push(`estado ${sid} transiciona para estado inválido: ${t}`);
  }
  for (const eid of ALL_EVENT_IDS) {
    const ev = INSTITUTIONAL_EVENTS[eid];
    for (const o of ev.relatedObjects) if (!isInstitutionalObject(o)) errors.push(`evento ${eid} referencia objeto inválido: ${o}`);
    for (const r of ev.involvedRoles) if (!isInstitutionalRole(r)) errors.push(`evento ${eid} envolve papel inválido: ${r}`);
  }
  for (const rel of INSTITUTIONAL_RELATIONSHIPS) {
    if (!isInstitutionalRole(rel.from) && !isInstitutionalObject(rel.from)) errors.push(`relacionamento com origem inválida: ${rel.from}`);
    if (!isInstitutionalObject(rel.to)) errors.push(`relacionamento com destino inválido: ${rel.to}`);
  }
  for (const id of ALL_OPERATIONAL_RULE_IDS) {
    const r = OPERATIONAL_RULES[id];
    if (!isInstitutionalObject(r.subject)) errors.push(`regra ${id} com subject inválido: ${r.subject}`);
    if (!isInstitutionalObject(r.requires)) errors.push(`regra ${id} com requires inválido: ${r.requires}`);
  }
  if (hasDependencyCycle()) errors.push("ciclo detectado no grafo de dependências de objetos");

  return { valid: errors.length === 0, errors };
}
