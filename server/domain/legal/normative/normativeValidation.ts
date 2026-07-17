/**
 * RC-4.6.1 — Federal Procurement Corpus · Validation.
 *
 * Valida a NormativeTree: ids únicos, nós válidos, reciprocidade pai/filho, hierarquia monotônica
 * (pai mais alto que filho), sem ciclos, referências resolvidas. Determinística.
 */

import type { NormativeTree } from "./normativeTree";
import { isValidNormativeNode } from "./normativeNode";
import { normativeDepth } from "./normativeHierarchy";
import { isReferenceType } from "./normativeReference";

export interface NormativeValidation { readonly valid: boolean; readonly errors: readonly string[]; }

export function validateNormativeTree(tree: NormativeTree): NormativeValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  const byId = new Map(tree.nodes.map(n => [n.id, n]));

  for (const n of tree.nodes) {
    if (ids.has(n.id)) errors.push(`nó com id duplicado: ${n.id}`);
    ids.add(n.id);
    if (!isValidNormativeNode(n)) errors.push(`nó inválido (tipo/tenant/norma/identificador): ${n.identifier}`);
    if (n.knowledgeUnitId !== null) errors.push(`nó ${n.identifier}: knowledgeUnitId deve ser null nesta RC`);
  }

  // Raiz existe.
  if (!ids.has(tree.root)) errors.push(`raiz inexistente: ${tree.root}`);

  for (const n of tree.nodes) {
    // Pai existe e é hierarquicamente superior (monotônico).
    if (n.parent) {
      const parent = byId.get(n.parent);
      if (!parent) { errors.push(`nó ${n.identifier}: pai inexistente ${n.parent}`); }
      else {
        if (normativeDepth(parent.type) >= normativeDepth(n.type)) errors.push(`nó ${n.identifier}: pai ${parent.identifier} não é hierarquicamente superior`);
        if (!parent.children.includes(n.id)) errors.push(`nó ${n.identifier}: pai ${parent.identifier} não reconhece o filho`);
        if (parent.tenantId !== n.tenantId || parent.normId !== n.normId) errors.push(`nó ${n.identifier}: pai em tenant/norma divergente`);
      }
    }
    // Filhos existem e reconhecem o pai.
    for (const c of n.children) {
      const child = byId.get(c);
      if (!child) errors.push(`nó ${n.identifier}: filho inexistente ${c}`);
      else if (child.parent !== n.id) errors.push(`nó ${n.identifier}: filho ${child.identifier} não reconhece o pai`);
    }
  }

  // Sem ciclos (subindo pelos pais).
  for (const n of tree.nodes) {
    const seen = new Set<string>();
    let cur: string | null | undefined = n.id;
    while (cur) {
      if (seen.has(cur)) { errors.push(`ciclo hierárquico detectado em ${n.identifier}`); break; }
      seen.add(cur);
      cur = byId.get(cur)?.parent ?? null;
    }
  }

  // Referências: tipo válido + nós existentes.
  const refIds = new Set<string>();
  for (const r of tree.references) {
    if (refIds.has(r.id)) errors.push(`referência duplicada: ${r.id}`);
    refIds.add(r.id);
    if (!isReferenceType(r.type)) errors.push(`referência com tipo inválido: ${r.type}`);
    if (!ids.has(r.from)) errors.push(`referência ${r.id}: origem inexistente`);
    if (!ids.has(r.to)) errors.push(`referência ${r.id}: destino inexistente`);
  }

  return { valid: errors.length === 0, errors };
}
