# Sprint 1 — Decisões Arquiteturais

## ADR-001: organizationId obrigatório em toda operação de negócio

**Contexto:** Sistema multi-tenant requer isolamento de dados.

**Decisão:** Todo service, repository e query de negócio deve receber e filtrar por `organizationId`. Nenhuma operação de leitura ou escrita pode ocorrer sem tenant context.

**Consequências:** 
- `TrpcAuditCtx` sempre carrega `organizationId`
- Queries sem `organizationId` são consideradas bug, não feature
- Safety nets no bootstrap garantem a coluna em todos os ambientes

---

## ADR-002: Row-level isolation via WHERE (não RLS)

**Contexto:** MySQL no Railway não suporta Row Level Security nativo.

**Decisão:** Implementar isolamento por `WHERE organizationId = ?` em nível de aplicação.

**Consequências:**
- Developer discipline: todo novo query precisa incluir o filtro
- Code review: verificar ausência do filtro é checklist obrigatório
- Tests: cada teste de integração verifica isolamento entre orgs

---

## ADR-003: RBAC hierárquico por nível numérico

**Contexto:** Diferentes papéis precisam de diferentes permissões em diferentes contextos.

**Decisão:** Roles têm nível numérico implícito. `assertMinRole(ctx, minRole)` verifica se o nível do actor ≥ nível requerido.

**Consequências:**
- Adição de novos roles requer reordenar hierarquia
- Papéis com mesmo nível não têm precedência (intenional)
