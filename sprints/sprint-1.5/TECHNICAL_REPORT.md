# Sprint 1.5 — Relatório Técnico

## Arquivos Modificados

### Migrações
- `drizzle/0039_backfill_org_ids.sql` — backfill de organizationId em registros legados
- `drizzle/0040_outbox_envelope_v2.sql` — campos `actorId`, `actorName`, `tenantContext`
- `drizzle/0041_activity_logs_hardening.sql` — campos de snapshot imutável
- `drizzle/0042_idempotency_ttl_index.sql` — índice TTL

### Schema
- `drizzle/schema.ts`: adição de campos em `activity_logs` e `outbox_events`
- `server/bootstrap.ts`: safety nets Sprint 1.5

## Notas de Implementação

### Snapshot de auditoria
`actorEmail`, `actorRole`, `orgName` são capturados no momento da ação e gravados no log. Qualquer mudança posterior no usuário não retroage nos logs — propriedade imutável por design.

### Outbox tenantContext
`tenantContext` é um JSON com `{ organizationId, organizationName }` snapshot do momento do evento. Permite replay com contexto correto mesmo se a organização mudar de nome.
