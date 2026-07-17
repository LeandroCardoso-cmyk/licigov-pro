/**
 * RC-4.4 — Institutional Legal Ontology · Conceitos jurídicos estruturais (declarativo).
 *
 * Modela os CONCEITOS estruturais do Direito (Obrigação, Vedação, Permissão, ...) por
 * categoria. NÃO ensina conteúdo jurídico — apenas os tipos de construção normativa.
 * Puro e determinístico.
 */

export type LegalConceptCategory = "deontico" | "condicional" | "competencial" | "temporal" | "procedimental" | "sancionatorio" | "qualificador" | "referencial";

export type LegalConceptId =
  | "obrigacao" | "vedacao" | "permissao" | "excecao" | "condicao" | "hipotese"
  | "competencia" | "prazo" | "procedimento" | "sancao" | "requisito" | "criterio"
  | "conceito" | "definicao" | "remissao" | "fundamentacao";

export interface LegalConcept {
  readonly id: LegalConceptId;
  readonly name: string;
  readonly category: LegalConceptCategory;
}

export const LEGAL_CONCEPTS: Record<LegalConceptId, LegalConcept> = {
  obrigacao:     { id: "obrigacao", name: "Obrigação", category: "deontico" },
  vedacao:       { id: "vedacao", name: "Vedação", category: "deontico" },
  permissao:     { id: "permissao", name: "Permissão", category: "deontico" },
  excecao:       { id: "excecao", name: "Exceção", category: "condicional" },
  condicao:      { id: "condicao", name: "Condição", category: "condicional" },
  hipotese:      { id: "hipotese", name: "Hipótese", category: "condicional" },
  competencia:   { id: "competencia", name: "Competência", category: "competencial" },
  prazo:         { id: "prazo", name: "Prazo", category: "temporal" },
  procedimento:  { id: "procedimento", name: "Procedimento", category: "procedimental" },
  sancao:        { id: "sancao", name: "Sanção", category: "sancionatorio" },
  requisito:     { id: "requisito", name: "Requisito", category: "qualificador" },
  criterio:      { id: "criterio", name: "Critério", category: "qualificador" },
  conceito:      { id: "conceito", name: "Conceito", category: "referencial" },
  definicao:     { id: "definicao", name: "Definição", category: "referencial" },
  remissao:      { id: "remissao", name: "Remissão", category: "referencial" },
  fundamentacao: { id: "fundamentacao", name: "Fundamentação", category: "referencial" },
};

export const ALL_LEGAL_CONCEPT_IDS: LegalConceptId[] = Object.keys(LEGAL_CONCEPTS) as LegalConceptId[];

export function isLegalConcept(id: string): id is LegalConceptId { return id in LEGAL_CONCEPTS; }
export function getLegalConcept(id: LegalConceptId): LegalConcept { return LEGAL_CONCEPTS[id]; }
export function conceptsByCategory(c: LegalConceptCategory): LegalConceptId[] {
  return ALL_LEGAL_CONCEPT_IDS.filter(id => LEGAL_CONCEPTS[id].category === c).sort();
}
