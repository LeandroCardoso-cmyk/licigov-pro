/**
 * RC-4.6.1 — Federal Procurement Corpus · Normative Hierarchy (Part 2).
 *
 * Níveis normativos OFICIAIS usados pela Lei nº 14.133/2021 (e reutilizáveis por qualquer ato
 * normativo): Lei → Livro → Título → Capítulo → Seção → Subseção → Artigo → Parágrafo → Inciso →
 * Alínea → Item. Estrutura declarativa e determinística. SEM conteúdo jurídico. Estende a taxonomia
 * estrutural da Ontologia Jurídica (RC-4.4) com os níveis de topo (Lei/Livro).
 */

export type NormativeLevelId =
  | "lei" | "livro" | "titulo" | "capitulo" | "secao" | "subsecao"
  | "artigo" | "paragrafo" | "inciso" | "alinea" | "item";

export interface NormativeLevel {
  readonly id: NormativeLevelId;
  readonly name: string;
  /** Nível canônico imediato acima (null = raiz). */
  readonly parent: NormativeLevelId | null;
  /** Nível canônico imediato abaixo. */
  readonly children: readonly NormativeLevelId[];
  /** Profundidade canônica (0 = raiz). Menor = mais alto. */
  readonly depth: number;
  /** Ordem determinística. */
  readonly order: number;
}

export const NORMATIVE_HIERARCHY: Record<NormativeLevelId, NormativeLevel> = {
  lei:       { id: "lei", name: "Lei", parent: null, children: ["livro"], depth: 0, order: 1 },
  livro:     { id: "livro", name: "Livro", parent: "lei", children: ["titulo"], depth: 1, order: 2 },
  titulo:    { id: "titulo", name: "Título", parent: "livro", children: ["capitulo"], depth: 2, order: 3 },
  capitulo:  { id: "capitulo", name: "Capítulo", parent: "titulo", children: ["secao"], depth: 3, order: 4 },
  secao:     { id: "secao", name: "Seção", parent: "capitulo", children: ["subsecao"], depth: 4, order: 5 },
  subsecao:  { id: "subsecao", name: "Subseção", parent: "secao", children: ["artigo"], depth: 5, order: 6 },
  artigo:    { id: "artigo", name: "Artigo", parent: "subsecao", children: ["paragrafo"], depth: 6, order: 7 },
  paragrafo: { id: "paragrafo", name: "Parágrafo", parent: "artigo", children: ["inciso"], depth: 7, order: 8 },
  inciso:    { id: "inciso", name: "Inciso", parent: "paragrafo", children: ["alinea"], depth: 8, order: 9 },
  alinea:    { id: "alinea", name: "Alínea", parent: "inciso", children: ["item"], depth: 9, order: 10 },
  item:      { id: "item", name: "Item", parent: "alinea", children: [], depth: 10, order: 11 },
};

export const ALL_NORMATIVE_LEVELS: NormativeLevelId[] = Object.keys(NORMATIVE_HIERARCHY) as NormativeLevelId[];

export function isNormativeLevel(id: string): id is NormativeLevelId {
  return Object.prototype.hasOwnProperty.call(NORMATIVE_HIERARCHY, id);
}

export function getNormativeLevel(id: NormativeLevelId): NormativeLevel {
  return NORMATIVE_HIERARCHY[id];
}

export function normativeDepth(id: NormativeLevelId): number {
  return NORMATIVE_HIERARCHY[id].depth;
}

/**
 * Um nível pode CONTER outro se sua profundidade for estritamente menor (níveis intermediários
 * são opcionais — ex.: um Artigo pode estar diretamente sob um Capítulo, sem Seção/Subseção).
 */
export function canContain(parent: NormativeLevelId, child: NormativeLevelId): boolean {
  return NORMATIVE_HIERARCHY[parent].depth < NORMATIVE_HIERARCHY[child].depth;
}

/** Caminho canônico da raiz (Lei) até o nível informado. Determinístico. */
export function levelPath(id: NormativeLevelId): NormativeLevelId[] {
  const path: NormativeLevelId[] = [];
  let cur: NormativeLevelId | null = id;
  const seen = new Set<NormativeLevelId>();
  while (cur && !seen.has(cur)) { seen.add(cur); path.unshift(cur); cur = NORMATIVE_HIERARCHY[cur].parent; }
  return path;
}
