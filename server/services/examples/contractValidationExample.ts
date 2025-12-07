/**
 * EXEMPLO DE INTEGRAÇÃO: Contract Validation
 * 
 * Este arquivo demonstra como integrar as validações de conformidade legal
 * nas operações de contratos e aditivos do LiciGov Pro.
 */

import {
  validateAmendmentValue,
  validateContractDuration,
  validateDispensaValue,
  validateAmendmentJustification,
  validateProposalValidity,
} from '../contractValidation';

/**
 * EXEMPLO 1: Validação de Aditivo de Valor
 */
export async function createAmendmentWithValidation(data: {
  contractId: number;
  type: 'prazo' | 'valor' | 'escopo' | 'misto';
  justification: string;
  valueChange?: number;
  newEndDate?: Date;
}) {
  // 1. Buscar contrato
  // const contract = await getContractById(data.contractId);
  const contract = {
    id: 1,
    value: 10000000, // R$ 100.000,00 (em centavos)
    startDate: new Date('2024-01-01'),
    endDate: new Date('2025-01-01'),
  };
  
  // 2. Validar justificativa (sempre obrigatória)
  const justificationValidation = validateAmendmentJustification(data.justification);
  
  if (!justificationValidation.isValid) {
    throw new Error(
      `Justificativa inválida:\n${justificationValidation.errors.join('\n')}`
    );
  }
  
  // 3. Validar limite de valor (se aplicável)
  if (data.type === 'valor' || data.type === 'misto') {
    if (!data.valueChange) {
      throw new Error('Valor do aditivo é obrigatório para aditivos de valor');
    }
    
    // Buscar total de aditivos existentes
    // const existingAmendments = await getTotalAmendmentValue(data.contractId);
    const existingAmendments = 2000000; // R$ 20.000,00 já aditivado
    
    const valueValidation = validateAmendmentValue(
      contract.value,
      existingAmendments,
      data.valueChange
    );
    
    if (!valueValidation.isValid) {
      throw new Error(valueValidation.error!);
    }
    
    console.log('[Amendment Validation] Valor:', {
      percentage: valueValidation.percentage.toFixed(2) + '%',
      remaining: `R$ ${(valueValidation.remaining / 100).toFixed(2)}`,
    });
  }
  
  // 4. Validar prazo contratual (se aplicável)
  if (data.type === 'prazo' || data.type === 'misto') {
    if (!data.newEndDate) {
      throw new Error('Nova data fim é obrigatória para aditivos de prazo');
    }
    
    const durationValidation = validateContractDuration(
      contract.startDate,
      data.newEndDate
    );
    
    if (!durationValidation.isValid) {
      throw new Error(durationValidation.error!);
    }
    
    console.log('[Amendment Validation] Prazo:', {
      totalYears: durationValidation.totalDurationYears.toFixed(2),
      maxDate: durationValidation.maxDate.toISOString().split('T')[0],
    });
  }
  
  // 5. Criar aditivo
  console.log('[Amendment] Validações aprovadas. Criando aditivo...');
  
  // return await db.insert(amendments).values({ ... });
  return { success: true, message: 'Aditivo criado com sucesso' };
}

/**
 * EXEMPLO 2: Validação de Dispensa de Licitação
 */
export async function createDirectContractWithValidation(data: {
  estimatedValue: number;
  legalBasis: string;
  justification: string;
}) {
  // Validar limite de valor conforme fundamentação legal
  const valueValidation = validateDispensaValue(
    data.estimatedValue,
    data.legalBasis
  );
  
  if (!valueValidation.isValid) {
    throw new Error(valueValidation.error!);
  }
  
  console.log('[Direct Contract] Validação de valor aprovada:', {
    estimatedValue: `R$ ${(data.estimatedValue / 100).toFixed(2)}`,
    limit: `R$ ${(valueValidation.limit / 100).toFixed(2)}`,
    legalBasis: data.legalBasis,
  });
  
  // Criar contrato direto
  // return await db.insert(directContracts).values({ ... });
  return { success: true };
}

/**
 * EXEMPLO 3: Validação de Prazo de Validade de Propostas
 */
export async function createBiddingProcessWithValidation(data: {
  proposalValidityDays: number;
  // ... outros campos
}) {
  // Validar prazo mínimo de validade (Art. 40, §3º)
  const validityValidation = validateProposalValidity(data.proposalValidityDays);
  
  if (!validityValidation.isValid) {
    throw new Error(validityValidation.error!);
  }
  
  console.log('[Bidding Process] Prazo de validade aprovado:', {
    days: data.proposalValidityDays,
    minimum: validityValidation.minimumDays,
  });
  
  // Criar processo licitatório
  // return await db.insert(biddingProcesses).values({ ... });
  return { success: true };
}

/**
 * EXEMPLO 4: Integração em Router tRPC
 */
/*
import { router, protectedProcedure } from '../_core/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';

export const contractsRouter = router({
  amendments: router({
    create: protectedProcedure
      .input(z.object({
        contractId: z.number(),
        type: z.enum(['prazo', 'valor', 'escopo', 'misto']),
        justification: z.string().min(100),
        valueChange: z.number().optional(),
        newEndDate: z.date().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const amendment = await createAmendmentWithValidation(input);
          return amendment;
        } catch (error: any) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.message,
          });
        }
      }),
  }),
  
  direct: router({
    create: protectedProcedure
      .input(z.object({
        estimatedValue: z.number(),
        legalBasis: z.enum(['art75_i_a', 'art75_i_b', 'art75_ii', 'art75_ii_outros']),
        justification: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const contract = await createDirectContractWithValidation(input);
          return contract;
        } catch (error: any) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.message,
          });
        }
      }),
  }),
});
*/

/**
 * EXEMPLO 5: Relatório de Conformidade de Contratos
 */
export async function generateContractComplianceReport(contractId: number): Promise<{
  contractId: number;
  isCompliant: boolean;
  issues: string[];
  warnings: string[];
}> {
  // Buscar contrato e aditivos
  // const contract = await getContractById(contractId);
  // const amendments = await getAmendmentsByContractId(contractId);
  
  const contract = {
    id: contractId,
    value: 10000000,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2029-01-01'), // 5 anos
  };
  
  const amendments = [
    { valueChange: 3000000 }, // R$ 30.000,00
    { valueChange: 2500000 }, // R$ 25.000,00
  ];
  
  const issues: string[] = [];
  const warnings: string[] = [];
  
  // Verificar limite de aditivos
  const totalAmendments = amendments.reduce((sum, a) => sum + (a.valueChange || 0), 0);
  const valueValidation = validateAmendmentValue(contract.value, totalAmendments, 0);
  
  if (!valueValidation.isValid) {
    issues.push(`Limite de aditivos excedido: ${valueValidation.percentage.toFixed(2)}%`);
  } else if (valueValidation.percentage > 40) {
    warnings.push(`Aditivos próximos do limite: ${valueValidation.percentage.toFixed(2)}%`);
  }
  
  // Verificar prazo contratual
  const durationValidation = validateContractDuration(contract.startDate, contract.endDate);
  
  if (!durationValidation.isValid) {
    issues.push(`Prazo contratual excede 5 anos: ${durationValidation.totalDurationYears.toFixed(2)} anos`);
  }
  
  return {
    contractId,
    isCompliant: issues.length === 0,
    issues,
    warnings,
  };
}
