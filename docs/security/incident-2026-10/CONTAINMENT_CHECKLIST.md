# Checklist de contenção — MySQL primeiro (staging → produção)

> **Revisão 3 (26/10/2026).** Executor: Owner (ou operador autorizado). Cada bloco ▶ é uma **mutação** que exige
> a autorização indicada; nenhum bloco ▶ foi autorizado por este documento. Detalhes e justificativas:
> [`ROTATION_RUNBOOK.md`](./ROTATION_RUNBOOK.md) §1–§2. Sem valores de segredo em nenhum registro.
> Tempo estimado: ~45 min por ambiente (o backup de produção sozinho leva ~20 min).

## 0. Acessos e condições necessários

- [ ] Railway: conta do Owner com acesso ao projeto `licigov-pro`; Railway CLI instalado e logado
      (`railway ssh`), numa **máquina confiável**.
- [ ] GitHub: admin do repositório (criar Actions Secrets e disparar workflows manuais).
- [ ] Esta PR (#317) integrada em `staging` e implantada (o seletor de ambiente dos workflows e o
      `MIGRATION_DATABASE_URL` vêm dela) **ou** usar a variante "sem PR" do passo 3.
- [ ] **Canal confidencial da senha gerada** (pré-requisito dos passos 2–4, decidir e registrar ANTES de criar
      contas). `CREATE USER … IDENTIFIED BY RANDOM PASSWORD` devolve a senha **uma vez**, como resultado da
      consulta, no terminal do `railway ssh`. Caminho exigido entre geração e armazenamento:
      terminal da máquina confiável → cofre do operador (gerenciador de senhas) **ou** colagem direta no campo do
      destino (Railway Variables / GitHub Secret) → limpar a área de transferência e encerrar a sessão do terminal.
      Proibido: chat, e-mail, arquivo local, print/gravação de tela, log de ferramenta, CI ou evidência.
      O cliente `mysql` já não grava no histórico linhas com `IDENTIFIED`/`PASSWORD` (`--histignore` padrão);
      **não se sabe** se a Railway retém a saída de sessões `railway ssh` — tratar como desconhecido.
      Se esse canal **não existir** (máquina não confiável, gravação de tela ativa, sem cofre), registrar a
      condição no `AUDIT_REPORT.md` §10 e **não** criar as contas até resolvê-la.
- [ ] **Regenerate disponível no serviço real**: abrir Railway → MySQL (staging) → Database View → Config →
      Connection e confirmar que o botão **Regenerate** aparece (a doc da Railway o descreve para os bancos do
      template; não foi possível confirmar no serviço real a partir desta auditoria). Se não aparecer, **parar
      antes do passo 5** e pedir orientação: trocar a senha por `ALTER USER` e editar a variável separadamente
      dessincroniza o serviço (a doc trata as duas coisas como uma operação).

## 1. Pré-checagem (somente leitura, sem autorização adicional)

Resultado da pré-checagem remota feita nesta auditoria: [`AUDIT_REPORT.md` §11](./AUDIT_REPORT.md). O que
ficou sem acesso remoto (versão real, contas, grants, se `DATABASE_URL` é referência) é coletado aqui:

- [ ] Railway → serviço `licigov-pro` → Variables: anotar se `DATABASE_URL` é **referência**
      (`${{MySQL.MYSQL_URL}}`) ou valor literal — em staging e produção (só a forma, nunca o valor).
- [ ] `railway ssh` no serviço MySQL do ambiente → `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "SELECT
      VERSION(); SELECT user, host, account_locked, ssl_type FROM mysql.user; SHOW GRANTS FOR CURRENT_USER();"`
      — registrar **versão em execução** (a tag `mysql:9` não prova a versão) e contas (só nomes/hosts).
      Contas internas esperadas: `root`, `mysql.sys`, `mysql.session`, `mysql.infoschema`. Qualquer outra:
      **anotar dono/função; não excluir** nesta rotina. Para grants: `SHOW GRANTS FOR '<conta>'@'<host>'`
      (não consultar `authentication_string`).
- [ ] Último run de "Backup do Banco" (produção) OK, com artefato `db-backup-production` (`.sql.gz.enc`).
      Histórico desta auditoria: backups diários OK; **nenhum drill real bem-sucedido** registrado (runs manuais
      4–8, 31/07–01/08, falharam na `RESTORE_TARGET_URL`).
- [ ] `pnpm db:roles:plan railway` (local) — confirmar o nome do banco (`MYSQLDATABASE`) e o plano de GRANT.

## 2. ▶ Criar contas (staging) — autorização: "criar contas MySQL em staging"

Só com o canal confidencial do passo 0 definido. Dentro de `railway ssh` (serviço MySQL, ambiente staging),
cliente `mysql` como root:

```sql
SET SESSION generated_random_password_length = 32;
CREATE USER 'licigov_app'@'%'      IDENTIFIED BY RANDOM PASSWORD;   -- senha exibida UMA vez → canal do passo 0
CREATE USER 'licigov_migrator'@'%' IDENTIFIED BY RANDOM PASSWORD;
CREATE USER 'licigov_backup'@'%'   IDENTIFIED BY RANDOM PASSWORD;
CREATE USER 'licigov_audit'@'%'    IDENTIFIED BY RANDOM PASSWORD;
-- colar aqui os GRANT/ALTER USER impressos por `pnpm db:roles:plan <banco>`
```

- [ ] Cada senha seguiu o canal do passo 0; nenhuma cópia fora dele.
- [ ] Copiar a CA do servidor (não é segredo): `cat /var/lib/mysql/ca.pem` dentro do mesmo `railway ssh` — usada
      nos passos 4 (backup/auditoria em `VERIFY_CA`).

## 3. ▶ Trocar consumidores (staging) — autorização: "trocar credenciais de banco em staging"

- [ ] **Com a PR implantada:** `DATABASE_URL` → `mysql://licigov_app:<senha>@mysql.railway.internal:3306/<banco>`;
      `MIGRATION_DATABASE_URL` → mesma forma com `licigov_migrator`.
- [ ] **Sem a PR implantada:** `DATABASE_URL` → `licigov_migrator` (credencial nova; o split app/migrator vem
      depois, quando a PR estiver no ambiente). A contenção não espera a PR.
- [ ] Deploy. Validar: log do pre-deploy (`conexão: MIGRATION_DATABASE_URL` quando aplicável, migrations "em
      dia"); boot `Schema validado`; `/readyz` 200; login; uma escrita no tenant sintético
      `homologacao-sintetica`; nenhum `command denied` no log.

**Limite real do `MIGRATION_DATABASE_URL`:** o pre-deploy da Railway roda com as **mesmas variáveis do serviço**,
então o processo da aplicação também recebe `MIGRATION_DATABASE_URL` no ambiente. A separação garante que o
**código** da aplicação conecta só com `licigov_app` (DDL acidental, privilégio do pool), **não** isola o segredo:
quem executar código no container lê as duas credenciais. Isolamento de segredo exigiria um serviço/job de
migração separado com variáveis próprias (backlog; não faz parte desta contenção).

## 4. ▶ Backup e auditoria (staging) — autorização: "criar secrets de staging no GitHub e rodar backup/auditoria de staging"

Os workflows escolhem o ambiente por **nome de secret** (`scripts/ops/select-db-target.sh`): staging usa só
`STAGING_*`, sem fallback para produção; o agendamento diário continua **sempre produção**. **Não alterar** os
secrets de produção (`BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_DB_SSL_CA`, `AUDIT_DATABASE_URL`,
`AUDIT_DB_SSL_CA`, `RESTORE_TARGET_URL`) para testar staging.

- [ ] Criar (GitHub → Settings → Secrets → Actions) **novos** secrets de staging:
      `STAGING_BACKUP_DATABASE_URL` (`licigov_backup`, endpoint público do MySQL de staging),
      `STAGING_BACKUP_ENCRYPTION_KEY` (chave **nova**, própria de staging — o seletor recusa a chave de produção),
      `STAGING_BACKUP_DB_SSL_CA` (PEM do passo 2; obrigatório em staging),
      `STAGING_AUDIT_DATABASE_URL` (`licigov_audit`, endpoint público, **sem** parâmetro `ssl` na URL),
      `STAGING_AUDIT_DB_SSL_CA` (mesmo PEM).
- [ ] "Backup do Banco" → Run workflow → `target = staging`. Log: `Alvo: staging`, `TLS: VERIFY_CA`,
      `Servidor: <versão> | TLS TLSv1.x`; artefato `db-backup-staging`. O seletor recusa (antes de conectar)
      secret ausente, host:porta igual ao de produção ou chave igual à de produção.
- [ ] "Auditoria de Schema" → `target = staging`: "✅ Alinhado".

**O que o TLS verifica (sem exagero):** `VERIFY_CA` (backup) e `ssl: { ca, rejectUnauthorized: true }` (auditoria,
`mysql2`) exigem um certificado assinado pela CA **fixada** — a CA autogerada daquela instância MySQL. O
**hostname não é conferido**: o certificado autogerado não traz o host do proxy público, então `VERIFY_IDENTITY`
falharia. É autenticação por CA fixada, não verificação completa de identidade; se a CA da instância mudar
(volume recriado), o job falha fechado e a CA precisa ser recopiada. `rejectUnauthorized:false` (só cifra, não
autentica) deixou de ser usado. Ensaio local (MySQL 9.7.4): CA certa com hostname divergente ⇒ conecta; CA de
outra instância ⇒ `certificate signature failure`.

**Produção, até o passo 7:** o backup agendado segue com os secrets atuais e, sem `BACKUP_DB_SSL_CA`, em
`REQUIRED` (aviso no log); a auditoria de produção passa a exigir `AUDIT_DB_SSL_CA` e falha sem ela.

## 5. ▶ Regenerate do root (staging) — autorização: "regenerar senha root MySQL em staging"

- [ ] Só depois dos passos 3–4 verdes e com o Regenerate confirmado no passo 0.
      Railway → MySQL → Config → Connection → **Regenerate**.
- [ ] Se `DATABASE_URL` ainda for referência ao `MYSQL_URL`, ela **deve** ter sido trocada no passo 3 (senão o
      app passa a seguir o root novo). Redeploy dos dependentes; repetir as validações do passo 3.

## 6. ▶ Drill de restauração (opcional, separado) — autorização: "drill de restauração em instância descartável de <ambiente>"

Não é leitura: grava uma cópia completa dos dados numa instância nova. Um banco vazio **não prova** que é
descartável; o drill só roda com todos os itens abaixo:

- [ ] **Destino identificado:** instância MySQL nova, num projeto Railway próprio (ex.: `licigov-restore-drill`),
      fora dos projetos de produção/staging, com o banco criado com o nome `licigov_restore_drill` (ou
      `licigov_restore_drill_<sufixo>`). O seletor recusa outro nome, host:porta igual à origem ou ao banco do
      outro ambiente, e o drill recusa destino não vazio ou `localhost`.
- [ ] **Acesso:** só o Owner no projeto do drill; conta do destino só com privilégio no banco do drill; endpoint
      público só durante o drill.
- [ ] **Secret do destino:** `RESTORE_TARGET_URL` (drill de produção) ou `STAGING_RESTORE_TARGET_URL` (drill de
      staging). Recomendado começar por staging.
- [ ] **Execução:** "Backup do Banco" → `target = <ambiente>`, `run_restore_drill = true`. Evidência
      `restore-drill-evidence-<ambiente>` (90 dias) só com contagens; o dump é decifrado em stream e os arquivos
      do runner são removidos também em falha.
- [ ] **Retenção e limpeza:** apagar o projeto/instância do drill logo após conferir a evidência (os dados
      restaurados são uma cópia real); apagar o secret do destino; registrar horário e run no §10.

Ensaio local desta revisão (MySQL 9.7.4 → instância separada, seletor + script do drill): 345 tabelas, 320
migrations, isolamento OK; segunda execução recusada por destino não vazio.

## 7. Recuperação (sem credencial antiga)

- App falha com `licigov_app` → apontar para `licigov_migrator` (nova) e registrar o privilégio faltante.
- Pre-deploy falha → GRANT justificado no `licigov_migrator`; nunca `root`.
- Backup falha → corrigir conta/TLS/CA; nunca texto puro nem root; backups anteriores retidos 14 dias.
- Nunca reaplicar a senha antiga do root nem a `DATABASE_URL` antiga.

## 8. ▶ Produção — autorização: "executar passos 2–5 em produção"

- [ ] Repetir 2–5 em produção, em janela de baixo uso. No passo 4, **atualizar** os secrets de produção
      (`BACKUP_DATABASE_URL` → `licigov_backup`, `BACKUP_DB_SSL_CA`, `AUDIT_DATABASE_URL` → `licigov_audit`,
      `AUDIT_DB_SSL_CA`) e rodar "Backup do Banco" e "Auditoria de Schema" com `target = production`.
- [ ] Atestação (sem valores) no `AUDIT_REPORT.md` §10: IDs de deploy, horário UTC, run do backup, lista de
      contas após a troca, confirmação do Regenerate, condição do canal confidencial.

## 9. Na sequência (cada um com sua autorização)

| Ordem | Item | Dependências / efeito | Runbook |
|---|---|---|---|
| 1 | `JWT_SECRET` prod e staging | Derruba todas as sessões (TTL 24 h); sem outros consumidores | §3 |
| 2 | `GEMINI_API_KEY` (prod, staging, Actions) | Projeto GCP ativo (staging com faturamento vencido em 08/10); possível chave compartilhada com SincroSaúde | §4 |
| 3 | `AWS_*` | Upload/download S3; CloudTrail data events provavelmente ausentes (verificar) | §5 |
| 4 | `BREVO_API_KEY` | E-mails de convite/reset; possível conta compartilhada com SincroSaúde | §6 |
| 5 | Senha do admin de plataforma | Reset revoga as sessões do admin | §7 |
| 6 | Remover `ADMIN_PASSWORD`; decidir `A2_HOMOLOG_TOKEN` | Após deploy da PR; confirmar uso fora do repo | §7–§8 |
