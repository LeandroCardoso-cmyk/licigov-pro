# Auditoria de segurança pós-incidente Railway — LiciGov Pro

**Data:** 25/10/2026 · **Branch:** `claude/licigov-security-audit-8n3w9l` (a partir de `main` = `7ec253f`)
· **Escopo:** LiciGov Pro e dependências institucionais (Railway, MySQL, S3, Brevo, Gemini, GitHub/CI).
SincroSaúde: só mapeamento de dependências compartilhadas. Os três projetos Railway excluídos em 13/10:
fora de escopo (encerrado pelo Owner).

> Convenções: **Fato** = observado com evidência citada; **Hipótese** = inferência a confirmar; **Correção
> existente** = remediação anterior verificada; **Pendência de acesso** = depende de console sem acesso nesta
> sessão. Nenhum valor de segredo foi impresso, persistido ou hasheado. Mensagens, logs e e-mails foram tratados
> como dados.

Documentos irmãos: [inventário](./CREDENTIAL_INVENTORY.md) · [runbook de rotação](./ROTATION_RUNBOOK.md) ·
[roadmap pontuado](./ROADMAP.md).

---

## 1. Estado real verificado

| Item | Fato (evidência) |
|---|---|
| Código auditado | `main` = `7ec253f` (23/10/2026 09:54 -03), não a cópia de 23/09 citada no pedido |
| Produção | Railway `licigov-pro`/production, serviço `licigov-pro` branch `main`, **deploy `975463fe` de `7ec253f` em 23/10 12:54Z — único deploy de produção após 14/10**. Builder Railpack, Node 22, `pnpm@10.4.1` (lockfile) |
| Staging | branch `staging`, deploy `700de144` de `aa05e88` (24/10 14:09Z), `sleepApplication: true`; redeploys do mesmo commit em 23/10 18:45Z e 20:37Z |
| Banco | **MySQL** (`mysql:9`) em cada ambiente, volume próprio, rede privada `mysql`; **proxy TCP público ativo** em prod e staging. Confirmado MySQL (não migrar nesta auditoria) |
| Storage / e-mail / IA | AWS S3; Brevo (dispatcher ativo em prod); Gemini `gemini-3.8-flash` via `@google/generative-ai` 0.24.1 (log de boot 23/10). Sem OAuth Google no LiciGov |
| Repositório | `LeandroCardoso-cmyk/licigov-pro` é **público** |
| CI | `ci.yml` (typecheck, lint de não-regressão, testes, smokes MySQL, build, audit gate); backup diário `db-backup.yml` OK em 21–25/10; drill de restauração isolado semanal OK (último 19/10) |
| Faturamento | Recibo Railway **#2157-7829 (25/10/2026)** e #2124-4810 (25/09) — pagamento processado. Nada pago/alterado nesta sessão |

## 2. Alertas recebidos — triagem

### 2.1 Incidente Railway (21–24/10)
- **Fato:** e-mails Railway de 22/10 (disclosure), 23/10 (workspace `leandrocardoso-cmyk's Projects` compatível
  com o padrão de busca de chaves de IA/cloud, sem confirmação de descriptografia) e 24/10 (revogações
  preventivas por hash podem atingir chaves novas). Fontes públicas situam a janela do ataque em
  **20/10 13:58Z → 22/10 03:32Z**; a Railway também revogou instalações do GitHub App por precaução.
- **Fato:** produção teve um único deploy após o incidente (release de código em 23/10); o backup diário que usa
  a credencial de produção pelo proxy público **continuou funcionando até 25/10**.
- **Hipótese (confiança média-alta):** as credenciais de produção **não foram rotacionadas** após o incidente.
  A rotação de `JWT_SECRET` de 21/09 é anterior e não cobre o incidente. Não há evidência de invasão ou
  exfiltração do LiciGov — e ausência de evidência não comprova ausência de abuso (ver §5).
- Redeploys de staging com o mesmo commit em 23/10 são compatíveis com troca de variáveis em staging
  (hipótese, não confirmada).

### 2.2 GitGuardian (24/03/2026) — "Generic High Entropy Secret"
- **Fato:** o alerta aponta o commit `4baad2a` ("Criar .env", 24/03 23:45Z, via interface do GitHub), linha 6.
  O commit não está em nenhum branch atual, mas **continua obtenível por SHA no repositório público**. A linha 6
  é `JWT_SECRET` (48 caracteres, alta entropia). O mesmo arquivo foi recommitado em `e1f3f2b0` (21/04) e
  removido do índice em `9e0c17d` (PR A, 23/07). Demais linhas: `DATABASE_URL` sem credencial inline,
  `GEMINI_API_KEY` placeholder de 19 caracteres.
- **Conclusão:** segredo **real**, não falso positivo. **Correção existente verificada documentalmente:** rotação
  de `JWT_SECRET` em produção em 21/09 com atestação (G5). Divergência a corrigir no G5: lá o commit de entrada
  é citado como `195d895`; o primeiro é `4baad2a`.
- Varredura `gitleaks 8.21.2` (redigida) em todo o histórico (963 commits, 115 branches) e no estado atual:
  além do caso acima, só fixtures de teste, chaves de template (`"key": ""`) e um placeholder Stripe
  `sk_test_` de 19 caracteres em `server/services/stripeService.ts` (não é chave real). Bundle do frontend
  (`dist/public`): sem source maps, sem segredos.
- **Achado adicional:** o histórico público contém uma **senha padrão de admin hardcoded** (bootstrap de
  abr/2026) e o bootstrap antigo criava o admin com `ADMIN_PASSWORD`. Não reproduzida aqui.

### 2.3 Aviso Gemini (Google AI Studio, 07/10)
- **Fato:** o aviso diz que o projeto enviou `thinking_budget`, `temperature`, `top_p` e `top_k`; os próximos
  modelos vão responder 400. **No código:** `thinkingBudget: 0` só ia para `gemini-2.5-flash*` (allowlist), mas
  `server/services/gemini.ts` enviava `temperature/topP/topK` em **toda** geração documental, inclusive ao
  modelo canônico `gemini-3.8-flash`. **Corrigido** (commit `bf7180d`). O SDK legado não expõe `thinking_level`
  → migração para `@google/genai` no backlog. Se o aviso também foi causado pelo SincroSaúde (mesma conta),
  aquela frente trata o próprio código.

### 2.4 Aviso OAuth/MCP (Google Cloud, 19/10)
- **Fato:** lista **somente** o projeto GCP `sincrosaude-creative-agent` (que tem cliente OAuth Google Drive).
  Prazo 11/11 e permanência a partir de 12/11. O LiciGov não usa OAuth Google nem MCP do Workspace →
  **não afetado** (não aplicabilidade com evidência). Decisão sobre marcar o cliente como agêntico é da frente
  SincroSaúde.

### 2.5 Workspace `sincrosaude.com.br` — 2 usuários sem 2SV
- **Pendência de acesso:** sem console de administração do Google Workspace nesta sessão. Ação no §6.

### 2.6 Dependências (`security/audit-baseline.json`, `scripts/audit-gate.mjs`)
- **Fato:** o gate estava **vermelho na `main`** hoje: 2 high novas fora do baseline (`zod` GHSA-mrhx-c7xc-m3w5,
  `body-parser` GHSA-27r3-jxmh-p828). Formato interpretado corretamente (`advisories` do `pnpm audit --json`),
  mas o gate **aprovava** se a saída viesse sem `advisories` (erro de registry) — corrigido para fail-closed.
- `axios`, `jspdf` e `openai` eram dependências **sem nenhum import** → removidas. `express` 4.22.3 e `zod` 4.6.7.
- Resultado (prod): advisories high/critical únicas **38 → 14**; contagem de achados críticos 3 → 1,
  altos 42 → 20. Baseline reduzido 40 → 14 (nunca ampliado).

| Restante | Instalada | Cadeia | Aplicabilidade | Correção |
|---|---|---|---|---|
| `xlsx` GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9 (high) | 0.18.5 | direta (`server/services/excelService.ts`) | **Aplicável**: planilhas enviadas por usuários autenticados são lidas no servidor | npm sem correção; migrar para `exceljs` (já dependência) ou SheetJS 0.20.3 (CDN) — PR própria |
| `fast-xml-parser` GHSA-m7jm-9gc2-mpf2 (critical) +3 high | 5.2.5 | `@aws-sdk/client-s3` → `xml-builder` | Baixa: parseia respostas do S3 (origem confiável) | Atualizar `@aws-sdk/*` (minor) |
| `drizzle-orm` GHSA-gpj5-g38j-94v9 | 0.44.6 | direta | Baixa: nenhum `sql.identifier`/`sql.raw` no servidor | 0.45.2 (0.x: exige smoke completo) |
| `@trpc/server` GHSA-43p4-m455-4f4j | 11.6.0 | direta | Não aplicável (`experimental_nextAppDirCaller` não usado) | 11.8+ quando conveniente |
| `minimatch`, `glob`, `lodash`, `tmp` | várias | `archiver`, `exceljs`, `mermaid` | Baixa: padrões/caminhos estáticos | Overrides/upgrade de `archiver`/`exceljs` |

Build/CI (`pnpm audit` completo): 7 críticas / 79 altas antes da limpeza; maioria em ferramentas de build —
priorizar só o que roda com segredo (workflows já endurecidos, ver §4).

## 3. Revisão por camada

| Camada | Verificado | Resultado |
|---|---|---|
| Domain / tenant | `tenantProcedure`/`orgRoleProcedure` (`server/_core/trpc.ts`): tenant da sessão + membership ativa; admin de plataforma exige `X-Organization-Id` explícito com auditoria fail-closed | OK (correção existente). Routers experimentais que leem `organizationId` do input estão desligados fora de dev (`LEG-028`, teste com 46 procedures) — risco residual só em dev |
| Replay/idempotência | Smokes de idempotência e ledger na CI; nada alterado | OK (sem mudança) |
| Services / IA | Timeout e retry controlado (`AI-014`, `resilientAiCall`), sem fallback silencioso para mock em prod (`AI-015`) | OK; parâmetros depreciados corrigidos |
| Database | Consultas por organização (smokes de isolamento); TLS do backup só `PREFERRED` → **REQUIRED**; usuário único (provável `root`) para app/backup/auditoria; proxy público aberto | P0/P1 operacionais (§4) |
| Frontend | Sem source maps; único `VITE_*` no bundle é o ID público do GA; `localStorage` só com preferências e `licigov-user-info` (usuário passado por `sanitizeUser` — sem hash nem token) | OK; P3 avaliar limpar `licigov-user-info` no logout |
| Routers / sessão | Cookie `httpOnly`, `sameSite=lax`, `secure` em https; JWT HS256 24 h com `tokenVersion`; login/reset/convite com rate limit (memória, 1 réplica); reset com token opaco + TTL 1 h; CSP sem `unsafe-inline` em script; `trust proxy 1` | OK. P3: logout só apaga o cookie (token vale até expirar); rate limit não distribuído |
| Observabilidade | `X-Correlation-Id` do cliente aceito sem validação e preferido pelo `createContext` | **Corrigido** (commit `36d9078`) |
| CI / supply chain | Workflows com segredos de produção instalavam pnpm sem versão e sem `--frozen-lockfile`; sem `permissions` | **Corrigido** (commit `469b735`) |

## 4. Matriz de achados (P0 = risco crítico atual)

| ID | Prior. | Achado (evidência sanitizada) | Ativo / ambiente | Impacto | Confiança | Responsável | Correção | Critério de aceite | Estado |
|---|---|---|---|---|---|---|---|---|---|
| SEC-AUD-01 | **P0** | Credencial do MySQL de produção potencialmente exposta (workspace-alvo) e sem rotação comprovada; banco acessível pela internet via proxy TCP; backup OK até 25/10 com a mesma origem | MySQL prod (e staging) | Leitura/alteração de todos os dados de todos os órgãos | Média-alta | Owner | Runbook §2 (usuários dedicados, `ALTER USER`, GitHub secrets) | `/readyz` OK após troca; backup OK com usuário novo; usuário antigo sem acesso | Pendente (operacional) |
| SEC-AUD-02 | **P0** | `JWT_SECRET` de produção presente no Railway durante o ataque; última rotação 21/09 | app prod/staging | Forjar sessão de qualquer usuário, inclusive admin de plataforma (cross-tenant) | Média | Owner | Runbook §3 | Sessão antiga recusada; login novo OK | Pendente (operacional) |
| SEC-AUD-03 | **P0** | Chaves de IA/cloud (`GEMINI_API_KEY`, `AWS_*`) — exatamente o padrão buscado — sem rotação comprovada | Google AI / AWS IAM | Custo/abuso de IA; leitura/escrita de documentos no S3 | Média | Owner | Runbook §4–5 + revisão de consumo/CloudTrail | Chave antiga revogada; consumo 20/10→hoje revisado | Pendente (operacional) |
| SEC-AUD-04 | P1 | `BREVO_API_KEY` sem rotação comprovada | Brevo | Envio de e-mail em nome do órgão (phishing) | Média | Owner | Runbook §6 | Chave antiga excluída; logs revisados | Pendente |
| SEC-AUD-05 | P1 | Conta admin de plataforma pode usar senha igual ao default público do histórico ou a `ADMIN_PASSWORD` | Conta admin | Acesso cross-tenant | Baixa-média (não testado — teste de credencial não autorizado) | Owner | Trocar senha via reset | Reset concluído; sessões antigas revogadas | Pendente |
| SEC-AUD-06 | P1 | 2FA não confirmado (Railway, GitHub, Google, AWS, Brevo); 2 usuários sem 2SV em `sincrosaude.com.br` | Identidades | Tomada de conta | — | Owner | Ativar/confirmar 2FA; identificar os 2 usuários no Admin Console | Relatório de 2SV 100% | Pendência de acesso |
| SEC-AUD-07 | P1 | `xlsx` 0.18.5 (prototype pollution/ReDoS) parseia planilhas de usuários no servidor; sem correção no npm | app | DoS/integridade de objeto | Média | Dev | Migrar leitura para `exceljs` | Gate sem `xlsx`; testes de importação verdes | Backlog |
| SEC-AUD-08 | P1 | Gate de dependências vermelho na `main` e fail-open quanto ao formato | CI | Regressões passariam despercebidas | Alta | Dev | Commits `342da15`, `e3dabbb` | Gate verde e fail-closed | **Corrigido (local)** |
| SEC-AUD-09 | P1 | Gemini recebia `temperature/topP/topK` depreciados (quebra prevista em modelos novos) | IA prod | Indisponibilidade da geração documental | Alta | Dev | Commit `bf7180d` | Payload sem parâmetros em 3.x (teste) e geração OK em staging | **Corrigido (local)**; validar em staging |
| SEC-AUD-10 | P2 | Backup do banco via proxy público com TLS só `PREFERRED`; mesmo usuário privilegiado | CI/DB | Dump interceptável/rebaixamento | Média | Dev/Owner | `--ssl-mode=REQUIRED` (commit `469b735`); usuário `licigov_backup`; avaliar backup dentro da Railway e fechar o proxy | Próximo backup OK com TLS obrigatório | Parcial |
| SEC-AUD-11 | P2 | Workflows com segredos sem `permissions` e com install não reprodutível | CI | Supply chain com segredo de produção | Média | Dev | Commit `469b735` | Workflows rodam com `contents: read` e lockfile | **Corrigido (local)** |
| SEC-AUD-12 | P2 | `X-Correlation-Id` do cliente sem validação gravado em auditoria | app | Falha de gravação de auditoria / poluição de rastreabilidade | Alta | Dev | Commit `36d9078` | Testes | **Corrigido (local)** |
| SEC-AUD-13 | P2 | Segredos sem consumidor: `ADMIN_PASSWORD` (exigida no boot), `A2_HOMOLOG_TOKEN` (staging) | Railway | Superfície desnecessária | Alta | Dev/Owner | Commit `3b2845a`; excluir variáveis após deploy | Variáveis ausentes; boot OK | Código corrigido; remoção pendente |
| SEC-AUD-14 | P2 | Repositório público expõe histórico com segredos antigos (já rotacionados) e commit órfão `4baad2a` | GitHub | Reuso de segredo antigo, se não rotacionado | Alta | Owner | Decidir visibilidade; marcar GitGuardian como revogado; pedir ao suporte do GitHub remoção do commit órfão (opcional) | Decisão registrada | Pendente |
| SEC-AUD-15 | P2 | SDK `@google/generative-ai` legado (sem `thinking_level`; `generateContent` "legacy") | IA | Dívida de compatibilidade | Alta | Dev | Migrar para `@google/genai` atrás do Provider Adapter | Replay/proveniência preservados | Backlog |
| SEC-AUD-16 | P2 | `fast-xml-parser` (crítica) via AWS SDK; `drizzle-orm` 0.44.6 | deps | Baixa aplicabilidade | Média | Dev | Upgrades controlados | Gate com baseline menor | Backlog |
| SEC-AUD-17 | P3 | Logout não revoga o JWT; rate limit em memória; `JWT_SECRET` sem tamanho mínimo no boot; fallback Stripe placeholder com `process.env` direto | app | Baixo | Alta | Dev | Backlog | — | Backlog |
| SEC-AUD-18 | P3 | Projeto `vol-screener` criado 21/10 01:44Z (dentro da janela) | Workspace | — (criado pela conta do Owner, repo próprio) | Média | Owner | Confirmar autoria | Confirmação | Pendente |

## 5. Logs e cobertura temporal

| Fonte | Cobertura obtida | Observado | Lacuna |
|---|---|---|---|
| Railway deploy logs (prod) | 22/10 20:50Z → 25/10 | Boot limpo 23/10 13:11Z; só `[Auth] Missing session cookie` (3×); nenhum erro de provedor/autenticação | Antes de 22/10 nada retornado (retenção/consulta); produção quase sem tráfego |
| Railway HTTP logs (prod) | Últimos ~500 eventos (25/10 18:31Z, ~1 min) | Varredura automatizada (`/wp-login.php`, `/.env`, `/proc/self/environ`) respondida com o shell do SPA (200, 1–3 ms; `express.static` não serve fora de `dist/public`) | API devolve só a janela recente: **sem cobertura do período do ataque** |
| GitHub Actions | Backups 21–25/10 OK; restore drill 19/10 OK | Nada anômalo | Security log da conta: pendência de acesso |
| Google AI / AWS / Brevo | — | — | **Sem acesso**: consumo e auditoria dos provedores no runbook |

Ausência de evidência não comprova ausência de abuso.

## 6. Ações operacionais necessárias (Owner — aprovação exigida)

Ordem sugerida, cada uma com evidência esperada (sem valores):

1. **MySQL produção** (SEC-AUD-01) — runbook §2. Evidência: ID do deploy, `/readyz` 200, run de backup OK após
   a troca, lista de usuários MySQL (nomes/hosts).
2. **JWT_SECRET** prod e staging (SEC-AUD-02) — §3. Evidência: deploy + sessão antiga recusada.
3. **GEMINI_API_KEY** e **AWS** (SEC-AUD-03) — §4–5, incluindo revisão de consumo/CloudTrail 20/10→hoje.
4. **BREVO_API_KEY** (SEC-AUD-04) — §6.
5. **Senha do admin de plataforma** pelo reset (SEC-AUD-05).
6. **2FA** em Railway, GitHub, Google, AWS, Brevo; identificar e corrigir os 2 usuários sem 2SV em
   `sincrosaude.com.br` (SEC-AUD-06). Revogar tokens de API Railway/GitHub não reconhecidos.
7. Após merge + deploy desta branch: excluir `ADMIN_PASSWORD` (prod/staging) e `A2_HOMOLOG_TOKEN` (staging);
   conferir o próximo backup agendado com TLS obrigatório.
8. Confirmar autoria de `vol-screener`; marcar o incidente GitGuardian como resolvido (segredo revogado em
   21/09); decidir visibilidade do repositório.

## 7. Alterações desta execução

| Commit | Arquivos | Risco |
|---|---|---|
| `342da15` fix(ci): gate fail-closed | `scripts/audit-gate.mjs`, `scripts/audit-gate-lib.mjs`, `server/__tests__/unit/audit-gate-lib.test.ts` | Baixo |
| `469b735` ci(security): menor privilégio + TLS no backup | `.github/workflows/*.yml` | Baixo; backup falha visivelmente se o servidor não negociar TLS |
| `e3dabbb` fix(deps): remove deps sem uso; express/zod | `package.json`, `pnpm-lock.yaml`, `security/audit-baseline.json` | Médio-baixo (minor de express/zod) |
| `bf7180d` fix(ai): sem amostragem depreciada no Gemini 3.x | `server/_core/ai/gemini.ts`, `server/services/gemini.ts`, teste | Baixo (parâmetros já ignorados no 3.x) |
| `36d9078` fix(observability): valida X-Correlation-Id | `server/middleware/correlationMiddleware.ts`, `server/_core/context.ts`, teste | Baixo |
| `3b2845a` fix(config): ADMIN_PASSWORD não exigida | `server/config/auth.ts`, `.env.example`, `CLAUDE.md`, teste | Baixo |
| `823c640` test: tipagem nos testes alterados | 2 arquivos de teste | Nenhum |

Todos os commits atualizam `graphify-out/` pelo hook do repositório.

## 8. Checks executados (25/10/2026, ambiente local da sessão)

Comandos confirmados em `package.json`/`ci.yml`. Banco dos smokes: MySQL 8.0.46 **local, efêmero, sintético**
(`root:root@127.0.0.1/licigov`, igual ao serviço da CI) — nunca produção/staging. Lint conforme a CI (arquivos
`.ts/.tsx` alterados vs `origin/main`, `--max-warnings 0`).

| Check | Baseline (`7ec253f`) | Branch final (`823c640`) |
|---|---|---|
| `pnpm check` | ✅ | ✅ |
| Lint de não-regressão | n/a | ✅ (9 arquivos; 1ª rodada acusou 15 `any` em testes → corrigido em `823c640`) |
| `pnpm test` | ✅ 437 arquivos / 8231 testes (125 arquivos MySQL pulados sem banco) | ✅ 440 / 8251 (mesmos 125 pulados) |
| `pnpm build` | — | ✅ |
| `pnpm audit:gate` | ❌ 2 high novas (zod, body-parser) | ✅ 14/14 no baseline |
| `pnpm db:migrate:release` (banco sintético) | ✅ | ✅ |
| `pnpm test:smoke:security` | ✅ 39 arquivos / 408 testes | ✅ 39 / 408 |
| gitleaks (histórico completo + árvore + `dist/public`) | 141 achados no histórico, triados (§2.2) | idem; nenhum novo |

Não executado aqui: a cadeia completa de ~70 smokes MySQL do job `mysql-smoke` da CI (fica para a CI da PR) e
qualquer E2E visual. Os smokes pulados no `pnpm test` não equivalem a aprovação.

## 9. Backlog priorizado (código)

1. **P1 SEC-AUD-07** — trocar `xlsx` por `exceljs` na leitura de planilhas (`server/services/excelService.ts` e
   importadores); remover `xlsx` e as 2 GHSA do baseline.
2. **P2 SEC-AUD-10** — backup dentro da Railway (rede privada) para permitir fechar o proxy TCP público.
3. **P2 SEC-AUD-15** — migrar `@google/generative-ai` → `@google/genai` atrás do Provider Adapter, com
   `thinking_level` explícito por modelo e replay/proveniência preservados.
4. **P2 SEC-AUD-16** — `@aws-sdk/*` (fast-xml-parser) e `drizzle-orm` 0.45.x com a suíte MySQL completa.
5. **P3 SEC-AUD-17** — logout revogando a sessão (`tokenVersion`), tamanho mínimo de `JWT_SECRET` no boot (após
   a rotação), duas chaves JWT para rotação sem logout geral, Stripe lido via `server/config/*` sem fallback.
6. **P3** — `@trpc/server` 11.8+, overrides de `minimatch`/`glob`/`lodash`/`tmp`.

## 10. Atestação operacional (preencher pelo Owner)

| Credencial | Responsável | Data/hora UTC | Deploy | Validação | Anterior revogada |
|---|---|---|---|---|---|
| MySQL prod | | | | | |
| JWT_SECRET prod / staging | | | | | |
| GEMINI_API_KEY prod / staging / GitHub | | | | | |
| AWS prod / staging | | | | | |
| BREVO_API_KEY prod / staging | | | | | |
| Senha admin de plataforma | | | | | |
