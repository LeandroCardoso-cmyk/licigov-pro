# Sprint 1 — Multi-tenant Foundation

**Status:** Concluída  
**Data:** Maio 2026  
**Impacto:** Fundação multi-tenant de toda a plataforma

---

## Objetivo

Transformar o LiciGov Pro de um sistema single-tenant em uma plataforma multi-tenant enterprise, com isolamento de dados por organização, RBAC completo e rastreabilidade de auditoria.

## Entregas

### Organizations Aggregate
- Tabela `organizations` com nome, CNPJ, plano, configurações
- Tabela `organization_members` com papéis: `viewer | operator | manager | admin | owner`
- Hierarquia de permissões por nível numérico: viewer=1, operator=2, manager=3, admin=4, owner=5

### Multi-tenant Isolation
- Coluna `organizationId` adicionada em todas as tabelas de negócio
- Row-level isolation: toda query filtra por `organizationId`
- Safety net no bootstrap: `addColumnIfMissing` para cada coluna crítica

### Activity Logs v2
- Campos adicionados: `correlationId`, `requestId`, `actorName`, `entityType`, `entityId`
- Rastreabilidade completa de ações por tenant

### RBAC
- Middleware de autorização verificando `orgMembership.role`
- Funções helper: `assertMinRole()`, `hasPermission()`

## Migrações
- `0033_organizations.sql`
- `0034_organization_members.sql`
- `0035_multi_tenant_columns.sql`
- `0036_outbox.sql`
- `0037_feature_flags.sql`
- `0038_activity_logs_v2.sql`

## Impacto Arquitetural

Esta sprint estabeleceu a **invariante fundamental** do sistema: nenhuma operação de negócio pode ocorrer sem `organizationId`. Todas as sprints subsequentes seguem este contrato.
