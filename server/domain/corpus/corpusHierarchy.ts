/**
 * RC-4.5.1 — Institutional Corpus Framework · Corpus Hierarchy (Part 4).
 *
 * Representa a hierarquia entre corpora (ex.: Nação → União → Estado → Município → Instituição
 * → Departamento) SEM assumir nenhum país específico. A taxonomia de escopo é CONFIGURÁVEL.
 * A árvore de corpora é construída a partir de `parentId`. Acíclica, determinística.
 */

import type { InstitutionalCorpus } from "./institutionalCorpus";

/** Nível de escopo configurável (rótulo estrutural — não presume país). */
export interface CorpusScopeLevel {
  readonly id: string;
  readonly name: string;
  /** Ordem (menor = mais amplo). */
  readonly depth: number;
}

/**
 * Taxonomia de escopo PADRÃO — apenas rótulos estruturais genéricos, sem país específico.
 * Pode ser substituída por qualquer taxonomia configurável.
 */
export const DEFAULT_SCOPE_TAXONOMY: readonly CorpusScopeLevel[] = [
  { id: "nacao", name: "Nação", depth: 0 },
  { id: "uniao", name: "União", depth: 1 },
  { id: "estado", name: "Estado", depth: 2 },
  { id: "municipio", name: "Município", depth: 3 },
  { id: "instituicao", name: "Instituição", depth: 4 },
  { id: "departamento", name: "Departamento", depth: 5 },
];

export function isScopeLevel(taxonomy: readonly CorpusScopeLevel[], scope: string): boolean {
  return taxonomy.some(l => l.id === scope);
}

export function scopeDepth(taxonomy: readonly CorpusScopeLevel[], scope: string): number | null {
  return taxonomy.find(l => l.id === scope)?.depth ?? null;
}

export interface CorpusHierarchyNode {
  readonly corpusId: string;
  readonly parentId: string | null;
  readonly scope: string;
  readonly children: readonly string[];
}

export interface CorpusHierarchy {
  readonly nodes: readonly CorpusHierarchyNode[];
  /** Raízes (corpora sem pai, ou cujo pai não está na base). */
  readonly roots: readonly string[];
}

/** Constrói a hierarquia (árvore) de corpora a partir de `parentId`. Determinística. */
export function buildCorpusHierarchy(corpora: readonly InstitutionalCorpus[]): CorpusHierarchy {
  const ids = new Set(corpora.map(c => c.id));
  const childrenOf = new Map<string, string[]>();
  for (const c of corpora) {
    if (c.parentId && ids.has(c.parentId)) {
      const arr = childrenOf.get(c.parentId) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parentId, arr);
    }
  }
  const nodes: CorpusHierarchyNode[] = [...corpora]
    .map(c => ({
      corpusId: c.id,
      parentId: c.parentId && ids.has(c.parentId) ? c.parentId : null,
      scope: c.scope,
      children: (childrenOf.get(c.id) ?? []).slice().sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.corpusId.localeCompare(b.corpusId));
  const roots = nodes.filter(n => n.parentId === null).map(n => n.corpusId).sort((a, b) => a.localeCompare(b));
  return { nodes, roots };
}

/** Detecta ciclo na hierarquia de corpora (um corpus não pode ser ancestral de si mesmo). */
export function hasHierarchyCycle(corpora: readonly InstitutionalCorpus[]): boolean {
  const parent = new Map<string, string | null>();
  const ids = new Set(corpora.map(c => c.id));
  for (const c of corpora) parent.set(c.id, c.parentId && ids.has(c.parentId) ? c.parentId : null);
  for (const c of corpora) {
    const seen = new Set<string>();
    let cur: string | null | undefined = c.id;
    while (cur) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = parent.get(cur) ?? null;
    }
  }
  return false;
}
