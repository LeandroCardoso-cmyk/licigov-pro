/**
 * RC-4.5.1 — Institutional Corpus Framework · Corpus Types (Part 2).
 *
 * Catálogo OFICIAL e declarativo dos tipos de corpus institucional. NÃO contém conhecimento
 * jurídico — apenas a classificação estrutural onde o conhecimento futuro será organizado.
 * Expansível: novos tipos podem ser adicionados sem alterar a arquitetura. Determinístico.
 */

export type CorpusTypeId =
  | "federal" | "estadual" | "municipal" | "institucional" | "organizacional"
  | "tribunal" | "controladoria" | "manual" | "normativo" | "conhecimento_interno";

/** Natureza institucional do corpus (agrupamento de alto nível). */
export type CorpusNature = "governamental" | "judicial" | "controle" | "institucional" | "interno";

export interface CorpusType {
  readonly id: CorpusTypeId;
  readonly name: string;
  readonly nature: CorpusNature;
  /** Descrição estrutural — nunca conteúdo jurídico. */
  readonly description: string;
  /** Nível de abrangência sugerido (menor = mais amplo). Apenas ordenação estrutural. */
  readonly breadth: number;
}

export const CORPUS_TYPES: Record<CorpusTypeId, CorpusType> = {
  federal: { id: "federal", name: "Corpus Federal", nature: "governamental", description: "Conhecimento de abrangência federal.", breadth: 1 },
  estadual: { id: "estadual", name: "Corpus Estadual", nature: "governamental", description: "Conhecimento de abrangência estadual.", breadth: 2 },
  municipal: { id: "municipal", name: "Corpus Municipal", nature: "governamental", description: "Conhecimento de abrangência municipal.", breadth: 3 },
  institucional: { id: "institucional", name: "Corpus Institucional", nature: "institucional", description: "Conhecimento próprio de uma instituição.", breadth: 4 },
  organizacional: { id: "organizacional", name: "Corpus Organizacional", nature: "institucional", description: "Conhecimento próprio de uma organização/unidade.", breadth: 5 },
  tribunal: { id: "tribunal", name: "Corpus de Tribunal", nature: "judicial", description: "Conhecimento de origem judicial/controle externo.", breadth: 2 },
  controladoria: { id: "controladoria", name: "Corpus de Controladoria", nature: "controle", description: "Conhecimento de origem de órgão de controle.", breadth: 2 },
  manual: { id: "manual", name: "Corpus de Manual", nature: "interno", description: "Conhecimento operacional em forma de manual.", breadth: 5 },
  normativo: { id: "normativo", name: "Corpus Normativo", nature: "governamental", description: "Conhecimento de natureza normativa geral.", breadth: 3 },
  conhecimento_interno: { id: "conhecimento_interno", name: "Corpus de Conhecimento Interno", nature: "interno", description: "Conhecimento interno (fluxos, boas práticas, FAQ).", breadth: 6 },
};

export const ALL_CORPUS_TYPES: CorpusTypeId[] = Object.keys(CORPUS_TYPES) as CorpusTypeId[];

export function isCorpusType(t: string): t is CorpusTypeId {
  return Object.prototype.hasOwnProperty.call(CORPUS_TYPES, t);
}

export function getCorpusType(id: CorpusTypeId): CorpusType {
  return CORPUS_TYPES[id];
}
