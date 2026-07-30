# Runbook — Backup e Restauração do Banco (PR D)

> Procedimentos operacionais de backup e restauração. Complementa
> [`backups/BACKUP_POLICY.md`](../../backups/BACKUP_POLICY.md) e
> [`backups/DISASTER_RECOVERY.md`](../../backups/DISASTER_RECOVERY.md).

## Backup

**Workflow:** [`.github/workflows/db-backup.yml`](../../.github/workflows/db-backup.yml)

- **Agendado:** diariamente às **06:00 UTC** (03:00 BRT) via `schedule`.
- **Manual:** Actions → "Backup do Banco (agendado + manual)" → "Run workflow".
- **Método:** `mysqldump --single-transaction` (snapshot consistente, somente leitura).
- **Artefato:** dump `.sql.gz` **+ checksum `.sha256`**, retenção **14 dias**.
- **Integridade:** falha explícita se o dump sair vazio/curto; checksum SHA-256 gerado.
- **Segurança:** host/usuário/senha **não** aparecem nos logs; o dump **nunca** é versionado no Git.
- **Secret necessário:** `BACKUP_DATABASE_URL` (MySQL público de produção — ex.: `MYSQL_PUBLIC_URL` do Railway).

## Teste de restauração (isolado — automatizado)

**Workflow:** [`.github/workflows/db-restore-test.yml`](../../.github/workflows/db-restore-test.yml)

- **Agendado:** semanal (segunda 07:00 UTC) + manual.
- **Ambiente:** banco **efêmero e isolado** do CI (MySQL service). **Nunca** produção.
- **Fixture sintética** (sem dados reais/segredos): gera dump → confere checksum → restaura em
  banco isolado → verifica **tabelas críticas, contagens (origem = destino) e isolamento por
  tenant** → registra **evidência** (artifact `restore-evidence`, 90 dias) → destrói o ambiente.
- **Objetivo:** comprovar a **mecânica** de backup→restauração de forma segura e repetível.

## ⚠️ Drill de restauração com backup REAL (ação operacional — pendente)

O teste automatizado valida a mecânica com fixture. Um drill com **backup real de produção**
exige o secret `BACKUP_DATABASE_URL` e infraestrutura de destino não-produtiva — é um exercício
**operacional gated** e **não** foi executado nesta PR (jamais restaurar sobre produção).

**Procedimento do drill (executar manualmente, fora de produção):**
1. Baixar o artefato `db-backup` mais recente (dump + `.sha256`).
2. `sha256sum -c backup-*.sql.gz.sha256` → confirmar integridade.
3. Subir um MySQL **descartável** (container/instância isolada) — nunca o de produção.
4. `gunzip -c backup-*.sql.gz | mysql --host=<isolado> <db_target>`.
5. Validar: schema restaurado, tabelas críticas (`organizations`, `users`,
   `documents`, `document_versions`, `activity_logs`), contagens plausíveis, login/consulta básica.
6. Registrar a evidência (data, run, tipo, checksum, resultado, duração, testes) **sem** expor
   dados/credenciais.
7. Destruir o ambiente isolado.

Só após esse drill o item de gate **G11** pode ser considerado plenamente `PASS` para o backup real.

## OPERATOR_ACTION_REQUIRED

- **SEC (dependências):** `pnpm audit --prod` acusa vulnerabilidades **críticas/altas
  pré-existentes** em dependências transitivas. Planejar upgrades controlados (fora do PR D),
  validando em staging. O gate de CI roda o audit de forma transparente (advisory).
- **G11 (restore real):** executar o drill acima com `BACKUP_DATABASE_URL` e registrar a evidência.
- **SEC-036 (CSP):** habilitar `HELMET_CSP_ENABLED=true` primeiro em **staging**, validar que o
  SPA não quebra, e só então em produção.
