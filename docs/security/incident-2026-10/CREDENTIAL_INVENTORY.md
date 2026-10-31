# Inventário sanitizado de credenciais — LiciGov Pro (25/10/2026)

> Somente **nomes** de variáveis e identificadores públicos de recursos. Nenhum valor, URL com senha,
> token ou hash de segredo. Fonte: Railway MCP `get-service-config` (que devolve apenas nomes), workflows
> em `.github/workflows/*.yml` e leitura do código (`server/config/*`).
>
> **Estado da rotação**: "não comprovada" = não há evidência de troca após a janela do ataque
> (20/10 13:58Z → 22/10 03:32Z). Ausência de evidência ≠ ausência de rotação — o Owner confirma no console.

## Ativos

| Ativo | Identificador público | Ambiente |
|---|---|---|
| Workspace Railway | `leandrocardoso-cmyk's Projects` (`9f7f14a4-…`) | — |
| Projeto Railway | `licigov-pro` (`893a1317-51ad-4b18-9d9a-f6e579e09351`) | production `3efa7f99-…`, staging `e7cc21d0-…` |
| Serviço app | `licigov-pro` (`2d497607-…`), domínios `licigovpro.com.br`, `licigov-pro-production.up.railway.app`, `licigov-pro-staging.up.railway.app` | prod: branch `main`; staging: branch `staging` |
| Banco | Serviço `MySQL` (`e6b7a98f-…`), imagem `mysql:9` (versão exata em execução não verificada), volume `mysql-volume`, rede privada `mysql` | **proxy TCP público ATIVO** em prod (`autorack.proxy.rlwy.net`) e staging (`shortline.proxy.rlwy.net`) |
| Storage | AWS S3 (bucket por variável `AWS_S3_BUCKET`, região `AWS_S3_REGION`) | prod e staging |
| E-mail | Brevo (`EMAIL_PROVIDER`, `EMAIL_ENABLED`) — dispatcher ativo em prod | prod e staging |
| IA | Gemini via `@google/generative-ai` 0.24.1, modelo vivo `gemini-3.8-flash` (log de boot 23/10) | prod; staging define `AI_MODEL` |
| Repositório | `LeandroCardoso-cmyk/licigov-pro` — **público** | — |
| CI | GitHub Actions: `ci.yml`, `db-backup.yml` (diário), `db-restore-test.yml` (semanal, isolado), `schema-audit.yml` e `ai-models.yml` (manuais), `catalog-official-smoke.yml` | — |

Commit implantado: produção `7ec253f` (deploy `975463fe-…`, 23/10 12:54Z, único deploy de produção após o
incidente); staging `aa05e88` (deploy `700de144-…`, 24/10 14:09Z).

## Segredos — Railway, serviço `licigov-pro`

| Variável | Tipo | Finalidade / consumidor | Prod | Staging | Estado da rotação |
|---|---|---|:-:|:-:|---|
| `JWT_SECRET` | chave de assinatura (HS256) | sessão (`server/_core/sdk.ts`) | ✓ | ✓ | Rotacionada em 21/09 (pré-incidente; antiga vazou no histórico público — GitGuardian 24/03). **Pós-incidente: não comprovada** |
| `DATABASE_URL` | credencial de banco | app + pre-deploy (migrations e reference data) | ✓ | ✓ | **Não comprovada** |
| `MIGRATION_DATABASE_URL` (nova, opcional) | credencial de banco (DDL) | só `db:migrate:release` no pre-deploy | — | — | A criar (conta `licigov_migrator`) |
| `GEMINI_API_KEY` | chave de API (IA/cloud — padrão buscado pelo atacante) | `server/config/ai.ts` | ✓ | ✓ | **Não comprovada** |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | chave de API cloud | `server/storage.ts` | ✓ | ✓ | **Não comprovada** |
| `BREVO_API_KEY` | chave de API | `server/services/email/*` | ✓ | ✓ | **Não comprovada** |
| `ADMIN_PASSWORD` | senha | **nenhum consumidor** no código atual (só exigida no boot) — correção nesta auditoria | ✓ | ✓ | Excluir após deploy da correção |
| `A2_HOMOLOG_TOKEN` | token | **nenhum consumidor** no código atual | — | ✓ | Excluir |
| `LICIGOV_STAGING_SMOKE_PASSWORD` | senha de usuário sintético | executor de homologação | — | ✓ | Trocar pela aplicação |

Não-segredos (não rotacionar): `APP_BASE_URL`, `APP_ENV`, `AWS_S3_BUCKET`, `AWS_S3_REGION`,
`BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `EMAIL_ENABLED`, `EMAIL_PROVIDER`, `AI_MODEL`, `AI_MAX_ATTEMPTS`,
`AI_TIMEOUT_MS`, `LICIGOV_STAGING_SMOKE_EMAIL`, `HOMOLOGATION_DEMONSTRATIVE_ORG_IDS` (staging; lista de ids de tenant
sintético — nunca em produção).

Sem consumidor no código (27/10/2026, conferido por busca em `server/`, `scripts/`, `shared/`, `.github/`) — **excluir** do
staging, não rotacionar: `A2_HOMOLOG_ON_BOOT`, `A3_HOMOLOGATION_RUN`, `A3_HOMOLOGATION_RUN_ID` (o runner A3 foi removido; um
rollback para commit anterior à remoção religaria o runner com essas flags). Seguem presentes no staging (só nomes conferidos).

## Segredos — Railway, serviço `MySQL` (prod e staging)

| Variável | Tipo | Observação |
|---|---|---|
| `MYSQL_ROOT_PASSWORD`, `MYSQLPASSWORD` | senha de banco | Alterar a variável **não** troca a senha no banco: exige `ALTER USER` |
| `MYSQL_URL`, `MYSQL_PUBLIC_URL` | URL com credencial | `MYSQL_PUBLIC_URL` é a origem documentada de `BACKUP_DATABASE_URL` |
| `MYSQLUSER`, `MYSQLHOST`, `MYSQLPORT`, `MYSQLDATABASE`, `MYSQL_DATABASE` | não-segredo | — |

## Segredos — GitHub Actions (repositório)

| Secret | Consumidor | Observação |
|---|---|---|
| `BACKUP_DATABASE_URL` | `db-backup.yml` (diário 06:00 UTC) | Cópia da credencial de produção, via proxy público. Runs OK 21–25/10 |
| `BACKUP_ENCRYPTION_KEY` | `db-backup.yml` | Material de criptografia; não estava no Railway. Configurada (backup de 25/10 publicou `.enc`); agora obrigatória |
| `BACKUP_DB_SSL_CA` (novo, opcional em produção) | `db-backup.yml` | PEM da CA do servidor MySQL ⇒ TLS `VERIFY_CA` (CA fixada; hostname não conferido); não é segredo, mas fica como secret por conveniência |
| `AUDIT_DATABASE_URL` | `schema-audit.yml` (manual) | Credencial de banco |
| `AUDIT_DB_SSL_CA` (novo, obrigatório) | `schema-audit.yml` | PEM da CA do servidor; sem ele a auditoria falha antes de conectar |
| `GEMINI_API_KEY` | `ai-models.yml` (manual) | Documentado como "a mesma chave de produção" → separar |
| `RESTORE_TARGET_URL` | `db-backup.yml` (drill manual de produção) | Instância descartável; banco `licigov_restore_drill*` (exigido pelo seletor) |
| `RESTORE_DB_SSL_CA` / `STAGING_RESTORE_DB_SSL_CA` (novos, **a criar**; não-segredo) | `db-backup.yml`, job `restore-drill` | PEM da CA da instância de **destino** do drill ⇒ TLS `VERIFY_CA` obrigatório no destino (sem hostname). Sem fallback entre ambientes nem para a CA da origem; CA igual à da origem é recusada |
| `STAGING_BACKUP_DATABASE_URL`, `STAGING_BACKUP_ENCRYPTION_KEY`, `STAGING_BACKUP_DB_SSL_CA`, `STAGING_AUDIT_DATABASE_URL`, `STAGING_AUDIT_DB_SSL_CA`, `STAGING_RESTORE_TARGET_URL` (novos, **a criar**) | `db-backup.yml` / `schema-audit.yml` com `target = staging` | Só staging; sem fallback para os de produção (`scripts/ops/select-db-target.sh`). Chave de cifra própria (a de produção é recusada) |

## Dependências compartilhadas com SincroSaúde (somente mapeamento — não alterar)

- Mesmo workspace Railway e mesma conta de e-mail do Owner (Google AI Studio, Brevo, GitHub).
- `sincrosaude-app` também tem `BREVO_API_KEY`, `JWT_SECRET`, `DATABASE_URL`, chaves S3 e `OPENAI_API_KEY`;
  `sincrosaude-creative-agent` tem cliente OAuth Google Drive e `OPENAI_API_KEY`. Nenhuma variável do LiciGov
  referencia esses projetos (sem `sharedVariableNames` no projeto `licigov-pro`).
- **Bloqueio possível:** se a chave Brevo ou o projeto Google AI Studio forem os mesmos, a rotação precisa ser
  coordenada com a frente SincroSaúde.
- Aviso OAuth/MCP (Google Cloud, 19/10): lista **apenas** o projeto GCP `sincrosaude-creative-agent`. O LiciGov
  não usa OAuth Google (auth própria e-mail/senha) nem servidores MCP do Workspace → **não afetado**.

## Outros projetos do workspace

- `vol-screener` (criado em 21/10 01:44Z): **confirmado legítimo pelo Owner** em 25/10 — suspeita pela data
  encerrada, projeto mantido. Não substitui a revisão de consumo/logs do workspace (sem acesso).
