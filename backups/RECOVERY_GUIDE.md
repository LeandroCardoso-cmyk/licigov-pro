# Recovery Guide — LiciGov Pro

## Cenários de Recuperação

### Cenário 1: Dado perdido por erro de usuário

**Detectar:** Verificar `activity_logs` para a operação que causou perda.

```sql
SELECT * FROM activity_logs 
WHERE organizationId = :orgId 
  AND action LIKE '%delete%' 
  AND createdAt > NOW() - INTERVAL 1 HOUR
ORDER BY createdAt DESC;
```

**Recuperar:** Se a tabela tem `deletedAt` (soft delete), restaurar:
```sql
UPDATE documents SET deletedAt = NULL WHERE id = :id AND organizationId = :orgId;
```

### Cenário 2: Migração aplicada incorretamente

1. Verificar qual migração causou o problema via `__drizzle_migrations`
2. Aplicar migração reversa manualmente (se existir)
3. Ou restaurar backup pontual do Railway

### Cenário 3: Corrupção de staging items

Staging items têm TTL de 30 dias. Se corrompidos:
```sql
DELETE FROM import_staging_items 
WHERE importSessionId = :sessionId 
  AND organizationId = :orgId;
```
Então re-processar via `startIngestion()`.

### Cenário 4: Lock preso no banco

```sql
-- Verificar locks ativos
SELECT * FROM documents 
WHERE isLocked = 1 
  AND lockExpiresAt < NOW();

-- Liberar locks expirados
UPDATE documents 
SET isLocked = 0, lockedBy = NULL, lockReason = NULL, lockExpiresAt = NULL
WHERE lockExpiresAt < NOW();
```

## Checklist de Recuperação

- [ ] Identificar scope: tenant afetado, tabelas, período
- [ ] Verificar activity_logs para rastrear causa raiz
- [ ] Comunicar usuários afetados
- [ ] Aplicar recuperação no menor scope possível
- [ ] Documentar incident em `/backups/DISASTER_RECOVERY.md`
- [ ] Adicionar teste para prevenir reocorrência
