# Inventário de Rotas e Routers tRPC
### LiciGov Pro · Piloto Moreira Sales · 2026-07-22

Fonte: `client/src/App.tsx` (rotas), `server/routers.ts` (74 routers montados + `system`),
contagem de procedures por `grep -c` do tipo de procedure em cada `server/routers/*.ts`.

---

## 1. Rotas do frontend (App.tsx)

| Página | Rota | Shell? | Consumer tRPC principal | Canônico/Legado | Status |
|---|---|:---:|---|---|---|
| CentroOperacoes | /dashboard, /centro-operacoes | ✅ | departmentOperation.* | Canônico | Ativo (home) |
| Dashboard (processos) | /processos | ✅ | processes.list | Legado ativo | Ativo (IDOR no backend) |
| DirectProcurement | /contratacao-direta | ✅ | directProcurement.* | Canônico | Ativo |
| ParecerJuridico | /parecer | ✅ | legalOpinionWorkspace.* | Canônico | Ativo |
| ContratosWorkspace | /contratos | ✅ | contractWorkspace.* | Canônico | Ativo |
| TirarDuvidas | /tirar-duvidas | ✅ | institutionalConsultation.* | Canônico | Ativo |
| NewProcess | /novo-processo | ❌ | processes.create | Legado ativo | Ativo |
| ProcessDetails | /processo/:id | ❌ | documents.*, processes.* | Legado ativo | Ativo (abas DFD/ETP/TR) |
| ModuleSelectionDashboard | /modulos | ❌ | contracts.analytics, processes, directContracts, tasks | Legado | Só por URL |
| DirectContracts (+ new/:id/analytics) | /direct-contracts* | ❌ | directContracts.* | Legado | Só por URL |
| Contracts (+ new/:id/alerts) | /contracts* | ❌ | contracts.* | Legado (corrigido) | Só por URL |
| LegalOpinions (+ novo/:id/analytics) | /parecer-juridico* | ❌ | legalOpinions.* | Legado (corrigido) | Só por URL |
| Templates | /templates | ❌ | templates.list | Canônico | Ativo (fora do shell) |
| DocumentSettings | /personalizacao-documentos | ❌ | documentSettings.* | Canônico | Só por URL |
| Settings | /configuracoes | ❌ | documentSettings.* | Canônico | Ativo (fora do shell) |
| ActivityReport | /auditoria | ❌ | — | Canônico | Só por URL |
| Analytics | /analytics | ❌ | analytics.* | Legado | Só por URL |
| DepartmentManagement | /gestao-departamento | ❌ | — | Canônico | Só por URL |
| CommercialManagement | /gestao-comercial, /admin/propostas | ❌ | commercial.* | Fora do piloto | Só por URL |
| AIUsageDashboard | /admin/ai-costs | ❌ | aiUsage.* | Admin | Só por URL |
| AdminPlatforms | /admin/platforms | ❌ | platforms.* | Canônico | Ativo |
| PublicationLogs | /admin/publication-logs | ❌ | — | Admin | Só por URL |
| Admin | /admin | ❌ | admin.* | Admin | Só por URL |
| TestPage 1-4 | /test, /test2, /test3, /test4 | ❌ | — | **Debug** | **Público (1-3)** |
| Home, Modules, ComponentShowcase | — | — | — | Órfã | **Sem rota** |

---

## 2. Inventário de routers tRPC (74 + system)

Contagem: pub=publicProcedure, prot=protectedProcedure, ten=tenantProcedure, adm=admin/orgRole.
Consumer FE = tem `trpc.<nome>.` no client.

### Tenant-safe (tenantProcedure + ctx.organizationId) — ~32 routers, seguros
`adaptiveRecommendation, agentExecution, approvalWorkflow, businessDomain, context,
contractWorkspace, contracts¹, copilot, copilotGovernance, departmentOperation, directProcurement,
documentEngine, drafting, institutionalConsultation, institutionalRequest, itemIntelligence,
knowledgeGraph, legalOpinionWorkspace, legalOpinions¹, legalReasoning, moduleLicensing,
operationRecord, ontology, procurementProcess, promptOrchestration, provider, providerGovernance,
semanticGovernance, semanticRetrieval, workspace, workspaceGovernance`
(¹ = corrigidos nas PRs #182/#183). **Sem achado de isolamento.**

### Institucionais em protectedProcedure com VULNERABILIDADE — bloco A

| Router | pub | prot | ten | adm | Consumer FE | Achado |
|---|:---:|:---:|:---:|:---:|:---:|---|
| processes | 0 | 16 | 0 | 0 | ✅ | **TENANT-001 (P0)** — getById/itens/status sem check |
| task | 0 | 13 | 0 | 0 | ✅ | **TENANT-002 (P0)** — list/getById/update/delete globais |
| departmentTasks | 0 | 14 | 0 | 0 | ✅ | **TENANT-002 (P0)** — delete/getById/anexos globais |
| activities | 0 | 2 | 0 | 0 | ⚠️ | **TENANT-002 (P0)** — listByProcess sem check |
| comments | 0 | 5 | 0 | 0 | ✅ | **TENANT-002 (P0)** — list sem check |
| aiAssistant | 0 | 7 | 0 | 0 | ✅ | **TENANT-007 (P1)** — IA sobre qualquer processo |
| onboarding | 0 | 8 | 0 | 0 | ❌ | **RBAC-004 (P0)** — auto-concessão de permissão global |
| documents | 0 | 17 | 0 | 0 | ✅ | **TENANT-008 (P1)** — repo global, router user-scoped |
| directContracts | 0 | 38 | 0 | 0 | ✅ | **TENANT-006 (P1)** — analytics global; user-scoped |

### Públicos indevidos — bloco A

| Router | pub | Consumer FE | Achado |
|---|:---:|:---:|---|
| deployment | 11 | ❌ | **AUTH-003 (P0)** — ops sem login |
| stability | 12 | ❌ | **AUTH-003 (P0)** — métricas/ops sem login |
| catmat | 5 | ✅ | TENANT-038 (P2) — proxy anônimo |

### Org-do-input (in-memory/demo, P1-P2) — bloco C
`clause, collaborationComments, exports, structuredExports, webhooks, reviewWorkspace, itemTr,
trComposition, itemAnalytics, pilotReadiness, productionReadiness` — aceitam `organizationId`
do input sem validar membership; maioria com store em memória (baixo impacto atual).

### Bug de tenant (protectedProcedure + `ctx.organizationId!` = null)
`institutionalRag, ragGovernance` — TENANT-032 (P2), bucket único compartilhado; órfãos do FE.

### Admin/user-scoped — OK
`admin, aiUsage, auth, billing, commercial, companyDocuments, contact, documentSettings,
downloadRouter, lgpd, notifications, organizations (orgRole), platforms, system`.

### Routers sem consumer no frontend (28) — LEGACY-071 (P3)
`adaptiveRecommendation, agentExecution, approvalWorkflow, context, copilotGovernance,
deployment, drafting, editalParameters, institutionalRag, legalReasoning, lgpd, onboarding,
ontology, organizations, pilotReadiness, productionReadiness, promptOrchestration,
providerGovernance, providers, ragGovernance, semanticGovernance, semanticRetrieval, stability,
structuredExports, system, trComposition, webhooks, workspaceGovernance`
(ressalva: `webhooks` pode ter consumo externo; `system.health` é diagnóstico).

---

## 3. Resumo quantitativo

- **74 routers** montados (+ system). **~45 institucionais** (lidam com dados de órgão).
- **~32 tenant-safe** + **2 corrigidos** (contracts, legalOpinions).
- **~9 institucionais com IDOR/global** confirmados (processes, task, departmentTasks,
  activities, comments, aiAssistant, onboarding, documents, directContracts).
- **2 routers públicos indevidos** (deployment, stability) = 23 procedures sem auth.
- **28 routers sem consumer no frontend** (camada IA/governança de sprints, órfãos).
- **Repositories legados sem filtro de org** consumidos por esses routers:
  `db/processes.ts`, `db/tasks.ts`, `db/processItems.ts`, `db/directContracts.ts`,
  `db/collaboration.ts`.
