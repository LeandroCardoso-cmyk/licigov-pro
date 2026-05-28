# LiciGov Pro — Padrões de Engenharia

> Padrões técnicos obrigatórios para desenvolvimento no LiciGov Pro.
> Versão: 1.0 | Atualizado em: 2026-05-27

---

## TypeScript

### Configuração
- `strict: true` obrigatório — nenhuma exceção
- `noImplicitAny: true` — types explícitos sempre
- `exactOptionalPropertyTypes: true` — diferencia `undefined` de ausência de campo
- Target: `ES2022` com Node.js 20

### Convenções de Tipos
```typescript
// ✅ Correto: type para unions e intersections
type DocumentStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'archived';

// ✅ Correto: interface para objetos extensíveis
interface DocumentRepository {
  findById(id: string, organizationId: string): Promise<DocumentoLicitatorio | null>;
  save(document: DocumentoLicitatorio): Promise<void>;
}

// ✅ Correto: readonly para value objects
type RetentionClass = Readonly<{
  class: 'legal_7years' | 'legal_permanent' | 'operational_3years';
  years: number;
  autoPurge: boolean;
}>;

// ❌ Evitar: any
const data: any = fetchData(); // não usar

// ❌ Evitar: type assertions sem justificativa
const doc = rawData as DocumentoLicitatorio; // não usar
```

### Enums vs Union Types
- **Prefira union types** sobre enums TypeScript
- Enums geram código JS desnecessário; union types são type-level only
- Exceção: quando o runtime precisa iterar sobre os valores

---

## tRPC v11

### Estrutura de Routers
```typescript
// ✅ Correto: hierarquia modular
export const documentsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createDocumentSchema)
    .mutation(async ({ ctx, input }) => { ... }),

  versions: createTRPCRouter({
    list: protectedProcedure
      .input(listVersionsSchema)
      .query(async ({ ctx, input }) => { ... }),
  }),
});
```

### Context Obrigatório
Todo context de procedure autenticada deve ter:
```typescript
interface TRPCContext {
  userId: string;
  organizationId: string;    // OBRIGATÓRIO - nunca opcional
  role: OrganizationRole;
  requestId: string;
  correlationId: string;
}
```

### Validação de Input
- Zod para todos os inputs — sem exceção
- Schemas reutilizáveis em `shared/schemas/`
- Mensagens de erro em PT-BR

```typescript
// ✅ Correto
const createDocumentSchema = z.object({
  title: z.string().min(3, 'Título deve ter no mínimo 3 caracteres').max(500),
  type: z.enum(['tr', 'etp', 'edital', 'contrato']),
  content: z.string().optional(),
});
```

### Error Handling
```typescript
// ✅ Correto: TRPCError com código e mensagem clara
throw new TRPCError({
  code: 'FORBIDDEN',
  message: 'Você não tem permissão para aprovar documentos nesta organização.',
});

// Códigos usados no projeto:
// NOT_FOUND — recurso não encontrado
// FORBIDDEN — sem permissão (papel insuficiente)
// UNAUTHORIZED — não autenticado
// CONFLICT — conflito de estado (ex: optimistic lock)
// BAD_REQUEST — input inválido
// INTERNAL_SERVER_ERROR — erros não esperados
```

---

## Drizzle ORM

### Schema Definition
```typescript
// ✅ Correto: Tabelas com organizationId como parte da chave composta
export const documentosLicitatorios = mysqlTable('documentos_licitatorios', {
  id: varchar('id', { length: 36 }).primaryKey(),
  organizationId: varchar('organization_id', { length: 36 }).notNull(),
  // ...outros campos
}, (table) => ({
  orgIdIdx: index('org_id_idx').on(table.organizationId),
  orgStatusIdx: index('org_status_idx').on(table.organizationId, table.status),
}));
```

### Queries com Isolamento Multi-tenant
```typescript
// ✅ SEMPRE incluir organizationId
const doc = await db.query.documentosLicitatorios.findFirst({
  where: and(
    eq(documentosLicitatorios.id, id),
    eq(documentosLicitatorios.organizationId, ctx.organizationId) // OBRIGATÓRIO
  ),
});

// ❌ NUNCA buscar sem organizationId
const doc = await db.query.documentosLicitatorios.findFirst({
  where: eq(documentosLicitatorios.id, id), // ERRO DE SEGURANÇA
});
```

### Migrations
- Sempre usar `drizzle-kit generate` para criar migrações
- Nunca editar SQL de migração gerado automaticamente
- Migrações são sequenciais e não podem ser reordenadas
- Rollback: criar nova migração, não reverter a anterior

---

## Testes (Vitest)

### Estrutura
```
server/
└── domain/
    └── [aggregate]/
        ├── [aggregate].aggregate.ts
        └── __tests__/
            ├── [aggregate].unit.test.ts
            └── [aggregate].integration.test.ts
```

### Cobertura Mínima
- Aggregates: ≥ 90%
- Services: ≥ 80%
- Routers tRPC: ≥ 70%
- Repositories: ≥ 70%

### Padrão de Testes
```typescript
describe('DocumentoLicitatorio', () => {
  describe('submitForReview()', () => {
    it('deve transicionar de draft para in_review quando usuário tem papel manager', () => {
      // Arrange
      const document = createTestDocument({ status: 'draft' });
      const manager = createTestMember({ role: 'manager' });

      // Act
      const result = document.submitForReview(manager.id);

      // Assert
      expect(result.status).toBe('in_review');
      expect(result.timeline).toHaveLength(2); // created + submitted
    });

    it('deve lançar erro quando usuário tem papel operator', () => {
      // ...
    });
  });
});
```

### Testes de Multi-tenant
Todo teste de domínio deve verificar isolamento:
```typescript
it('deve retornar null quando documento pertence a outra organização', async () => {
  const doc = await repo.findById(docId, 'OUTRO_ORG_ID');
  expect(doc).toBeNull();
});
```

---

## Git e Commits

### Convenção de Commits (Conventional Commits)
```
feat: nova funcionalidade
fix: correção de bug
docs: apenas documentação
refactor: refatoração sem mudança de comportamento
test: adição ou correção de testes
chore: tarefas de manutenção
migration: nova migração de banco de dados
```

### Tamanho de Commits
- Commits atômicos: uma mudança lógica por commit
- Não commitar código comentado
- Não commitar `.env` ou secrets

### Branch Strategy
- `main` — produção estável
- `develop` — integração contínua
- `claude/[feature]-[id]` — branches de feature (gerados automaticamente)
- `fix/[issue-id]-[description]` — branches de correção

---

## Nomenclatura

### Arquivos TypeScript
```
[aggregate].aggregate.ts         # Aggregate root
[aggregate].repository.ts        # Interface do repositório
[aggregate].errors.ts            # Erros do domínio
[aggregate].events.ts            # Eventos de domínio
[aggregate].value-objects.ts     # Value objects relacionados
drizzle-[aggregate].repository.ts  # Implementação Drizzle
[use-case].command.ts            # Comando (application layer)
[use-case].handler.ts            # Handler do comando
```

### Variáveis e Funções
```typescript
// camelCase para variáveis e funções
const organizationId = ctx.organizationId;
function findDocumentsByOrganization() {}

// PascalCase para classes e interfaces
class DocumentoLicitatorioService {}
interface DocumentRepository {}

// SCREAMING_SNAKE_CASE para constantes de configuração
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const DEFAULT_IDEMPOTENCY_TTL_HOURS = 24;
```

---

*Para governança geral: [governance/GOVERNANCE.md](./GOVERNANCE.md)*
*Para decisões arquiteturais: [governance/ARCHITECTURAL_DECISIONS.md](./ARCHITECTURAL_DECISIONS.md)*
