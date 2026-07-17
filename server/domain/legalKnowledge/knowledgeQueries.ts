/**
 * RC-4.5 — Legal Knowledge Foundation · Knowledge Queries (Part 4).
 *
 * API DECLARATIVA de consulta sobre uma KnowledgeBase em memória. Nenhuma consulta depende
 * de banco. Determinística (ordenação estável). Multi-tenant (opera sobre a base fornecida).
 */

import type { KnowledgeBase } from "./knowledgeBase";
import type { LegalKnowledgeUnit } from "./legalKnowledgeUnit";
import type { KnowledgeReference, KnowledgeReferenceType } from "./knowledgeReference";
import { detectConflicts, type KnowledgeConflict } from "./knowledgeConflict";

const byId = (base: KnowledgeBase) => new Map(base.units.map(u => [u.id, u]));

export function getKnowledge(base: KnowledgeBase, id: string): LegalKnowledgeUnit | null {
  return base.units.find(u => u.id === id) ?? null;
}

export function findKnowledge(base: KnowledgeBase, predicate: (u: LegalKnowledgeUnit) => boolean): LegalKnowledgeUnit[] {
  return base.units.filter(predicate).sort((a, b) => a.id.localeCompare(b.id));
}

export function findByType(base: KnowledgeBase, type: string): LegalKnowledgeUnit[] {
  return findKnowledge(base, u => u.type === type);
}

export function findReferences(base: KnowledgeBase, id: string): KnowledgeReference[] {
  return base.references.filter(r => r.from === id || r.to === id).sort((a, b) => a.id.localeCompare(b.id));
}

/** Unidades relacionadas (por qualquer referência, em qualquer direção). */
export function findRelatedKnowledge(base: KnowledgeBase, id: string): LegalKnowledgeUnit[] {
  const ids = new Set<string>();
  for (const r of base.references) { if (r.from === id) ids.add(r.to); if (r.to === id) ids.add(r.from); }
  const m = byId(base);
  return [...ids].map(x => m.get(x)!).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

/** Dependências diretas (referências depends_on / requires a partir da unidade). */
export function findDependencies(base: KnowledgeBase, id: string): LegalKnowledgeUnit[] {
  const deps: KnowledgeReferenceType[] = ["depends_on", "requires"];
  const m = byId(base);
  return base.references.filter(r => r.from === id && deps.includes(r.type)).map(r => m.get(r.to)!).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

/** Pais na hierarquia (unidades com hierarquia imediatamente superior, mesmo tenant). */
export function findParents(base: KnowledgeBase, id: string): LegalKnowledgeUnit[] {
  const u = getKnowledge(base, id); if (!u) return [];
  return base.units.filter(x => x.tenantId === u.tenantId && x.hierarchy < u.hierarchy).sort((a, b) => b.hierarchy - a.hierarchy || a.id.localeCompare(b.id));
}

/** Filhos na hierarquia (unidades com hierarquia inferior). */
export function findChildren(base: KnowledgeBase, id: string): LegalKnowledgeUnit[] {
  const u = getKnowledge(base, id); if (!u) return [];
  return base.units.filter(x => x.tenantId === u.tenantId && x.hierarchy > u.hierarchy).sort((a, b) => a.hierarchy - b.hierarchy || a.id.localeCompare(b.id));
}

/** Hierarquia completa: pais + a própria unidade + filhos. */
export function findHierarchy(base: KnowledgeBase, id: string): LegalKnowledgeUnit[] {
  const u = getKnowledge(base, id); if (!u) return [];
  return [...findParents(base, id), u, ...findChildren(base, id)];
}

export function findConflicts(base: KnowledgeBase): KnowledgeConflict[] {
  return detectConflicts(base.units, base.references);
}
