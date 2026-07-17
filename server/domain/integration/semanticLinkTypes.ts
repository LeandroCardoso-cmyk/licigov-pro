/**
 * RC-4.4.1 — Ontology Integration Layer · Tipos de ligação semântica (declarativo).
 *
 * Define os TIPOS de ligação que conectam a Ontologia Operacional (RC-4.3) à Ontologia
 * Jurídica (RC-4.4), mantendo ambas independentes. Cada tipo declara direção, cardinalidade
 * e navegabilidade. NÃO executável, sem conteúdo jurídico. Puro e determinístico.
 */

export type SemanticLinkTypeId =
  | "representa" | "depende" | "materializa" | "exige" | "fundamenta" | "relaciona_se"
  | "origina" | "controla" | "fiscaliza" | "executa" | "valida" | "substitui"
  | "complementa" | "encapsula";

export type LinkDirection = "unidirectional" | "bidirectional";
export type LinkCardinality = "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";

export interface SemanticLinkType {
  readonly id: SemanticLinkTypeId;
  readonly name: string;
  readonly description: string;
  readonly direction: LinkDirection;
  readonly cardinality: LinkCardinality;
  /** Permite navegação (traversal) na direção declarada. */
  readonly navigable: boolean;
  /** Peso para projeção no Knowledge Graph (0..1). */
  readonly weight: number;
}

export const SEMANTIC_LINK_TYPES: Record<SemanticLinkTypeId, SemanticLinkType> = {
  representa:    { id: "representa", name: "Representa", description: "O elemento representa/encarna o conceito.", direction: "unidirectional", cardinality: "many_to_one", navigable: true, weight: 0.9 },
  depende:       { id: "depende", name: "Depende", description: "O elemento depende do conceito/estrutura.", direction: "unidirectional", cardinality: "many_to_many", navigable: true, weight: 0.8 },
  materializa:   { id: "materializa", name: "Materializa", description: "O elemento materializa (concretiza) o conceito.", direction: "unidirectional", cardinality: "many_to_one", navigable: true, weight: 1.0 },
  exige:         { id: "exige", name: "Exige", description: "O elemento exige o conceito para existir.", direction: "unidirectional", cardinality: "many_to_many", navigable: true, weight: 0.9 },
  fundamenta:    { id: "fundamenta", name: "Fundamenta", description: "O elemento se fundamenta no conceito.", direction: "unidirectional", cardinality: "many_to_many", navigable: true, weight: 0.9 },
  relaciona_se:  { id: "relaciona_se", name: "Relaciona-se", description: "Relação semântica genérica.", direction: "bidirectional", cardinality: "many_to_many", navigable: true, weight: 0.5 },
  origina:       { id: "origina", name: "Origina", description: "O elemento origina o conceito/estado.", direction: "unidirectional", cardinality: "one_to_many", navigable: true, weight: 0.7 },
  controla:      { id: "controla", name: "Controla", description: "O elemento controla o conceito/procedimento.", direction: "unidirectional", cardinality: "one_to_many", navigable: true, weight: 0.7 },
  fiscaliza:     { id: "fiscaliza", name: "Fiscaliza", description: "O elemento fiscaliza o procedimento.", direction: "unidirectional", cardinality: "many_to_many", navigable: true, weight: 0.7 },
  executa:       { id: "executa", name: "Executa", description: "O elemento executa o procedimento.", direction: "unidirectional", cardinality: "many_to_many", navigable: true, weight: 0.8 },
  valida:        { id: "valida", name: "Valida", description: "O elemento valida requisito/critério.", direction: "unidirectional", cardinality: "many_to_many", navigable: true, weight: 0.7 },
  substitui:     { id: "substitui", name: "Substitui", description: "O elemento substitui outro (mesmo domínio).", direction: "unidirectional", cardinality: "one_to_one", navigable: true, weight: 0.6 },
  complementa:   { id: "complementa", name: "Complementa", description: "O elemento complementa outro.", direction: "bidirectional", cardinality: "many_to_many", navigable: true, weight: 0.6 },
  encapsula:     { id: "encapsula", name: "Encapsula", description: "O elemento encapsula (agrega) outros.", direction: "unidirectional", cardinality: "one_to_many", navigable: true, weight: 0.6 },
};

export const ALL_SEMANTIC_LINK_TYPE_IDS: SemanticLinkTypeId[] = Object.keys(SEMANTIC_LINK_TYPES) as SemanticLinkTypeId[];
export const ALL_LINK_CARDINALITIES: LinkCardinality[] = ["one_to_one", "one_to_many", "many_to_one", "many_to_many"];
export const ALL_LINK_DIRECTIONS: LinkDirection[] = ["unidirectional", "bidirectional"];

export function isSemanticLinkType(id: string): id is SemanticLinkTypeId { return id in SEMANTIC_LINK_TYPES; }
export function getSemanticLinkType(id: SemanticLinkTypeId): SemanticLinkType { return SEMANTIC_LINK_TYPES[id]; }
