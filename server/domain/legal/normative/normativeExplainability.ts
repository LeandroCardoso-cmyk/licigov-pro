/**
 * RC-4.6.1 — Federal Procurement Corpus · Explainability (Part 8).
 *
 * Toda estrutura normativa se EXPLICA: origem, posição na hierarquia, ancestrais, descendentes,
 * referências, dependências e lineage. Nunca informação implícita. Determinístico.
 */

import type { NormativeTree } from "./normativeTree";
import type { NormativeNode } from "./normativeNode";
import { ancestorsOf, descendantsOf, childrenOf, referencesOf } from "./normativeQueries";
import { normativeDepth } from "./normativeHierarchy";

export interface NormativeExplanation {
  readonly nodeId: string;
  readonly origin: { readonly normId: string; readonly authority: string; readonly scope: string; readonly identifier: string };
  readonly position: { readonly type: string; readonly depth: number; readonly order: number };
  readonly ancestors: readonly string[];
  readonly children: readonly string[];
  readonly descendants: readonly string[];
  readonly references: readonly { readonly id: string; readonly type: string; readonly to: string; readonly explanation: string }[];
  readonly dependencies: readonly string[];
  readonly lineageId: string;
  readonly knowledgeUnitId: string | null;
  readonly summary: string;
}

/** Explica um nó normativo dentro da árvore. Sempre estruturado — nunca só dados. */
export function explainNode(tree: NormativeTree, node: NormativeNode): NormativeExplanation {
  const refs = referencesOf(tree, node.id);
  const dependencies = refs.filter(r => r.from === node.id && (r.type === "dependencia" || r.type === "regulamentadora")).map(r => r.to);
  return {
    nodeId: node.id,
    origin: { normId: node.normId, authority: node.authority, scope: node.scope, identifier: node.identifier },
    position: { type: node.type, depth: normativeDepth(node.type), order: node.order },
    ancestors: ancestorsOf(tree, node.id).map(n => n.id),
    children: childrenOf(tree, node.id).map(n => n.id),
    descendants: descendantsOf(tree, node.id).map(n => n.id),
    references: refs.map(r => ({ id: r.id, type: r.type, to: r.to === node.id ? r.from : r.to, explanation: r.explanation })),
    dependencies,
    lineageId: node.lineageId,
    knowledgeUnitId: node.knowledgeUnitId,
    summary: `${node.displayName} (${node.type}) da ${node.normId}, profundidade ${normativeDepth(node.type)}, ${childrenOf(tree, node.id).length} filho(s), sem conteúdo jurídico vinculado (knowledgeUnitId=${node.knowledgeUnitId}).`,
  };
}
