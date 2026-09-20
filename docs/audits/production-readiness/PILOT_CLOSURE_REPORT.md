# LiciGov Pro — Pilot Closure Report

### Auditoria final de prontidão para piloto · 2026-09-20 · Prefeitura de Moreira Sales

> **Este documento não autoriza o piloto.** A IA produz a evidência e a classificação técnica; a
> decisão de go-live é **humana (owner)**. Ver seção **Q**.

---

## A. Executive Summary

Após o fechamento produtivo de 20/09/2026 (merge de #228/#229, F-RAG1 apply 7/7 + replay PASS,
produção web SUCCESS), esta rodada executou a reconciliação formal dos gates pendentes:

- **G7 (CI)** → **PASS** reconciliado (evidência de CI verde real em `main`); PR #230.
- **G5 (segredos)** → **PARTIAL** (código completo; rotação de `JWT_SECRET`/`DATABASE_URL` é
  `OPERATOR_ACTION_REQUIRED`); PR #231.
- **G8 (navegação)** → **PARTIAL** (nav canônica limpa e órfãos de teste removidos; duplicação legada
  cross-wired do núcleo exige decisão de produto); PR #232.

**Resultado do Gate Obrigatório (técnico): 10 PASS · 0 FAIL · 2 PARTIAL (G5, G8).**
Como a prontidão é **conjuntiva** (todos os itens aplicáveis devem estar PASS), a classificação é:

> ## **PILOT NOT READY** — bloqueado por **G5** (rotação operacional de segredos) e **G8** (reconciliação da duplicação legada).

Ambos os bloqueios têm **caminho de fechamento objetivo e curto** (ver M/P). Nenhum é falha de
segurança nova; nenhum é regressão. As reconciliações documentais (G7/G5/G8) estão em **PRs abertas
(#230/#231/#232), pendentes de merge humano** — merge é gate humano e **não foi executado**.

---

## B. Main/Production State

| Item | Valor |
|---|---|
| `main` HEAD | `81afdf50b4f3dab79b9ab2ed3b729a9dd81dbb6c` |
| CI pós-merge main | run **#573** (`35532091237`) — **SUCCESS** (6/6 jobs) |
| PRs mergeadas | #228 (`b2e2df3`), #229 (`81afdf5`) |
| Migration frontier | `0301` (inalterada) |
| Produção web (operador) | deployment `952b62d1-…-14d392cdb159` — SUCCESS; MySQL SUCCESS; `/readyz` `status=ok`, `database=ok` |
| Release path | `pnpm db:release:predeploy` (config-as-code `railway.json`) |
| PRs abertas desta rodada | #230 (G7), #231 (G5), #232 (G8), **todas Ready for Review, não mergeadas** |

> Evidências de produção/Railway (deployment id, readyz) e de dry-run são **fornecidas pelo operador**
> e tratadas como atestação operacional; o repositório confirma o HEAD, o CI e o release path.

---

## C. Gate Matrix G1–G12 (auditado do zero)

| # | Item | Status | Evidência (verificada nesta auditoria) |
|---|---|:---:|---|
| G1 | Sem IDOR no core | **PASS** | RC-SEC-PR-A (TENANT-001/002/008) + PR #229 (TENANT-006 analytics/edital + IDOR notifications). Smoke `test:smoke:security` (108 tests, inclui `post-blockers-tenant-isolation`) **verde no #573 em `main`** |
| G2 | Sem endpoint público sem auth | **PASS** | AUTH-003 (adminProcedure); canônico |
| G3 | Sem escalação de privilégio | **PASS** | RBAC-004 (orgRoleProcedure; `adminRouter` com guard `role==='admin'`) |
| G4 | Sem credencial default em produção | **PASS** | CONFIG-005: `auth.ts` exige `ADMIN_PASSWORD` (fail-closed); confirmado no ambiente |
| G5 | Segredos fora do repo e rotacionados | **PARTIAL** | Código `CODE_COMPLETE` (só `.env.example`, fail-closed); **JWT_SECRET/DATABASE_URL rotação = OPERATOR_ACTION_REQUIRED**. [`G5_SECRET_READINESS_AUDIT.md`](./../../security/G5_SECRET_READINESS_AUDIT.md), PR #231 |
| G6 | Registro fail-closed no tenant | **PASS** | SEC-017 (fallback org 1 removido) |
| G7 | CI comprova build/typecheck/isolamento | **PASS** | Reconciliado: CI real verde em `main` (#573; deploy `needs` todos os gates + `if main`; sem `\|\| true`; smoke MySQL real; build com artefato). PR #230 |
| G8 | Fluxo navegável, sem debug/duplicadas | **PARTIAL** | Nav canônica limpa + `/test*` removidos; **duplicação legada cross-wired do núcleo** não reconciliada. [`G8_PILOT_NAVIGATION_AUDIT.md`](./G8_PILOT_NAVIGATION_AUDIT.md), PR #232 |
| G9 | Login/sessão/logout | **PASS** | JWT httpOnly; TTL 24h configurável (SEC-022) |
| G10 | Suíte verde | **PASS** | `pnpm test` **5218 passed / 337 skipped / 0 falhas** (verificado nesta rodada e no #573) |
| G11 | Backup e restauração | **PASS** | Drill real (312 tabelas, 120 migrations, órfãs=0) — PR D |
| G12 | IA nunca serve mock como oficial | **PASS** | AI-015 fail-closed do provider; `GEMINI_API_KEY` rotacionada/validada; RAG governado 3/3 em produção (Art. 74 I/V/II, locator canônico, zero legacy bleed) |

**Total: 10 PASS · 0 FAIL · 2 PARTIAL · 0 NOT_VERIFIED · 0 N/A.** Bloqueiam: **G5, G8.**

---

## D. G7 Closure

**PASS (reconciliado).** Condição do adendo PR D ("CI verde") satisfeita. Estrutural: `deploy`
`needs: [quality, test, mysql-smoke, build, security-audit]` + `if: main`; sem `|| true` mascarando
gate; smoke MySQL sobe serviço real e roda `test:smoke:security`; build publica artefato. Execução:
run **#573** (push `main` @ `81afdf5`) 6/6 SUCCESS; + #567–#570 na PR #229. Formalizado em PR #230.
Governança: bloqueio efetivo do deploy exige branch protection + Wait-for-CI (ação operacional).

## E. G5 Closure

**PARTIAL (bloqueante).** Código `CODE_COMPLETE`: `.env` gitignored (só `.env.example`), config
fail-closed (sem default inseguro), sem segredo hardcoded em produção, diagnóstico só-presença. Um
`.env` versionado historicamente (#172, removido na PR A #185) expôs **`JWT_SECRET`** (real) e
`DATABASE_URL` (sem credencial inline); `GEMINI_API_KEY` era placeholder e já foi rotacionada (G12). A
rotação de `JWT_SECRET`/`DATABASE_URL` no Railway/provedor é **irreversível, afeta produção e não é
verificável pelo repositório** → `OPERATOR_ACTION_REQUIRED`. Runbook: `PR_A_SECRET_ROTATION_RUNBOOK.md`.
**Não promovido a PASS por inferência.** PR #231.

## F. G8 Closure

**PARTIAL (bloqueante).** Nav principal canônica e limpa (`businessDomains.ts`/`LEGACY_PATHS`);
`/test*` fora do roteamento + **arquivos órfãos removidos**; redirects canônicos; sem bypass de auth.
Bloqueio: as rotas legadas (`/direct-contracts`, `/parecer-juridico`, `/contracts`) seguem montadas e
**cross-wired do núcleo** (`ProcessDetails` cria parecer/contrato com `?processId=`; `DirectContractDetails`
idem). Redirecioná-las quebraria fluxo crítico; migrar exige entrada canônica de criação-com-contexto
(**feature fora de escopo**). ⇒ **decisão de produto humana**. PR #232.

---

## G. Security Final Audit

- Multi-tenant/IDOR: G1/G2/G3/G6 PASS; PR #229 fechou TENANT-006 (analytics/edital) e IDOR cross-user
  (notifications), com prova MySQL real (`post-blockers-tenant-isolation`, 9/9; suíte de segurança 108/108).
- Auth/sessão: JWT httpOnly, TTL configurável, fail-closed sem `JWT_SECRET`/`ADMIN_PASSWORD` em produção.
- Segredos: código completo; **pendência operacional de rotação (G5)**.
- CSP secure-by-default (SEC-036); auditoria de deps com baseline (bloqueia regressão).

## H. Cognitive Final Audit

- Kernel Cognitivo único (`aiExecutionEngine`); domínios não acessam provider/S3 diretamente.
- Fail-closed do provider (AI-015): sem provider real em staging/prod → falha controlada, **não** persiste
  resposta oficial; mock nunca classificado como "Fundamentada".
- **Legal Reference Set V1 ACTIVE/APPROVED** (setId=1, v1, hash `332a9cb3…196832`) — ativação **não**
  ocorreu nesta rodada. RAG governado validado em produção (3/3 governed, 0 legacy; Art. 74 I/V/II com
  locator canônico e fonte oficial Planalto). Explainability/selos de suficiência ativos.

## I. Multi-Tenant Audit

`organizationId` sempre derivado do contexto do servidor (`tenantProcedure`/`ctx.organizationId`),
nunca de `input`. Leituras/escritas org-scoped (`*ForOrganization`). Prova de persistência real (MySQL)
no smoke de isolamento. Anti-padrão RANK 2 (routers satélite com `input.organizationId`) permanece
**latente** (stores in-memory/mock; sem vazamento de DB real) — registrado no Risk Register.

## J. Backup/Recovery

G11 PASS: backup agendado + checksum + retenção (14d) + criptografia; **drill de restauração real** em
banco descartável (312 tabelas, 120 migrations, órfãs=0/mismatch=0). Follow-up: política de retenção
longa/off-site.

## K. CI/Release Safety

CI real com 5 gates obrigatórios + deploy condicionado (`needs` + `if main`), sem máscara. Release path
`pnpm db:release:predeploy` (installer governado; reference set **noop** quando replayado). #573 SUCCESS
em `main`. Ação operacional contínua: branch protection + Wait-for-CI.

## L. Residual Risk Register

| ID | Risco | Sev | Estado |
|---|---|:---:|---|
| G5-OP | Rotação de `JWT_SECRET`/`DATABASE_URL` não confirmada | Alta | **BLOQUEIA** — OPERATOR_ACTION_REQUIRED |
| G8-DUP | Duplicação legada cross-wired do núcleo | Média/Alta | **BLOQUEIA** — decisão de produto + fluxo canônico |
| RANK2 | Routers satélite `input.organizationId` (in-memory/mock) | P1 latente | Documentado; vira real ao ganhar persistência DB |
| PERF-P3 | Analytics org-scoped agregam em Node | P3 | Documentado; futuro `COUNT`/`GROUP BY` |
| RC-X | RC-X.1/X.2 preparados, não fiados ao runtime | P2 | Fora desta fase; só após autorização |
| OBS | Sem Sentry/APM ponta a ponta | P2/P3 | Aceitável corrigir no piloto |

## M. Pilot Scope (derivado do estado real)

**Dentro do piloto (canônico, tenant-safe):** Processo Licitatório (DFD→ETP→TR→Edital), Contratação
Direta, Parecer Jurídico, Contratos/Aditivos, Central de Operações, Tirar Dúvidas (RAG governado),
Documentos/versionamento, CATMAT **com revisão humana**, Importação **só Excel**.
**Fora do piloto (ocultar):** Billing/Comercial; RAG institucional/Copilots/Agentes/Governança IA
(órfãos de frontend); Aprovação/Workflow em memória; rotas legadas duplicadas; qualquer módulo ainda
não governado. **Nunca:** decisão jurídica autônoma; ERP/financeiro/contábil/RH/patrimônio.

## N. Rollback Conditions

Interromper o piloto se: vazamento cross-tenant confirmado; IA servindo conteúdo oficial sem provider
real; perda/corrupção de dados; falha de `/readyz`/boot persistente; qualquer decisão jurídica emitida
sem revisão humana. Rollback: restaurar valor anterior de segredo **no cofre/Railway** (nunca no Git);
restore de backup testado (G11); redeploy do último `main` verde (#573). Migrations são forward-only —
rollback de schema exige restore.

## O. Monitoring Plan

- **24h:** boot/`readyz`, erros 5xx, falhas de login, latência de IA, taxa de fail-closed (AI-015),
  qualquer `experience_divergence` (quando RC-X existir — ainda não).
- **72h:** integridade multi-tenant (spot-check por org), consumo de IA, tempos de geração documental.
- **7d:** produtividade do departamento, incidentes, uso por módulo, backup diário + 1 restore de amostra.

## P. Pilot Decision Package (para o owner)

1. **Gates:** 10 PASS · 2 PARTIAL (G5, G8) — ver C.
2. **Produção:** main `81afdf5`, #573 SUCCESS, readyz ok (atestação do operador).
3. **Riscos residuais:** ver L.
4. **Módulos aprovados/fora:** ver M.
5. **Bloqueios e fechamento objetivo:**
   - **G5:** executar a rotação de `JWT_SECRET` e `DATABASE_URL` no Railway conforme
     `PR_A_SECRET_ROTATION_RUNBOOK.md`; validar por presença + relogin + health; **atestar**. → G5 PASS.
   - **G8:** decidir a consolidação da duplicação legada (construir criação-com-contexto canônica →
     migrar cross-links do núcleo → redirecionar/retirar rotas legadas). → G8 PASS.
6. **Fallback/rollback/monitoramento/incidentes:** N, O.
7. **Ações humanas requeridas:** (a) mergear #230/#231/#232 após revisão; (b) rotação de segredos (G5);
   (c) decisão de produto sobre G8; (d) manter branch protection + Wait-for-CI.

## Q. Owner Authorization Required

> **A IA NÃO autoriza o piloto.** No estado atual (**PILOT NOT READY**, bloqueado por G5 e G8), o
> go-live **não** é recomendado. Quando G5 e G8 estiverem em **PASS** (com as PRs revisadas/mergeadas
> e a rotação atestada), a classificação técnica passará a **PILOT TECHNICALLY READY FOR OWNER
> DECISION**, e o **owner** decide o go-live. Solicita-se: **OWNER PILOT AUTHORIZATION** somente após o
> fechamento de G5 e G8.

## R. RC-X Readiness — NOT STARTED

RC-X.1 (Experience) e RC-X.2 (Bootstrap) permanecem **preparados e não fiados** ao runtime. O wiring
**não foi iniciado** e **não pode** começar antes de: (1) Production Gate completo em PASS; (2)
autorização explícita do owner para o piloto; (3) autorização explícita do owner para a fase RC-X.
Nada nesta rodada tocou `server/domain/experience/**` ou `server/domain/bootstrap/**`.
