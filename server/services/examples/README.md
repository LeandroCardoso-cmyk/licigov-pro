# Exemplos de Integração - Correções da Auditoria

Este diretório contém exemplos práticos de como integrar os módulos de correção da auditoria técnica no LiciGov Pro.

## 📁 Arquivos de Exemplo

1. **`legalValidationExample.ts`** - Validação de artigos legais (anti-hallucination)
2. **`contractValidationExample.ts`** - Validações de conformidade legal

## 🚀 Quick Start

### 1. Validação de Artigos Legais

```typescript
import { validateAndCorrectDocument } from '../legalValidation';
import { invokeLLM } from '../_core/llm';

// Gerar parecer com validação automática
const generateFn = async () => {
  const response = await invokeLLM({
    messages: [
      {
        role: 'system',
        content: 'Você é especialista em Lei 14.133/2021. A lei possui APENAS 194 artigos.'
      },
      { role: 'user', content: 'Analise este processo...' }
    ],
    temperature: 0.2,
  });
  return response.choices[0].message.content;
};

const result = await validateAndCorrectDocument(
  await generateFn(),
  generateFn,
  2 // máx 2 tentativas
);

// result.content = documento válido
// result.wasRegenerated = true se precisou regenerar
// result.validation = detalhes da validação
```

### 2. Validação de Aditivos de Contrato

```typescript
import { validateAmendmentValue, validateAmendmentJustification } from '../contractValidation';

// Validar justificativa
const justificationValidation = validateAmendmentJustification(justification);
if (!justificationValidation.isValid) {
  throw new Error(justificationValidation.errors.join('\n'));
}

// Validar limite de 50%
const valueValidation = validateAmendmentValue(
  contractValue,      // R$ 100.000,00 (em centavos: 10000000)
  existingAmendments, // R$ 20.000,00 já aditivado
  newAmendmentValue   // R$ 30.000,00 novo aditivo
);

if (!valueValidation.isValid) {
  throw new Error(valueValidation.error);
}

// valueValidation.percentage = 50%
// valueValidation.remaining = R$ 0,00
```

### 3. Validação de Prazo Contratual

```typescript
import { validateContractDuration } from '../contractValidation';

const durationValidation = validateContractDuration(
  startDate,  // new Date('2024-01-01')
  newEndDate  // new Date('2029-01-01')
);

if (!durationValidation.isValid) {
  throw new Error(durationValidation.error);
}

// durationValidation.totalDurationYears = 5.0
// durationValidation.maxDate = data máxima permitida
```

### 4. Rate Limiting em Procedures

```typescript
import { rateLimitMiddleware } from '../rateLimiter';
import { protectedProcedure } from '../_core/trpc';

// Aplicar rate limiting
const rateLimitedProcedure = protectedProcedure.use(
  rateLimitMiddleware('signature') // 10 por 15 minutos
);

export const legalOpinionsRouter = router({
  sign: rateLimitedProcedure
    .input(z.object({ opinionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Rate limiting já aplicado automaticamente
      // Máximo 10 assinaturas por 15 minutos por usuário
    }),
});
```

### 5. Password Security (Bcrypt Salt 12)

```typescript
import { hashPassword, verifyPassword, validatePasswordStrength } from '../passwordSecurity';

// Validar força da senha
const strength = validatePasswordStrength(password);
if (!strength.isValid) {
  throw new Error(strength.feedback.join('\n'));
}

// Hash com salt factor 12
const hashedPassword = await hashPassword(password);

// Verificar senha
const isValid = await verifyPassword(password, hashedPassword);
```

## 📋 Checklist de Integração

### Fase 1 - Crítico (48h)

- [ ] Integrar `validateAndCorrectDocument` em `generateLegalOpinion()`
- [ ] Integrar `validateAndCorrectDocument` em `generateETP()`
- [ ] Integrar `validateAndCorrectDocument` em `generateTR()`
- [ ] Integrar `validateAmendmentValue` em `contracts.amendments.create`
- [ ] Integrar `validateContractDuration` em `contracts.amendments.create`

### Fase 2 - Alto (1 semana)

- [ ] Integrar `rateLimitMiddleware('signature')` em `legalOpinions.sign`
- [ ] Integrar `rateLimitMiddleware('documentGeneration')` em gerações de documentos
- [ ] Integrar `rateLimitMiddleware('login')` em `auth.login`
- [ ] Atualizar `hashPassword` para usar salt factor 12
- [ ] Integrar `validateDispensaValue` em `directContracts.create`

### Fase 3 - Médio (2 semanas)

- [ ] Integrar `validateAndCorrectAIOutput` em todas as gerações
- [ ] Integrar `validateProposalValidity` em criação de processos
- [ ] Integrar `validateApostilamentoIndex` em apostilamentos
- [ ] Criar testes automatizados

## 🔧 Onde Integrar

### Legal Validation

**Arquivos:**
- `server/services/documentGenerationService.ts`
- `server/api/routers/legalOpinionsRouter.ts`
- `server/api/routers/processesRouter.ts`

**Funções:**
- `generateLegalOpinion()`
- `generateETP()`
- `generateTR()`
- `generateDFD()`
- `generateEdital()`

### Contract Validation

**Arquivos:**
- `server/api/routers/contractsRouter.ts`
- `server/api/routers/amendmentsRouter.ts`
- `server/api/routers/directContractsRouter.ts`

**Procedures:**
- `contracts.create`
- `contracts.amendments.create`
- `directContracts.create`
- `biddingProcesses.create`

### Rate Limiter

**Arquivos:**
- `server/api/routers/legalOpinionsRouter.ts`
- `server/api/routers/processesRouter.ts`
- `server/api/routers/authRouter.ts`

**Procedures:**
- `legalOpinions.sign`
- `processes.generateETP/TR/DFD/Edital`
- `auth.login`
- `documents.export`

### Password Security

**Arquivos:**
- `server/services/digitalSignatureService.ts`
- `server/api/routers/authRouter.ts`

**Funções:**
- `setSignaturePassword()`
- `verifySignaturePassword()`
- `createUser()`
- `updatePassword()`

## 📊 Métricas de Sucesso

Após integração completa, você terá:

- ✅ 0% de citações legais inválidas
- ✅ 100% de conformidade com Lei 14.133/2021
- ✅ Proteção contra DoS e abuso de API
- ✅ Segurança de senhas conforme OWASP 2024
- ✅ Documentos com qualidade garantida

## 🆘 Suporte

Para dúvidas ou problemas:

1. Consulte o **GUIA_INTEGRACAO_CORRECOES.md** (guia completo)
2. Consulte o **RELATORIO_IMPLEMENTACAO_CORRECOES.md** (relatório técnico)
3. Consulte o **LiciGov_Pro_Auditoria_Tecnica.md** (auditoria original)

## 📝 Notas

- Todos os módulos são **independentes**
- Não há dependências entre módulos
- Integração pode ser **gradual**
- Logs detalhados facilitam debugging
- Exemplos incluem casos de uso reais
