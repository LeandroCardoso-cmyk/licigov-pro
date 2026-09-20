# Post-Blockers Roadmap Foundation — Entrega e Reconciliação

**Branch:** `feat/post-blockers-roadmap-foundation`
**Base:** `main` @ `b1d782844dc5df75b167d63c30ba8277f6695b95` (pós-merge da PR #226 — F-EMB1 / F-RAG1)
**Natureza:** avanço autônomo das **fases posteriores** com correções paralelas-seguras + reconciliação.
**Restrições honradas:** sem merge em `main`; sem tocar produção; sem ativar Legal Reference Set;
sem tocar `law_chunks`/F-EMB1 (migration `0301`); sem inventar contratos/decisões jurídicas/integrações.

> **Regra de Ouro (PRODUCT_NORTH_STAR, Q5 "pertence ao ERP?"):** nada aqui adiciona ERP,
> financeiro, contábil, tributário, RH ou patrimônio. Todas as mudanças reforçam invariantes
> multi-tenant já existentes — nenhuma cria capability nova de negócio.

---

## Sumário executivo

Auditado o estado **real** de `main` @ `b1d7828`, concluiu-se que as fases posteriores
(Licitação, Contratação Direta, Parecer, Contratos, Central de Operações, CATMAT, frameworks RC-X.1
/ RC-X.2) já estão majoritariamente **implementadas e tenant-safe** no código. Portanto o trabalho
honesto desta rodada **não é inventar features**, e sim: (1) reconciliar roadmap × docs × código;
(2) corrigir os **defeitos reais e prováveis** que ainda restam e são paralelos-seguros; (3) deixar
as frentes bloqueadas arquiteturalmente preparadas e documentadas, sem forçá-las.

Foram encontrados e corrigidos **3 defeitos genuínos de isolamento** (mesma classe da família
TENANT-006), todos provados por teste e sem mudança de schema:

| # | Defeito | Superfície | Classe | Commit |
|---|---|---|---|---|
| 1 | `analytics.getOverview` agregava **globalmente** (todos os tenants) sob `protectedProcedure` | `analyticsRouter.ts` | Vazamento de leitura cross-tenant | `18dafc7` |
| 2 | `editalParameters.get`/`save` liam/gravavam por `processId` do cliente **sem checar org** | `editalParametersRouter.ts` | IDOR leitura+escrita cross-tenant | `dcf69ab` |
| 3 | `notifications.markAsRead` atualizava por id **sem checar dono** | `notificationsRouter.ts` | IDOR escrita cross-user | `c8d709d` |

Nenhuma migration criada — a fronteira permanece em `0301` (F-EMB1). Gates locais verdes.

---

## Estado atualizado após auditoria (Post-audit status — 2026-09-20)

> Esta seção reconcilia o handoff com o estado **atual** dos blockers após os trabalhos posteriores
> (produção/cutover conduzidos por outra frente, fora desta branch). O conteúdo acima permanece como
> registro histórico de quando a branch foi criada; os deltas abaixo têm precedência quando divergirem.
> **Nada aqui alterou runtime jurídico, F-EMB1/F-RAG1, Railway ou produção nesta branch.**

### P2-A — Prova MySQL real das 3 correções (fechado nesta rodada)

Adicionado o smoke dedicado
`server/__tests__/integration/post-blockers-tenant-isolation-mysql-smoke.test.ts`, executado contra
**MySQL real**, complementando (sem substituir) os testes de caller com mock. Registrado no gate de
segurança existente (`test:smoke:security` → job "Smoke MySQL + Isolamento" do CI). Cobre, com prova
do **efeito persistido** e cleanup determinístico (zero resíduo):

- **Analytics** — `getProcessCountByStatusForOrg` / `getDocumentCountByMonthForOrg` /
  `getMostActiveMembersForOrg` contam **somente** a própria organização; dados da Org B jamais entram
  nos contadores da Org A (ex.: `em_dfd` de A = 2, não 7); `analytics.getOverview` (caller real)
  resolve a org pelo contexto, **nunca** pelo input.
- **Edital** — Org A tentando `get`/`save` em processo da Org B → `NOT_FOUND`; prova por query direta
  ao MySQL de que os parâmetros de B **não mudam** e **nenhum** `activity_log` é inserido; happy path
  de A no próprio processo persiste corretamente.
- **Notificações** — User A marcando notificação de B → permanece **não lida** (prova no MySQL); o
  dono (B) marca a própria → efetivamente **lida**.

### F-LEGAL1 V1 — CLOSED (removido dos blockers ativos)

- **F-LEGAL1.1 V1 = 100% CLOSED** e **F-LEGAL1.2 V1 = 100% CLOSED.**
- Reference Set V1: **instalado, aprovado por humano, ativo, hash pinado.**
  Hash: `332a9cb3ff8477eddc5cf94790a13d7ea9bd7a8c5855078f7f567f5400196832`.
- Expansão jurídica futura = **F-LEGAL1 V2** (append-only), **não bloqueante** para o Pilot V1.
- **Não** foi tocado runtime jurídico nesta branch. F-LEGAL1.1/1.2 **deixam de constar como blocker**
  (ver Risk Register, R5, atualizado).

### Release safety (`railway.json`) — RESOLVED / runtime evidence confirmed

A divergência histórica `railway.json` (`pnpm db:release`) × config efetiva observada
(`pnpm db:migrate`) foi **investigada**. O deploy real de produção executou efetivamente
`pnpm db:release`: migrations sob o release path, installer governado, reference set retornou **noop**
(nenhuma nova ativação), aplicação iniciou, `/readyz` passou. **Não é mais blocker ativo** — permanece
como nota histórica marcada **RESOLVED / runtime evidence confirmed** (antes R6).

### F-EMB1 + F-RAG1 — dry-runs produtivos executados (registrados em conjunto)

Autorizados e executados por outra frente (não nesta branch):

- **F-EMB1** (dry-run produtivo): `model=gemini-embedding-2`, `dim=768`, `status=dry-run`,
  `total=0 / processed=0 / skipped=0 / failed=0`. Interpretação correta: **nenhum embedding stale**;
  porém o corpus governado **ainda não estava materializado**, por isso `skipped=0` (e não 7). Portanto
  **não** se declara o rollout de produção do F-EMB1 encerrado isoladamente — registra-se **junto** com
  F-RAG1.
- **F-RAG1** (dry-run produtivo): `environment=production`, `setId=1`, `setVersion=1`,
  `hash=332a9cb3ff84`, `total=7 / existing=0 / materialized=0 / replayed=false`. Interpretação:
  Reference Set **ACTIVE**; **corpus RAG governado 0/7 materializado em produção**.

> **Blocker operacional real ATUAL desta frente:** F-RAG1 **0/7 materializado em produção.**
> Próximo gate correto (a ser conduzido pela frente responsável, **NÃO nesta PR**): F-RAG1 *apply* em
> produção → materializar **7/7** → *replay* do **mesmo runId** → F-EMB1 dry-run esperando **7
> current/skipped** → **A3 LIVE production validation.**

O runner usado para os dry-runs foi **neutralizado** (comando inerte; `preDeployCommand=[]`;
`restartPolicy=NEVER`; `APP_ENV`/`DATABASE_URL`/`JWT_SECRET`/`ADMIN_PASSWORD` zerados). Não tocar
nesse serviço.

### Backfill de `organizationId` legado — auditado, mecanismo já existe

A preocupação com registros legacy de `organizationId` NULL foi auditada: já existe
`drizzle/0039_backfill_org_ids.sql` (backfill de `processes`, `documents`, `tasks`, `contracts`,
`direct_contracts`, `legal_opinions`, `comments`, `activity_logs`). **Nenhuma migration de backfill é
necessária nesta rodada.**

### Blockers atuais (pós-auditoria)

| Frente | Status atual |
|---|---|
| F-LEGAL1.1 / F-LEGAL1.2 V1 | **CLOSED** (não é mais blocker) |
| Release safety `railway.json` | **RESOLVED / runtime evidence confirmed** |
| **F-RAG1 produção 0/7 materializado** | **BLOCKER OPERACIONAL REAL** (próximo gate; fora desta PR) |
| F-EMB1 produção | Pendente do apply do F-RAG1 (registrado em conjunto; não encerrado isoladamente) |
| Pilot go-live (G5/G7/G8/G11) | Inalterado (frentes bloqueadas, não tocadas) |
| RC-X.1/RC-X.2 wiring | Preparado, não integrado (inalterado) |

---

## A. Roadmap Reconciliation Report

**Fonte da verdade cruzada:** `docs/business-domains/roadmap.md` (Sprints 5.x),
`docs/audits/production-readiness/INTERNAL_PRODUCTION_GATE.md`, `MODULE_READINESS_MATRIX.md`,
`ROUTES_AND_ROUTERS_INVENTORY.md`, handoffs C2/C3A/C4A/C4B, e o código em `server/routers/**` +
`server/domain/**`.

| Fase / Domínio | Roadmap diz | Código real em `b1d7828` | Reconciliação |
|---|---|---|---|
| Licitação (DFD→ETP→TR→Edital) | "core do MVP, em dev" | `procurementProcessRouter`, `processesRouter`, DFD/ETP/TR canônicos, `editalParametersRouter` — **tenant-safe** (edital corrigido aqui) | **Alinhado** após a correção #2 |
| Contratação Direta | "roadmap" | `directContractsRouter` (38 procedures) todo em `tenantProcedure` + `...ForOrganization`; analytics TENANT-006 **já corrigido** (linhas 1200-1227); bridge governada (migration `0300`) | **Adiantado** vs. roadmap; canônico |
| Parecer Jurídico | "roadmap" | `legalOpinionsRouter` completo em `tenantProcedure` + `...ForOrganization` | **Adiantado**; canônico |
| Contratos e Aditivos | "roadmap" | `contract*Router` (workspaces, aditivos, apostilamentos, ocorrências) tenant-safe | **Adiantado**; canônico |
| Gestão / Central de Operações | "implementado" | `departmentOperation*` canônico; Central de Operações no `/dashboard` | **Alinhado** |
| IA / Governança cognitiva | "em dev" | Kernel Cognitivo único (`aiExecutionEngine`), fail-closed AI-015, Legal Reference governado (A3-RD1) | **Alinhado**; ativação de referência é **bloqueada** (fora de escopo) |
| RC-X.1 Experience / RC-X.2 Bootstrap | frameworks "X" | `server/domain/experience/**` e `server/domain/bootstrap/**` **presentes mas não fiados** ao runtime | **Preparado, não integrado** (ver Risk Register) |

**Conclusão:** o roadmap 5.x subestima o estado real — a maior parte de 5.2–5.4 já existe canônica e
tenant-safe. O gap verdadeiro não é de features, é de (a) higiene de isolamento em superfícies
legadas/satélites (corrigido nesta rodada onde provável) e (b) integração/ativação de frentes
que dependem de decisão humana/jurídica (deixadas preparadas).

---

## B. Architectural Change Map

Todas as mudanças são **aditivas e locais**, sem tocar Kernel, Document Engine, idempotência, RAG,
vector store, provider, S3 ou schema. Nenhum novo núcleo paralelo criado.

1. **`server/routers/analyticsRouter.ts`** — `protectedProcedure` → `tenantProcedure`; agregação
   global → agregação por `ctx.organizationId`. Contrato de saída inalterado (cliente
   `client/src/pages/Analytics.tsx` segue chamando sem argumentos).
2. **`server/db/admin.ts`** — adicionadas 3 leituras org-scoped
   (`getProcessCountByStatusForOrg`, `getDocumentCountByMonthForOrg`, `getMostActiveMembersForOrg`),
   filtrando por `organizationId`. As versões globais foram **mantidas** (consumidas por
   `adminRouter`, que é platform-admin com guard `role === "admin"` in-body — não é dead code).
3. **`server/routers/editalParametersRouter.ts`** — `protectedProcedure` → `tenantProcedure`;
   guard `getProcessByIdForOrganization(processId, ctx.organizationId)` antes de ler/gravar;
   activity log via `createActivityLogForOrganization` (passa a carregar `organizationId`).
4. **`server/routers/notificationsRouter.ts` + `server/db/collaboration.ts`** —
   `markNotificationAsRead(id)` → `markNotificationAsRead(id, userId)`, filtrando o UPDATE por
   `notifications.userId`; router passa `ctx.user.id`.

**Não modificado (proteção explícita):** F-EMB1 (`0301`, `law_chunks`, embedding lineage),
Legal Reference Set (nenhuma aprovação/ativação), `railway.json` (divergência
`db:release:predeploy` × `db:migrate:release` — **não corrigida** aqui), qualquer provider/S3/kernel.

---

## C. Migration Report

**Nenhuma migration criada nesta rodada.** A fronteira de migrations permanece em **`0301`**
(`0301_f_emb1_embedding_lineage`, de propriedade da F-EMB1). As três correções operam apenas sobre
colunas já existentes (`processes.organizationId`, `documents.organizationId`,
`activity_logs.organizationId`, `notifications.userId`), adicionando filtros de leitura/escrita — sem
qualquer DDL. Isso respeita a restrição de não tocar `0301` nem inventar tabelas.

> **Backfill legado auditado (pós-auditoria):** a preocupação com registros legacy de
> `organizationId` NULL foi verificada — já existe `drizzle/0039_backfill_org_ids.sql` (backfill de
> `processes`, `documents`, `tasks`, `contracts`, `direct_contracts`, `legal_opinions`, `comments`,
> `activity_logs`). O mecanismo histórico de reconciliação existe; **nenhuma migration de backfill é
> necessária nesta rodada.** Fronteira preservada em `0301`.

---

## D. Test Report

- **Testes de regressão de caller (mock) — pirâmide, camada 1:**
  - `server/__tests__/integration/analytics-tenant-scope.test.ts` (2)
  - `server/__tests__/integration/edital-parameters-tenant-scope.test.ts` (5)
  - `server/__tests__/integration/notifications-owner-scope.test.ts` (2)
- **Smoke MySQL real — pirâmide, camada 2 (adicionado pós-auditoria, P2-A):**
  `server/__tests__/integration/post-blockers-tenant-isolation-mysql-smoke.test.ts` (9) — prova de
  **persistência e isolamento contra MySQL real** para as 3 correções (Org A × Org B; efeito
  persistido verificado por query direta; cleanup determinístico com zero resíduo). Registrado no
  `test:smoke:security` (job "Smoke MySQL + Isolamento" do CI). As duas camadas coexistem.
- **Suíte completa (`pnpm test`), snapshot da criação da branch:** **5218 passed / 328 skipped / 0
  falhas** (267 arquivos; +7 vs. base). Os smokes MySQL (`*-mysql-smoke.test.ts`) exigem
  `DATABASE_URL` e rodam no runner de CI com o serviço MySQL.
- **Typecheck (`pnpm check`):** 0 erros.
- **Lint (`--max-warnings 0`, arquivos alterados):** limpo (gate de não-regressão do `ci.yml`).
- **Build (`pnpm build`):** ok (`vite build` + `esbuild`).

> **Evidência pós-auditoria (P2-A):** o novo smoke foi executado contra **MySQL real** (banco
> descartável, migrations aplicadas via `db:migrate`, fronteira `0301`): **9/9 passed**, e o gate
> `test:smoke:security` completo (7 arquivos, **108 tests**) passou verde incluindo o novo smoke.
> **PASS pleno de CI** segue condicionado ao `workflow_dispatch` rodar **verde** no runner.

---

## E. Risk Register

| ID | Risco | Severidade | Status / decisão | Racional |
|---|---|:---:|---|---|
| R1 | **Anti-padrão sistêmico RANK 2**: routers satélite (`itemTrRouter`, `reviewWorkspaceRouter`, `itemAnalyticsRouter`, `trCompositionRouter`, `clauseRouter`, `exportRouter`, `structuredExportRouter`, `collaborationCommentsRouter`, `webhookRouter`, `productionReadinessRouter`, `pilotReadinessRouter`) usam `protectedProcedure` + `input.organizationId` **do cliente** | P1 (latente) | **Documentado, não corrigido** | Hoje leem stores **in-memory/mock** — **não há vazamento de DB real** ainda. Vira vazamento no instante em que a persistência DB entrar. Correção segura exige o mesmo movimento (`tenantProcedure` + derivar org do contexto) **quando** cada um ganhar DB; corrigir agora tocaria hooks vivos (ex.: review workspace) sem defeito provável — fora de "menor mudança segura" |
| R2 | `institutionalRagRouter` / `ragGovernanceRouter` leem `ctx.organizationId!` sob `protectedProcedure` (nunca populado → `undefined`) | P3 | **Documentado** | Inócuo enquanto stubs; sinaliza que deveriam ser `tenantProcedure`. Corrigir junto de R1 |
| R3 | Funções globais de analytics em `admin.ts` (`getProcessCountByStatus`/`getDocumentCountByMonth`/`getMostActiveMembers`) sem consumidor de produção após a correção #1 | P3 | **Mantidas** | Removê-las é limpeza fora de escopo e de risco desnecessário; exportadas (sem warning de unused). Candidatas a poda futura |
| R4 | RC-X.1 / RC-X.2 presentes mas **não fiados** ao runtime | P2 | **Preparado, bloqueado** | Fiar o bootstrap ao boot tem risco de inicialização; requer decisão de rollout. Não tocado |
| R5 | Frentes que dependem de decisão humana/jurídica: F-LEGAL1.1/1.2, ativação de Legal Reference Set, PNCP, assinatura ICP-Brasil, sync de calendário externo | — | **Bloqueado por design** | Explicitamente fora do mandato; não iniciadas para não inventar contratos/decisões. **Delta pós-auditoria:** **F-LEGAL1.1/1.2 V1 = CLOSED** (reference set instalado/aprovado/ativo, hash `332a9cb3…196832`) — **removidos** desta lista de blockers; permanecem bloqueadas apenas PNCP, ICP-Brasil e calendário externo |
| R6 | `railway.json`: `db:release:predeploy` × `db:migrate:release` divergentes | P2 | **Não corrigido (bloqueado)** → **RESOLVED (pós-auditoria)** | **Delta pós-auditoria:** deploy real de produção executou `pnpm db:release` (migrations sob release path, installer governado, reference set **noop**, app iniciou, `/readyz` passou) → **RESOLVED / runtime evidence confirmed**. Não é mais blocker ativo; nota histórica preservada |
| R7 | Os helpers org-scoped novos (`getProcessCountByStatusForOrg` / `getDocumentCountByMonthForOrg` / `getMostActiveMembersForOrg`) carregam registros da organização e **agregam em Node** | P3 (performance/scalability debt) | **Documentado, não implementado** | Correto funcionalmente e **seguro multi-tenant**, porém menos eficiente em escala. Recomendação futura: `COUNT`/`GROUP BY`/filtros temporais em SQL (agregação no banco). **Não otimizar nesta execução** (não ampliar o diff) |
| R8 | **F-RAG1 produção: corpus governado 0/7 materializado** (Reference Set ACTIVE, mas `materialized=0`) | — (operacional) | **BLOCKER OPERACIONAL REAL — fora desta PR** | Próximo gate: F-RAG1 *apply* em produção → 7/7 → *replay* do mesmo runId → F-EMB1 dry-run esperando 7 current/skipped → A3 LIVE validation. Conduzido pela frente responsável; **não executado nesta PR** |

---

## F. Pilot Readiness Delta

Referência: `INTERNAL_PRODUCTION_GATE.md` (Piloto Moreira Sales). Esta rodada **não altera o
veredito do gate** (segue `NÃO PRONTO` até G5/G7/G8/G11 fecharem — frentes bloqueadas), mas
**reduz risco residual** em um item do Teste de Realidade:

- **Pergunta 21 do gate** ("Existe risco de acessar dados de outro órgão?") citava
  **TENANT-001/002/006** como risco real "mitigado em single-tenant, mas real". As correções #1 e #2
  fecham **duas superfícies concretas da classe TENANT-006** (overview institucional + parâmetros de
  edital) que permaneciam globais/sem-org, e a #3 fecha um IDOR cross-user adjacente. Em ambiente
  **multi-tenant** (pós-piloto), isso remove vetores de leitura/escrita cross-org reais.
- **Sem impacto** nos itens bloqueantes G5 (segredos), G7 (CI verde), G8 (rotas legadas fora da
  navegação) e G11 (backup) — que permanecem como estão. Nenhum módulo foi exposto/ocultado.

**Delta líquido:** postura de isolamento **mais forte**; go-live **inalterado** (continua
condicionado às frentes bloqueadas, que não foram tocadas).

---

## G. Master Handoff

**Commits nesta branch (sobre `b1d7828`):**
```
c8d709d fix(notifications): owner-scope markAsRead to close cross-user IDOR
dcf69ab fix(edital): tenant-scope get/save to close cross-tenant IDOR
18dafc7 fix(analytics): tenant-scope getOverview to close cross-tenant leak
```
(+ este documento de reconciliação)

**Como validar:**
```bash
pnpm check                 # typecheck (0 erros)
pnpm test                  # 5218 passed / 328 skipped
pnpm build                 # ok
pnpm exec eslint <arquivos alterados> --max-warnings 0
```
CI: disparar `workflow_dispatch` do `ci.yml` nesta branch (roda gates + smokes MySQL de isolamento;
job `deploy` fica restrito a `main`).

**Próximos passos recomendados (fora desta rodada, exigem decisão):**
1. **R1/R2** — ao dar persistência DB a cada router satélite, migrar para `tenantProcedure` e derivar
   `organizationId` do contexto (padrão desta rodada). É a maior dívida de isolamento restante.
2. **R4** — planejar o fiamento (wiring) de RC-X.1/RC-X.2 ao runtime com gate de inicialização.
3. **Frentes bloqueadas (R5/R6)** — permanecem com o time responsável; nada aqui as antecipa.

**Garantias desta entrega:** sem merge em `main`; sem produção; sem ativação jurídica; sem migration;
sem novo núcleo; sem dado fictício; sem mascarar estado degradado. Toda correção é real, provável por
teste, e é a **menor mudança segura** para a invariante que restaura.

### Addendum pós-auditoria (2026-09-20)

**Commits adicionais nesta rodada (fecham os dois P2 da auditoria da PR #229):**
- `test(security): add MySQL proof for post-blockers isolation fixes` — novo smoke MySQL real +
  registro no `test:smoke:security`.
- `docs(handoff): reconcile post-audit blocker state` — este arquivo (seção "Estado atualizado após
  auditoria", Test/Migration/Risk atualizados).

**Validação local pós-auditoria (contra MySQL real, banco descartável):** `pnpm check` 0 erros ·
lint dos arquivos alterados `--max-warnings 0` limpo · novo smoke **9/9 passed** ·
`pnpm test:smoke:security` **108/108 passed** (7 arquivos, inclui o novo) · `pnpm build` ok.

**Blockers atuais (autoritativo):** ver seção "Estado atualizado após auditoria". Em resumo:
F-LEGAL1 V1 **CLOSED**; release safety `railway.json` **RESOLVED (runtime evidence)**; **blocker
operacional real = F-RAG1 produção 0/7 materializado** (próximo gate, fora desta PR); F-EMB1 registrado
em conjunto; Pilot G5/G7/G8/G11 inalterados; RC-X.1/X.2 preparados e não integrados.

**Invariantes preservadas nesta rodada:** NO MERGE · NO PRODUCTION CHANGE · NO LEGAL ACTIVATION ·
NO MIGRATION (fronteira `0301`) · NO RAILWAY CHANGE · runner de dry-run **não** tocado · PR permanece
**DRAFT**.
