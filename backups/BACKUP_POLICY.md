# Backup Policy — LiciGov Pro

## Responsabilidade

O backup de dados em produção é responsabilidade da plataforma Railway (managed MySQL). Esta política documenta os procedimentos complementares de backup de código e configuração.

## Backup do Banco de Dados

### Railway MySQL (Produção)
- Backup automático diário gerenciado pela Railway
- Retenção: 7 dias (plano padrão)
- Point-in-time recovery disponível no plano Pro

### Backup lógico automatizado (GitHub Actions — PR D)
- Workflow [`db-backup.yml`](../.github/workflows/db-backup.yml): **agendado** (diário 06:00 UTC)
  + **manual** (`workflow_dispatch`).
- `mysqldump --single-transaction` → `.sql.gz` **+ checksum `.sha256`**; retenção do artifact: **14 dias**.
- Falha explícita se o dump sair vazio; logs sem host/usuário/senha; dump nunca versionado no Git.
- Requer o secret `BACKUP_DATABASE_URL`.

### Teste de restauração (PR D)
- Workflow [`db-restore-test.yml`](../.github/workflows/db-restore-test.yml): restaura em **banco
  isolado do CI** (nunca produção), valida checksum + estrutura + isolamento por tenant e registra
  evidência. Drill com backup **real** é ação operacional — ver
  [`docs/ops/DB_RESTORE_RUNBOOK.md`](../docs/ops/DB_RESTORE_RUNBOOK.md).

### Procedimento Manual (quando necessário)
```bash
# Dump completo
mysqldump -h HOST -u USER -p DBNAME > backup_$(date +%Y%m%d).sql

# Apenas schema
mysqldump -h HOST -u USER -p --no-data DBNAME > schema_$(date +%Y%m%d).sql

# Apenas dados de tabelas críticas
mysqldump -h HOST -u USER -p DBNAME \
  import_sessions import_staging_items \
  documents document_versions \
  > critical_data_$(date +%Y%m%d).sql
```

## Backup do Código

O código é armazenado no repositório Git (`leandrocardoso-cmyk/licigov-pro`). Toda sprint é preservada via commits e tags de release.

## Tabelas Críticas por Ordem de Importância

| Prioridade | Tabela | Motivo |
|------------|--------|--------|
| P1 | `organizations` | Identidade dos tenants |
| P1 | `users` + `organization_members` | Acesso ao sistema |
| P1 | `documents` + `document_versions` | Documentos licitatórios |
| P2 | `activity_logs` | Auditoria imutável |
| P2 | `import_sessions` | Histórico de importações |
| P3 | `import_staging_items` | Staging (TTL 30 dias, recuperável) |
| P3 | `document_render_cache` | Cache (regenerável) |
