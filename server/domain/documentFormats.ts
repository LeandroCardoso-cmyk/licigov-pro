/**
 * SPRINT 5.X.X — Document Formats (consolidação)
 *
 * Regra consolidada: TODO Business Domain termina em documentos oficiais e, quando
 * produzidos DENTRO da plataforma, esses documentos são SEMPRE gerados em DOCX e
 * PDF. Este módulo é a fonte única de verdade sobre os formatos oficiais e sobre
 * quais saídas cada domínio produz. Determinístico.
 */

export type OfficialFormat = "docx" | "pdf";

/** Formatos oficiais obrigatórios para todo documento produzido na plataforma. */
export const REQUIRED_OFFICIAL_FORMATS: readonly OfficialFormat[] = ["docx", "pdf"];

/** Documentos oficiais produzidos por cada Business Domain. */
export const DOMAIN_OFFICIAL_DOCUMENTS: Record<string, readonly string[]> = {
  processo_licitatorio: ["dfd", "etp", "tr", "edital"],
  contratacao_direta: ["justificativa_contratacao", "justificativa_preco", "aviso", "ratificacao", "extrato_contrato"],
  parecer_juridico: ["parecer"],
  contratos: ["contrato", "aditivo", "apostilamento", "rescisao"],
};

/**
 * Saídas oficiais de um documento produzido na plataforma: sempre DOCX + PDF.
 * (O ETP não é obrigatório; mas SE elaborado, também gera DOCX + PDF.)
 */
export function officialOutputsFor(_documentKind: string): readonly OfficialFormat[] {
  return REQUIRED_OFFICIAL_FORMATS;
}

/** Indica se um documento de um domínio deve gerar os formatos oficiais. */
export function producesOfficialDocument(domain: string, documentKind: string): boolean {
  const docs = DOMAIN_OFFICIAL_DOCUMENTS[domain];
  return Boolean(docs && docs.includes(documentKind));
}

/** Verdadeiro se ambos os formatos oficiais (DOCX e PDF) estão presentes. */
export function hasAllOfficialFormats(formats: readonly string[]): boolean {
  return REQUIRED_OFFICIAL_FORMATS.every(f => formats.includes(f));
}
