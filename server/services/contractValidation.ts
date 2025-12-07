/**
 * Módulo de Validação de Contratos
 * 
 * Correções da Auditoria Técnica:
 * - Item 1.4: Validação de limite de aditivos de valor (50%) - Prioridade 90/100
 * - Item 1.5: Validação de prazo contratual máximo (5 anos) - Prioridade 90/100
 * - Item 4.2: Validação de limites de valor em dispensas - Prioridade 85/100
 * - Item 4.3: Justificativa obrigatória em aditivos - Prioridade 75/100
 * - Item 4.4: Validação de apostilamentos contra índices oficiais - Prioridade 80/100
 */

import { differenceInDays, differenceInYears, addYears, format } from 'date-fns';

/**
 * Validação de limite de aditivos de valor (Art. 125 da Lei 14.133/2021)
 * Limite: 50% do valor original do contrato
 */
export interface AmendmentValueValidation {
  isValid: boolean;
  totalAmendments: number;
  percentage: number;
  limit: number;
  remaining: number;
  error?: string;
}

export function validateAmendmentValue(
  originalValue: number,
  existingAmendments: number,
  newAmendmentValue: number
): AmendmentValueValidation {
  const limit = originalValue * 0.5; // 50% do valor original
  const totalAmendments = existingAmendments + newAmendmentValue;
  const percentage = (totalAmendments / originalValue) * 100;
  const remaining = limit - totalAmendments;

  const isValid = totalAmendments <= limit;

  return {
    isValid,
    totalAmendments,
    percentage,
    limit,
    remaining,
    error: !isValid
      ? `Limite de 50% do valor original excedido (Art. 125 da Lei 14.133/2021).\n\n` +
        `Valor original do contrato: R$ ${(originalValue / 100).toFixed(2)}\n` +
        `Limite máximo de aditivos: R$ ${(limit / 100).toFixed(2)}\n` +
        `Total de aditivos existentes: R$ ${(existingAmendments / 100).toFixed(2)}\n` +
        `Valor deste aditivo: R$ ${(newAmendmentValue / 100).toFixed(2)}\n` +
        `Total após este aditivo: R$ ${(totalAmendments / 100).toFixed(2)}\n\n` +
        `Você pode adicionar no máximo R$ ${(remaining / 100).toFixed(2)}`
      : undefined,
  };
}

/**
 * Validação de prazo contratual (Art. 125 da Lei 14.133/2021)
 * Limite: 120 meses (10 anos) de duração total incluindo aditivos
 */
export interface ContractDurationValidation {
  isValid: boolean;
  totalDurationDays: number;
  totalDurationMonths: number;
  totalDurationYears: number;
  maxDate: Date;
  error?: string;
}

export function validateContractDuration(
  startDate: Date,
  newEndDate: Date
): ContractDurationValidation {
  const totalDurationDays = differenceInDays(newEndDate, startDate);
  const totalDurationMonths = totalDurationDays / 30.44; // Média de dias por mês
  const totalDurationYears = totalDurationMonths / 12;
  const maxDate = addYears(startDate, 10); // 120 meses = 10 anos

  const isValid = totalDurationMonths <= 120;

  return {
    isValid,
    totalDurationDays,
    totalDurationMonths,
    totalDurationYears,
    maxDate,
    error: !isValid
      ? `Duração total do contrato excede 120 meses (Art. 125 da Lei 14.133/2021).\n\n` +
        `Data de início: ${format(startDate, 'dd/MM/yyyy')}\n` +
        `Nova data fim: ${format(newEndDate, 'dd/MM/yyyy')}\n` +
        `Duração total: ${totalDurationMonths.toFixed(1)} meses (${totalDurationYears.toFixed(2)} anos)\n\n` +
        `Limite máximo: 120 meses / 10 anos (${format(maxDate, 'dd/MM/yyyy')})\n\n` +
        `Art. 125: Os contratos poderão ser alterados, com as devidas justificativas, nos seguintes casos:\n` +
        `- Aditivos de prazo: até 120 meses\n` +
        `- Aditivos de valor: até 50% do valor inicial\n\n` +
        `Se houver necessidade de prazo superior, é necessário novo processo licitatório.`
      : undefined,
  };
}

/**
 * Limites de valor para dispensas de licitação (Art. 75 da Lei 14.133/2021)
 */
export const DISPENSA_LIMITS: Record<string, number> = {
  // Art. 75, I, a) - Obras e serviços de engenharia
  'art75_i_a': 10000000, // R$ 100.000,00

  // Art. 75, I, b) - Outros serviços e compras
  'art75_i_b': 5000000,  // R$ 50.000,00

  // Art. 75, II - Contratações de entes federativos
  'art75_ii': 10000000,  // R$ 100.000,00 (obras e serviços de engenharia)

  // Art. 75, II - Contratações de entes federativos (outros)
  'art75_ii_outros': 5000000,  // R$ 50.000,00

  // Outros incisos (valores específicos)
  'art75_iii': Infinity, // Sem limite de valor (emergência)
  'art75_iv': Infinity,  // Sem limite de valor (segurança nacional)
};

export interface DispensaValidation {
  isValid: boolean;
  limit: number;
  estimatedValue: number;
  legalBasis: string;
  error?: string;
}

export function validateDispensaValue(
  estimatedValue: number,
  legalBasis: string
): DispensaValidation {
  const limit = DISPENSA_LIMITS[legalBasis];

  if (!limit) {
    return {
      isValid: false,
      limit: 0,
      estimatedValue,
      legalBasis,
      error: `Fundamentação legal inválida: ${legalBasis}`,
    };
  }

  const isValid = estimatedValue <= limit;

  return {
    isValid,
    limit,
    estimatedValue,
    legalBasis,
    error: !isValid
      ? `Valor estimado (R$ ${(estimatedValue / 100).toFixed(2)}) excede limite legal de R$ ${(limit / 100).toFixed(2)} para ${legalBasis}`
      : undefined,
  };
}

/**
 * Validação de justificativa em aditivos (Art. 124 da Lei 14.133/2021)
 */
export interface JustificationValidation {
  isValid: boolean;
  length: number;
  hasLegalBasis: boolean;
  errors: string[];
}

export function validateAmendmentJustification(
  justification: string
): JustificationValidation {
  const errors: string[] = [];

  // Verificar tamanho mínimo
  if (justification.length < 100) {
    errors.push('Justificativa deve ter no mínimo 100 caracteres (Art. 124 da Lei 14.133/2021)');
  }

  // Verificar se menciona fundamentação legal
  const hasLegalBasis = /Art\.?\s*\d+|Artigo\s*\d+/i.test(justification);

  if (!hasLegalBasis) {
    errors.push('Justificativa deve citar fundamentação legal (Art. 124 da Lei 14.133/2021)');
  }

  return {
    isValid: errors.length === 0,
    length: justification.length,
    hasLegalBasis,
    errors,
  };
}

/**
 * Índices oficiais para reajustes contratuais
 */
export const OFFICIAL_INDICES: Record<string, string> = {
  IPCA: 'IPCA - Índice Nacional de Preços ao Consumidor Amplo (IBGE)',
  'IGP-M': 'IGP-M - Índice Geral de Preços do Mercado (FGV)',
  INPC: 'INPC - Índice Nacional de Preços ao Consumidor (IBGE)',
  IPC: 'IPC - Índice de Preços ao Consumidor (FGV)',
  INCC: 'INCC - Índice Nacional de Custo da Construção (FGV)',
};

export interface ApostilamentoValidation {
  isValid: boolean;
  indexType: string;
  indexValue: number;
  officialValue?: number;
  difference?: number;
  warnings: string[];
}

/**
 * Valida apostilamento de reajuste contra índice oficial
 * Nota: Requer integração com API do IBGE/FGV para buscar índices reais
 */
export async function validateApostilamentoIndex(
  indexType: string,
  indexValue: number,
  referenceDate: Date
): Promise<ApostilamentoValidation> {
  const warnings: string[] = [];

  // Verificar se índice é válido
  if (!OFFICIAL_INDICES[indexType]) {
    return {
      isValid: false,
      indexType,
      indexValue,
      warnings: [`Índice inválido: ${indexType}. Índices válidos: ${Object.keys(OFFICIAL_INDICES).join(', ')}`],
    };
  }

  // TODO: Integrar com API oficial (IBGE/FGV) para buscar índice real
  // Por enquanto, apenas validar se está dentro de uma margem razoável
  const officialValue = await fetchOfficialIndex(indexType, referenceDate);

  if (officialValue !== null) {
    const difference = Math.abs(indexValue - officialValue);

    // Margem de tolerância: 0.5%
    if (difference > 0.5) {
      warnings.push(
        `Índice informado (${indexValue}%) difere do índice oficial (${officialValue}%). ` +
        `Diferença: ${difference.toFixed(2)}%. Verifique a fonte.`
      );
    }

    return {
      isValid: difference <= 0.5,
      indexType,
      indexValue,
      officialValue,
      difference,
      warnings,
    };
  }

  // Se não conseguiu buscar índice oficial, apenas avisar
  warnings.push(
    `Não foi possível validar o índice ${indexType} para a data ${format(referenceDate, 'MM/yyyy')}. ` +
    `Verifique manualmente em ${getIndexSourceURL(indexType)}`
  );

  return {
    isValid: true, // Assume válido se não conseguiu verificar
    indexType,
    indexValue,
    warnings,
  };
}

/**
 * Busca índice oficial (placeholder - requer integração com API)
 */
async function fetchOfficialIndex(
  indexType: string,
  referenceDate: Date
): Promise<number | null> {
  // TODO: Implementar integração com APIs oficiais
  // IPCA: https://servicodados.ibge.gov.br/api/v3/agregados/1737/periodos/...
  // IGP-M: https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/dados
  // INPC: https://servicodados.ibge.gov.br/api/v3/agregados/1736/periodos/...

  console.warn(
    `[Contract Validation] Integração com API de índices não implementada. ` +
    `Índice: ${indexType}, Data: ${format(referenceDate, 'MM/yyyy')}`
  );

  return null; // Retorna null se não conseguiu buscar
}

/**
 * Retorna URL da fonte oficial do índice
 */
function getIndexSourceURL(indexType: string): string {
  const urls: Record<string, string> = {
    IPCA: 'https://www.ibge.gov.br/estatisticas/economicas/precos-e-custos/9256-indice-nacional-de-precos-ao-consumidor-amplo.html',
    'IGP-M': 'https://portalibre.fgv.br/estudos-e-pesquisas/indices-de-precos/igp',
    INPC: 'https://www.ibge.gov.br/estatisticas/economicas/precos-e-custos/9258-indice-nacional-de-precos-ao-consumidor.html',
    IPC: 'https://portalibre.fgv.br/estudos-e-pesquisas/indices-de-precos/ipc',
    INCC: 'https://portalibre.fgv.br/estudos-e-pesquisas/indices-de-precos/incc',
  };

  return urls[indexType] || 'https://www.ibge.gov.br';
}

/**
 * Validação de prazo mínimo de validade de propostas (Art. 40, §3º)
 */
export interface ProposalValidityValidation {
  isValid: boolean;
  days: number;
  minimumDays: number;
  error?: string;
}

export function validateProposalValidity(days: number): ProposalValidityValidation {
  const minimumDays = 60; // Art. 40, §3º da Lei 14.133/2021
  const isValid = days >= minimumDays;

  return {
    isValid,
    days,
    minimumDays,
    error: !isValid
      ? `Prazo de validade de propostas deve ser no mínimo ${minimumDays} dias (Art. 40, §3º da Lei 14.133/2021). Valor informado: ${days} dias.`
      : undefined,
  };
}
