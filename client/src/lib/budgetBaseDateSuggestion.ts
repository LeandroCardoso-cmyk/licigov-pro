/**
 * M8 pós-homologação — sugestão de data-base do orçamento. A data disponível é a de REGISTRO da pesquisa no sistema
 * (timestamp técnico), não a data declarada no documento da pesquisa: o rótulo diz isso, e a sugestão só existe enquanto
 * não houver data-base registrada (decisão humana). Nada é presumido como "data da pesquisa".
 */
export function baseDateSuggestion(s: { baseDate?: string | null; suggestedBaseDate?: string | null }): string | null {
  if (s.baseDate) return null;
  return s.suggestedBaseDate || null;
}

export const BASE_DATE_SUGGESTION_LABEL = "Sugestão: data de registro da pesquisa no sistema";
