---
name: plan-first
description: Use esta skill para qualquer tarefa que envolva múltiplos arquivos, mudanças no schema Drizzle, novas rotas tRPC, ou qualquer implementação que toque em mais de um módulo do LiciGov Pro.
---

# Skill: Plan First — Planejar antes de executar no LiciGov Pro

## Quando aplicar
- Implementação toca mais de 2 arquivos
- Mudança em `drizzle/schema.ts`
- Nova rota tRPC ou alteração de rota existente
- Qualquer mudança em `server/_core/` (especialmente `llm.ts` e `sdk.ts`)
- Implementação de novo módulo (Contratos, Parecer Jurídico, etc.)
- Integração com API externa (CATMAT/CATSER, PNCP, etc.)

## Estrutura do plano

### FASE 1 — Exploração (ler antes de tocar)
```
1. Ler os arquivos afetados — especialmente server/_core/trpc.ts para entender
   os tipos de procedure disponíveis (publicProcedure, protectedProcedure, adminProcedure)
2. Verificar server/routers.ts para entender como os sub-routers estão organizados
3. Verificar drizzle/schema.ts para entender tabelas existentes
4. Identificar o que pode ser reaproveitado do módulo de Gestão do Departamento
```

### FASE 2 — Plano escrito

```
## Plano: [nome da tarefa]

### Objetivo
[Uma frase do que será implementado]

### Estado da migração Manus (verificar antes)
- [ ] vite.config.ts limpo de plugins Manus?
- [ ] server/_core/sdk.ts sem chamadas OAuth Manus?
- [ ] server/_core/llm.ts usando Gemini direto?

### Passos em ordem
1. [arquivo] → [o que muda]
2. [arquivo] → [o que muda]
...

### Schema changes (se houver)
- Tabela nova ou modificada: [nome]
- Campos: [nome + tipo Drizzle]
- Executar: pnpm db:push

### Rotas tRPC novas (se houver)
- Router: server/routers/[nome].ts
- Registrar em: server/routers.ts → appRouter

### Checklist de qualidade
- [ ] Rota protegida com protectedProcedure (não publicProcedure)?
- [ ] Input validado com Zod?
- [ ] Erros retornados como TRPCError com code correto?
- [ ] Para documentos: aviso legal incluído na saída?
- [ ] Para documentos: output validado com Zod antes de salvar?

### Rollback
[Como desfazer se algo der errado]
```

### FASE 3 — Confirmação
Apresentar o plano. Aguardar aprovação antes de executar.

### FASE 4 — Execução por etapas
Arquivo por arquivo, verificando consistência antes de avançar.

## Padrões específicos do LiciGov Pro

### Adicionar novo sub-router ao AppRouter
```typescript
// 1. Criar server/routers/meuModulo.ts
export const meuModuloRouter = router({ ... });

// 2. Registrar em server/routers.ts
import { meuModuloRouter } from './routers/meuModulo';
export const appRouter = router({
  // ... routers existentes ...
  meuModulo: meuModuloRouter,
});
```

### Adicionar nova tabela no schema Drizzle
```typescript
// Em drizzle/schema.ts
export const minhaTabela = mysqlTable('minha_tabela', {
  id: int('id').primaryKey().autoincrement(),
  processoId: int('processo_id').references(() => processos.id),
  tipo: varchar('tipo', { length: 50 }).notNull(),
  conteudo: text('conteudo').notNull(),
  criadoEm: timestamp('criado_em').defaultNow().notNull(),
  atualizadoEm: timestamp('atualizado_em').defaultNow().onUpdateNow().notNull(),
});

// Após: pnpm db:push
```

### Numeração sequencial de processos (padrão crítico)
```typescript
// SEMPRE usar transação + FOR UPDATE para evitar duplicação:
const numero = await db.transaction(async (tx) => {
  const [ultimo] = await tx
    .select({ sequencial: processos.sequencial })
    .from(processos)
    .where(eq(sql`YEAR(criado_em)`, ano))
    .orderBy(desc(processos.sequencial))
    .limit(1)
    .for('update');
  
  const seq = ultimo ? ultimo.sequencial + 1 : 1;
  return `${ano}/${seq.toString().padStart(4, '0')}`;
});
```

---

## Testes Vitest (obrigatório — regra fundamental do projeto)

Todo código de lógica de negócio novo deve ter teste correspondente.

```typescript
// Localização: server/__tests__/ ou ao lado do arquivo em .test.ts
// Executar: pnpm vitest run

// Exemplo — testar geração de número de processo:
import { describe, it, expect } from 'vitest';
import { gerarNumeroProcesso } from '../services/processos';

describe('gerarNumeroProcesso', () => {
  it('gera número no formato AAAA/NNNN', async () => {
    const numero = await gerarNumeroProcesso(2026);
    expect(numero).toMatch(/^\d{4}\/\d{4}$/);
  });

  it('incrementa sequencial corretamente', async () => {
    const n1 = await gerarNumeroProcesso(2026);
    const n2 = await gerarNumeroProcesso(2026);
    const seq1 = parseInt(n1.split('/')[1]);
    const seq2 = parseInt(n2.split('/')[1]);
    expect(seq2).toBe(seq1 + 1);
  });
});
```

### Adicionar ao checklist do plano
- [ ] Testes Vitest criados para lógica de negócio nova?
- [ ] Migration gerada (não apenas db:push)?
- [ ] Testado em staging antes de produção?
