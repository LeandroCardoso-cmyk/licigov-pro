# Guia de Integração das Correções da Auditoria Técnica

**Data:** 07 de Dezembro de 2025  
**Versão:** 1.0  
**Projeto:** LiciGov Pro

---

## Sumário

1. [Visão Geral](#visão-geral)
2. [Módulos Implementados](#módulos-implementados)
3. [Integração por Prioridade](#integração-por-prioridade)
4. [Exemplos de Uso](#exemplos-de-uso)
5. [Testes Recomendados](#testes-recomendados)
6. [Checklist de Implementação](#checklist-de-implementação)

---

## Visão Geral

Este guia apresenta as correções críticas implementadas com base na auditoria técnica do LiciGov Pro. Todos os módulos foram criados de forma **isolada e independente**, permitindo integração gradual sem quebrar o código existente.

**Módulos criados:**
- `server/services/legalValidation.ts` - Validação de artigos legais (anti-hallucination)
- `server/services/aiOutputValidation.ts` - Validação de outputs de IA
- `server/services/contractValidation.ts` - Validações de conformidade legal
- `server/services/rateLimiter.ts` - Rate limiting para procedures críticas
- `server/services/passwordSecurity.ts` - Segurança de senhas (bcrypt salt 12)

---

## Módulos Implementados

### 1. Legal Validation (Prioridade 95/100)

**Arquivo:** `server/services/legalValidation.ts`

**Problema resolvido:** IA pode citar artigos inexistentes da Lei 14.133/2021

**Funções principais:**
- `validateLegalCitations(content: string)` - Valida citações de artigos
- `validateAndCorrectDocument(content, regenerateFn, maxRetries)` - Valida e regenera se necessário
- `extractCitedArticles(content)` - Extrai todos os artigos citados
- `generateComplianceReport(content)` - Gera relatório de conformidade

**Como integrar:**

```typescript
// Em server/services/documentGenerationService.ts

import { validateAndCorrectDocument } from './legalValidation';

export async function generateLegalOpinion(opinionId: number): Promise<string> {
  const opinion = await getLegalOpinionById(opinionId);
  
  // Função de geração
  const generateFn = async () => {
    const response = await invokeLLM({
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em Lei 14.133/2021. IMPORTANTE: A lei possui apenas 194 artigos. Cite apenas artigos de 1 a 194.'
        },
        // ... resto do prompt
      ],
      temperature: 0.2,
    });
    return response.choices[0].message.content;
  };
  
  // Validar e corrigir
  const result = await validateAndCorrectDocument(
    await generateFn(),
    generateFn,
    2 // máximo 2 tentativas
  );
  
  if (!result.validation.isValid) {
    throw new Error(`Documento inválido: ${result.validation.warnings.join(', ')}`);
  }
  
  return result.content;
}
```

---

### 2. AI Output Validation (Prioridade 75/100)

**Arquivo:** `server/services/aiOutputValidation.ts`

**Problema resolvido:** IA pode retornar JSON, texto plano ou formato corrompido

**Funções principais:**
- `validateDocument(content, documentType)` - Valida formato e estrutura
- `validateAndCorrectAIOutput(content, documentType, regenerateFn, maxRetries)` - Valida e regenera
- `getTemperatureForDocument(documentType)` - Retorna temperatura adequada
- `TEMPERATURE_CONFIG` - Configuração de temperatura por tipo

**Como integrar:**

```typescript
// Em server/services/documentGenerationService.ts

import { 
  validateAndCorrectAIOutput, 
  getTemperatureForDocument 
} from './aiOutputValidation';

export async function generateETP(processId: number): Promise<string> {
  const process = await getProcessById(processId);
  
  const generateFn = async (feedback?: string) => {
    const response = await invokeLLM({
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em licitações públicas. Gere documentos em formato Markdown válido.'
        },
        {
          role: 'user',
          content: `Gere um ETP para: ${process.object}${feedback ? `\n\nFeedback: ${feedback}` : ''}`
        }
      ],
      temperature: getTemperatureForDocument('etp'), // 0.5
    });
    return response.choices[0].message.content;
  };
  
  const result = await validateAndCorrectAIOutput(
    await generateFn(),
    'etp',
    generateFn,
    2
  );
  
  return result.content;
}
```

---

### 3. Contract Validation (Prioridade 90-85/100)

**Arquivo:** `server/services/contractValidation.ts`

**Problemas resolvidos:**
- Limite de aditivos de valor (50%)
- Prazo contratual máximo (5 anos)
- Limites de valor em dispensas
- Justificativa obrigatória em aditivos
- Validação de apostilamentos

**Funções principais:**
- `validateAmendmentValue(originalValue, existingAmendments, newAmendmentValue)`
- `validateContractDuration(startDate, newEndDate)`
- `validateDispensaValue(estimatedValue, legalBasis)`
- `validateAmendmentJustification(justification)`
- `validateApostilamentoIndex(indexType, indexValue, referenceDate)`
- `validateProposalValidity(days)`

**Como integrar:**

```typescript
// Em server/api/routers/contractsRouter.ts

import { 
  validateAmendmentValue, 
  validateContractDuration,
  validateAmendmentJustification
} from '../services/contractValidation';

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
        const contract = await getContractById(input.contractId);
        
        if (!contract) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        
        // VALIDAÇÃO 1: Justificativa
        const justificationValidation = validateAmendmentJustification(input.justification);
        if (!justificationValidation.isValid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: justificationValidation.errors.join('\n')
          });
        }
        
        // VALIDAÇÃO 2: Limite de valor (se aplicável)
        if (input.type === 'valor' || input.type === 'misto') {
          const existingAmendments = await getTotalAmendmentValue(input.contractId);
          const valueValidation = validateAmendmentValue(
            contract.value,
            existingAmendments,
            input.valueChange!
          );
          
          if (!valueValidation.isValid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: valueValidation.error
            });
          }
        }
        
        // VALIDAÇÃO 3: Prazo contratual (se aplicável)
        if (input.type === 'prazo' || input.type === 'misto') {
          const durationValidation = validateContractDuration(
            contract.startDate,
            input.newEndDate!
          );
          
          if (!durationValidation.isValid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: durationValidation.error
            });
          }
        }
        
        // Criar aditivo
        const amendment = await createAmendment({
          contractId: input.contractId,
          type: input.type,
          justification: input.justification,
          valueChange: input.valueChange,
          newEndDate: input.newEndDate,
          signedAt: new Date(),
        });
        
        return amendment;
      }),
  }),
});
```

---

### 4. Rate Limiter (Prioridade 85/100)

**Arquivo:** `server/services/rateLimiter.ts`

**Problema resolvido:** Ausência de rate limiting em procedures críticas

**Funções principais:**
- `rateLimitMiddleware(limitType)` - Middleware para tRPC
- `checkRateLimit(identifier, limitType)` - Verificar limite
- `resetRateLimit(identifier, limitType)` - Resetar limite
- `getRateLimitStats(identifier, limitType)` - Obter estatísticas

**Limites configurados:**
- Assinaturas digitais: 10 por 15 minutos
- Geração de documentos: 50 por hora
- API geral: 100 por minuto
- Login: 5 tentativas por 15 minutos
- Exportação: 30 por hora

**Como integrar:**

```typescript
// Em server/api/routers/legalOpinionsRouter.ts

import { rateLimitMiddleware } from '../services/rateLimiter';
import { protectedProcedure } from '../_core/trpc';

// Criar procedure com rate limiting
const rateLimitedProcedure = protectedProcedure.use(rateLimitMiddleware('signature'));

export const legalOpinionsRouter = router({
  sign: rateLimitedProcedure
    .input(z.object({
      opinionId: z.number(),
      signerRole: z.enum(['revisor', 'responsavel', 'gestor']),
      password: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Lógica de assinatura
      // Rate limiting já foi aplicado pelo middleware
    }),
});

// Para geração de documentos
const documentGenerationProcedure = protectedProcedure.use(
  rateLimitMiddleware('documentGeneration')
);

export const processesRouter = router({
  generateETP: documentGenerationProcedure
    .input(z.object({ processId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Lógica de geração
    }),
});
```

---

### 5. Password Security (Prioridade 80/100)

**Arquivo:** `server/services/passwordSecurity.ts`

**Problema resolvido:** bcrypt com salt factor 10 é considerado baixo

**Funções principais:**
- `hashPassword(password)` - Hash com salt factor 12
- `verifyPassword(password, hash)` - Verificar senha
- `needsRehash(hash)` - Verificar se precisa rehash
- `validatePasswordStrength(password)` - Validar força da senha
- `generateSecurePassword(length)` - Gerar senha segura

**Como integrar:**

```typescript
// Em server/services/digitalSignatureService.ts

import { hashPassword, verifyPassword, validatePasswordStrength } from './passwordSecurity';

export async function setSignaturePassword(
  userId: number,
  password: string
): Promise<void> {
  // Validar força da senha
  const strength = validatePasswordStrength(password);
  
  if (!strength.isValid) {
    throw new Error(`Senha fraca:\n${strength.feedback.join('\n')}`);
  }
  
  // Hash com salt factor 12
  const hashedPassword = await hashPassword(password);
  
  // Salvar no banco
  await updateUser(userId, {
    signaturePassword: hashedPassword,
  });
}

export async function verifySignaturePassword(
  userId: number,
  password: string
): Promise<boolean> {
  const user = await getUserById(userId);
  
  if (!user || !user.signaturePassword) {
    return false;
  }
  
  // Verificar senha
  const isValid = await verifyPassword(password, user.signaturePassword);
  
  // Se válida e precisa rehash, atualizar
  if (isValid && needsRehash(user.signaturePassword)) {
    const newHash = await hashPassword(password);
    await updateUser(userId, {
      signaturePassword: newHash,
    });
  }
  
  return isValid;
}
```

---

## Integração por Prioridade

### Fase 1 - Crítico (Implementar imediatamente)

1. **Legal Validation** (Prioridade 95)
   - Integrar em `generateLegalOpinion()`
   - Integrar em `generateETP()`, `generateTR()`, `generateDFD()`, `generateEdital()`
   - Tempo estimado: 2 horas

2. **Contract Validation - Aditivos e Prazos** (Prioridade 90)
   - Integrar em `contracts.amendments.create`
   - Integrar em `contracts.create`
   - Tempo estimado: 3 horas

### Fase 2 - Alto (Implementar em 48h)

3. **Rate Limiter** (Prioridade 85)
   - Integrar em `legalOpinions.sign`
   - Integrar em `processes.generateETP/TR/DFD/Edital`
   - Integrar em `auth.login`
   - Tempo estimado: 2 horas

4. **Contract Validation - Dispensas** (Prioridade 85)
   - Integrar em `directContracts.create`
   - Tempo estimado: 1 hora

5. **Password Security** (Prioridade 80)
   - Atualizar `setSignaturePassword()`
   - Atualizar `verifySignaturePassword()`
   - Tempo estimado: 1 hora

### Fase 3 - Médio (Implementar em 1 semana)

6. **AI Output Validation** (Prioridade 75)
   - Integrar em todas as funções de geração de documentos
   - Tempo estimado: 3 horas

7. **Contract Validation - Apostilamentos** (Prioridade 80)
   - Integrar em `contracts.apostilles.create`
   - Implementar integração com API do IBGE/FGV
   - Tempo estimado: 4 horas

---

## Exemplos de Uso

### Exemplo 1: Geração de Parecer Jurídico com Validação Completa

```typescript
import { validateAndCorrectDocument } from './legalValidation';
import { validateAndCorrectAIOutput, getTemperatureForDocument } from './aiOutputValidation';

export async function generateLegalOpinion(opinionId: number): Promise<string> {
  const opinion = await getLegalOpinionById(opinionId);
  
  const generateFn = async (feedback?: string) => {
    const response = await invokeLLM({
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em Lei 14.133/2021. A lei possui apenas 194 artigos. Gere documentos em formato Markdown válido.'
        },
        {
          role: 'user',
          content: `Analise o processo licitatório e emita parecer jurídico.${feedback ? `\n\nFeedback: ${feedback}` : ''}`
        }
      ],
      temperature: getTemperatureForDocument('parecer'), // 0.2
    });
    return response.choices[0].message.content;
  };
  
  // Validação 1: Formato e estrutura
  const outputResult = await validateAndCorrectAIOutput(
    await generateFn(),
    'parecer',
    generateFn,
    2
  );
  
  // Validação 2: Artigos legais
  const legalResult = await validateAndCorrectDocument(
    outputResult.content,
    generateFn,
    2
  );
  
  return legalResult.content;
}
```

### Exemplo 2: Criação de Aditivo com Todas as Validações

```typescript
import { 
  validateAmendmentValue, 
  validateContractDuration,
  validateAmendmentJustification
} from './contractValidation';

export async function createAmendment(data: {
  contractId: number;
  type: 'prazo' | 'valor' | 'escopo' | 'misto';
  justification: string;
  valueChange?: number;
  newEndDate?: Date;
}) {
  const contract = await getContractById(data.contractId);
  
  // Validação 1: Justificativa
  const justificationValidation = validateAmendmentJustification(data.justification);
  if (!justificationValidation.isValid) {
    throw new Error(justificationValidation.errors.join('\n'));
  }
  
  // Validação 2: Valor (se aplicável)
  if (data.type === 'valor' || data.type === 'misto') {
    const existingAmendments = await getTotalAmendmentValue(data.contractId);
    const valueValidation = validateAmendmentValue(
      contract.value,
      existingAmendments,
      data.valueChange!
    );
    
    if (!valueValidation.isValid) {
      throw new Error(valueValidation.error);
    }
  }
  
  // Validação 3: Prazo (se aplicável)
  if (data.type === 'prazo' || data.type === 'misto') {
    const durationValidation = validateContractDuration(
      contract.startDate,
      data.newEndDate!
    );
    
    if (!durationValidation.isValid) {
      throw new Error(durationValidation.error);
    }
  }
  
  // Criar aditivo
  return await db.insert(amendments).values({
    contractId: data.contractId,
    type: data.type,
    justification: data.justification,
    valueChange: data.valueChange,
    newEndDate: data.newEndDate,
    signedAt: new Date(),
  });
}
```

### Exemplo 3: Procedure com Rate Limiting

```typescript
import { rateLimitMiddleware } from './rateLimiter';

const rateLimitedProcedure = protectedProcedure.use(rateLimitMiddleware('signature'));

export const legalOpinionsRouter = router({
  sign: rateLimitedProcedure
    .input(z.object({
      opinionId: z.number(),
      password: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Rate limiting já aplicado
      // Máximo 10 assinaturas por 15 minutos
      
      // Verificar senha
      const isValid = await verifySignaturePassword(ctx.user.id, input.password);
      
      if (!isValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Senha de assinatura incorreta'
        });
      }
      
      // Assinar documento
      // ...
    }),
});
```

---

## Testes Recomendados

### 1. Testes de Legal Validation

```typescript
// tests/legalValidation.test.ts

import { validateLegalCitations } from '../server/services/legalValidation';

describe('Legal Validation', () => {
  test('deve aceitar artigos válidos', () => {
    const content = 'Conforme Art. 125 da Lei 14.133/2021...';
    const result = validateLegalCitations(content);
    expect(result.isValid).toBe(true);
  });
  
  test('deve rejeitar artigos inexistentes', () => {
    const content = 'Conforme Art. 999 da Lei 14.133/2021...';
    const result = validateLegalCitations(content);
    expect(result.isValid).toBe(false);
    expect(result.invalidArticles).toHaveLength(1);
  });
});
```

### 2. Testes de Contract Validation

```typescript
// tests/contractValidation.test.ts

import { validateAmendmentValue } from '../server/services/contractValidation';

describe('Contract Validation', () => {
  test('deve aceitar aditivo dentro do limite', () => {
    const result = validateAmendmentValue(
      10000000, // R$ 100.000,00
      2000000,  // R$ 20.000,00 já aditivado
      3000000   // R$ 30.000,00 novo aditivo (total 50%)
    );
    expect(result.isValid).toBe(true);
  });
  
  test('deve rejeitar aditivo acima do limite', () => {
    const result = validateAmendmentValue(
      10000000, // R$ 100.000,00
      3000000,  // R$ 30.000,00 já aditivado
      3000000   // R$ 30.000,00 novo aditivo (total 60%)
    );
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('50%');
  });
});
```

### 3. Testes de Rate Limiter

```typescript
// tests/rateLimiter.test.ts

import { checkRateLimit, resetRateLimit } from '../server/services/rateLimiter';

describe('Rate Limiter', () => {
  beforeEach(() => {
    resetRateLimit('test-user', 'signature');
  });
  
  test('deve permitir requisições dentro do limite', () => {
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit('test-user', 'signature');
      expect(result.allowed).toBe(true);
    }
  });
  
  test('deve bloquear após exceder limite', () => {
    // Fazer 10 requisições (limite)
    for (let i = 0; i < 10; i++) {
      checkRateLimit('test-user', 'signature');
    }
    
    // 11ª requisição deve ser bloqueada
    const result = checkRateLimit('test-user', 'signature');
    expect(result.allowed).toBe(false);
  });
});
```

---

## Checklist de Implementação

### Fase 1 - Crítico (48h)

- [ ] Integrar Legal Validation em geração de pareceres jurídicos
- [ ] Integrar Legal Validation em geração de ETP/TR/DFD/Edital
- [ ] Integrar Contract Validation em criação de aditivos
- [ ] Integrar Contract Validation em criação de contratos
- [ ] Testar validações com casos reais

### Fase 2 - Alto (1 semana)

- [ ] Integrar Rate Limiter em assinaturas digitais
- [ ] Integrar Rate Limiter em geração de documentos
- [ ] Integrar Rate Limiter em login
- [ ] Integrar Contract Validation em dispensas
- [ ] Atualizar Password Security (bcrypt salt 12)
- [ ] Testar rate limiting com múltiplos usuários

### Fase 3 - Médio (2 semanas)

- [ ] Integrar AI Output Validation em todas as gerações
- [ ] Implementar integração com API do IBGE/FGV para apostilamentos
- [ ] Criar testes automatizados para todos os módulos
- [ ] Documentar mudanças no README do projeto
- [ ] Realizar auditoria de segurança completa

### Fase 4 - Monitoramento (contínuo)

- [ ] Monitorar logs de validações rejeitadas
- [ ] Monitorar taxa de regenerações de documentos
- [ ] Monitorar rate limiting (usuários bloqueados)
- [ ] Ajustar limites conforme necessário
- [ ] Atualizar lista de artigos se lei for alterada

---

## Notas Finais

**Importante:**
- Todos os módulos são **independentes** e podem ser integrados gradualmente
- Não há dependências entre os módulos
- Cada módulo possui tratamento de erros completo
- Logs detalhados facilitam debugging

**Próximos Passos:**
1. Revisar este guia com a equipe técnica
2. Priorizar integrações conforme criticidade
3. Implementar testes automatizados
4. Monitorar métricas após deploy
5. Ajustar configurações conforme feedback

**Suporte:**
- Documentação completa em cada arquivo de serviço
- Exemplos de uso incluídos neste guia
- Testes recomendados para validação

---

**Documento gerado por:** Manus AI  
**Data:** 07 de Dezembro de 2025  
**Versão:** 1.0
