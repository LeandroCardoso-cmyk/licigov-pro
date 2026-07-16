/**
 * RC-4.3.1 — Institutional Ontology Validation (validação exaustiva).
 *
 * Valida se a Ontologia Operacional (RC-4.3) é íntegra e expressiva o suficiente para
 * representar qualquer cenário institucional relevante SEM alterações estruturais. NÃO
 * adiciona conhecimento jurídico, IA ou RAG — apenas valida a modelagem existente.
 * Puro e determinístico. Inclui detectores genéricos (reutilizados nos testes de resiliência).
 */

import { INSTITUTIONAL_ROLES, ALL_ROLE_IDS, isInstitutionalRole, type InstitutionalRoleId } from "./roles";
import { INSTITUTIONAL_OBJECTS, ALL_OBJECT_IDS, isInstitutionalObject, type InstitutionalObjectId } from "./objects";
import { INSTITUTIONAL_STATES, ALL_STATE_IDS, isInstitutionalState, type InstitutionalStateId } from "./states";
import { INSTITUTIONAL_EVENTS, ALL_EVENT_IDS, isInstitutionalEvent } from "./events";
import { OPERATIONAL_RULES, ALL_OPERATIONAL_RULE_IDS } from "./operationalRules";
import { INSTITUTIONAL_RELATIONSHIPS, toOntologyNodes, toOntologyEdges } from "./operatingModel";

// ─── Detectores genéricos (reutilizáveis para resiliência) ────────────────────

/** Detecta ciclo num grafo direcionado (adjacência id → dependências). */
export function detectCycle(adjacency: Record<string, readonly string[]>): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  const ids = Object.keys(adjacency);
  for (const id of ids) color[id] = WHITE;
  const dfs = (id: string): boolean => {
    color[id] = GRAY;
    for (const dep of adjacency[id] ?? []) {
      if (color[dep] === GRAY) return true;
      if (color[dep] === WHITE && dfs(dep)) return true;
    }
    color[id] = BLACK;
    return false;
  };
  return ids.some(id => color[id] === WHITE && dfs(id));
}

/** Estados alcançáveis a partir dos estados de entrada (sem incoming). */
export function reachableStates(): Set<InstitutionalStateId> {
  const incoming = new Set<InstitutionalStateId>();
  for (const s of ALL_STATE_IDS) for (const t of INSTITUTIONAL_STATES[s].transitions) incoming.add(t);
  const entries = ALL_STATE_IDS.filter(s => !incoming.has(s));
  const reached = new Set<InstitutionalStateId>();
  const queue = [...entries];
  while (queue.length) {
    const s = queue.shift()!;
    if (reached.has(s)) continue;
    reached.add(s);
    for (const t of INSTITUTIONAL_STATES[s].transitions) if (!reached.has(t)) queue.push(t);
  }
  return reached;
}

/** Estados terminais legítimos (sem saída, mas intencionais). */
export const FINAL_STATES: readonly InstitutionalStateId[] = ["arquivado"];

// ─── Validação por seção ──────────────────────────────────────────────────────

export interface SectionResult { readonly section: string; readonly ok: boolean; readonly issues: readonly string[]; }

function section(name: string, issues: string[]): SectionResult {
  return { section: name, ok: issues.length === 0, issues };
}

/** Part 1 — Papéis: campos, referências e não-isolamento. */
export function validateRoles(): SectionResult {
  const issues: string[] = [];
  for (const id of ALL_ROLE_IDS) {
    const r = INSTITUTIONAL_ROLES[id];
    if (r.responsibilities.length === 0) issues.push(`papel ${id} sem responsabilidades`);
    if (r.permissions.length === 0) issues.push(`papel ${id} sem permissões`);
    if (r.participation.length === 0) issues.push(`papel ${id} sem participação`);
    for (const d of r.documents) if (!isInstitutionalObject(d)) issues.push(`papel ${id} → objeto inválido ${d}`);
    for (const dep of r.dependencies) if (!isInstitutionalRole(dep)) issues.push(`papel ${id} → papel inválido ${dep}`);
    // não-isolamento: participa via documentos, eventos ou relacionamentos
    const inEvents = ALL_EVENT_IDS.some(e => INSTITUTIONAL_EVENTS[e].involvedRoles.includes(id));
    const inRel = INSTITUTIONAL_RELATIONSHIPS.some(rel => rel.from === id);
    if (r.documents.length === 0 && !inEvents && !inRel) issues.push(`papel ${id} isolado (sem documentos/eventos/relacionamentos)`);
  }
  return section("roles", issues);
}

/** Part 2 — Objetos: campos, estados, dependências, relacionamentos, não-órfão. */
export function validateObjects(): SectionResult {
  const issues: string[] = [];
  for (const id of ALL_OBJECT_IDS) {
    const o = INSTITUTIONAL_OBJECTS[id];
    if (!o.purpose) issues.push(`objeto ${id} sem finalidade`);
    if (o.possibleStates.length === 0) issues.push(`objeto ${id} sem estados possíveis`);
    for (const s of o.possibleStates) if (!isInstitutionalState(s)) issues.push(`objeto ${id} → estado inválido ${s}`);
    for (const d of o.dependsOn) if (!isInstitutionalObject(d)) issues.push(`objeto ${id} → dependência inválida ${d}`);
    for (const rel of o.relationships) if (!isInstitutionalObject(rel)) issues.push(`objeto ${id} → relacionamento inválido ${rel}`);
    // não-órfão: conectado por dependência, relacionamento, papel ou evento
    const hasDep = o.dependsOn.length > 0 || ALL_OBJECT_IDS.some(x => INSTITUTIONAL_OBJECTS[x].dependsOn.includes(id));
    const inRole = ALL_ROLE_IDS.some(r => INSTITUTIONAL_ROLES[r].documents.includes(id));
    const inEvent = ALL_EVENT_IDS.some(e => INSTITUTIONAL_EVENTS[e].relatedObjects.includes(id));
    const inRel = INSTITUTIONAL_RELATIONSHIPS.some(rel => rel.from === id || rel.to === id);
    if (!hasDep && !inRole && !inEvent && !inRel) issues.push(`objeto ${id} órfão (desconectado da ontologia)`);
  }
  return section("objects", issues);
}

/** Part 3 — Estados: transições válidas, inalcançáveis, sem saída (não-final), duplicados. */
export function validateStates(): SectionResult {
  const issues: string[] = [];
  const names = new Set<string>();
  for (const id of ALL_STATE_IDS) {
    const st = INSTITUTIONAL_STATES[id];
    if (names.has(st.name)) issues.push(`estado duplicado (nome): ${st.name}`);
    names.add(st.name);
    for (const t of st.transitions) if (!isInstitutionalState(t)) issues.push(`estado ${id} → transição inválida ${t}`);
    if (st.transitions.length === 0 && !FINAL_STATES.includes(id)) issues.push(`estado ${id} sem saída e não-final`);
  }
  const reached = reachableStates();
  for (const id of ALL_STATE_IDS) if (!reached.has(id)) issues.push(`estado inalcançável: ${id}`);
  return section("states", issues);
}

/** Part 4 — Eventos: origem, destino, objetos, papéis; órfãos. */
export function validateEvents(): SectionResult {
  const issues: string[] = [];
  for (const id of ALL_EVENT_IDS) {
    const e = INSTITUTIONAL_EVENTS[id];
    if (!e.origin) issues.push(`evento ${id} sem origem`);
    if (!e.destination) issues.push(`evento ${id} sem destino`);
    if (e.relatedObjects.length === 0) issues.push(`evento ${id} órfão (sem objetos)`);
    if (e.involvedRoles.length === 0) issues.push(`evento ${id} sem papéis`);
    for (const o of e.relatedObjects) if (!isInstitutionalObject(o)) issues.push(`evento ${id} → objeto inválido ${o}`);
    for (const r of e.involvedRoles) if (!isInstitutionalRole(r)) issues.push(`evento ${id} → papel inválido ${r}`);
  }
  return section("events", issues);
}

/** Part 5 — Dependências: ciclos + caminhos mortos. */
export function validateDependencies(): SectionResult {
  const issues: string[] = [];
  const adjacency: Record<string, readonly string[]> = {};
  for (const id of ALL_OBJECT_IDS) adjacency[id] = INSTITUTIONAL_OBJECTS[id].dependsOn;
  if (detectCycle(adjacency)) issues.push("ciclo no grafo de dependências");
  for (const id of ALL_OBJECT_IDS) for (const d of INSTITUTIONAL_OBJECTS[id].dependsOn) if (!isInstitutionalObject(d)) issues.push(`dependência quebrada: ${id} → ${d}`);
  return section("dependencies", issues);
}

/** Part 6 — Relacionamentos: origem/destino válidos, duplicados, sem objeto. */
export function validateRelationships(): SectionResult {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const rel of INSTITUTIONAL_RELATIONSHIPS) {
    if (!isInstitutionalObject(rel.to)) issues.push(`relacionamento sem objeto válido: ${rel.kind} → ${rel.to}`);
    if (!isInstitutionalRole(rel.from) && !isInstitutionalObject(rel.from)) issues.push(`relacionamento com origem inválida: ${rel.from}`);
    const key = `${rel.kind}|${rel.from}|${rel.to}`;
    if (seen.has(key)) issues.push(`relacionamento duplicado: ${key}`);
    seen.add(key);
  }
  return section("relationships", issues);
}

/** Part 10 — Projeção Knowledge Graph: nós, arestas, cardinalidade. */
export function validateKnowledgeGraphProjection(): SectionResult {
  const issues: string[] = [];
  const nodes = toOntologyNodes();
  const edges = toOntologyEdges();
  const nodeIds = new Set(nodes.map(n => n.id));
  if (nodes.length !== new Set(nodeIds).size) issues.push("nós duplicados na projeção");
  for (const e of edges) {
    if (!nodeIds.has(e.from)) issues.push(`aresta com origem inexistente: ${e.from}`);
    if (!nodeIds.has(e.to)) issues.push(`aresta com destino inexistente: ${e.to}`);
    if (!e.type) issues.push(`aresta sem tipo: ${e.from}→${e.to}`);
  }
  for (const n of nodes) if (!n.type || !n.category) issues.push(`nó sem tipo/categoria: ${n.id}`);
  return section("knowledge_graph", issues);
}

// ─── Validação integral ───────────────────────────────────────────────────────

export interface OntologyValidationReport {
  readonly valid: boolean;
  readonly sections: readonly SectionResult[];
  readonly issues: readonly string[];
  readonly coverage: { roles: number; objects: number; states: number; events: number; rules: number; nodes: number; edges: number };
}

/** Executa a validação exaustiva da ontologia. Determinística. */
export function validateOntology(): OntologyValidationReport {
  const sections = [
    validateRoles(), validateObjects(), validateStates(), validateEvents(),
    validateDependencies(), validateRelationships(), validateKnowledgeGraphProjection(),
  ];
  const issues = sections.flatMap(s => s.issues);
  return {
    valid: issues.length === 0,
    sections,
    issues,
    coverage: {
      roles: ALL_ROLE_IDS.length, objects: ALL_OBJECT_IDS.length, states: ALL_STATE_IDS.length,
      events: ALL_EVENT_IDS.length, rules: ALL_OPERATIONAL_RULE_IDS.length,
      nodes: toOntologyNodes().length, edges: toOntologyEdges().length,
    },
  };
}

// ─── Detectores para testes de resiliência (dados sintéticos quebrados) ───────

export function objectRefValid(id: string): boolean { return isInstitutionalObject(id); }
export function roleRefValid(id: string): boolean { return isInstitutionalRole(id); }
export function stateRefValid(id: string): boolean { return isInstitutionalState(id); }
export function eventRefValid(id: string): boolean { return isInstitutionalEvent(id); }
export function ruleRefValid(id: string): boolean { return id in OPERATIONAL_RULES; }
