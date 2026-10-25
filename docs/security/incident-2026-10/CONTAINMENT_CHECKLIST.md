# Checklist de contenção — MySQL primeiro (staging → produção)

> Executor: Owner (ou operador autorizado). Cada bloco ▶ é uma **mutação** que exige a autorização indicada.
> Detalhes e justificativas: [`ROTATION_RUNBOOK.md`](./ROTATION_RUNBOOK.md) §1–§2. Sem valores de segredo
> em nenhum registro. Tempo estimado: ~45 min por ambiente (o backup sozinho leva ~20 min).

## 0. Acessos necessários

- [ ] Railway: conta do Owner com acesso ao projeto `licigov-pro`; Railway CLI instalado e logado
      (`railway ssh`), numa máquina confiável.
- [ ] GitHub: admin do repositório (editar Actions Secrets e disparar workflows manuais).
- [ ] Esta PR (#317) implantada em staging **ou** usar a variante "sem PR" do passo 3.

## 1. Pré-checagem (somente leitura, sem autorização adicional)

- [ ] Railway → serviço `licigov-pro` → Variables: anotar se `DATABASE_URL` é **referência**
      (`${{MySQL.MYSQL_URL}}`) ou valor literal — em staging e produção.
- [ ] `railway ssh` no serviço MySQL → `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "SELECT VERSION();
      SELECT user, host, account_locked FROM mysql.user;"` — registrar versão e contas (só nomes/hosts).
      Contas internas esperadas: `root`, `mysql.sys`, `mysql.session`, `mysql.infoschema`. Qualquer outra:
      **anotar dono/função; não excluir** nesta rotina.
- [ ] Backup recuperável **antes** da troca: último run de "Backup do Banco" OK (artefato `.sql.gz.enc`) e, se
      houver banco descartável vazio em `RESTORE_TARGET_URL`, rodar o workflow com `run_restore_drill=true`.
      Nunca usar staging/produção como destino.
- [ ] `pnpm db:roles:plan railway` (local) — confirmar o nome do banco (`MYSQLDATABASE`) e o plano de GRANT.

## 2. ▶ Criar contas (staging) — autorização: "criar contas MySQL em staging"

Dentro de `railway ssh` (serviço MySQL, ambiente staging), cliente `mysql` como root:

```sql
SET SESSION generated_random_password_length = 32;
CREATE USER 'licigov_app'@'%'      IDENTIFIED BY RANDOM PASSWORD;   -- copiar a senha exibida para o destino
CREATE USER 'licigov_migrator'@'%' IDENTIFIED BY RANDOM PASSWORD;
CREATE USER 'licigov_backup'@'%'   IDENTIFIED BY RANDOM PASSWORD;
CREATE USER 'licigov_audit'@'%'    IDENTIFIED BY RANDOM PASSWORD;
-- colar aqui os GRANT/ALTER USER impressos por `pnpm db:roles:plan <banco>`
```

- [ ] Cada senha copiada **direto** para o destino (passo 3/5) e a tela limpa. Não salvar em arquivo/chat.

## 3. ▶ Trocar consumidores (staging) — autorização: "trocar credenciais de banco em staging"

- [ ] **Com a PR implantada:** `DATABASE_URL` → `mysql://licigov_app:<senha>@mysql.railway.internal:3306/<banco>`;
      `MIGRATION_DATABASE_URL` → mesma forma com `licigov_migrator`.
- [ ] **Sem a PR implantada:** `DATABASE_URL` → `licigov_migrator` (credencial nova; o split app/migrator vem
      depois, quando a PR estiver no ambiente). A contenção não espera a PR.
- [ ] Deploy. Validar: log do pre-deploy (`conexão: MIGRATION_DATABASE_URL` quando aplicável, migrations "em
      dia"); boot `Schema validado`; `/readyz` 200; login; uma escrita no tenant sintético
      `homologacao-sintetica`; nenhum `command denied` no log.

## 4. ▶ Backup e auditoria (staging, se houver secrets de staging; senão direto no passo 7)

- [ ] GitHub Secrets: `BACKUP_DATABASE_URL` → `licigov_backup` pelo endpoint público; `AUDIT_DATABASE_URL` →
      `licigov_audit` com `?ssl={"rejectUnauthorized":false}` no fim da URL (a conta exige TLS; o `mysql2` não
      recebe CA pela URL, então isto cifra o transporte sem verificar a identidade — ensaiado localmente).
- [ ] Opcional (recomendado): `BACKUP_DB_SSL_CA` com o PEM da CA do servidor (`/var/lib/mysql/ca.pem` dentro do
      container via `railway ssh`) ⇒ backup em `VERIFY_CA`.
- [ ] Rodar "Backup do Banco" manual: log mostra `Servidor: <versão> | TLS TLSv1.x`, artefato `.sql.gz.enc`.
      Rodar "Auditoria de Schema": "✅ Alinhado".

## 5. ▶ Regenerate do root (staging) — autorização: "regenerar senha root MySQL em staging"

- [ ] Só depois dos passos 3–4 verdes. Railway → MySQL → Config → Connection → **Regenerate**.
- [ ] Se `DATABASE_URL` ainda for referência ao `MYSQL_URL`, ela **deve** ter sido trocada no passo 3 (senão o
      app passa a seguir o root novo). Redeploy dos dependentes; repetir as validações do passo 3.

## 6. Recuperação (sem credencial antiga)

- App falha com `licigov_app` → apontar para `licigov_migrator` (nova) e registrar o privilégio faltante.
- Pre-deploy falha → GRANT justificado no `licigov_migrator`; nunca `root`.
- Backup falha → corrigir conta/TLS; nunca texto puro nem root; backups anteriores retidos 14 dias.
- Nunca reaplicar a senha antiga do root nem a `DATABASE_URL` antiga.

## 7. ▶ Produção — autorização: "executar passos 2–5 em produção"

- [ ] Repetir 2–5 em produção, em janela de baixo uso (produção quase sem tráfego hoje). Mesmos critérios.
- [ ] Atestação (sem valores) no `AUDIT_REPORT.md` §10: IDs de deploy, horário UTC, run do backup, lista de
      contas após a troca, confirmação do Regenerate.

## 8. Na sequência (cada um com sua autorização)

| Ordem | Item | Dependências / efeito | Runbook |
|---|---|---|---|
| 1 | `JWT_SECRET` prod e staging | Derruba todas as sessões (TTL 24 h); sem outros consumidores | §3 |
| 2 | `GEMINI_API_KEY` (prod, staging, Actions) | Projeto GCP ativo (staging com faturamento vencido em 08/10); possível chave compartilhada com SincroSaúde | §4 |
| 3 | `AWS_*` | Upload/download S3; CloudTrail data events provavelmente ausentes (verificar) | §5 |
| 4 | `BREVO_API_KEY` | E-mails de convite/reset; possível conta compartilhada com SincroSaúde | §6 |
| 5 | Senha do admin de plataforma | Reset revoga as sessões do admin | §7 |
| 6 | Remover `ADMIN_PASSWORD`; decidir `A2_HOMOLOG_TOKEN` | Após deploy da PR; confirmar uso fora do repo | §7–§8 |
