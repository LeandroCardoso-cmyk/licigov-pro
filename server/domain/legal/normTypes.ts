/**
 * RC-4.4 — Institutional Legal Ontology · Tipos normativos (declarativo).
 *
 * Modela a ESTRUTURA do conhecimento jurídico das contratações públicas — NÃO o conteúdo.
 * Cada tipo declara sua natureza, nível hierárquico, origem, escopo, classificação e
 * dependências típicas. Independente de qualquer lei/tribunal/país. Puro e determinístico.
 * NÃO ensina Lei 14.133, acórdãos, jurisprudência ou doutrina.
 */

/** Classificações/taxonomias (Part 6). */
export type LegalClassification =
  | "norma_primaria" | "norma_secundaria" | "norma_complementar"
  | "entendimento" | "jurisprudencia" | "doutrina" | "orientacao" | "manual" | "parecer";

/** Origem institucional do elemento jurídico. */
export type LegalOrigin = "legislativo" | "executivo" | "judiciario" | "tecnico" | "academico";

/** Escopo normativo. */
export type LegalScope = "primaria" | "secundaria" | "complementar" | "entendimento";

export type NormTypeId =
  | "norma" | "lei" | "decreto" | "regulamento" | "instrucao_normativa" | "portaria"
  | "resolucao" | "acordao" | "parecer" | "jurisprudencia" | "doutrina"
  | "orientacao_tecnica" | "nota_tecnica" | "manual" | "guia";

export interface NormType {
  readonly id: NormTypeId;
  readonly name: string;
  readonly classification: LegalClassification;
  readonly origin: LegalOrigin;
  readonly scope: LegalScope;
  /** Nível hierárquico normativo (menor = mais alto). 0 = tipo abstrato raiz. */
  readonly hierarchyLevel: number;
  /** Tipo é abstrato (supertipo, não instanciável). */
  readonly abstract: boolean;
  /** Tipos dos quais este DEPENDE tipicamente (dependência estrutural, não conteúdo). */
  readonly dependsOn: readonly NormTypeId[];
}

export const NORM_TYPES: Record<NormTypeId, NormType> = {
  norma: { id: "norma", name: "Norma", classification: "norma_primaria", origin: "legislativo", scope: "primaria", hierarchyLevel: 0, abstract: true, dependsOn: [] },
  lei: { id: "lei", name: "Lei", classification: "norma_primaria", origin: "legislativo", scope: "primaria", hierarchyLevel: 1, abstract: false, dependsOn: [] },
  decreto: { id: "decreto", name: "Decreto", classification: "norma_secundaria", origin: "executivo", scope: "secundaria", hierarchyLevel: 2, abstract: false, dependsOn: ["lei"] },
  regulamento: { id: "regulamento", name: "Regulamento", classification: "norma_secundaria", origin: "executivo", scope: "secundaria", hierarchyLevel: 2, abstract: false, dependsOn: ["lei"] },
  instrucao_normativa: { id: "instrucao_normativa", name: "Instrução Normativa", classification: "norma_complementar", origin: "executivo", scope: "complementar", hierarchyLevel: 3, abstract: false, dependsOn: ["decreto"] },
  portaria: { id: "portaria", name: "Portaria", classification: "norma_complementar", origin: "executivo", scope: "complementar", hierarchyLevel: 4, abstract: false, dependsOn: ["instrucao_normativa"] },
  resolucao: { id: "resolucao", name: "Resolução", classification: "norma_complementar", origin: "executivo", scope: "complementar", hierarchyLevel: 4, abstract: false, dependsOn: ["instrucao_normativa"] },
  orientacao_tecnica: { id: "orientacao_tecnica", name: "Orientação Técnica", classification: "orientacao", origin: "tecnico", scope: "complementar", hierarchyLevel: 5, abstract: false, dependsOn: ["portaria"] },
  manual: { id: "manual", name: "Manual", classification: "manual", origin: "tecnico", scope: "complementar", hierarchyLevel: 6, abstract: false, dependsOn: ["orientacao_tecnica"] },
  guia: { id: "guia", name: "Guia", classification: "manual", origin: "tecnico", scope: "complementar", hierarchyLevel: 6, abstract: false, dependsOn: ["orientacao_tecnica"] },
  nota_tecnica: { id: "nota_tecnica", name: "Nota Técnica", classification: "orientacao", origin: "tecnico", scope: "complementar", hierarchyLevel: 7, abstract: false, dependsOn: ["manual"] },
  parecer: { id: "parecer", name: "Parecer", classification: "parecer", origin: "tecnico", scope: "entendimento", hierarchyLevel: 8, abstract: false, dependsOn: ["lei"] },
  acordao: { id: "acordao", name: "Acórdão", classification: "jurisprudencia", origin: "judiciario", scope: "entendimento", hierarchyLevel: 8, abstract: false, dependsOn: ["lei"] },
  jurisprudencia: { id: "jurisprudencia", name: "Jurisprudência", classification: "jurisprudencia", origin: "judiciario", scope: "entendimento", hierarchyLevel: 8, abstract: false, dependsOn: ["lei"] },
  doutrina: { id: "doutrina", name: "Doutrina", classification: "doutrina", origin: "academico", scope: "entendimento", hierarchyLevel: 9, abstract: false, dependsOn: ["lei"] },
};

export const ALL_NORM_TYPE_IDS: NormTypeId[] = Object.keys(NORM_TYPES) as NormTypeId[];

export const ALL_LEGAL_CLASSIFICATIONS: LegalClassification[] = [
  "norma_primaria", "norma_secundaria", "norma_complementar",
  "entendimento", "jurisprudencia", "doutrina", "orientacao", "manual", "parecer",
];

/** Cadeia hierárquica normativa canônica (Part 5). */
export const NORMATIVE_HIERARCHY: readonly NormTypeId[] = [
  "lei", "decreto", "instrucao_normativa", "portaria", "orientacao_tecnica", "manual", "nota_tecnica",
];

export function isNormType(id: string): id is NormTypeId { return id in NORM_TYPES; }
export function getNormType(id: NormTypeId): NormType { return NORM_TYPES[id]; }
export function normsByClassification(c: LegalClassification): NormTypeId[] {
  return ALL_NORM_TYPE_IDS.filter(id => NORM_TYPES[id].classification === c).sort();
}
