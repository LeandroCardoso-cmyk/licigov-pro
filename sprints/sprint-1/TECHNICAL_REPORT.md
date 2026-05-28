# Sprint 1 — Relatório Técnico

## Arquivos Criados / Modificados

### Migrações
| Arquivo | Descrição |
|---------|-----------|
| `drizzle/0033_organizations.sql` | Tabela `organizations` |
| `drizzle/0034_organization_members.sql` | Tabela `organization_members` com RBAC |
| `drizzle/0035_multi_tenant_columns.sql` | `organizationId` em todas as tabelas |
| `drizzle/0036_outbox.sql` | Tabela `outbox_events` |
| `drizzle/0037_feature_flags.sql` | Tabela `feature_flags` |
| `drizzle/0038_activity_logs_v2.sql` | Extensão de `activity_logs` |

### Schema
- `drizzle/schema.ts`: adição de `organizations`, `organizationMembers`
- Colunas `organizationId` em: `processes`, `documents`, `tasks`, `contracts`, `direct_contracts`, `legal_opinions`, `comments`, `activity_logs`

### Serviços
- `server/services/activityLogService.ts`: suporte a `correlationId`, `requestId`, contexto de org
- `server/bootstrap.ts`: safety nets Sprint 1

## Decisões Técnicas

### MySQL sobre PostgreSQL
Mantido MySQL (Railway) por compatibilidade com infraestrutura existente. Row-level isolation via `WHERE organizationId = ?` em lugar de Row Level Security (PostgreSQL).

### organizationId nullable → NOT NULL gradual
`organizationId` adicionado como nullable para permitir migração gradual de dados legados. Sprint futura tornará NOT NULL após backfill.

### RBAC por hierarquia numérica
Roles representados como strings com nível numérico para comparação: `viewer=1, operator=2, manager=3, admin=4, owner=5`. Permite `assertMinRole(ctx, "manager")` sem switch/case.
