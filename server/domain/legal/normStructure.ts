/**
 * RC-4.4 — Institutional Legal Ontology · Estrutura normativa interna (declarativo).
 *
 * Modela a ESTRUTURA interna de uma norma (Título → ... → Item, + Anexo). Cada elemento
 * declara pai, filhos, nível e posição relativa. Árvore acíclica. Sem conteúdo jurídico.
 * Puro e determinístico.
 */

export type StructuralElementId =
  | "titulo" | "capitulo" | "secao" | "subsecao" | "artigo"
  | "paragrafo" | "inciso" | "alinea" | "item" | "anexo";

export interface StructuralElement {
  readonly id: StructuralElementId;
  readonly name: string;
  /** Elemento pai na árvore estrutural (null = raiz). */
  readonly parent: StructuralElementId | null;
  readonly children: readonly StructuralElementId[];
  /** Nível na hierarquia estrutural (0 = raiz). */
  readonly level: number;
  /** Posição relativa (ordem determinística). */
  readonly order: number;
}

export const NORM_STRUCTURE: Record<StructuralElementId, StructuralElement> = {
  titulo:    { id: "titulo", name: "Título", parent: null, children: ["capitulo"], level: 0, order: 1 },
  capitulo:  { id: "capitulo", name: "Capítulo", parent: "titulo", children: ["secao"], level: 1, order: 2 },
  secao:     { id: "secao", name: "Seção", parent: "capitulo", children: ["subsecao"], level: 2, order: 3 },
  subsecao:  { id: "subsecao", name: "Subseção", parent: "secao", children: ["artigo"], level: 3, order: 4 },
  artigo:    { id: "artigo", name: "Artigo", parent: "subsecao", children: ["paragrafo"], level: 4, order: 5 },
  paragrafo: { id: "paragrafo", name: "Parágrafo", parent: "artigo", children: ["inciso"], level: 5, order: 6 },
  inciso:    { id: "inciso", name: "Inciso", parent: "paragrafo", children: ["alinea"], level: 6, order: 7 },
  alinea:    { id: "alinea", name: "Alínea", parent: "inciso", children: ["item"], level: 7, order: 8 },
  item:      { id: "item", name: "Item", parent: "alinea", children: [], level: 8, order: 9 },
  anexo:     { id: "anexo", name: "Anexo", parent: null, children: [], level: 0, order: 10 },
};

export const ALL_STRUCTURAL_ELEMENT_IDS: StructuralElementId[] = Object.keys(NORM_STRUCTURE) as StructuralElementId[];

export function isStructuralElement(id: string): id is StructuralElementId { return id in NORM_STRUCTURE; }
export function getStructuralElement(id: StructuralElementId): StructuralElement { return NORM_STRUCTURE[id]; }

/** Caminho da raiz até o elemento (posição hierárquica). Determinístico. */
export function structuralPath(id: StructuralElementId): StructuralElementId[] {
  const path: StructuralElementId[] = [];
  let cur: StructuralElementId | null = id;
  const seen = new Set<StructuralElementId>();
  while (cur && !seen.has(cur)) { seen.add(cur); path.unshift(cur); cur = NORM_STRUCTURE[cur].parent; }
  return path;
}
