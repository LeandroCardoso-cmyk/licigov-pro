/**
 * SEM-060 — a Importação Assistida NÃO tem etapa de confirmação: `operationRecord.importLegacy` extrai número, objeto
 * e modalidade do texto colado e GRAVA o registro como Origem Externa de imediato (a timeline já o marca como
 * "pendente de confirmação"). A cópia diz isso; não promete "você confirma" antes de gravar.
 */
export const LEGACY_IMPORT_NOTE =
  "Cole o texto do documento (PDF/DOCX). Ao importar, o sistema extrai número, objeto e modalidade e registra o documento de imediato como Origem Externa, sem pedir confirmação dos campos antes. Depois, confira os dados extraídos na lista de registros.";

export const LEGACY_IMPORT_BUTTON = "Importar e registrar como Origem Externa";
export const LEGACY_IMPORT_PENDING = "Registrando…";

export function legacyImportResultTitle(confidence: number): string {
  return `Registrado como Origem Externa (extração assistida) — confiança ${Math.round(confidence * 100)}%. Confira os campos extraídos.`;
}
