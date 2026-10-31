# Checklist de contenção — MySQL de STAGING (produção depois, com autorização própria)

> **Revisão 4 (26/10/2026).** Executor: Owner (ou operador autorizado). Cada bloco ▶ é uma **mutação**; todos os
> blocos ▶ de staging estão cobertos por uma única autorização coordenada (§9). Nada aqui vale para produção.
> Detalhes: [`ROTATION_RUNBOOK.md`](./ROTATION_RUNBOOK.md) §1–§2. Nenhum valor de segredo em registro algum.

## 0. Alvo exato (staging)

| Item | ID |
|---|---|
| Projeto Railway `licigov-pro` | `893a1317-51ad-4b18-9d9a-f6e579e09351` |
| Ambiente `staging` | `e7cc21d0-22a8-4844-a29b-81ee1221e0d0` |
| Serviço app `licigov-pro` (branch `staging`, pre-deploy `pnpm db:release:predeploy`) | `2d497607-3208-4996-9295-0f919b6a93bd` |
| Serviço `MySQL` (imagem `mysql:9`, `--disable-log-bin`; proxy público `shortline.proxy.rlwy.net:25899`) | `e6b7a98f-38c2-4123-8b99-7039a1829cbf` (deploy `ed5a4d7e-ff57-4c52-b2c3-ef5ae24ad45d`, 19/09) |
| Volume `mysql-volume` (5000 MB, `/var/lib/mysql`) | `e912c006-ad27-4a36-ad88-447d3d2bb699` |
| Deploy atual do app | `ea6a4b68-fb53-45d2-b022-40e211b56abf` — commit `eef4bf762be66f912535b9cc5c339d72ea29095b` (#320), SUCCESS 25/10 22:25 UTC |

**Confirmar o alvo antes de cada mutação** (sem revelar valores):
1. Railway UI: barra superior `licigov-pro` › ambiente **staging**; a URL contém
   `893a1317-51ad-4b18-9d9a-f6e579e09351` e `environmentId=e7cc21d0-22a8-4844-a29b-81ee1221e0d0`.
2. CLI: `railway link --project 893a1317-51ad-4b18-9d9a-f6e579e09351 --environment staging --service e6b7a98f-38c2-4123-8b99-7039a1829cbf`
   e `railway status` mostrando projeto `licigov-pro`, ambiente `staging`, serviço `MySQL`.
3. Dentro do `railway ssh`: `printenv RAILWAY_PROJECT_ID RAILWAY_ENVIRONMENT_NAME RAILWAY_SERVICE_NAME` ⇒
   `893a1317-…`, `staging`, `MySQL`; e `SELECT @@server_uuid` igual ao registrado na leitura §2 (impressão
   digital da instância; diferente ⇒ **parar**).

## 1. Canal confidencial das senhas (pré-requisito dos blocos ▶ com conta)

Ninguém além do operador vê as senhas; **nunca** em chat, log de ferramenta, CI, PR, issue ou arquivo. O Claude
não participa desta etapa e não pede senha.

- **Gerador:** o cofre de senhas do operador (entrada por conta: `licigov staging licigov_app`, `…_migrator`,
  `…_backup`, `…_audit`), **40 caracteres alfanuméricos** (sem símbolos). Motivo técnico: as senhas entram em URLs
  `mysql://…`; o `mysql2` decodifica percent-encoding e o `db-backup.sh` usa a senha literal — símbolos
  quebrariam um dos dois. Por isso não se usa `IDENTIFIED BY RANDOM PASSWORD` (pode gerar pontuação).
- **Intervenção do operador, por conta:** gerar no cofre → copiar → colar no `CREATE USER … IDENTIFIED BY '…'`
  dentro do `mysql` do `railway ssh` (o cliente não grava linhas com `IDENTIFIED`/`PASSWORD` no histórico) →
  colar a mesma senha, já dentro da URL, no campo do destino (Railway Variables do app / GitHub Secret) →
  limpar a área de transferência. Máquina confiável, sem gravação de tela.
- **Desconhecido registrado:** se a Railway retém saída de sessões `railway ssh`. Mitigação: a senha aparece só
  como entrada colada, não como resultado de consulta.
- Sem cofre ou sem máquina confiável ⇒ **impedimento** só dos blocos ▶ com senha; as leituras do §2 seguem.

## 2. Leituras pendentes (sem segredo, sem `authentication_string`)

Pelo `railway ssh` no MySQL de staging, como root (`MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot …`; a senha
fica só no ambiente do container):

```sql
SELECT VERSION(), @@server_uuid, @@require_secure_transport, @@tls_version, DATABASE();
SELECT user, host, plugin, ssl_type, account_locked, password_expired FROM mysql.user ORDER BY user, host;
SELECT schema_name FROM information_schema.schemata ORDER BY 1;
-- para cada conta fora de root/mysql.sys/mysql.session/mysql.infoschema:
SHOW GRANTS FOR '<conta>'@'<host>';
```

E na UI (sem clicar em revelar):
- app `licigov-pro` (staging) → Variables → `DATABASE_URL`: **referência** (`${{MySQL.MYSQL_URL}}`, aparece como
  vínculo) ou **literal** (mascarado). Só registrar a forma.
- MySQL → Database → Config → Connection: o botão **Regenerate** existe? Registrar; não clicar.
- Volume `mysql-volume` → Backups: há backups da Railway? Registrar (recuperação adicional; PITR não se aplica com
  `--disable-log-bin`).

Contas fora das esperadas: anotar dono/função; **não excluir** nesta rotina.

## 3. Consumidores e plano de contas (staging)

| Consumidor | Hoje (nomes) | Depois | Conta | Privilégios |
|---|---|---|---|---|
| App `licigov-pro` — runtime | `DATABASE_URL` (forma: §2) | `DATABASE_URL` → `licigov_app` via `mysql.railway.internal:3306` | `licigov_app` | SELECT, INSERT, UPDATE, DELETE |
| App — pre-deploy (`db:release:predeploy`) | mesma `DATABASE_URL` | `MIGRATION_DATABASE_URL` → `licigov_migrator` (variável nova) | `licigov_migrator` | + CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE/ALTER ROUTINE |
| GitHub — "Backup do Banco" `target=staging` | — | `STAGING_BACKUP_DATABASE_URL` (proxy público), `STAGING_BACKUP_ENCRYPTION_KEY` (própria), `STAGING_BACKUP_DB_SSL_CA` | `licigov_backup` (REQUIRE SSL) | SELECT, SHOW VIEW, TRIGGER, EVENT + SHOW_ROUTINE |
| GitHub — "Auditoria de Schema" `target=staging` | — | `STAGING_AUDIT_DATABASE_URL`, `STAGING_AUDIT_DB_SSL_CA` | `licigov_audit` (REQUIRE SSL) | REFERENCES |
| Serviço MySQL (`MYSQL_URL`, `MYSQL_ROOT_PASSWORD`…) | root | root, senha nova pelo Regenerate | `root` | — |

`MIGRATION_DATABASE_URL` no mesmo serviço: o processo da aplicação também recebe a variável; a separação limita o
que o código usa, **não isola o segredo**. `LICIGOV_STAGING_SMOKE_*` são credenciais de login de teste, não de banco.

**Produção intocada:** os secrets `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_DB_SSL_CA`,
`AUDIT_DATABASE_URL`, `AUDIT_DB_SSL_CA`, `RESTORE_TARGET_URL` e as variáveis do ambiente `production` não mudam.

## 4. Qual código de workflow roda (cuidado)

- **Agendamento usa o workflow do branch padrão (`main`).** Integrar a #317 em `staging` **não** muda o backup
  diário de produção: ele continua no workflow antigo da `main` até a promoção staging → main. Não contar a
  mudança de workflow como implantada antes disso.
- **Ensaios manuais:** Actions → "Backup do Banco" → **Use workflow from: `staging`** (o ref com a #317) →
  `target = staging`. Disparar a partir da `main` roda o workflow antigo, que **não tem `target` e faz backup de
  produção** — não fazer. No run, conferir: `head_sha` = commit integrado em staging; log `🎯 Alvo: staging`;
  `TLS: VERIFY_CA`; artifact **`db-backup-staging`**. Qualquer divergência ⇒ cancelar o run.
- "Auditoria de Schema": mesmo cuidado (ref `staging`, `target = staging`).

## 5. ▶ Integrar a #317 em `staging`

- [ ] Merge da #317 em `staging` (CI verde no head). A Railway implanta o app de staging (deploy automático do
      branch, aguardando os checks). Validar: pre-deploy "migrations em dia", `Schema validado`, `/readyz` 200,
      login. Ainda com a credencial atual (nada de banco mudou).

## 6. ▶ Criar contas (staging)

- [ ] Alvo confirmado (§0). Canal do §1 pronto.
- [ ] No `mysql` do `railway ssh`: `CREATE USER '<conta>'@'%' IDENTIFIED BY '<colado do cofre>';` para as quatro
      contas; depois colar os `GRANT`/`ALTER USER … REQUIRE SSL` impressos por `pnpm db:roles:plan <banco>`
      (banco = `MYSQLDATABASE` lido no §2). `SHOW GRANTS` de cada conta confere com o plano.
- [ ] `cat /var/lib/mysql/ca.pem` (não é segredo) ⇒ conteúdo dos secrets `STAGING_*_DB_SSL_CA`.
- O app continua usando a credencial atual: criar contas não altera nenhum consumidor.

## 7. ▶ Secrets de staging, backup, auditoria e **prova de recuperação** — antes de trocar consumidores

- [ ] Criar os secrets `STAGING_*` do §3 (o seletor recusa chave igual à de produção e host:porta de produção).
- [ ] "Backup do Banco" (ref `staging`, `target = staging`) ⇒ checagens do §4 + artifact `db-backup-staging`.
- [ ] "Auditoria de Schema" (ref `staging`, `target = staging`) ⇒ "✅ Alinhado".
- [ ] **Drill com os dados reais de staging** (o dump bem-sucedido não prova restauração; o ensaio local foi
      sintético):
      - origem: o backup cifrado de staging deste run;
      - destino: projeto Railway **novo e separado** `licigov-restore-drill` com um MySQL do template e o banco
        `licigov_restore_drill` criado vazio; proxy público ligado só durante o drill;
      - acesso: só o Owner no projeto do drill; secret `STAGING_RESTORE_TARGET_URL` com a conta do drill;
      - execução: "Backup do Banco" (ref `staging`, `target = staging`, `run_restore_drill = true`) ⇒ evidência
        `restore-drill-evidence-staging` (contagens, isolamento por tenant, migrations);
      - retenção/limpeza: apagar o projeto `licigov-restore-drill` e o secret `STAGING_RESTORE_TARGET_URL` logo
        após conferir a evidência. Nunca restaurar sobre staging ou produção.
- Recuperação disponível depois disto: backup cifrado de staging restaurável (comprovado), backups da Railway do
  volume (se o §2 confirmar), e a credencial antiga ainda válida até o §8.

## 8. ▶ Trocar consumidores e Regenerate (staging)

- [ ] App: `DATABASE_URL` → `mysql://licigov_app:<senha>@mysql.railway.internal:3306/<banco>`;
      `MIGRATION_DATABASE_URL` → mesma forma com `licigov_migrator`. Deploy. Validar: log do pre-deploy
      `conexão: MIGRATION_DATABASE_URL`, `Schema validado`, `/readyz` 200, login, uma escrita no tenant sintético
      `homologacao-sintetica`, nenhum `command denied`.
- [ ] Só com o item anterior verde e o Regenerate confirmado no §2: MySQL → Config → Connection → **Regenerate**.
      Redeploy do app; repetir as validações. Backup e auditoria de staging rodam de novo (não dependem do root).

## 9. Autorização coordenada (texto para o Owner)

"Autorizo, **somente no ambiente staging** (`e7cc21d0-22a8-4844-a29b-81ee1221e0d0` do projeto
`893a1317-51ad-4b18-9d9a-f6e579e09351`), os passos §5–§8 deste checklist: merge da #317 em `staging` e o deploy
automático decorrente; criação das contas `licigov_app`, `licigov_migrator`, `licigov_backup`, `licigov_audit` com
os GRANTs de `db-roles.ts`; criação dos secrets `STAGING_*`; backup, auditoria e drill de staging (incluindo criar
e apagar o projeto descartável `licigov-restore-drill`); troca de `DATABASE_URL`/`MIGRATION_DATABASE_URL` do app de
staging; e o Regenerate do root de staging depois da validação. Produção fica de fora."

## 10. Recuperação (sem credencial antiga)

- App falha com `licigov_app` → apontar para `licigov_migrator` e registrar o privilégio faltante.
- Pre-deploy falha → GRANT justificado no `licigov_migrator`; nunca `root`.
- Backup falha → corrigir conta/TLS/CA; nunca texto puro nem root.
- Nunca reaplicar a senha antiga do root nem a `DATABASE_URL` antiga.

## 11. Produção — fora desta autorização

Repetir §5–§8 em produção exige autorização própria e a promoção staging → main (que também ativa o novo workflow
de backup agendado). Atestação (sem valores) no `AUDIT_REPORT.md` §10.

## 12. Na sequência (cada um com sua autorização)

| Ordem | Item | Dependências / efeito | Runbook |
|---|---|---|---|
| 1 | `JWT_SECRET` prod e staging | Derruba todas as sessões (TTL 24 h) | §3 |
| 2 | `GEMINI_API_KEY` (prod, staging, Actions) | Projeto GCP ativo; possível chave compartilhada com SincroSaúde | §4 |
| 3 | `AWS_*` | Upload/download S3; CloudTrail data events provavelmente ausentes | §5 |
| 4 | `BREVO_API_KEY` | E-mails de convite/reset; possível conta compartilhada com SincroSaúde | §6 |
| 5 | Senha do admin de plataforma | Reset revoga as sessões do admin | §7 |
| 6 | Remover `ADMIN_PASSWORD`; decidir `A2_HOMOLOG_TOKEN`; excluir `A2_HOMOLOG_ON_BOOT`, `A3_HOMOLOGATION_RUN`, `A3_HOMOLOGATION_RUN_ID` (sem consumidor; presentes no staging em 27/10) | Após deploy da PR; confirmar uso fora do repo | §7–§8 |
