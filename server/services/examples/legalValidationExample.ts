/**
 * EXEMPLO DE INTEGRAÇÃO: Legal Validation
 * 
 * Este arquivo demonstra como integrar o módulo de validação legal
 * nas funções de geração de documentos do LiciGov Pro.
 */

import { invokeLLM } from '../../_core/llm';
import { validateAndCorrectDocument, validateLegalCitations } from '../legalValidation';

/**
 * EXEMPLO 1: Geração de Parecer Jurídico com Validação
 */
export async function generateLegalOpinionWithValidation(
  processDescription: string
): Promise<{ content: string; validation: any; wasRegenerated: boolean }> {
  
  // Função de geração que será chamada (e possivelmente re-chamada)
  const generateFn = async () => {
    const response = await invokeLLM({
      messages: [
        {
          role: 'system',
          content: `Você é um especialista em licitações públicas e Lei 14.133/2021.

IMPORTANTE: A Lei 14.133/2021 possui APENAS 194 artigos (Art. 1 a Art. 194).
NUNCA cite artigos que não existem.

Gere o parecer em formato Markdown, citando apenas artigos válidos da Lei 14.133/2021.`
        },
        {
          role: 'user',
          content: `Analise o seguinte processo licitatório e emita parecer jurídico:

${processDescription}

Estruture o parecer com:
## RELATÓRIO
## FUNDAMENTAÇÃO LEGAL
## CONCLUSÃO`
        }
      ],
    });
    
    return response.choices[0].message.content as string;
  };
  
  // Validar e corrigir documento
  const result = await validateAndCorrectDocument(
    await generateFn(),
    generateFn,
    2 // Máximo 2 tentativas de regeneração
  );
  
  console.log('[Legal Opinion] Validação:', {
    isValid: result.validation.isValid,
    wasRegenerated: result.wasRegenerated,
    retries: result.retries,
    warnings: result.validation.warnings,
  });
  
  return result;
}

/**
 * EXEMPLO 2: Validação de Documento Existente
 */
export async function validateExistingDocument(content: string): Promise<void> {
  const validation = validateLegalCitations(content);
  
  if (!validation.isValid) {
    console.error('[Legal Validation] Documento inválido!');
    console.error('Artigos inválidos:', validation.invalidArticles);
    console.error('Avisos:', validation.warnings);
    
    throw new Error(
      `Documento contém citações legais inválidas:\n${validation.warnings.join('\n')}`
    );
  }
  
  console.log('[Legal Validation] Documento válido!');
  
  if (validation.suggestions.length > 0) {
    console.warn('[Legal Validation] Sugestões:', validation.suggestions);
  }
}

/**
 * EXEMPLO 3: Integração em Router tRPC
 */
/*
import { router, protectedProcedure } from '../_core/trpc';
import { z } from 'zod';

export const legalOpinionsRouter = router({
  generate: protectedProcedure
    .input(z.object({
      processId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Buscar dados do processo
      const process = await getProcessById(input.processId);
      
      if (!process) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      
      // Gerar parecer com validação
      const result = await generateLegalOpinionWithValidation(
        `Processo: ${process.name}\nObjeto: ${process.object}\nModalidade: ${process.modality}`
      );
      
      // Salvar no banco
      const opinion = await db.insert(legalOpinions).values({
        processId: input.processId,
        content: result.content,
        createdBy: ctx.user.id,
        validatedAt: new Date(),
        wasRegenerated: result.wasRegenerated,
      });
      
      return opinion;
    }),
});
*/

/**
 * EXEMPLO 4: Validação em Background Job
 */
export async function validateAllExistingOpinions(): Promise<{
  total: number;
  valid: number;
  invalid: number;
  invalidOpinions: Array<{ id: number; warnings: string[] }>;
}> {
  // Buscar todos os pareceres
  // const opinions = await db.select().from(legalOpinions);
  
  const opinions: Array<{ id: number; content: string }> = []; // Placeholder
  
  const results = {
    total: opinions.length,
    valid: 0,
    invalid: 0,
    invalidOpinions: [] as Array<{ id: number; warnings: string[] }>,
  };
  
  for (const opinion of opinions) {
    const validation = validateLegalCitations(opinion.content);
    
    if (validation.isValid) {
      results.valid++;
    } else {
      results.invalid++;
      results.invalidOpinions.push({
        id: opinion.id,
        warnings: validation.warnings,
      });
    }
  }
  
  console.log('[Validation Report]', results);
  
  return results;
}
