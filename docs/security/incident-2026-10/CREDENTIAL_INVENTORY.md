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
| Banco | Serviço `MySQL` (`e6b7a98f-…`), imagem `mysql:9`, volume `mysql-volume`, rede privada `mysql` | **proxy TCP público ATIVO** em prod (`autorack.proxy.rlwy.net`) e staging (`shortline.proxy.rlwy.net`) |
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
| `DATABASE_URL` | credencial de banco | app + pre-deploy de migrations | ✓ | ✓ | **Não comprovada** (indício contrário: backup via mesma origem segue OK) |
| `GEMINI_API_KEY` | chave de API (IA/cloud — padrão buscado pelo atacante) | `server/config/ai.ts` | ✓ | ✓ | **Não comprovada** |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | chave de API cloud | `server/storage.ts` | ✓ | ✓ | **Não comprovada** |
| `BREVO_API_KEY` | chave de API | `server/services/email/*` | ✓ | ✓ | **Não comprovada** |
| `ADMIN_PASSWORD` | senha | **nenhum consumidor** no código atual (só exigida no boot) — correção nesta auditoria | ✓ | ✓ | Excluir após deploy da correção |
| `A2_HOMOLOG_TOKEN` | token | **nenhum consumidor** no código atual | — | ✓ | Excluir |
| `LICIGOV_STAGING_SMOKE_PASSWORD` | senha de usuário sintético | executor de homologação | — | ✓ | Trocar pela aplicação |

Não-segredos (não rotacionar): `APP_BASE_URL`, `APP_ENV`, `AWS_S3_BUCKET`, `AWS_S3_REGION`,
`BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `EMAIL_ENABLED`, `EMAIL_PROVIDER`, `AI_MODEL`, `AI_MAX_ATTEMPTS`,
`AI_TIMEOUT_MS`, `A2_HOMOLOG_ON_BOOT`, `A3_HOMOLOGATION_RUN`, `A3_HOMOLOGATION_RUN_ID`,
`LICIGOV_STAGING_SMOKE_EMAIL`.

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
| `BACKUP_ENCRYPTION_KEY` | `db-backup.yml` | Material de criptografia; não estava no Railway |
| `AUDIT_DATABASE_URL` | `schema-audit.yml` (manual) | Credencial de banco |
| `GEMINI_API_KEY` | `ai-models.yml` (manual) | Documentado como "a mesma chave de produção" → separar |
| `RESTORE_TARGET_URL` | `db-backup.yml` (drill manual) | Banco descartável |

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

- `vol-screener` (criado em 21/10 01:44Z, dentro da janela do ataque): criado pela conta do Owner a partir do
  repo `LeandroCardoso-cmyk/vol-screener` ("Screener de volatilidade - versão inicial"). Provável legítimo —
  **confirmar com o Owner**.
