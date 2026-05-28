# Documentação de Observabilidade

## Componentes

### serviceLogger
Logger estruturado por serviço. Convenção de nomenclatura para eventos:

```typescript
// Padrão: snake_case descrevendo o que aconteceu
log.info("import_session_created", { sessionId: 42, orgId: 1 });
log.warn("job_retry_scheduled", { jobId, attempt, delayMs });
log.error("job_dlq", { jobId, error });
```

### activityLogService
Auditoria de negócio imutável. Registra ações visíveis ao usuário:

```typescript
await logActivity({
  organizationId: orgId,
  userId: ctx.user.id,
  actorName: ctx.user.name,
  actorEmail: ctx.user.email,
  actorRole: ctx.orgMembership?.role,
  sourceContext: "api",
  action: "import_session_created",
  entityType: "import_session",
  entityId: sessionId,
  correlationId: ctx.correlationId,
  details: { fileName, importType },
});
```

## Eventos de Activity Log por Domínio

### Documentos
- `document_created`, `document_updated`, `document_status_changed`
- `document_version_created`, `document_draft_saved`
- `document_locked`, `document_unlocked`
- `document_exported`, `document_purged`

### Importação
- `import_session_created`, `import_session_started`
- `import_items_staged`, `import_item_reviewed`
- `import_session_completed`, `import_session_failed`

### Organização
- `member_invited`, `member_role_changed`, `member_removed`

## Roadmap
- Sprint 5: Dashboard de atividade por organização
- Sprint 5: Alertas configuráveis por evento
