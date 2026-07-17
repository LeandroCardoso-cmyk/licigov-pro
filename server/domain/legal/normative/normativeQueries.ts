/**
 * RC-4.6.1 — Federal Procurement Corpus · Declarative Queries (Part 7).
 *
 * Consultas declarativas sobre uma NormativeTree em memória. Sem banco. Determinísticas
 * (ordenação estável). Localizar artigo, subir/descer hierarquia, listar filhos/ancestrais/
 * descendentes, localizar referências e relações.
 */

import type { NormativeTree } from "./normativeTree";
import type { NormativeNode } from "./normativeNode";
import type { NormativeReference } from "./normativeReference";
import type { NormativeLevelId } from "./normativeHierarchy";

const byId = (tree: NormativeTree) => new Map(tree.nodes.map(n => [n.id, n]));

export function findNode(tree: NormativeTree, id: string): NormativeNode | null {
  return tree.nodes.find(n => n.id === id) ?? null;
}

/** Localiza um nó pelo identificador estrutural (ex.: "Art. 1º"). */
export function findByIdentifier(tree: NormativeTree, identifier: string): NormativeNode | null {
  return tree.nodes.find(n => n.identifier === identifier) ?? null;
}

/** Localiza nós por tipo/nível (ex.: todos os artigos). */
export function findByType(tree: NormativeTree, type: NormativeLevelId): NormativeNode[] {
  return tree.nodes.filter(n => n.type === type).sort((a, b) => a.id.localeCompare(b.id));
}

/** Sobe um nível (pai direto). */
export function parentOf(tree: NormativeTree, id: string): NormativeNode | null {
  const n = findNode(tree, id);
  if (!n || !n.parent) return null;
  return findNode(tree, n.parent);
}

/** Desce um nível (filhos diretos). */
export function childrenOf(tree: NormativeTree, id: string): NormativeNode[] {
  const m = byId(tree);
  const n = m.get(id);
  if (!n) return [];
  return n.children.map(c => m.get(c)).filter((x): x is NormativeNode => Boolean(x)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Lista todos os ancestrais (do pai até a raiz). */
export function ancestorsOf(tree: NormativeTree, id: string): NormativeNode[] {
  const out: NormativeNode[] = [];
  const seen = new Set<string>();
  let cur = parentOf(tree, id);
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.push(cur); cur = parentOf(tree, cur.id); }
  return out;
}

/** Lista todos os descendentes (subárvore, em ordem determinística). */
export function descendantsOf(tree: NormativeTree, id: string): NormativeNode[] {
  const out: NormativeNode[] = [];
  const visit = (nid: string) => {
    for (const child of childrenOf(tree, nid)) { out.push(child); visit(child.id); }
  };
  visit(id);
  return out;
}

/** Referências que envolvem o nó (origem ou destino). */
export function referencesOf(tree: NormativeTree, id: string): NormativeReference[] {
  return tree.references.filter(r => r.from === id || r.to === id).sort((a, b) => a.id.localeCompare(b.id));
}

/** Referências de um tipo específico em toda a árvore. */
export function referencesByType(tree: NormativeTree, type: NormativeReference["type"]): NormativeReference[] {
  return tree.references.filter(r => r.type === type).sort((a, b) => a.id.localeCompare(b.id));
}
