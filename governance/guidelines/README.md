# Guidelines

## Guias de Desenvolvimento

### Como adicionar uma nova entidade de domínio

1. Criar `server/domain/[entidade]Types.ts` com tipos, status, transições
2. Criar migração `drizzle/[N]_[entidade].sql`
3. Atualizar `drizzle/schema.ts` com a tabela Drizzle
4. Atualizar `drizzle/meta/_journal.json` com a entrada
5. Criar `server/services/[entidade]Service.ts`
6. Adicionar safety nets em `server/bootstrap.ts`
7. Criar testes em `server/__tests__/integration/`
8. Atualizar `CHANGELOG.md` e sprint history

### Como adicionar um novo parser

1. Criar `server/parsers/[tipo]Parser.ts` extendendo `BaseParser`
2. Implementar `canHandle()`, `parse()`, `parserType`, `capabilities`
3. Registrar no `parserRegistry.ts` via `parserRegistry.register()`
4. Adicionar MIME type em `ALLOWED_MIME_TYPES` em `importTypes.ts`
5. Testes: arquivo válido → items extraídos, arquivo inválido → erro correto

### Como adicionar uma nova ação ao PolicyEngine

1. Adicionar tipo em `PolicyAction` em `documentPolicy.ts`
2. Implementar regra em `evaluatePolicy()`
3. Adicionar testes de todos os roles para a nova ação
4. Atualizar `DOCUMENT_ENGINE.md` com a tabela de permissões

### Como criar uma migração nova

```bash
# Criar arquivo de migração
touch drizzle/00NN_descricao_snake_case.sql

# Adicionar ao journal
# Editar drizzle/meta/_journal.json: novo entry { idx, version, when, tag, breakpoints }

# Atualizar schema.ts com a tabela/coluna Drizzle

# Adicionar safety net no bootstrap.ts
```
