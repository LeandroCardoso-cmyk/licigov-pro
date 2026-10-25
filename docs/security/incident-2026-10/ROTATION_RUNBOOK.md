# Runbook de rotação e recuperação — pós-incidente Railway (out/2026)

> **Nenhum valor de credencial aparece neste documento** (nem novo, nem antigo). Gerar valores
> diretamente no console do provedor ou no terminal do operador; colar apenas no destino (Railway,
> GitHub Secrets). Nunca em chat, PR, issue, log ou documento.
>
> Complementa (não substitui) [`../PR_A_SECRET_ROTATION_RUNBOOK.md`](../PR_A_SECRET_ROTATION_RUNBOOK.md)
> e [`../G5_SECRET_READINESS_AUDIT.md`](../G5_SECRET_READINESS_AUDIT.md). Inventário em
> [`CREDENTIAL_INVENTORY.md`](./CREDENTIAL_INVENTORY.md).

## 0. Princípios

- **Não rotacionar tudo indiscriminadamente.** Só segredos (ver inventário). `APP_ENV`, `AWS_S3_BUCKET`,
  `BREVO_SENDER_*`, `AI_MODEL`, `MYSQLHOST` etc. não são segredos.
- **Não repetir rotação concluída e funcional** sem motivo. Motivo aqui: o workspace foi notificado pela
  Railway (23/10) como compatível com o padrão de busca do atacante; a janela do ataque foi
  20/10 13:58Z → 22/10 03:32Z. Toda credencial presente no Railway **nessa janela** e não trocada depois é
  tratada como potencialmente exposta. Rotações feitas **antes** de 20/10 (ex.: `JWT_SECRET` em 21/09) não
  cobrem o incidente.
- **Revogação preventiva da Railway (24/10):** provedores (OpenAI/Anthropic confirmados) revogaram chaves
  por hash, inclusive substitutas. O LiciGov usa **Gemini (Google)** — se uma chave nova parar de funcionar,
  criar outra; não é indício de novo comprometimento.
- **Ordem por consumidor**, uma credencial por vez, com validação antes de revogar a anterior.
- **Staging e produção nunca compartilham credencial.** Cada ambiente recebe valor próprio.
- Toda ação em produção abaixo é **mutação operacional** → executar só com aprovação do Owner.

Tipos de material e efeito da troca:

| Tipo | Variáveis | Efeito da troca |
|---|---|---|
| Senha/credencial de serviço | `DATABASE_URL` (senha embutida), `MYSQL_*PASSWORD`, `BACKUP_DATABASE_URL`, `AUDIT_DATABASE_URL` | Precisa coordenar todos os consumidores; janela curta |
| Token/chave de API | `GEMINI_API_KEY`, `BREVO_API_KEY`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `A2_HOMOLOG_TOKEN` | Criar nova → trocar → validar → revogar antiga |
| Chave de assinatura | `JWT_SECRET` | Invalida **todas** as sessões (relogin). Sem versionamento de chave no código: troca é imediata |
| Material de criptografia | `BACKUP_ENCRYPTION_KEY` (só GitHub) | Trocar **não** recifra backups antigos; guardar a anterior em cofre até expirar a retenção (14 dias) |
| Senha de usuário | conta admin de plataforma; `LICIGOV_STAGING_SMOKE_PASSWORD` | Trocar pela própria aplicação (reset ⇒ `tokenVersion` revoga sessões) |

## 1. Pré-checagem (somente leitura, 10 min)

1. Railway → projeto `licigov-pro` → **production** → serviço `licigov-pro` → Variables: anotar quais
   variáveis são **referências** (`${{MySQL.…}}`) e quais são valores literais. Repetir em **staging**.
2. Railway → Account → Tokens: listar tokens de API ativos; revogar os não reconhecidos.
3. GitHub → Settings → Security log (conta) e repo → Settings → Secrets: confirmar a lista
   `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `AUDIT_DATABASE_URL`, `GEMINI_API_KEY`, `RESTORE_TARGET_URL`.
4. GitHub → Settings → Applications: a Railway revogou instalações do GitHub App por precaução. Os deploys
   de 23–24/10 indicam reconexão; confirmar que o app instalado é o oficial e o escopo está restrito aos repos usados.

## 2. MySQL de produção (maior prioridade)

**Consumidores conhecidos:** app produção (`DATABASE_URL`); GitHub Actions `db-backup.yml`
(`BACKUP_DATABASE_URL`, via proxy TCP público) e `schema-audit.yml` (`AUDIT_DATABASE_URL`); pre-deploy
(`pnpm db:release:predeploy`, mesmo `DATABASE_URL`); eventuais `.env` locais do Owner.

**Evidência atual:** backup diário via proxy público teve sucesso em 21, 22, 23, 24 e **25/10** e o app não
teve redeploy em produção após 23/10 12:54Z ⇒ é provável que a credencial **não** tenha sido trocada após o
incidente. Confirmar no console.

Sequência (janela sugerida: madrugada BRT; produção hoje tem tráfego quase nulo):

1. Conectar ao MySQL de produção pelo console da Railway (aba Data/Query) — **não** pelo proxy público de
   uma máquina não confiável.
2. Criar usuários dedicados de menor privilégio (em vez de `root` para tudo):
   - `licigov_app` — `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, CREATE ROUTINE,
     ALTER ROUTINE, EXECUTE, TRIGGER, LOCK TABLES` no banco da aplicação (o release de migrations precisa de DDL;
     revisar se algum passo exige mais e ajustar no staging primeiro);
   - `licigov_backup` — `SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES` (suficiente para
     `mysqldump --single-transaction --routines --triggers --events --no-tablespaces`).
   Senhas geradas no terminal do operador (ex.: `openssl rand -base64 36`), coladas direto no destino.
3. **Ensaiar em staging** os passos 2–5 (staging tem MySQL próprio, mesmo template).
4. Produção: trocar `DATABASE_URL` do serviço `licigov-pro` para `licigov_app` no host **privado**
   (`mysql.railway.internal`). Deploy. Validar `/readyz` 200, log de boot `Schema validado`, login.
5. GitHub: trocar `BACKUP_DATABASE_URL` para `licigov_backup`; rodar "Backup do Banco" manualmente
   (agora com `--ssl-mode=REQUIRED`); confirmar artifact cifrado. Trocar `AUDIT_DATABASE_URL` idem
   (usuário somente leitura).
6. Trocar a senha de `root` (`ALTER USER 'root'@'%' IDENTIFIED BY …`) e atualizar `MYSQL_ROOT_PASSWORD`,
   `MYSQLPASSWORD`, `MYSQL_URL`, `MYSQL_PUBLIC_URL` do serviço MySQL para refletir o valor novo (a Railway
   **não** troca a senha do banco ao editar a variável; o `ALTER USER` é o que vale).
7. Remover qualquer outro usuário antigo/desconhecido (`SELECT user, host FROM mysql.user;`).
8. Rollback: se o app não subir, voltar `DATABASE_URL` à credencial anterior **por no máximo a janela de
   diagnóstico**, corrigir grants e repetir. Nunca reverter a senha de `root`.
9. Follow-up (P1): eliminar o proxy TCP público movendo o backup para dentro da Railway (serviço cron na
   rede privada) ou restringir o uso a um usuário de backup somente leitura; avaliar o mesmo para staging.

**Evidência esperada:** print/nota do `/readyz`, ID do deploy, ID do run de backup com sucesso após a troca,
lista de usuários do MySQL (só nomes/hosts), data/hora. Sem senhas.

## 3. `JWT_SECRET` (chave de assinatura — produção e staging separados)

1. Gerar ≥ 48 bytes aleatórios no terminal do operador (`openssl rand -base64 48`).
2. Railway produção → `JWT_SECRET` → salvar → deploy. Todas as sessões caem (TTL padrão 24 h).
3. Validar: sessão antiga recebe 401/“sessão inválida”; login novo funciona.
4. Repetir em staging com **outro** valor.
5. Não há compatibilidade a manter (sem `kid`/rotação dupla no código). Backlog P3: suportar duas chaves
   (atual + anterior) para rotação sem logout geral.

## 4. `GEMINI_API_KEY` (Google AI Studio / Cloud)

1. AI Studio → API keys: identificar o projeto GCP de cada chave. Criar **uma chave por ambiente**
   (produção, staging, GitHub Actions `ai-models.yml`), restrita à *Generative Language API*.
2. Railway produção/staging e GitHub Secret `GEMINI_API_KEY`: atualizar. Deploy.
3. Validar em staging: gerar um DFD de teste no tenant sintético `homologacao-sintetica`; em produção, apenas
   o log de boot `AI=✓` (sem gerar documento em órgão real).
4. Revogar a chave antiga no console.
5. **Consumo:** Cloud Console → APIs & Services → Generative Language API → Metrics, de 20/10 até hoje, por
   chave/credencial. Os logs da Railway mostram produção quase ociosa desde 22/10 — consumo relevante nesse
   período é sinal de abuso.
6. Verificar se a mesma chave/projeto é usada pelo SincroSaúde (mesmo e-mail do AI Studio). Se for, a rotação
   precisa ser coordenada com aquela frente — **não alterar o SincroSaúde a partir daqui**.

## 5. AWS S3 (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)

1. IAM → usuário da aplicação → *Create access key* (manter a antiga ativa por enquanto).
2. Confirmar política mínima: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` apenas no
   bucket da aplicação; bucket com *Block Public Access* ligado.
3. Railway produção (e staging, chave própria): atualizar; deploy; validar upload/download de anexo no tenant
   sintético em staging e um download em produção.
4. Desativar a chave antiga; após 48 h sem erro, excluir.
5. CloudTrail: eventos da chave antiga desde 20/10 (IPs fora da Railway, `ListBuckets`, `GetObject` em massa).

## 6. `BREVO_API_KEY`

1. Brevo → SMTP & API → API keys: criar nova; habilitar restrição de IP se o plano permitir.
2. Railway produção/staging: atualizar; deploy; validar envio de recuperação de senha para o e-mail do Owner.
3. Excluir a chave antiga. Revisar *Transactional → Logs* desde 20/10 (envios não reconhecidos).
4. O SincroSaúde também tem `BREVO_API_KEY`: se for a mesma conta/chave, coordenar.

## 7. Conta admin de plataforma e `ADMIN_PASSWORD`

- O histórico **público** do repositório contém (a) uma senha padrão de admin hardcoded (abr/2026) e
  (b) o código antigo de bootstrap que criava o admin com `ADMIN_PASSWORD`. Se a senha da conta admin nunca
  foi trocada desde a criação, ela é igual a um desses valores.
- Ação: trocar a senha do admin de plataforma pelo fluxo "Esqueci minha senha" (revoga sessões via
  `tokenVersion`), usando senha nova e única.
- Após o deploy da correção desta auditoria (`ADMIN_PASSWORD` deixa de ser exigida), **excluir**
  `ADMIN_PASSWORD` de produção e staging — não há consumidor.

## 8. Staging

`LICIGOV_STAGING_SMOKE_PASSWORD` (trocar pela aplicação), `A2_HOMOLOG_TOKEN` (sem consumidor no código
atual → excluir), `JWT_SECRET`, `GEMINI_API_KEY`, `BREVO_API_KEY`, `AWS_*`, `DATABASE_URL` — valores próprios,
nunca iguais aos de produção.

## 9. Encerramento

Registrar no [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) (seção "Atestação operacional"), por credencial:
responsável, data/hora UTC, ID do deploy, método de validação, revogação da anterior confirmada (sim/não).
Somente então os critérios correspondentes do [`ROADMAP.md`](./ROADMAP.md) passam a "validado em ambiente".
