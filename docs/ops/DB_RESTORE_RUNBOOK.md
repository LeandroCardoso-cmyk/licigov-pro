# Runbook — Backup e Restauração do Banco (PR D)

> Procedimentos operacionais de backup e restauração. Complementa
> [`backups/BACKUP_POLICY.md`](../../backups/BACKUP_POLICY.md) e
> [`backups/DISASTER_RECOVERY.md`](../../backups/DISASTER_RECOVERY.md).

## Backup

**Workflow:** [`.github/workflows/db-backup.yml`](../../.github/workflows/db-backup.yml)

- **Agendado:** diariamente às **06:00 UTC** (03:00 BRT) via `schedule`.
- **Manual:** Actions → "Backup do Banco (agendado + manual)" → "Run workflow".
- **Método:** `mysqldump --single-transaction` (snapshot consistente, somente leitura).
- **Artefato:** dump `.sql.gz` (ou `.sql.gz.enc` se cifrado) **+ checksum `.sha256`**, retenção **14 dias**.
- **Integridade:** falha explícita se o dump sair vazio/curto; checksum SHA-256 do artifact final.
- **Criptografia at-rest (secure-by-default):** se o secret `BACKUP_ENCRYPTION_KEY` estiver definido,
  o dump é **cifrado** com `openssl aes-256-cbc -pbkdf2` antes do upload. Sem a chave, o workflow
  **avisa** e sobe o dump apenas **restrito ao repositório** (artifacts do GitHub são privados aos
  colaboradores, mas não cifrados por nós) — definir a chave é ação operacional.
- **Segurança:** host/usuário/senha **não** aparecem nos logs; o dump **nunca** é versionado no Git.
- **Secrets:** `BACKUP_DATABASE_URL` (obrigatório) e `BACKUP_ENCRYPTION_KEY` (recomendado).
  Para restaurar um dump cifrado: `openssl enc -d -aes-256-cbc -pbkdf2 -in dump.sql.gz.enc -out dump.sql.gz -pass env:BACKUP_ENCRYPTION_KEY`.

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

## Healthcheck canônico (Railway)

- **Rota canônica de readiness:** **`/readyz`** (200 quando o banco responde; 503 quando não).
  Declarada em [`railway.json`](../../railway.json) (`deploy.healthcheckPath`). `/health` e
  `/healthz` são aliases equivalentes; `/livez` é liveness (sempre 200) — não usar como healthcheck
  de deploy (não detectaria o banco indisponível).
- **Ação operacional (painel Railway):** confirmar em Service → Settings que o healthcheck aponta
  para `/readyz` e habilitar *Wait for CI* para o deploy aguardar os checks do GitHub.

## OPERATOR_ACTION_REQUIRED

- **SEC (dependências):** 3 críticas + 45 altas **pré-existentes** (triagem em
  [`DEPENDENCY_AUDIT_TRIAGE.md`](./DEPENDENCY_AUDIT_TRIAGE.md)). O gate de CI (`pnpm audit:gate`)
  bloqueia **novas**; reduzir o baseline via upgrades controlados (validar em staging).
- **G11 (restore real):** executar o drill acima com `BACKUP_DATABASE_URL` e registrar a evidência.
- **Criptografia de backup:** definir o secret `BACKUP_ENCRYPTION_KEY` para cifrar o dump at-rest.
- **Required checks / Wait for CI:** configurar branch protection na `main` e *Wait for CI* no
  Railway (ver [`CI_CD_GATES.md`](../architecture/CI_CD_GATES.md)).
- **Healthcheck:** confirmar `/readyz` no painel do Railway.
- **SEC-036 (CSP):** a CSP é **secure-by-default** (ligada em produção/staging). Validar em
  **staging** que a CSP padrão não quebra o SPA; se quebrar, ajustar as diretivas — nunca desligar
  em produção sem substituto (`HELMET_CSP_ENABLED=false` é só escape hatch de emergência).
