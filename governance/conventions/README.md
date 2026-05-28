# Conventions

## Nomenclatura

### Arquivos e Pastas
- `kebab-case` para pastas: `sprint-2.8/`, `import-engine/`
- `camelCase` para arquivos TypeScript: `importStagingService.ts`
- `UPPER_CASE` para documentos mestres: `MASTER_INDEX.md`, `GOVERNANCE.md`
- `PascalCase` para classes: `CsvParser`, `ImportQueueService`

### Banco de Dados
- `camelCase` para nomes de tabelas no Drizzle: `importSessions`
- `camelCase` para colunas: `organizationId`, `createdAt`
- Índices: `idx_tabela_coluna`: `idx_import_sessions_org`

### Serviços
- `*Service.ts` para serviços de negócio: `fileIngestionService.ts`
- `*Repository.ts` para acesso a dados: `documentRepository.ts`
- `*Parser.ts` para parsers: `csvParser.ts`
- `*Types.ts` para tipos de domínio: `importTypes.ts`

### Testes
- `*.test.ts` para todos os testes
- Arquivos de integração em `server/__tests__/integration/`
- Nome do arquivo reflete o sprint: `sprint28-import-foundation.test.ts`

## Padrões de Código

### Guard clauses primeiro
```typescript
if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });
if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
// ... lógica principal
```

### Log estruturado
```typescript
log.info("evento_descritivo", { sessionId, orgId, status });
```

### Retorno de função de serviço
Serviços retornam o objeto completo após operação:
```typescript
const rows = await db.select().from(table).where(eq(table.id, inserted.id)).limit(1);
return rows[0];
```
