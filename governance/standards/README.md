# Engineering Standards

Esta pasta documenta os padrões de engenharia do LiciGov Pro.

Ver [../ENGINEERING_STANDARDS.md](../ENGINEERING_STANDARDS.md) para o documento completo.

## Padrões Principais

### TypeScript
- Strict mode habilitado
- Sem `any` implícito (apenas cast explícito com justificativa)
- Interfaces para contratos de domínio, types para unions/aliases

### tRPC
- Procedures organizadas por domínio (router por aggregate)
- `TrpcAuditCtx` obrigatório em todas as procedures de negócio
- Input validation via Zod em todas as procedures

### Drizzle ORM
- Nenhuma query raw SQL sem justificativa documentada
- Sempre filtrar por `organizationId` em queries de negócio
- Migrations incrementais, nunca destrutivas em produção

### Testes (Vitest)
- 100% dos testes devem passar antes de qualquer PR
- Mocks de `getDb` e `observabilityService` em todos os testes de integração
- Nomenclatura: `describe("Serviço — funcionalidade", () => { it("comportamento esperado") })`

### Commits
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`
- Mensagem inclui sprint e impacto arquitetural
- Link para sessão Claude no final do corpo
