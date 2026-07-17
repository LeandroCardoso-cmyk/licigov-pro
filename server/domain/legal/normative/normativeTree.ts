/**
 * RC-4.6.1 — Federal Procurement Corpus · Federal Procurement Tree (Part 3).
 *
 * Árvore ESTRUTURAL da Lei nº 14.133/2021 — apenas os nós estruturais (identificadores), SEM
 * texto jurídico. Determinística, multi-tenant, extensível: novos nós/normas seguem exatamente
 * este modelo (Part 10). Agregado `NormativeTree` (nós + referências).
 */

import { createNormativeNode, normativeNodeId, type NormativeNode } from "./normativeNode";
import { createNormativeReference, type NormativeReference } from "./normativeReference";
import type { NormativeLevelId } from "./normativeHierarchy";

export interface NormativeTree {
  readonly normId: string;
  readonly root: string;
  readonly nodes: readonly NormativeNode[];
  readonly references: readonly NormativeReference[];
}

export function createNormativeTree(normId: string, root: string, nodes: NormativeNode[], references: NormativeReference[] = []): NormativeTree {
  return { normId, root, nodes, references };
}

export const LEI_14133_NORM_ID = "lei-14133-2021";
const AUTHORITY = "Congresso Nacional";
const SCOPE = "federal";

/** Especificação estrutural (identificador/rótulo — nunca conteúdo jurídico). */
interface NodeSpec { type: NormativeLevelId; identifier: string; displayName: string; parent: string | null; order: number; }

/**
 * Esqueleto estrutural REPRESENTATIVO da Lei nº 14.133 (não exaustivo). Cobre todos os níveis
 * principais e é preenchido incrementalmente nas próximas RCs. `parent` referencia o identifier.
 */
const LEI_14133_SPECS: NodeSpec[] = [
  { type: "lei", identifier: "Lei 14.133/2021", displayName: "Lei nº 14.133/2021", parent: null, order: 1 },
  { type: "titulo", identifier: "Título I", displayName: "Título I", parent: "Lei 14.133/2021", order: 1 },
  { type: "capitulo", identifier: "Título I · Capítulo I", displayName: "Capítulo I", parent: "Título I", order: 1 },
  { type: "artigo", identifier: "Art. 1º", displayName: "Artigo 1º", parent: "Título I · Capítulo I", order: 1 },
  { type: "paragrafo", identifier: "Art. 1º · § 1º", displayName: "§ 1º", parent: "Art. 1º", order: 1 },
  { type: "inciso", identifier: "Art. 1º · § 1º · Inc. I", displayName: "Inciso I", parent: "Art. 1º · § 1º", order: 1 },
  { type: "artigo", identifier: "Art. 2º", displayName: "Artigo 2º", parent: "Título I · Capítulo I", order: 2 },
  { type: "capitulo", identifier: "Título I · Capítulo II", displayName: "Capítulo II", parent: "Título I", order: 2 },
  { type: "secao", identifier: "Título I · Capítulo II · Seção I", displayName: "Seção I", parent: "Título I · Capítulo II", order: 1 },
  { type: "subsecao", identifier: "Título I · Capítulo II · Seção I · Subseção I", displayName: "Subseção I", parent: "Título I · Capítulo II · Seção I", order: 1 },
  { type: "artigo", identifier: "Art. 3º", displayName: "Artigo 3º", parent: "Título I · Capítulo II · Seção I · Subseção I", order: 1 },
  { type: "titulo", identifier: "Título II", displayName: "Título II", parent: "Lei 14.133/2021", order: 2 },
  { type: "artigo", identifier: "Art. 4º", displayName: "Artigo 4º", parent: "Título II", order: 1 },
  { type: "inciso", identifier: "Art. 4º · Inc. I", displayName: "Inciso I", parent: "Art. 4º", order: 1 },
  { type: "alinea", identifier: "Art. 4º · Inc. I · a", displayName: "Alínea a", parent: "Art. 4º · Inc. I", order: 1 },
  { type: "item", identifier: "Art. 4º · Inc. I · a · 1", displayName: "Item 1", parent: "Art. 4º · Inc. I · a", order: 1 },
];

/**
 * Constrói a árvore estrutural da Lei nº 14.133 para uma organização. Determinística.
 * `knowledgeUnitId` de todos os nós é null (ligação preparada, sem conteúdo — Part 4).
 */
export function buildFederalProcurementTree(tenantId: number): NormativeTree {
  const idOf = (identifier: string, type: NormativeLevelId) => normativeNodeId(tenantId, LEI_14133_NORM_ID, type, identifier);
  const specByIdentifier = new Map(LEI_14133_SPECS.map(s => [s.identifier, s]));

  // Filhos por identificador de pai (ordenados por order → identifier, determinístico).
  const childrenByParent = new Map<string, string[]>();
  for (const s of [...LEI_14133_SPECS].sort((a, b) => a.order - b.order || a.identifier.localeCompare(b.identifier))) {
    if (s.parent) {
      const arr = childrenByParent.get(s.parent) ?? [];
      arr.push(idOf(s.identifier, s.type));
      childrenByParent.set(s.parent, arr);
    }
  }

  const nodes: NormativeNode[] = LEI_14133_SPECS.map(s => createNormativeNode({
    tenantId, normId: LEI_14133_NORM_ID, type: s.type, identifier: s.identifier, displayName: s.displayName,
    parent: s.parent ? idOf(s.parent, specByIdentifier.get(s.parent)!.type) : null,
    children: childrenByParent.get(s.identifier) ?? [], order: s.order, authority: AUTHORITY, scope: SCOPE,
  })).sort((a, b) => a.id.localeCompare(b.id));

  // Referências estruturais de exemplo (SEM conteúdo): Art. 2º remete ao Art. 1º; Art. 4º correlato ao Art. 3º.
  const references: NormativeReference[] = [
    createNormativeReference({ from: idOf("Art. 2º", "artigo"), to: idOf("Art. 1º", "artigo"), type: "remissao", explanation: "Remissão estrutural do Art. 2º ao Art. 1º." }),
    createNormativeReference({ from: idOf("Art. 4º", "artigo"), to: idOf("Art. 3º", "artigo"), type: "correlacao", explanation: "Correlação estrutural entre Art. 4º e Art. 3º." }),
  ];

  return { normId: LEI_14133_NORM_ID, root: idOf("Lei 14.133/2021", "lei"), nodes, references };
}
