# Database Architecture

## Engine e Infraestrutura

- **Banco:** MySQL 8.0 (Railway managed)
- **ORM:** Drizzle com type-safe queries
- **Migrações:** Drizzle Kit (arquivo SQL por migração)
- **Connection Pool:** mysql2/promise com pool configurado

## Schema Overview

```
organizations (tenants)
    │
    ├── organization_members (RBAC)
    │       └── users
    │
    ├── processes (licitações) ─── version (optimistic lock)
    │
    ├── documents (documentos licitatórios)
    │       ├── document_versions (imutável)
    │       ├── document_drafts (mutável)
    │       ├── document_timeline (imutável)
    │       ├── document_attachments
    │       └── document_render_cache
    │
    ├── import_sessions
    │       └── import_staging_items
    │
    ├── activity_logs (imutável)
    ├── outbox_events
    └── feature_flags
```

## Padrão de Migração

```sql
-- Sempre idempotente
CREATE TABLE IF NOT EXISTS `tabela` (...);
ALTER TABLE `tabela` ADD COLUMN IF NOT EXISTS `coluna` ...;

-- Nunca destrutivo em produção
-- DROP TABLE, DROP COLUMN: apenas em dev/staging
```

## Índices por Tabela Crítica

### import_sessions
- `idx_import_sessions_org` (organizationId)
- `idx_import_sessions_status` (organizationId, status)
- `idx_import_sessions_file` (organizationId, sourceFileId)

### import_staging_items
- `idx_staging_session` (importSessionId)
- `idx_staging_org` (organizationId)
- `idx_staging_review` (importSessionId, reviewStatus)
- `idx_staging_expires` (expiresAt)

### documents
- `idx_documents_org` (organizationId)
- `idx_documents_status` (organizationId, documentStatus)

## Bootstrap Safety Net

Todo campo crítico tem safety net em `server/bootstrap.ts`:
```typescript
await addColumnIfMissing("tabela", "coluna", "tipo DEFAULT valor");
```
Garante que envs sem migration automática (Railway cold start) tenham schema correto.
