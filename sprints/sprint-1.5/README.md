# Sprint 1.5 — Hardening Multi-tenant

**Status:** Concluída  
**Data:** Maio 2026  
**Impacto:** Hardening de auditoria e integridade transacional

---

## Objetivo

Fortalecer a fundação multi-tenant com imutabilidade de auditoria, contexto de ator nos eventos de outbox, idempotência de operações e índices de performance.

## Entregas

### ActivityLog Hardening
- Campos imutáveis adicionados: `actorEmail`, `actorRole`, `orgName`, `sourceContext`, `ipAddress`
- `sourceContext`: enum `api | job | system | test | webhook`
- Snapshot de contexto no momento da ação (imutável por design)

### Outbox Envelope v2
- Campos adicionados ao `outbox_events`: `actorId`, `actorName`, `tenantContext`
- Enriquecimento do envelope para replay de eventos com contexto completo

### Idempotency TTL Index
- Índice de TTL em tabela de idempotência para limpeza automática
- Garante deduplicação de operações em ambientes distribuídos

## Migrações
- `0039_backfill_org_ids.sql`
- `0040_outbox_envelope_v2.sql`
- `0041_activity_logs_hardening.sql`
- `0042_idempotency_ttl_index.sql`

## Impacto Arquitetural

Estabeleceu o **padrão de auditoria imutável**: todo evento de negócio carrega contexto completo do ator e tenant no momento da ação, impossibilitando adulteração retroativa de logs.
