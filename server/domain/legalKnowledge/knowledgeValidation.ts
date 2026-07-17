/**
 * RC-4.5 — Legal Knowledge Foundation · Validation (Part 7).
 *
 * validateLegalKnowledge(): IDs únicos, hierarquia válida, referências existentes, sem ciclos,
 * versionamento consistente, relacionamentos e dependências válidos. Determinística.
 */

import type { KnowledgeBase } from "./knowledgeBase";
import { isValidUnit } from "./legalKnowledgeUnit";
import { isReferenceType } from "./knowledgeReference";
import { buildVersionChains, isVersionChainConsistent } from "./knowledgeVersion";

export interface KnowledgeValidation { readonly valid: boolean; readonly errors: readonly string[]; }

/** Detecta ciclo em grafo direcionado (adjacência id → destinos). */
function detectCycle(adjacency: Record<string, readonly string[]>): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  const ids = Object.keys(adjacency);
  for (const id of ids) color[id] = WHITE;
  const dfs = (id: string): boolean => {
    color[id] = GRAY;
    for (const d of adjacency[id] ?? []) { if (color[d] === GRAY) return true; if (color[d] === WHITE && dfs(d)) return true; }
    color[id] = BLACK; return false;
  };
  return ids.some(id => color[id] === WHITE && dfs(id));
}

export function validateLegalKnowledge(base: KnowledgeBase): KnowledgeValidation {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const u of base.units) {
    if (ids.has(u.id)) errors.push(`unidade com id duplicado: ${u.id}`);
    ids.add(u.id);
    if (!isValidUnit(u)) errors.push(`unidade inválida (tipo/hierarquia/versão/tenant): ${u.id}`);
    if (u.hierarchy < 0) errors.push(`unidade ${u.id} com hierarquia negativa`);
    if (u.revokedDate && u.effectiveDate && u.effectiveDate > u.revokedDate) errors.push(`unidade ${u.id}: vigência posterior à revogação`);
  }

  // Referências: tipos válidos + apontam para unidades existentes.
  const refIds = new Set<string>();
  const dependencyAdj: Record<string, string[]> = {};
  for (const u of base.units) dependencyAdj[u.id] = [];
  for (const r of base.references) {
    if (refIds.has(r.id)) errors.push(`referência duplicada: ${r.id}`);
    refIds.add(r.id);
    if (!isReferenceType(r.type)) errors.push(`referência com tipo inválido: ${r.type}`);
    if (!ids.has(r.from)) errors.push(`referência ${r.id}: origem inexistente ${r.from}`);
    if (!ids.has(r.to)) errors.push(`referência ${r.id}: destino inexistente ${r.to}`);
    if (r.strength < 0 || r.strength > 1) errors.push(`referência ${r.id}: força fora de [0,1]`);
    // dependências acumulam no grafo para detecção de ciclos.
    if ((r.type === "depends_on" || r.type === "requires" || r.type === "derived_from") && ids.has(r.from) && ids.has(r.to)) {
      dependencyAdj[r.from].push(r.to);
    }
  }
  if (detectCycle(dependencyAdj)) errors.push("ciclo detectado no grafo de dependências de conhecimento");

  // Versionamento consistente por linhagem.
  for (const chain of buildVersionChains(base.units)) {
    if (!isVersionChainConsistent(chain)) errors.push(`cadeia de versões inconsistente na linhagem ${chain.lineageId}`);
  }

  return { valid: errors.length === 0, errors };
}
