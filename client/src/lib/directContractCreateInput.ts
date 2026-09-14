/**
 * A3-RD1 — seleção PURA do enquadramento legal para `directContracts.create` no wizard.
 *
 * Dois domínios DISJUNTOS (nunca misturar IDs de tabelas distintas):
 *   - GOVERNADO: referência resolvida de uma sugestão IA governada (canonicalLocator + versão);
 *   - LEGADO:    artigo escolhido no dropdown legado (legalArticleId).
 * Governado tem precedência quando presente; ausência de ambos é erro (fail-closed no cliente,
 * espelhando o refine estrito do backend).
 */
export interface GovernedRef {
  canonicalLocator: string;
  referenceSetVersion: number;
  legalReferenceEntryId: number;
}

export type LegalFramingInput =
  | { canonicalLocator: string; referenceSetVersion: number }
  | { legalArticleId: number };

export function buildLegalFramingInput(
  governedRef: GovernedRef | null,
  legalArticleId: number | null,
): LegalFramingInput {
  if (governedRef) {
    return { canonicalLocator: governedRef.canonicalLocator, referenceSetVersion: governedRef.referenceSetVersion };
  }
  if (legalArticleId != null) {
    return { legalArticleId };
  }
  throw new Error("Enquadramento ausente: selecione a referência governada (IA) ou o artigo legal (catálogo legado).");
}
