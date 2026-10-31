# Roteiro — credenciais MySQL de PRODUÇÃO (pós-incidente Railway, out/2026)

> **Estado:** código preparado (backport mínimo para `main`). **Nada aqui foi executado em produção.**
> As evidências de staging (contas dedicadas, drill #102, Regenerate do root, backup #103, auditoria #11)
> comprovam o **procedimento**, não o estado de produção — cada passo abaixo precisa da própria evidência.
> Cada bloco ▶ exige **autorização específica do Owner**; a promoção da release #337 segue em NO-GO e é
> independente deste roteiro. A organização 1 contém dados reais (Moreira Sales): nenhum passo escreve nela.

Alvo: projeto `893a1317-51ad-4b18-9d9a-f6e579e09351`, ambiente `production`
`3efa7f99-8641-48e1-ad33-3c98bf5e91c7`. Confirmar projeto **e** ambiente na tela antes de cada ação.

## 1. O que o merge desta PR muda (efeitos, antes de qualquer credencial nova)

| Componente | Comportamento após o merge na `main` | Pré-requisito / risco |
|---|---|---|
| Pre-deploy (`db:release:predeploy` → `db:migrate:release`) | Usa `MIGRATION_DATABASE_URL` **se existir**; senão `DATABASE_URL` (igual a hoje). Loga só o **nome** da variável. Reference data e runtime seguem em `DATABASE_URL` | Nenhum: produção não tem `MIGRATION_DATABASE_URL`, o fallback mantém o comportamento atual. O merge na `main` dispara o deploy da Railway em produção (sem migration nova: as 320 migrations de `main` não mudam) |
| Backup agendado (06:00 UTC) | Sempre **produção**; nomes de secrets atuais (`BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`). Cifra **obrigatória** (sem chave ⇒ falha antes de conectar; não há mais artifact em claro). Dump nunca em claro no disco. **TLS obrigatório**: `VERIFY_CA` se `BACKUP_DB_SSL_CA` existir; sem ela, `REQUIRED` (cifra o transporte, não autentica o servidor — aviso no log). Artifact passa a se chamar `db-backup-production` | `BACKUP_ENCRYPTION_KEY` precisa existir (o run de staging #103 recebeu o secret de produção não vazio no ambiente do job — conferir mesmo assim). O MySQL de produção precisa aceitar TLS; se não aceitar, o backup **falha** (fail-closed) em vez de cair para texto puro |
| Backup manual | Exige escolher `target` (`production` \| `staging`); staging só lê `STAGING_*`, sem fallback | — |
| Auditoria de schema | Exige `target`; produção exige `AUDIT_DATABASE_URL` **e** `AUDIT_DB_SSL_CA` (TLS com CA fixada) | **Novo:** `AUDIT_DB_SSL_CA` não existe em produção hoje ⇒ a auditoria de produção falha antes de conectar até o secret ser criado (§3) |
| Drill de restauração | Dispatch-only; exige `RESTORE_TARGET_URL` **e** `RESTORE_DB_SSL_CA` (CA do **destino**, `VERIFY_CA`); banco `licigov_restore_drill[_sufixo]`, vazio, endpoint ≠ origem e ≠ staging; CA do destino ≠ CA da origem; evidência `restore-drill-evidence-production` | **Novos:** `RESTORE_DB_SSL_CA` (e um `RESTORE_TARGET_URL` válido) só quando o drill de produção for autorizado (§4) |
| CI | Lint de não-regressão fail-closed (`scripts/ci/lint-changed.sh`: base real da PR; erro de fetch/diff reprova); smoke MySQL das contas com menor privilégio; `permissions: contents: read` | Disparo manual do CI passa a pedir `lint_base` |

Secrets novos só são exigidos pela operação que os usa. Nenhum valor de secret é impresso pelos scripts.

## 2. ▶ Contas dedicadas em produção

Plano de privilégios (fonte única, sem senhas): `pnpm db:roles:plan <banco>` (`scripts/ops/db-roles.ts`).

| Conta | Privilégios | Consumidor |
|---|---|---|
| `licigov_app` | SELECT, INSERT, UPDATE, DELETE no banco | `DATABASE_URL` (runtime + reference data), rede privada |
| `licigov_migrator` | + CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE/ALTER ROUTINE | `MIGRATION_DATABASE_URL` (pre-deploy), rede privada |
| `licigov_backup` | SELECT, SHOW VIEW, TRIGGER, EVENT + global SHOW_ROUTINE; `REQUIRE SSL` | secret `BACKUP_DATABASE_URL` |
| `licigov_audit` | REFERENCES; `REQUIRE SSL` | secret `AUDIT_DATABASE_URL` |

Canal das senhas: geradas no cofre do Owner (40 caracteres alfanuméricos — entram em URLs `mysql://`; não usar
`RANDOM PASSWORD`, que pode gerar pontuação), coladas no `CREATE USER` dentro do `mysql` do `railway ssh` do serviço
MySQL de **produção** e depois no destino (Railway Variables / GitHub Secret). Nunca em chat, log, PR ou arquivo.
Antes: ler versão (`SELECT VERSION(), @@server_uuid`), contas existentes (`user, host` — sem `authentication_string`)
e confirmar que o botão **Regenerate** existe em MySQL → Database → Config → Connection.

## 3. ▶ Secrets de produção, backup e auditoria (antes de trocar consumidores)

1. `BACKUP_DATABASE_URL` → `licigov_backup` (proxy público do MySQL de produção) e `BACKUP_DB_SSL_CA` = `ca.pem`
   público do servidor de produção (nunca `ca-key.pem`). Conferir o fingerprint SHA-256 por OpenSSL no console.
2. `AUDIT_DATABASE_URL` → `licigov_audit` e `AUDIT_DB_SSL_CA` (mesma CA do servidor).
3. Backup manual `target=production`, `run_restore_drill=false`: conferir no log `Alvo: production`,
   `TLS: VERIFY_CA`, versão do servidor, tamanho, checksum e artifact `db-backup-production`.
4. Auditoria `target=production`: ler o **relatório** (o job não falha por divergência — `|| true`); exigir
   "✅ Alinhado".

## 4. ▶ Prova de recuperação de produção (instância descartável)

Dados reais de Moreira Sales: a instância de destino é **projeto Railway separado**, privado, só o Owner, sem app,
sem proxy até o drill, banco `licigov_restore_drill`. O script **não** prova que a instância é descartável (só que
o banco está vazio): identificação, acesso restrito e descarte são do operador.

1. Criar o destino (MySQL compatível com a versão de produção), conferir UUID ≠ origem e 0 tabelas.
2. Abrir o proxy TCP só durante o drill; secrets `RESTORE_TARGET_URL` (banco `licigov_restore_drill`) e
   `RESTORE_DB_SSL_CA` (CA **do destino**, fingerprint conferido; diferente da CA de produção).
3. Backup `target=production`, `run_restore_drill=true`. Conferir: alvo, checksum, `VERIFY_CA` no destino, destino
   vazio, restauração, tabelas, journal de migrations, checagens de consistência, artifact com **PASS**. As checagens
   são mínimas — não equivalem a homologação de isolamento da aplicação. Não exibir registros.
4. Preservar evidência (run, SHAs, checksum) e só então: fechar proxy, excluir o projeto descartável (com volume) e
   remover `RESTORE_TARGET_URL`/`RESTORE_DB_SSL_CA`. Falha ⇒ fechar proxy, preservar o destino para diagnóstico.

## 5. ▶ Troca dos consumidores do app de produção

Pré-condição: §3 e §4 com PASS. No serviço do app em **production**, aplicar **num único deploy**:
`DATABASE_URL` → `mysql://licigov_app:<cofre>@<host privado>:3306/<banco>` (mesmos host privado e banco da
`DATABASE_URL` atual) e `MIGRATION_DATABASE_URL` → mesma forma com `licigov_migrator`. Validar sem escrita em dados reais:
log do pre-deploy `conexão: MIGRATION_DATABASE_URL`, migrations em dia, reference data concluído,
`Schema validado`, nenhum `command denied`, `/readyz` 200, login de um usuário autorizado. Qualquer escrita de
validação só em tenant sintético **explicitamente identificado** em produção, se existir — nunca na org 1.
Identidade do runtime: `processlist` (usuário por conexão) no console do MySQL de produção.

## 6. ▶ Regenerate do root de produção

Só após §5 verde: MySQL → Database → Config → Connection → **Regenerate** (mantém variável e banco sincronizados;
não editar `MYSQL_ROOT_PASSWORD` isoladamente nem `ALTER USER` avulso). Nova senha direto no cofre. Redeploy do app;
repetir §5; backup e auditoria de produção de novo. Registrar `password_last_changed` de `root@%`/`root@localhost`
e ausência de senha secundária. Teste negativo da senha antiga: planejar **antes** (sessão separada que tente a
senha anterior após o Regenerate sem mantê-la em arquivo); se não for possível, registrar NOT_TESTED.

## 7. Recuperação (nunca com a credencial antiga)

| Falha | Recuperação |
|---|---|
| App não sobe com `licigov_app` | `DATABASE_URL` → `licigov_migrator` temporariamente; registrar o privilégio faltante; corrigir `db-roles.ts` + smoke |
| Pre-deploy falha com `licigov_migrator` | GRANT justificado pela mensagem do MySQL; nunca `root` |
| Backup/auditoria falham | Corrigir conta/TLS/CA; nunca texto puro nem `root`; backups anteriores retidos 14 dias |
| Backup agendado falha logo após o merge | TLS ausente no servidor ou `BACKUP_ENCRYPTION_KEY` ausente: corrigir a causa; não reverter a cifra/TLS |
| Regenerate quebrou um consumidor | Dependência não mapeada do root: conta própria para esse consumidor; não reverter a senha |

## 8. Dependências e ordem com a release #337

- Este backport traz para `main` exatamente os scripts/workflows validados em staging (#317 + #338) e o
  `MIGRATION_DATABASE_URL` opcional; nada de domínio, routers ou frontend.
- A #337 (staging → main) contém o suporte à URL de migrations mas não a correção TLS do destino (#338). Se for
  promovida depois deste backport, os arquivos em comum devem resolver para a versão mais nova (a de staging).
- Fora deste roteiro: JWT, Gemini, AWS, Brevo e conta admin (rotação própria); isolamento total de
  `MIGRATION_DATABASE_URL` (serviço separado de migrations — backlog); fixar a tag da imagem MySQL (hoje `mysql:9`).
