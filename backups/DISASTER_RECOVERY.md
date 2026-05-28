# Disaster Recovery Plan — LiciGov Pro

## RTO e RPO

| Cenário | RTO (Recovery Time) | RPO (Recovery Point) |
|---------|--------------------|--------------------|
| Deploy com bug crítico | 15 min (rollback) | 0 (sem perda de dados) |
| Corrupção de banco | 2h | 24h (backup diário Railway) |
| Perda completa de ambiente | 4h | 24h |

## Plano de Rollback de Deploy

Railway suporta rollback automático para deploy anterior:

```
Railway Dashboard → Service → Deployments → Rollback to previous
```

Ou via variável de ambiente: remover/alterar `DATABASE_URL` para apontar para backup.

## Plano de Recuperação de Banco

### Fase 1: Contenção (0-30min)
1. Colocar Railway em maintenance mode (ou remover DNS)
2. Tirar snapshot do banco corrompido para análise
3. Comunicar usuários via status page

### Fase 2: Recuperação (30min-2h)
1. Criar novo banco Railway a partir do backup mais recente
2. Aplicar migrações pendentes (se houver)
3. Validar integridade dos dados críticos:
   ```sql
   SELECT COUNT(*) FROM organizations;
   SELECT COUNT(*) FROM documents WHERE organizationId IS NOT NULL;
   SELECT COUNT(*) FROM activity_logs;
   ```
4. Testar login e operações básicas

### Fase 3: Restauração (2h+)
1. Atualizar `DATABASE_URL` para novo banco
2. Remover maintenance mode
3. Monitorar logs por 1h
4. Documentar incident

## Contatos de Emergência

- Railway Status: status.railway.app
- Repositório: github.com/leandrocardoso-cmyk/licigov-pro

## Post-Incident Review

Após qualquer incident, adicionar entrada neste arquivo:

### Incident Log
| Data | Descrição | Causa | Resolução | Duração |
|------|-----------|-------|-----------|---------|
| — | — | — | — | — |
