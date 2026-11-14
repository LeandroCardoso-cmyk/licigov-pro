# Runbook de rotação e recuperação — pós-incidente Railway (out/2026)

> **Revisão 2 (25/10/2026)** — substitui a revisão 1 do mesmo dia. Mudanças: nenhum rollback reutiliza
> credencial potencialmente exposta; senha do `root` trocada pelo **Regenerate** da Railway (via suportada);
> contas MySQL separadas por função, ensaiadas em MySQL 9.7.4; acesso SQL real mapeado (sem presumir aba SQL);
> nenhuma conta/token é excluído sem identificar dono e função; CloudTrail com cobertura real.
>
> **Nenhum valor de credencial aparece aqui.** Valores novos são gerados no próprio provedor/banco e colados
> só no destino (Railway, GitHub Secrets). Nunca em chat, PR, issue, log ou documento.
>
> Checklist operacional curto: [`CONTAINMENT_CHECKLIST.md`](./CONTAINMENT_CHECKLIST.md). Inventário:
> [`CREDENTIAL_INVENTORY.md`](./CREDENTIAL_INVENTORY.md). Este runbook prevalece sobre as seções de rollback de
> [`../PR_A_SECRET_ROTATION_RUNBOOK.md`](../PR_A_SECRET_ROTATION_RUNBOOK.md) para segredos do incidente.

## 0. Princípios

- **Prioridade:** não há comprovação suficiente de rotação pós-incidente. Isso **não** prova comprometimento
  nem ausência de rotação; justifica a contenção imediata. Uma rotação feita depois de 20/10 13:58Z e
  comprovada no console é creditada e **não** é repetida sem motivo.
- **Nunca restaurar segredo potencialmente exposto** para recuperar disponibilidade. Recuperação = credencial
  **nova**, permissões corretas e configuração/código compatíveis. Em abuso ativo, revogar primeiro e avaliar o
  impacto depois.
- **Uma credencial por vez**, na ordem dos consumidores; validar antes de revogar a anterior quando o provedor
  suporta sobreposição (chaves de API, contas de banco novas). Staging antes de produção; valores diferentes
  por ambiente.
- **Não excluir conta, token ou chave só porque não foi reconhecido** numa leitura: identificar dono, função
  e dependências; preservar contas internas; exclusão é decisão operacional específica do Owner.
- Toda ação abaixo em produção/staging é **mutação operacional** → executar só com aprovação explícita.

| Tipo | Itens | Particularidade |
|---|---|---|
| Credencial de banco | `root`, contas novas `licigov_*`, `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BACKUP_DATABASE_URL`, `AUDIT_DATABASE_URL` | Contas novas convivem com a antiga ⇒ troca sem janela; o `root` muda por último |
| Chave de API | `GEMINI_API_KEY`, `AWS_*`, `BREVO_API_KEY` | Criar nova → trocar → validar → revogar antiga |
| Chave de assinatura | `JWT_SECRET` | Sem versionamento de chave no código: a troca invalida **todas** as sessões. A chave suspeita **nunca** volta a ser aceita, nem como "anterior" |
| Material de criptografia | `BACKUP_ENCRYPTION_KEY` (só GitHub; não estava na Railway) | Não exige troca pelo incidente. Se trocar: manter a antiga no cofre até expirar a retenção (14 dias) para restaurar backups antigos |
| Senha de usuário | admin de plataforma, `LICIGOV_STAGING_SMOKE_PASSWORD` | Trocar pela aplicação (reset ⇒ `tokenVersion` revoga sessões) |

## 1. Acesso real disponível (sem presumir console SQL)

Docs oficiais da Railway (consultadas em 25/10): o painel do banco oferece **Table View / Entries View** e, em
**Config → Connection**, o **Regenerate** da senha do usuário do template — não há console SQL documentado.
Editar só a variável de senha **não** muda a senha no banco; só `ALTER USER` **não** muda a variável: as duas
coisas dessincronizam e derrubam as conexões. Para SQL arbitrário (CREATE USER/GRANT), as vias são:

1. **`railway ssh`** no serviço `MySQL` do ambiente e o cliente `mysql` **dentro do container**, autenticando
   com a variável já presente lá (`MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot` — o texto digitado não
   contém a senha). Preferida: nada atravessa a máquina do operador além do terminal.
2. **`railway connect MySQL --environment <env>`** numa máquina confiável do Owner com cliente `mysql`
   (via proxy público ou túnel `--ssh`).

Em ambos: criar contas com `CREATE USER … IDENTIFIED BY '<senha>'`, a senha gerada no **cofre do operador** (40
caracteres alfanuméricos) e colada — rev. 4: `IDENTIFIED BY RANDOM PASSWORD` (ensaiado em 9.7.4) pode gerar
pontuação, e as senhas vão dentro de URLs `mysql://…` (o `mysql2` decodifica percent-encoding; o `db-backup.sh` usa a
senha literal). O `--histignore` padrão do cliente não grava `IDENTIFIED`/`PASSWORD` no histórico. Canal completo
no checklist §1.

## 2. MySQL — contas separadas por função

### 2.1 Mecanismo real (verificado no código)

- O **boot não migra**: só valida o schema (INFORMATION_SCHEMA + `__drizzle_migrations`). DDL só ocorre no
  pre-deploy `pnpm db:release:predeploy` = (1) `db:migrate:release` (DDL) + (2) reference data (DML).
- A Railway roda o pre-deploy num container separado **com as variáveis do serviço** — hoje a mesma
  `DATABASE_URL` do runtime.
- Com esta PR: `db:migrate:release` usa `MIGRATION_DATABASE_URL` se definida (senão `DATABASE_URL`). Limite:
  o pre-deploy roda com as mesmas variáveis do serviço, então o processo da aplicação também recebe essa
  variável — a separação restringe o que o código usa, não isola o segredo (checklist §3). O reference
  data continua na `DATABASE_URL`. Limitação: a variável de migrations fica no mesmo serviço (um RCE no
  processo do app ainda a leria); o ganho é que uma injeção SQL/ORM no runtime não executa DDL. Isolamento
  total exigiria um serviço separado só para migrations (backlog).

### 2.2 Privilégios (fonte única: `scripts/ops/db-roles.ts`; plano sem senhas: `pnpm db:roles:plan <banco>`)

| Conta | Banco | Global | TLS | Consumidor | Por quê |
|---|---|---|---|---|---|
| `licigov_app` | SELECT, INSERT, UPDATE, DELETE | — | rede privada | `DATABASE_URL` (runtime + reference data) | DML; `FOR UPDATE` exige UPDATE |
| `licigov_migrator` | SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE | — | rede privada | `MIGRATION_DATABASE_URL` (pre-deploy) | 320 migrations: tabelas, índices, FKs, procedures temporárias (`DROP PROCEDURE IF EXISTS` exige ALTER ROUTINE); sem EXECUTE (o criador recebe automaticamente) |
| `licigov_backup` | SELECT, SHOW VIEW, TRIGGER, EVENT | SHOW_ROUTINE | `REQUIRE SSL` | `BACKUP_DATABASE_URL` | **Sem SHOW_ROUTINE o mysqldump omite procedures em silêncio** (ensaiado) |
| `licigov_audit` | REFERENCES | — | `REQUIRE SSL` | `AUDIT_DATABASE_URL` | Só metadados; SELECT nos dados é negado (ensaiado) |

### 2.3 Ensaio já realizado (local, sintético, 25/10)

MySQL **9.7.4** (imagem oficial que `mysql:9` resolve hoje) e 8.0.46: as 320 migrations do zero + replay com
`licigov_migrator`; boot da aplicação, `/readyz`, login, criação de órgão e de processo com `licigov_app`;
`db:audit` com `licigov_audit`; backup cifrado com `licigov_backup` (cliente mysqldump 8.0.46, TLS 1.3,
`VERIFY_CA` com a CA do servidor) e restore em banco isolado com `CHECKSUM TABLE` idêntico em 345/345 tabelas.
Revisão 3 (26/10): backup de "staging" → drill numa segunda instância pelo seletor de ambiente
(`scripts/ops/select-db-target.sh`), 345 tabelas e 320 migrations; `db:audit` com CA fixada (CA de outra
instância ⇒ recusado). `VERIFY_CA` = CA fixada, **sem** conferência de hostname (ver checklist §1/§3 e `AUDIT_REPORT.md` §7).
Smoke equivalente na CI: `sec-db-least-privilege-mysql-smoke.test.ts`.

**Lacuna:** a versão exata do MySQL em execução na Railway não está nos logs retidos (deploy de 19/09; tag
`mysql:9` fixada por SHA no deploy, auto-update "vuln"). O novo backup registra `VERSION()` a cada execução;
conferir no primeiro run e repetir o ensaio se for < 8.0.20 (sem `SHOW_ROUTINE`) — improvável em `mysql:9`.

### 2.4 Sequência (staging primeiro; produção só após staging verde)

Passo a passo com IDs, confirmação do alvo e autorização coordenada: [`CONTAINMENT_CHECKLIST.md`](./CONTAINMENT_CHECKLIST.md)
(rev. 4). Resumo, em staging:

1. Leituras sem segredo (versão, contas/grants, forma da `DATABASE_URL`, Regenerate disponível) — checklist §2.
2. Integrar a PR no ambiente (workflows com `target` e `MIGRATION_DATABASE_URL` vêm dela) — §5.
3. Criar as quatro contas com senhas alfanuméricas geradas no cofre do operador (canal do §1; não
   `RANDOM PASSWORD`, que pode gerar pontuação incompatível com as URLs) e aplicar os GRANTs do plano — §6.
4. Secrets `STAGING_*` (nunca reapontar os de produção); backup e auditoria pelo ref `staging` com
   `target = staging`; **drill com os dados reais de staging** numa instância descartável separada, com TLS
   `VERIFY_CA` pela CA **do destino** (`STAGING_RESTORE_DB_SSL_CA`) — §7. Só
   depois disso a recuperação está comprovada.
5. `DATABASE_URL` → `licigov_app`, `MIGRATION_DATABASE_URL` → `licigov_migrator`; deploy e validação; então
   **Regenerate** do root — §8.
6. Produção: mesma sequência, com autorização própria e após a promoção staging → main.
7. Contas que sobrarem em `mysql.user` (além de `root` e das internas `mysql.sys`, `mysql.session`,
   `mysql.infoschema`): listar dono/função/dependência e decidir caso a caso. Não excluir na rotina.

### 2.5 Recuperação (sem credencial antiga)

| Falha | Recuperação |
|---|---|
| App não sobe com `licigov_app` (privilégio faltando) | Apontar `DATABASE_URL` temporariamente para `licigov_migrator` (nova, mais privilégio) e registrar o privilégio faltante; ajustar `db-roles.ts` + smoke antes de voltar |
| Pre-deploy falha com `licigov_migrator` | Corrigir o GRANT justificado (ver mensagem do MySQL) e redeploy; não usar `root` |
| Backup falha após a troca | Corrigir a conta/TLS; **nunca** voltar a texto puro nem ao `root`; o backup anterior continua retido por 14 dias |
| Regenerate do `root` quebrou algo | Sinal de dependência não mapeada do `root`: criar conta própria para esse consumidor; não reverter a senha |

## 3. `JWT_SECRET` (chave de assinatura)

- Gerar ≥ 48 bytes aleatórios (`openssl rand -base64 48`) direto no campo da variável; valores distintos em
  staging e produção. Deploy. **Efeito:** todas as sessões caem (TTL 24 h) — avisar os usuários do órgão.
- Validar: cookie antigo ⇒ não autenticado; login novo ok.
- Não há janela de sobreposição: o código só aceita uma chave. Rotação planejada futura com duas chaves é
  backlog e **nunca** pode aceitar uma chave suspeita como "anterior".
- Dependências: nenhum outro serviço valida estes JWTs. Convites/reset usam tokens opacos no banco (não dependem
  da chave).

## 4. `GEMINI_API_KEY`

- Criar **uma chave por consumidor** (produção, staging, workflow `ai-models.yml`), restrita à Generative
  Language API, num projeto GCP **ativo**. Atenção: em 08/10 o Google avisou que a conta de faturamento do
  projeto "LiciGov Pro - Staging" estava vencida e o projeto em risco de suspensão — não há evidência posterior
  de regularização; se estiver suspenso, a chave nova de staging precisa de outro projeto/conta ativa.
- Trocar, deploy, validar (staging: gerar um DFD no tenant sintético; produção: só o boot `AI=✓`), revogar a
  antiga.
- Consumo 20/10 → hoje: Cloud Console → APIs & Services → Generative Language API → Metrics por credencial.
- Mesma conta Google do SincroSaúde: se a chave/projeto for compartilhado, coordenar com aquela frente.

## 5. AWS S3 (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)

- IAM: criar a nova chave (até 2 ativas por usuário), trocar, deploy, validar upload/download no tenant
  sintético (staging) e um download em produção, **desativar** a antiga; excluir após 48 h sem erro.
- Política mínima: Get/Put/DeleteObject e ListBucket só no bucket da aplicação; Block Public Access ligado.
- **Cobertura de logs (real):** `iam get-access-key-last-used` (data, serviço e região do último uso) está
  sempre disponível. CloudTrail **Event history** cobre só eventos de **gerenciamento** dos últimos 90 dias;
  `GetObject`/`PutObject` são **eventos de dados** do S3 e só existem se havia uma trail com data events
  habilitada **antes** de 20/10 (ou S3 server access logging no bucket). Habilitar agora não recupera o período —
  registrar como lacuna se não havia.

## 6. `BREVO_API_KEY`

- Criar nova chave (SMTP & API), restringir por IP se o plano permitir, trocar, deploy, validar um e-mail de
  recuperação para o Owner, excluir a antiga. Revisar *Transactional → Logs* desde 20/10 conforme a retenção do
  plano. O SincroSaúde também usa `BREVO_API_KEY`: se for a mesma conta/chave, coordenar.

## 7. Conta admin de plataforma e `ADMIN_PASSWORD`

- Trocar a senha do admin pelo fluxo "Esqueci minha senha" (revoga sessões via `tokenVersion`). Motivo: o
  histórico público contém uma senha padrão antiga e o bootstrap antigo usava `ADMIN_PASSWORD`; não foi testado
  se a conta ainda usa alguma delas (teste de credencial não autorizado).
- Após o deploy desta PR, excluir `ADMIN_PASSWORD` de produção e staging (sem consumidor no código) — decisão
  do Owner registrada na atestação.

## 8. Staging

Mesma sequência, com valores próprios: `JWT_SECRET`, `GEMINI_API_KEY`, `BREVO_API_KEY`, `AWS_*`, contas MySQL do
MySQL de staging, `LICIGOV_STAGING_SMOKE_PASSWORD` (pela aplicação). `A2_HOMOLOG_TOKEN` não tem consumidor no
código atual: confirmar com o Owner antes de remover (pode haver uso operacional fora do repositório).

## 9. Depois da rotação

- Considerar **selar** (Seal) as variáveis rotacionadas: o valor deixa de ser legível pela UI/API (não pode ser
  desselado; `railway run`/`railway variables` não o entregam).
- Registrar a atestação no [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) §10.
