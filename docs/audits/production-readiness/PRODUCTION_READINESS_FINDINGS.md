# Inventário Consolidado de Achados — Prontidão para Produção Interna
### LiciGov Pro · Piloto Moreira Sales · 2026-07-22

Achados deduplicados a partir de 6 auditorias read-only paralelas + verificação direta no
código. Cada achado tem ID estável. "Bloqueia piloto?" é avaliado para o cenário-alvo:
**piloto single-tenant fechado** (um órgão, poucos servidores, registro controlado).

Legenda de decisão: **BLOQ** = bloqueia produção interna · **MÓD** = bloqueia módulo (ocultar) ·
**FLAG** = aceitável atrás de feature flag/navegação · **PILOTO** = aceitável no piloto ·
**POST** = postergável.

---

## P0 — Bloqueadores absolutos

| ID | Categoria | Domínio | Achado | Evidência | Bloqueia? | Bloco |
|---|---|---|---|---|---|---|
| TENANT-001 | SEC/tenant | Processos | IDOR: `getById`/`getProcessItems`/`addItemsToTR`/`updateProcessItem`/`deleteProcessItem`/`updateStatus` sem check de dono/org | `processesRouter.ts:113-329`; `db/processes.ts:60` | BLOQ | A |
| TENANT-002 | SEC/tenant | Gestão/Tarefas | IDOR: `tasks.list/getById/update/delete` e `departmentTasks.*`/anexos por id global; `listTasks` retorna todas as tarefas | `taskRouter.ts:48-178`; `departmentTasksRouter.ts:48-114`; `db/tasks.ts:14-74` | BLOQ | A |
| AUTH-003 | SEC | Deploy/Ops | `deploymentRouter` (11) e `stabilityRouter` (12) 100% `publicProcedure` — ops institucional sem login | `deploymentRouter.ts:18-30`; `stabilityRouter.ts:30-56`; `routers.ts:119-120` | BLOQ | A |
| RBAC-004 | RBAC | Onboarding | `grantDepartmentPermission` permite auto-concessão de permissão `scope: global` | `onboardingRouter.ts:56-69` | BLOQ | A |
| CONFIG-005 | SEC/config | Bootstrap | Admin seedado com senha default `Admin@123` se `ADMIN_PASSWORD` ausente | `bootstrap.ts:18,4225,4308` | BLOQ (condic.) | A |

---

## P1 — Bloqueadores do piloto

| ID | Categoria | Domínio | Achado | Evidência | Bloqueia? | Bloco |
|---|---|---|---|---|---|---|
| TENANT-006 | SEC/tenant | Contratação Direta | Analytics legadas (`getOverview/getCharts/getTopSuppliers/getRecent`) agregam TODAS as orgs | `directContractsRouter.ts:1088-1118` | BLOQ se rota legada exposta | A |
| TENANT-007 | SEC/tenant | IA/Assistente | `aiAssistant.*` roda IA sobre DFD/ETP/TR de qualquer processo (userId ignorado) | `aiAssistantRouter.ts:15-22` | BLOQ | A |
| TENANT-008 | SEC/tenant | Documentos | Repo `getDocumentById`/`updateDocumentStatus` global; router protege via `assertProcessAccess` (user-scoped, não org) | `documentsRouter.ts:34-47,267`; `db/processes.ts:117,161` | MÓD | A |
| SEC-017 | SEC | Auth | Registro público aberto + fallback org 1: conta nova vira `operator` da org 1 (Moreira Sales) | `authRouter.ts:15`; `tenantService.ts:38-44` | BLOQ se exposto na internet | A |
| SEC-018 | SEC | Config | `.env` versionado no git com `JWT_SECRET` de 48 chars commitado; senha admin no código | `.env` (git ls-files); `.gitignore:11` | BLOQ (rotacionar) | A |
| AUDIT-020 | AUDIT | Aprovações | `humanApprovalService` = Map em memória; sem validação de tenant do workflow; `approver` do input (forjável) | `humanApprovalService.ts:35-89` | MÓD (se aprovação usada) | C |
| SEC-022 | SEC | Auth | Sessão JWT expira em 1 ano, sem refresh/revogação | `authRouter.ts:50,88`; `sdk.ts:40` | PILOTO | A |
| LEGACY-010 | ARCH/legacy | Licitação | Módulo canônico (procurementProcessRouter + Workspaces DFD/ETP/TR/Edital) órfão do frontend; UI usa legado | `Dashboard.tsx:17-21`; 0 imports de `components/procurement/*` | BLOQ (decisão de fluxo) | B |
| LEGACY-011 | ARCH/legacy | Central | Central de Operações só lê tabelas canônicas; processos legados não aparecem nos indicadores | `departmentOperationService.ts:16`; `db/procurement.ts:54` | MÓD | B |
| LEGACY-013 | ARCH/legacy | Multi | Rotas legadas paralelas às canônicas seguem montadas (dados em tabelas distintas) | `App.tsx:178-189` | FLAG | B |
| DATA-012 | DATA | Banco | Zero transações no backend (`.transaction(` = 0 em server/) | grep server/ (verificado) | PILOTO | D |
| DATA-013 | DATA | Processos | `processNumber` vem do input do cliente; sem numeração atômica AAAA/NNNN | `procurementProcessRouter.ts:44`; `processesRouter.ts:41-111` | PILOTO | B/D |
| AI-014 | AI | IA | Sem timeout/retry/AbortController em nenhuma chamada Gemini | `_core/ai/gemini.ts:122`; `services/gemini.ts` | BLOQ (risco operacional) | D |
| AI-015 | AI | IA | Fallback silencioso para MockAIProvider: resposta `mock:<hash>` persistida como oficial | `providerAdapter.ts:116-133` | BLOQ (verificar env) | D |
| DOC-016 | AI/DOC | CATMAT | Matcher pede códigos CATMAT do "conhecimento interno" do LLM — risco de código alucinado no TR | `catmatMatcher.ts:31-58` | MÓD (revisão humana) | C |
| DEPLOY-019 | DEPLOY | CI/CD | Job "Deploy (Preparação)" é 100% echo; CI não roda build/typecheck/lint; deploy não depende de mysql-smoke | `.github/workflows/ci.yml:117-131` | BLOQ (deploy cego) | D |
| DASH-021 | UI/UX | Dashboard | Botão "Relatório Operacional" descarta o retorno; cliques em eventos/inbox sem ação | `DepartmentOperationHome.tsx:44-82` | PILOTO (corrigir p/ demo) | B |
| NAV-023 | NAV | Multi-tenant | Sem seletor de organização na UI; client nunca envia `X-Organization-Id` | `main.tsx:39-52` (verificado) | PILOTO (single-org auto-resolve) | B |
| ARCH-025 | ARCH | IA | Geração DFD/ETP/TR legada chama Gemini direto (`services/gemini.ts`), fora de `_core/llm.ts` | `gemini.ts:41`; `documentsRouter.ts:22` | PILOTO | C |

---

## P2 — Curto prazo

| ID | Categoria | Domínio | Achado | Evidência | Decisão | Bloco |
|---|---|---|---|---|---|---|
| TENANT-030 | tenant | Schema | 24 tabelas-filhas institucionais sem `organizationId` (acesso por id do filho) | `schema.ts` (processItems, taskAttachments, digitalSignatures…) | PILOTO | A/D |
| TENANT-031 | tenant | Repos | `assertTenantOwnership` implementado mas nunca chamado em produção; 42/74 routers em `protectedProcedure` | `tenantRepository.ts:12`; grep | POST | A |
| TENANT-032 | tenant | RAG | `institutionalRagRouter`/`ragGovernanceRouter` usam `ctx.organizationId!` sob `protectedProcedure` = sempre null (bucket único) | `institutionalRagRouter.ts:13`; `context.ts:44` | MÓD (órfão) | C |
| TENANT-033 | tenant | Multi | ~15 routers aceitam `organizationId` do input sem validar membership (mitigado: stores in-memory) | `exportRouter.ts:26`; `webhookRouter.ts:62` | FLAG | C |
| SEC-034 | SEC | Auth | Rate limit de login in-memory (reseta a cada deploy, spoofável por `x-forwarded-for`) | `rateLimiter.ts:49-110` | PILOTO | A |
| SEC-035 | SEC | Auth | Cookie `sameSite: "none"` (resíduo Manus/iframe) — superfície CSRF em app same-origin | `_core/cookies.ts:45` | PILOTO | A |
| SEC-036 | SEC | Infra | Helmet com `contentSecurityPolicy: false` também em produção | `_core/index.ts:39` | PILOTO | D |
| SEC-037 | SEC | Uploads | Anexos de tarefa sem validação de tenant/MIME/tamanho; `fileUrl` arbitrário | `departmentTasksRouter.ts:83-114` | BLOQ (parte de TENANT-002) | A |
| TENANT-038 | tenant | CATMAT | `catmatRouter` inteiro em `publicProcedure` — proxy anônimo sem rate limit | `catmatRouter.ts:32,89,133,180` | PILOTO | A |
| DATA-039 | DATA | Banco | Sequences (aditivo/apostila/versão) = `count+1` read-then-write sem lock (race) | `contractService.ts:241`; `documentsRouter.ts:73,477` | PILOTO | D |
| DATA-040 | DATA | Schema | 19 tabelas em migrations ausentes do `schema.ts`; 15 do bootstrap sem schema | seção C do relatório de repos | POST | D |
| DATA-041 | DATA | Schema | Zero FKs no banco; integridade referencial 100% na aplicação | schema.ts/migrations | POST | D |
| DATA-042 | DATA | Schema | `ensureSchema` = ~4.000 linhas de DDL manual rodando em todo boot (contorna migrations) | `bootstrap.ts:46-4200` | POST | D |
| OBS-043 | OBS | Infra | Sem endpoint HTTP `/health` (só tRPC `system.health`) — healthcheck Railway não usa | `systemRouter.ts:40`; `index.ts` | PILOTO | D |
| OBS-044 | OBS | Infra | Sem Sentry/APM; 178 `console.*` crus no server ao lado de `structuredLog` | `observabilityService.ts:24`; grep | POST | D |
| OBS-045 | OBS | IA | CorrelationId server→IA ok, mas client nunca envia `X-Correlation-Id` (sem ponta a ponta) | `main.tsx:39-51` | POST | C |
| REPLAY-046 | REPLAY | Multi | `idempotencyService` (com DB) usado só em `contractWorkspace`; IA/export/upload/aprovação sem idempotência | `idempotencyService.ts`; grep | POST | C |
| ERR-047 | ERR | Frontend | `ErrorBoundary` exibe stack trace cru em inglês; alguns erros legados vazam message | `ErrorBoundary.tsx:34-40` | PILOTO | B |
| ERR-048 | ERR | Banco | `getDb()` retorna null silencioso → idempotência/auditoria viram no-op sem alarme | `db/connection.ts:6-16`; `activityLogService.ts:28` | POST | D |
| DEPLOY-049 | DEPLOY | CI | 5 de 7 smokes MySQL (isolamento tenant, geração documental) nunca rodam no CI | `ci.yml:69-80` | PILOTO | D |
| DEPLOY-050 | DEPLOY | Railway | Zero config Railway no repo; `findAvailablePort` troca porta silenciosamente | `index.ts:25-32,62` | PILOTO | D |
| DEPLOY-051 | DEPLOY | Backup | Backup 100% manual (workflow_dispatch, artifact 7d); restore nunca exercitado | `db-backup.yml`; `backups/*.md` | PILOTO | D |
| PERF-052 | PERF | Banco | Listagens sem paginação; `getDocumentsByProcess` retorna `content` markdown inteiro; N+1 em `getActivityLogs` | `db/processes.ts:14-30,111`; `processesRouter.ts:28-36` | PILOTO | D |
| TEST-053 | TEST | Cobertura | Módulo Gestão (tarefas) e billing sem teste dedicado | inventário de testes | POST | D |
| UI-054 | UI | Frontend | Rotas `/test`, `/test2`, `/test3` públicas; `/test4` autenticada — debug em produção | `App.tsx:205-208` | PILOTO (remover) | B |
| UI-055 | UI | Frontend | UI em inglês em `NotFound` num produto pt-BR | `NotFound.tsx:27-46` | PILOTO | B |
| DOC-056 | DOC | Config | CLAUDE.md diz `AWS_REGION`; código lê `AWS_S3_REGION`; `.env.example` desatualizado | `CLAUDE.md` vs `config/aws.ts:22` | PILOTO (config 1º deploy) | D |
| DOC-057 | DOC | Config | `GEMINI_API_KEY` exigido no boot mas comentado como opcional (inconsistência) | `config/env.ts:47,60` | POST | D |
| DOC-058 | DOC | Central | Falha de geração automática de DFD engolida sem feedback | `processesRouter.ts:105-107` | PILOTO | B |

---

## P3 — Melhoria futura

| ID | Categoria | Achado | Evidência |
|---|---|---|---|
| LEGACY-070 | legacy | `routers.ts.backup` (962 l.) e `proposalRouter.ts.backup` (314 l.) mortos | `LEGACY_INVENTORY.md:220-226` |
| LEGACY-071 | legacy | 28 routers registrados sem consumer no frontend (camada IA/governança sprints 4x-5x) | `routers.ts:78-151` |
| LEGACY-072 | legacy | Módulos Manus mortos em `_core` (dataApi, map, imageGeneration, voiceTranscription); feature-flag services sem consumidor | grep |
| LEGACY-073 | legacy | 4 páginas órfãs: `Home.tsx`, `Modules.tsx`, `ComponentShowcase.tsx`, `AdminPlatforms_ChecklistEditor` (falso positivo — é usada) | grep imports |
| LEGACY-074 | legacy | Pipeline de importação (6 serviços + ~10 tabelas) sem router e sem UI — código de sprint | grep |
| SEC-075 | SEC | `.manus/db/db-query-*.json` versionado: host + usuário do TiDB legado | `.manus/db/*.json` |
| DEP-076 | deps | Deps não usadas: `openai`, `jspdf`, `html2canvas`, devDep `add`; `@builder.io/vite-plugin-jsx-loc` (Manus) ativo no build | `package.json`; `vite.config.ts:8` |
| DATA-077 | DATA | `seed-test-data.mjs` quebrado (importa `invoiceInstallments` inexistente); sem seed do tenant Moreira Sales | `seed-test-data.mjs:2` |
| DATA-078 | DATA | 6 tabelas com org sem índice de org; `drizzle/migrations/` vazia (migrations em `drizzle/`) | schema/migrations |
| UX-079 | UX | Cores hardcoded (bg-white/text-gray) quebram dark mode em Contratação Direta/Parecer/Contratos | `DirectProcurementHome.tsx:51` |
| UX-080 | UX | Título `<h1>` duplicado (wrapper + home) nas telas de domínio | `DirectProcurement.tsx:19` |
| NAV-081 | NAV | `/auditoria`, `/analytics`, `/gestao-departamento`, `/personalizacao-documentos`, `/modulos` só por URL manual | `App.tsx:166-192` |
| NAV-082 | NAV | Itens duplicados na sidebar (Dashboard + Centro de Operações = mesma página); alguns itens saem do shell | `DashboardLayout.tsx:36`; `App.tsx:127` |
| UI-083 | UI | Mocks hardcoded em `components/legal-ai/*`, `knowledge-graph/*` etc. — não roteados (dead code) | grep imports |
| DOC-084 | DOC | Assinatura no fluxo canônico de parecer é só transição de estado; assinatura digital só no legado | `legalOpinionWorkspaceService.ts:243` |

---

**Total: 68 achados** — 5 P0, 19 P1, 29 P2, 15 P3 (contagem inclui os P2/P3 tabelados acima).

> **Severidade ≠ decisão de go-live.** A severidade (P0/P1/P2/P3) classifica a natureza e o
> impacto técnico do achado. A coluna "Bloqueia?" e o **Gate de Produção Interna**
> (`INTERNAL_PRODUCTION_GATE.md`) determinam se o item impede o piloto — um P1 ou mesmo um P2
> pode bloquear o go-live conforme exposição e contexto. A severidade não substitui o gate.
