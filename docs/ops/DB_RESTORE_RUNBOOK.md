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

## Drill de restauração com backup REAL (workflow gated — dispatch-only)

O drill com **backup real** é executado por um **job gated** dentro de
[`.github/workflows/db-backup.yml`](../../.github/workflows/db-backup.yml) — job `restore-drill`.
Não há restauração manual/local: o exercício roda **inteiramente no workflow**, de forma auditável.

**Por que dentro do db-backup.yml?** `workflow_dispatch` só é disparável para workflows presentes na
**default branch**. `db-backup.yml` já está na `main`; assim o drill é disparável a partir da branch
da PR (`ref`) **sem merge**. O job `restore-drill` é **dispatch-only** e **desligado por padrão**
(`run_restore_drill=false`), então o backup agendado diário **nunca** dispara restauração.

**Como disparar (manual):** Actions → "Backup do Banco (agendado + manual)" → "Run workflow" →
selecionar a branch → marcar `run_restore_drill = true`.

**Secrets consumidos:** `BACKUP_DATABASE_URL` (origem, só-leitura), `BACKUP_ENCRYPTION_KEY`
(decifra o dump), `RESTORE_TARGET_URL` (**único** destino).

**Invariantes de segurança (verificadas em runtime, sem expor valores):**
1. destino = **exclusivamente** `RESTORE_TARGET_URL`; `DATABASE_URL` **nunca** é lida/usada;
2. **recusa** se origem == destino (host+porta+banco, ou host+banco);
3. destino precisa estar **acessível** e **vazio** (prod/staging teriam tabelas → aborta);
4. dump precisa estar **cifrado** (`.enc`); **checksum SHA-256** conferido antes de decifrar;
5. **origem só-leitura** (o dump vem do backup; a origem não é tocada no restore);
6. **nenhuma aplicação** conectada ao destino (apenas o cliente `mysql`);
7. **nenhum** secret/host/URL/dado nos logs — só contagens/aggregates;
8. arquivos decifrados **removidos** ao final; o banco de destino **não** é dropado
   (a exclusão do projeto Railway é **manual**, pelo operador).

**Validações pós-restore:** schema restaurado, `__drizzle_migrations` (migrations aplicadas),
tabelas essenciais (`organizations`, `users`, `processes`, `documents`, `document_versions`,
`activity_logs`, `official_documents`) presentes e legíveis, isolamento multi-tenant
(versões órfãs = 0, mismatch tenant versão↔documento = 0), smoke de join canônico.

**Evidência:** artifact `restore-drill-evidence` (retenção 90 dias) com apenas metadados agregados
(run, data, checksum, duração, nº de tabelas, testes, resultado) — **sem** dados/hosts/URLs/secrets.

Só após esse drill o item de gate **G11** pode ser considerado plenamente `PASS` para o backup real.

> ✅ **Drill real CONCLUÍDO (G11 = PASS).** Executado no run `30682397855` #8 em banco descartável
> e isolado (`RESTORE_TARGET_URL`, endpoint público): checksum `b882…685e`, 770s, **312 tabelas**,
> **120 migrations**, isolamento **órfãs=0/mismatch=0**, resultado **PASS**. O job foi marcado
> "failure" por um **falso negativo de cleanup posterior às validações** (`ls` sem correspondência
> sob `set -euo pipefail`), corrigido preventivamente em `0fd5099` — sem reexecução com dados reais.
> Evidência: [`../audits/production-readiness/DB_RESTORE_DRILL_EVIDENCE.md`](../audits/production-readiness/DB_RESTORE_DRILL_EVIDENCE.md).
> A **política definitiva de backup institucional** (retenção longa/rotação/off-site) segue como follow-up.

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
- **G11 (restore real):** ✅ **CONCLUÍDO** — drill real registrado (run `30682397855`; evidência em
  [`DB_RESTORE_DRILL_EVIDENCE.md`](../audits/production-readiness/DB_RESTORE_DRILL_EVIDENCE.md)).
- **Criptografia de backup:** definir o secret `BACKUP_ENCRYPTION_KEY` para cifrar o dump at-rest.
- **Required checks / Wait for CI:** configurar branch protection na `main` e *Wait for CI* no
  Railway (ver [`CI_CD_GATES.md`](../architecture/CI_CD_GATES.md)).
- **Healthcheck:** confirmar `/readyz` no painel do Railway.
- **SEC-036 (CSP):** a CSP é **secure-by-default** (ligada em produção/staging). Validar em
  **staging** que a CSP padrão não quebra o SPA; se quebrar, ajustar as diretivas — nunca desligar
  em produção sem substituto (`HELMET_CSP_ENABLED=false` é só escape hatch de emergência).
