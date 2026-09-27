# R2.1 — Inventário congelado de superfícies legadas montadas

> Programa: **Remediação da Auditoria Semântica** · roadmap **v1.0** · fase **R2 — Legacy Reachability & Cutover** ·
> checkpoint **R2.1**. Baseline de código: main **`141bcad`** (contém #260/SEM-001, #261/PR-01A/NEW-001, migration 0307).
> Plano mestre: [`SEMANTIC_AUTHORITY_REMEDIATION_MASTER_PLAN.md`](SEMANTIC_AUTHORITY_REMEDIATION_MASTER_PLAN.md) ·
> Baseline da auditoria (inalterado): [`SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md`](SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md).

## 1. Objetivo

Congelar, com evidência de código, **todas** as superfícies legadas ou duplicadas ainda **montadas** no LiciGov Pro, cobrindo, conforme a definição de R2.1 no plano (§8):
- rota de UI;
- menu;
- caller de frontend;
- API tRPC.

Para cada superfície, o inventário registra também:
- alcance (reachability);
- boundary de autenticação e de tenant;
- dados consumidos;
- alternativa canônica;
- achado associado;
- tratamento FIX/CUTOVER/DISABLE, **quando já congelado**, ou proposto com **decisão humana pendente**.

Este documento **não corrige nada**. Ele prepara o escopo de PR-02, PR-03, PR-04 e PR-14 e das decisões de R2.2 e R2.3.

## 2. Metodologia

- **Somente código, somente leitura:**
  - branch `docs/r2-legacy-reachability-inventory` a partir de `origin/main` `141bcad`;
  - `rg`/`git grep` e leitura de routers, pages, componentes e hooks;
  - grafo de imports a partir de `client/src/main.tsx` (imports estáticos e dinâmicos; 615 arquivos não-teste; 325 deles inalcançáveis a partir de qualquer página);
  - leitura dos testes-guarda existentes.
- **Sem produção:**
  - nenhum acesso a banco ou tabela de produção, nenhuma contagem de registros;
  - nenhuma chamada tRPC em produção, nenhum cookie ou JWT;
  - nenhuma feature flag lida ou alterada;
  - uso real de `legal_opinions`, `direct_contracts`, `contracts` e `processes` fica para **R2.3**.
- **Reachability por wiring, nunca por nome.** Uma superfície é:
  - **roteada** se um `<Route>` em `client/src/App.tsx` monta a página;
  - **com caller ativo** se o componente que chama a procedure é alcançável, transitivamente, a partir de uma página roteada;
  - **API-reachable** se o router está agregado em `appRouter` (`server/routers.ts:91-164`).
- **Classes de caller:**
  - `ACTIVE_CALLER`: alcançável a partir de página roteada;
  - `UNROUTED_CALLER`: só via página não roteada;
  - `TEST_ONLY`;
  - `NO_CALLER`;
  - `SERVER_INTERNAL`.
- **Menu:** `client/src/components/DashboardLayout.tsx:36-54`, com os filtros `adminOnly` (`:243`) e `requiresOrgAdmin` (`:245`).
- **Taxonomia de reachability** (fixada nesta execução):
  - `CANONICAL_ACTIVE`;
  - `LEGACY_UI_REACHABLE`;
  - `LEGACY_API_REACHABLE`: API montada, sem caller de UI roteada;
  - `LEGACY_UI_AND_API_REACHABLE`;
  - `LEGACY_UNROUTED_BUT_API_REACHABLE`: UI existe, mas não roteada;
  - `LEGACY_INERT`: não executa efeito, como `processes.create` desativado ou página morta;
  - `COMPATIBILITY_LAYER`;
  - `UNKNOWN`.
- **Distinções obrigatórias.** "Sem menu" ≠ "não roteado" ≠ "API não montada" ≠ "API montada sem caller" ≠ "endpoint protegido" ≠ "endpoint inutilizável". Uma superfície sem UI continua atacável se a API está montada.

## 3. Baseline

| Item | Valor |
|---|---|
| main | `141bcad59f2098a7ce2069c8cc138f2b5b58b1dc` |
| CI main | run #657 `36281687564` SUCCESS |
| Deploy (contexto, não consultado para uso) | Railway `b85dd763` SUCCESS |
| Rotas UI | `client/src/App.tsx:174-262` |
| Routers montados | `server/routers.ts:91-164` (~90) |
| Registro arquitetural de legado | `server/kernel/architecture/legacyBoundaries.ts:127-224` (LEGACY_ACTIVE_MAINTENANCE_ONLY: `documentsRouter`, `processesRouter`, `contractsRouter`, `legalOpinionsRouter`, `gemini.ts`, páginas `Dashboard`/`ProcessDetails`/`NewProcess`). `directContractsRouter` **não** está registrado. |
| R1 | R1.1–R1.9 PASS; **R1.10 IN_PROGRESS**. A produção tem hoje um único tenant conhecido; o smoke cross-tenant de R1.10 continua impraticável sem criar dado artificial, o que não será feito. |

**Menu** (`DashboardLayout.tsx`):
- **Visível para todos:**
  - `/dashboard` :37;
  - `/centro-operacoes` :38;
  - `/processos` :39;
  - `/contratacao-direta` :40;
  - `/parecer` :41;
  - `/contratos` :42;
  - `/tirar-duvidas` :43;
  - `/templates` :44.
- **Admin do órgão:** `/usuarios` :48, `/configuracoes` :51.
- **Admin de plataforma:** `/admin/platforms` :52, `/admin/organizacoes` :53.

Nenhuma rota legada tem entrada de menu.

## 4. Tabela consolidada

Legenda:
- **Auth:** `T` = `tenantProcedure`; `OR(x)` = `orgRoleProcedure(x)`; `P` = `protectedProcedure`; `A` = admin.
- **Tenant:**
  - `ctx` = organização do contexto;
  - `input` = `organizationId` vem do cliente;
  - `pai` = escopo pelo registro-pai;
  - `nulo` = organização sempre null.
- **HDR:** decisão humana requerida.
- **Tratamento:** `—` = nada congelado.

| Surface ID | Domain | Legacy Surface | Finding(s) | Frontend Route | Menu | Frontend Caller | API Router | Procedure(s) | API Mounted | Auth Boundary | Tenant Boundary | Data/Table | Canonical Alternative | Reachability | Current Treatment | Proposed Treatment | HDR | Future PR | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LEG-001 | Colaboração | membros e responsáveis por etapa do processo legado | SEM-001 (corrigido #260), NEW-001 (corrigido #261) | nenhuma (`ProcessDetails` não roteado) | NO_MENU | UNROUTED_CALLER (`MembersDialog.tsx:72-106`, `StageAssignmentPanel.tsx:28-49`) | `collaboration` | 9 procedures | API_MOUNTED (`routers.ts:97`) | T | ctx (#260) | `process_members`, `stage_assignments`, `notifications`, `activity_logs` | PARTIAL: `procurement_processes.responsibleUser`/`participants` (`schema.ts:5164-5165`), sem gestão de membros nem responsável por etapa | LEGACY_UNROUTED_BUT_API_REACHABLE | FIX aplicado (SEM-001/NEW-001) | DISABLE (governado) **ou** manter como FIX estratégico | **YES** | a definir (candidata PR-02) | `collaborationRouter.ts:147-345` | o plano deixou "desativação avaliada em R2" (§3, SEM-001) |
| LEG-002 | Processo (legado) | `processes.create` | — | nenhuma (`/novo-processo` → `/processos`) | NO_MENU | UNROUTED_CALLER (`NewProcess.tsx:46`) | `processes` | create | API_MOUNTED (`routers.ts:92`) | T | — | nenhuma escrita | YES: `procurementProcess.createProcess` (`procurementProcessRouter.ts:73`) | LEGACY_INERT (erro governado) | DISABLE já aplicado | manter DISABLE | não | — | `processesRouter.ts:67-84`, `legacyPipeline.ts:23-37` | não conclui nada sobre os demais endpoints |
| LEG-003 | Processo (legado) | leitura de processos legados | — | `/admin` (App:241), `/parecer/novo` (App:213) | NO_MENU (deep link) | ACTIVE_CALLER (`Admin.tsx:24`, `NewLegalOpinion.tsx:46`) | `processes` | list, search, getById | API_MOUNTED | T | ctx | `processes` | YES: `procurementProcess.listProcesses`/`loadProcess` (:143/:129); busca NO | LEGACY_UI_AND_API_REACHABLE | — | CUTOVER (acompanha LEG-012 e LEG-027) | **YES** | PR-03 / a definir | `processesRouter.ts:43,47,87` | `search` e `getById` só UNROUTED/TEST |
| LEG-004 | Auditoria | relatório de atividades por processo legado | SEM-046 (P2) | `/auditoria` (App:195) | NO_MENU | ACTIVE_CALLER (`ActivityReport.tsx:16`) | `processes` | getActivityLogs | API_MOUNTED | T | ctx (N+1) | `processes` + `activity_logs` | PARTIAL: `departmentOperation.timeline` (`departmentOperationRouter.ts:60`), timeline por processo (`loadProcess`) | LEGACY_UI_AND_API_REACHABLE | — | CUTOVER → Centro de Operações | **YES** | a definir (R10) | `processesRouter.ts:53-65` | ignora logs canônicos: sem processos legados, a página tende a vir vazia |
| LEG-005 | Processo (legado) | itens do TR e sugestões CATMAT legadas | — | nenhuma | NO_MENU | UNROUTED_CALLER (`TRItemsModal`, `ImportItemsModal`, `CatmatSuggestionsModal`, `EditItemDialog`) | `processes` | addItemsToTR, getProcessItems, parseItemsFile, generate/get/approve/rejectCatmatSuggestion(s), update/deleteProcessItem | API_MOUNTED | T | pai; **generateCatmatSuggestions chama a IA antes de checar a organização** | `process_items`, `catmat_suggestions`, `activity_logs` (sem orgId) | PARTIAL: `itemIntelligence.*`, `procurementItems.*`, `ingestion.*` | LEGACY_UNROUTED_BUT_API_REACHABLE | — | DISABLE | **YES** | candidata PR-02 | `processesRouter.ts:97-340`; `processItems.ts:126-142` | `legacyBoundaries.ts:209` diz "VIVO no fluxo canônico" — FCC-04 |
| LEG-006 | Processo (legado) | mudança de status do processo legado | — | nenhuma | NO_MENU | NO_CALLER (só TEST) | `processes` | updateStatus | API_MOUNTED | T | ctx | `processes`, `activity_logs`, e-mail | YES: `procurementProcess.issueProcess` (e ver LEG-010) | LEGACY_API_REACHABLE | — | DISABLE | **YES** | candidata PR-02 | `processesRouter.ts:341-362` | envia e-mail real (`sendStatusChangeEmail`) |
| LEG-007 | UI (legado) | subárvore de `ProcessDetails` e páginas mortas | — | nenhuma; `/processo/:id` → `/processos` (App:238) | NO_MENU | DEAD (sem importador) | vários | — | n/a | — | — | — | YES: `/processos` (`ProcessoLicitatorio`) | LEGACY_INERT (UI) | UNROUTED (guardas: `pr-b-canonical-wiring.test.ts:32`, `rc-c01a-legacy-freeze.test.ts:79`) | DISABLE (remoção de código morto) | **YES** | a definir (R10) | `App.tsx:15-18`; páginas mortas: `Dashboard`, `NewProcess`, `ModuleSelectionDashboard`, `Modules`, `Home`, `Contracts`, `DirectContracts`, `LegalOpinions`, `ComponentShowcase` | remover a UI não fecha as APIs (LEG-001/005/008/018–022) |
| LEG-008 | Documentos (legado) | revisão/aprovação legada | **SEM-018** | nenhuma | NO_MENU | NO_CALLER (o painel usa `documentReview.*`) | `documents` | approveDocument (SEM-018); submitForReview, rejectDocument | API_MOUNTED (`routers.ts:93`) | T (dono do processo, sem papel) | ctx | `documents.documentStatus` (a mesma coluna do canônico, sem ledger) | YES: `documentReview.submitForReview/approve/reject` (`documentReviewRouter.ts:37-63`) | LEGACY_API_REACHABLE | **DISABLE (PR-02, congelado p/ approveDocument)** | estender DISABLE a submit/reject | **YES** (só a extensão) | PR-02 | `documentsRouter.ts:720-761`; `db/processes.ts:235-247` | o plano §3 usa "LEGACY_INERT (API montada)": taxonomia (FCC-05) |
| LEG-009 | Documentos (legado) | autoria/versão/export legados | SEM-079 (P1, restoreVersion) | nenhuma | NO_MENU | UNROUTED_CALLER (`useProcessDocuments.ts`, `VersionHistoryDialog.tsx`, `useDocumentDownload.ts`); save/getByType TEST_ONLY; generateNext/list NO_CALLER | `documents` | listByProcess, list, save, getByType, generateNext, updateDocument, generateDocument, uploadDocument, getDownloadUrl, getVersionHistory, restoreVersion, downloadDocx, downloadPdf | API_MOUNTED | T (dono/membro) | ctx; 3 inserts **sem organizationId** (:484, :541, :605) | `documents`, `processes.status`, S3, Gemini direto | PARTIAL: `procurementProcess.generate*`/`saveDFD`/`saveReviewableDraft`/`exportDocument`, `documentEngine.*`; ata: NONE | LEGACY_UNROUTED_BUT_API_REACHABLE | — | DISABLE | **YES** | candidata PR-02 | `documentsRouter.ts:112-716` | `rc-c01a-legacy-freeze.test.ts:119` fixa a forma do router |
| LEG-010 | Processo (canônico) | salto genérico de etapa | **SEM-015** | nenhuma | NO_MENU | NO_CALLER | `procurementProcess` | updateStage | API_MOUNTED (`routers.ts:152`) | OR(operator) | ctx | `procurement_processes`, `process_timeline` | YES: `issueProcess` (OR(manager) + Edital oficial, :633-650) | LEGACY_API_REACHABLE (endpoint de router canônico sem uso) | **DISABLE (PR-02, congelado)** | manter | não | PR-02 | `procurementProcessRouter.ts:151-162`; domain `procurementProcess.ts:131-141` | sem `stage`, avança REVIEW → ISSUED/"emitido" |
| LEG-011 | Contratação Direta (canônico) | salto genérico de etapa | — (não está no baseline) | nenhuma | NO_MENU | NO_CALLER | `directProcurement` | updateStage | API_MOUNTED | **T (sem papel)** | ctx | workspace canônico | PARTIAL: transições específicas (`ratify`, `publish`) | LEGACY_API_REACHABLE | — | DISABLE (análogo a SEM-015) | **YES** | candidata PR-02 | `directProcurementRouter.ts:97-100` | FCC-02 |
| LEG-012 | Parecer (legado) | parecer legado e páginas por deep link | **SEM-016, SEM-017** | `/parecer/novo`, `/parecer/analytics`, `/parecer/:id` (App:213-215) + LegacyRedirect `/parecer-juridico/*` (:228-231) | NO_MENU (menu só `/parecer` canônico) | ACTIVE_CALLER (`NewLegalOpinion.tsx:43-51`, `LegalOpinionDetails.tsx:24-88`, `SetSignaturePasswordDialog.tsx:33`, `LegalOpinionsAnalytics.tsx:17`); único link: `DirectContractDetails.tsx:45` | `legalOpinions` | 14 procedures (list, getById, getBySource, create, update, delete, exportPDF, exportDOCX, generateOpinion, sign, verifySignature, getAnalytics, set/hasSignaturePassword, getSignatureHistory) | API_MOUNTED (`routers.ts:116`) | T (+P em signaturePassword) | ctx; `signature_history` sem orgId | `legal_opinions`, `signature_history`, `digital_signatures`, `users.signaturePassword` | PARTIAL/YES: `legalOpinionWorkspace.*` (`legalOpinionWorkspaceRouter.ts:34-192`), export `documentEngine.exportInstitutional`. NO: analytics, parecer para processo licitatório, verificação de assinatura | LEGACY_UI_AND_API_REACHABLE | **CUTOVER (PR-03, congelado)** | manter; somente leitura do histórico dependente de R2.3 | não (o tratamento está congelado); **YES** p/ lacunas canônicas | PR-03 | `legalOpinionsRouter.ts:65-527`; update :145-181, delete :192, generateOpinion :266-311 | nenhum código canônico lê `legal_opinions`; o servidor não bloqueia SEM-016/017 |
| LEG-013 | Pesquisa de Preços | colagem legada no Processo Licitatório | **SEM-005** | `/processos` (aba Pesquisa de Preços) | MENU_VISIBLE (`/processos`) | ACTIVE_CALLER (`PesquisaPrecosWorkspace.tsx:40-120`), exibido quando a flag está OFF **ou** a consulta de capabilities falha (:139-165) | `procurementProcess` | importPriceResearch | API_MOUNTED | OR(operator) | ctx | `price_research`, `price_research_items`, `intelligent_items` | YES: `DocumentIngestionLauncher` (`allowPaste`) → `ingestion.*` supervisionado | LEGACY_UI_AND_API_REACHABLE | **CUTOVER (PR-04, congelado)** | manter; a API **não** checa a flag | não (tratamento); R2.2 é decisão própria | PR-04 | `procurementProcessRouter.ts:362-405`; `priceResearch.ts:50-52,80-82`; `db/procurement.ts:152-175` | o guard da flag é só de UI: o fallback continua API-reachable (FCC-03) |
| LEG-014 | Contratação Direta (canônico) | colagem de pesquisa na justificativa de preço | SEM-005 (o mesmo código de sobrescrita) — FCC-01 | `/contratacao-direta` | MENU_VISIBLE | ACTIVE_CALLER (`PriceJustificationWorkspace.tsx:22,41`) | `directProcurement` | importPriceResearch | API_MOUNTED | **T (viewer escreve)** | ctx | `price_research*` (sem transação, `directProcurementService.ts:55-73`) | NO: não há ingestão canônica para Contratação Direta | CANONICAL_ACTIVE | — | FIX (id por importação, como no baseline) **ou** CUTOVER para ingestão | **YES** | PR-04 (ampliar) ou nova | `directProcurementRouter.ts:139-146` | a CUTOVER do LEG-013 **não** cobre este caminho |
| LEG-015 | Contratação Direta (legado) | contratação direta legada e páginas por deep link | SEM-012 (analytics em centavos), SEM-072 (P1, pacote) | `/contratacao-direta/novo`, `/analytics`, `/:id` (App:207-209) + LegacyRedirect `/direct-contracts/*` (:220-223) | NO_MENU | ACTIVE_CALLER (`NewDirectContract.tsx:70-79`, `DirectContractDetails.tsx:22` + tabs/modais, `DirectContractsAnalytics.tsx:19-22`, `Admin.tsx:25`, `NewLegalOpinion.tsx:47`); 3 procedures inexistentes chamadas via `as any` | `directContracts` | ~36 procedures (create, list, getById, update, assistant.*, legalArticles.*, documents.*, quotations.*, generate.*, presential.*, platforms.*, validation.*, audit.*, checklist.*, analytics.*) | API_MOUNTED (`routers.ts:114`) | T | ctx/pai; serviços usam `getDirectContractById` sem escopo após o guard | `direct_contracts` e filhas (sem FK) | PARTIAL: `directProcurement.*` (tabelas próprias, ids string). NO: pacote presencial, checklists de plataforma, CNPJ, catálogo de artigos, export de auditoria, analytics de valor | LEGACY_UI_AND_API_REACHABLE | CUTOVER só para SEM-012 (PR-14, congelado) | CUTOVER da superfície inteira | **YES** (lacunas canônicas + R2.3) | PR-14 (+ a definir) | `directContractsRouter.ts:91-1222` | não é SHARED_INFRA: o canônico não lê nem grava `direct_contracts` |
| LEG-016 | Contratos (legado) | contratos legados e páginas por deep link | — (SEM-011/084 tratam limites no canônico) | `/contratos/novo`, `/alertas`, `/:id` (App:210-212) + LegacyRedirect `/contracts/*` (:224-227) | NO_MENU | ACTIVE_CALLER (`NewContract.tsx:66`, `ContractDetails.tsx:35-82`, `NewAmendmentModal.tsx:47`, `NewApostilleModal.tsx:45`, `ContractAlerts.tsx:17-46`, `Admin.tsx:26`, `NewLegalOpinion.tsx:51`); link `DirectContractDetails.tsx:57` | `contracts` | 23 procedures (create, getById, list, update, amendments.*, apostilles.*, documents.*, audit.*, analytics.*, generation.*, notifications.*, reports.*) | API_MOUNTED (`routers.ts:115`) | T | ctx/pai | `contracts`, `contract_amendments`, `contract_apostilles`, `contract_documents`, `contract_audit_logs` | PARTIAL: `contractWorkspace.*` (tabelas próprias). NO: validação de 25%/prazo do aditivo, alertas/checkExpirations, exports Excel | LEGACY_UI_AND_API_REACHABLE | — | CUTOVER | **YES** (lacunas canônicas + R2.3) | a definir | `contractsRouter.ts:55-782` | `NewContract` envia reais onde a origem está em centavos e descarta originType/originId |
| LEG-017 | Gestão | router `tasks` duplicado | — | nenhuma | NO_MENU | UNROUTED_CALLER (`ModuleSelectionDashboard.tsx`) | `tasks` | 12 | API_MOUNTED (`routers.ts:108`) | T | ctx | `tasks` (a mesma camada `db/tasks.ts` de `departmentTasks`) | YES: `departmentTasks.*` | LEGACY_UNROUTED_BUT_API_REACHABLE | — | DISABLE | **YES** | a definir | `server/routers.ts:108`; `db/tasks.ts` | |
| LEG-018 | Gestão | vínculo de tarefa com processo legado e página por deep link | SEM-071 (P1) | `/gestao-departamento` (App:196) | NO_MENU | ACTIVE_CALLER (`TaskDetailModal.tsx:25-31`) | `departmentTasks` | listProcesses, getProcess, linkProcess (o resto do router é gestão de tarefas) | API_MOUNTED | T | ctx | `tasks`, **`processes` legado** | PARTIAL: `/centro-operacoes` (`LEGACY_INVENTORY.md:195-198` "substituído") | LEGACY_UI_AND_API_REACHABLE | — | CUTOVER (vincular ao processo canônico) | **YES** | a definir | `departmentTasksRouter.ts:266-296` | |
| LEG-019 | Analytics | analytics de processos/documentos legados | — | `/analytics` (App:240) | NO_MENU | ACTIVE_CALLER (`Analytics.tsx:26`) | `analytics` | getOverview | API_MOUNTED (`routers.ts:103`) | T | ctx | `processes`, `documents` (`db/admin.ts:127,138`) | PARTIAL: indicadores de `departmentOperation` | LEGACY_UI_AND_API_REACHABLE | — | CUTOVER → Centro de Operações | **YES** | a definir | `analyticsRouter.ts:20` | não reflete processos canônicos |
| LEG-020 | Colaboração (legado) | comentários sobre documento/processo legado | — | nenhuma | NO_MENU | UNROUTED_CALLER (`CommentsSection.tsx`) | `comments` | 4 | API_MOUNTED (`routers.ts:100`) | T | ctx | comentários sobre ids legados | NO (sem comentário canônico roteado) | LEGACY_UNROUTED_BUT_API_REACHABLE | — | DISABLE | **YES** | a definir | `commentsRouter.ts:10-43` | |
| LEG-021 | Pacotes (legado) | downloads e pacote de publicação | SEM-072 (P1) | nenhuma | NO_MENU | UNROUTED_CALLER (`ProcessDetails.tsx`, `PublicationPackageModal.tsx`) | `downloads`, `platforms.generatePublicationPackage` | 4 + 1 | API_MOUNTED (`routers.ts:113`) | P (dono) | ownerId, não organização | `processes`, `documents`, `process_items` | PARTIAL: `procurementProcess.exportDocument`, `documentEngine.exportInstitutional` | LEGACY_UNROUTED_BUT_API_REACHABLE | — | DISABLE | **YES** | a definir | `downloadRouter.ts:18-20`; `platformsRouter.ts:111-114`; `zipService.ts:41,85` | grava activity log sem orgId (SEM-046) |
| LEG-022 | IA (legado) | assistente de IA sobre processo legado | — | nenhuma | NO_MENU | UNROUTED_CALLER (`AiAssistantPanel.tsx`) | `aiAssistant` | 6 | API_MOUNTED (`routers.ts:117`) | T | ctx | `processes`, `documents`, `activity_logs` | YES: IA canônica via Kernel em `procurementProcess.*` (`legacyBoundaries.ts:116-126`) | LEGACY_UNROUTED_BUT_API_REACHABLE | — | DISABLE | **YES** | a definir | `aiAssistantRouter.ts:21-116` | |
| LEG-023 | Edital (legado) | parâmetros do Edital sobre processo legado | — | nenhuma | NO_MENU | NO_CALLER | `editalParameters` | 2 | API_MOUNTED (`routers.ts:95`) | T | ctx | `edital_parameters` sobre `processes` | YES: parâmetros do Edital no fluxo canônico (`procurementProcess`) | LEGACY_API_REACHABLE | — | DISABLE | **YES** | a definir | `editalParametersRouter.ts:25-51` | |
| LEG-024 | Notificações | leitura de notificações sem UI roteada | — | nenhuma | NO_MENU | UNROUTED_CALLER (`NotificationBell.tsx:21-37`) | `notifications` | list, unreadCount, markAsRead, markAllAsRead | API_MOUNTED (`routers.ts:98`) | P | por usuário | `notifications` (gravadas por collaboration e outros, 8 call sites) | NO | COMPATIBILITY_LAYER | — | FIX (expor UI) **ou** manter sem UI | **YES** | a definir | `notificationsRouter.ts:9-27` | notificações são gravadas e nunca vistas na UI roteada |
| LEG-025 | Atividades (legado) | atividades por processo legado | — | nenhuma | NO_MENU | UNROUTED_CALLER (`ProcessDetails.tsx:64`, `StageAssignmentPanel.tsx`) | `activities` | listByProcess | API_MOUNTED (`routers.ts:96`) | T | ctx | `activity_logs` | PARTIAL: timeline canônica | LEGACY_UNROUTED_BUT_API_REACHABLE | — | DISABLE | **YES** | a definir | `activitiesRouter.ts:11` | a tabela `activity_logs` é infra canônica e **não** pode ser desativada |
| LEG-026 | CATMAT (legado) | busca CATMAT direta | — | nenhuma | NO_MENU | UNROUTED_CALLER (`CatmatSearch.tsx`, `useCatalogSearch.ts`) | `catmat` | 4 (queries) | API_MOUNTED (`routers.ts:107`) | T | ctx | catálogo | YES: `itemIntelligence.*` (usado em `ProcurementItemPanel.tsx:87`) | LEGACY_UNROUTED_BUT_API_REACHABLE | — | DISABLE | **YES** | a definir | `catmatRouter.ts:33-175` | somente leitura |
| LEG-027 | Admin | página `/admin` sobre listas legadas | — | `/admin` (App:241), guarda só no cliente (`Admin.tsx:36`) | NO_MENU | ACTIVE_CALLER (`Admin.tsx:24-26`) | `admin`, `processes`, `directContracts`, `contracts` | admin.listUsers/promote/demote + listas legadas | API_MOUNTED | P + checagem de admin no corpo | ctx | `users`, tabelas legadas | PARTIAL: `/admin/organizacoes`, `/usuarios` | LEGACY_UI_AND_API_REACHABLE | — | CUTOVER | **YES** | a definir | `Admin.tsx:24-36,91-93` | |
| LEG-028 | Diversos | APIs experimentais em memória (sem banco) | — | nenhuma (`ReviewWorkspacePage`, `OperationalDashboardPage`, `ClauseWorkspacePage` sem importador) | NO_MENU | UNROUTED_CALLER / NO_CALLER | `itemTr`, `reviewWorkspace`, `trComposition`, `approvalWorkflow`, `collaborationComments`, `exports`, `structuredExports`, `webhooks`, `clauses`, `pilotReadiness`, `productionReadiness`, `itemAnalytics` (mock) | vários | API_MOUNTED | P ou T | **input** (a organização vem do cliente em vários: `itemTrRouter.ts:254`, `trCompositionRouter.ts:91`, `webhookRouter.ts:59-80`); approvalWorkflow approve/reject sem checar organização (`humanApprovalService.ts:80-97`) | `Map` em memória | NO (experimental) | LEGACY_UNROUTED_BUT_API_REACHABLE / LEGACY_API_REACHABLE | — | DISABLE | **YES** | a definir | ver `§6` | dado volátil, impacto baixo, mas viola INV-03 |
| LEG-029 | Plataforma | routers montados sem nenhum caller de cliente | — | nenhuma | NO_MENU | NO_CALLER | `onboarding`, `context`, `promptOrchestration`, `legalReasoning`, `drafting`, `agentExecution`, `providers`, `providerGovernance`, `semanticRetrieval`, `semanticGovernance`, `ontology`, `workspace`, `workspaceGovernance`, `copilot`, `copilotGovernance`, `knowledgeGraph`, `businessDomain`, `moduleLicensing`, `adaptiveRecommendation`, `institutionalRequest`, `institutionalRag`, `ragGovernance` | vários | API_MOUNTED | T / P / OR | ctx; `institutionalRag`/`ragGovernance` usam `ctx.organizationId!` sob `protectedProcedure` (**nulo**, `_core/context.ts:44`) | vários | n/a (não são legado nominal; parte é roadmap) | LEGACY_API_REACHABLE (montado, sem caller) | — | a decidir: manter montado, DISABLE, ou isolar por flag | **YES** | a definir | `server/routers.ts:128-160` | não classificar por nome: exige decisão de produto |
| LEG-030 | Configurações | página duplicada de personalização documental | — | `/personalizacao-documentos` (App:193), sem shell | NO_MENU (único link a partir de `Modules.tsx`, morto) | ACTIVE_CALLER (`DocumentSettings.tsx`) | `documentSettings` | get, save | API_MOUNTED | OR | ctx | `document_settings` | YES: `/configuracoes` (`Settings.tsx`, menu) | LEGACY_UI_AND_API_REACHABLE (a API é canônica) | — | CUTOVER (redirect para `/configuracoes`) | **YES** | a definir | `App.tsx:193,239` | |
| LEG-031 | Navegação | redirects de compatibilidade | — | `/direct-contracts/*`, `/contracts/*`, `/parecer-juridico/*` → rotas pt-BR; `/processo/:id`, `/novo-processo` → `/processos`; `/modulos` → `/dashboard` | NO_MENU | n/a | — | — | n/a | — | — | — | YES (destino) | COMPATIBILITY_LAYER | CUTOVER já aplicado (G8) | manter; os destinos legados seguem LEG-012/015/016 | não | — | `App.tsx:180,192,220-231,238` | `g8-canonical-navigation.test.ts:28-96` fixa as rotas legadas |
| LEG-032 | Público | formulário de contato público sem UI | — | nenhuma (`landing/ContactForm.tsx` inalcançável) | NO_MENU | NO_CALLER efetivo | `contact` | submitContactForm | API_MOUNTED (`routers.ts:84`) | **público** | — | notifica o dono | YES: `commercial.create` (`/solicitar-proposta`) | LEGACY_API_REACHABLE | — | DISABLE **ou** religar à landing | **YES** | a definir | `contactRouter.ts:7` | mutation pública |
| LEG-033 | LGPD | exclusão de conta sem UI | — | nenhuma | NO_MENU | NO_CALLER | `lgpd` | deleteMyAccount, exportMyData, … | API_MOUNTED (`routers.ts:101`) | P | usuário | **hard delete** de `processes`, `documents`, `activity_logs` (trilha de auditoria), `comments`, `process_members`, `notifications` | NO | LEGACY_API_REACHABLE | — | a decidir (FIX com retenção legal **ou** DISABLE) | **YES** (jurídica) | a definir | `lgpdRouter.ts:37-42`; `db/lgpd.ts:43-71` | candidato a achado novo (§12) |

## 5. Inventário de UI (rotas)

| Rota (App.tsx) | Componente | Classe | Menu | Superfície |
|---|---|---|---|---|
| `/processos` :188 | ProcessoLicitatorio | ROUTED (shell) | MENU_VISIBLE | canônico; contém LEG-013 |
| `/contratacao-direta` :182 | DirectProcurement | ROUTED (shell) | MENU_VISIBLE | canônico; contém LEG-014 |
| `/parecer` :183 | ParecerJuridico | ROUTED (shell) | MENU_VISIBLE | canônico |
| `/contratos` :184 | ContratosWorkspace | ROUTED (shell) | MENU_VISIBLE | canônico |
| `/contratacao-direta/novo`, `/analytics`, `/:id` :207-209 | NewDirectContract, DirectContractsAnalytics, DirectContractDetails | ROUTED (auth) | NO_MENU | LEG-015 |
| `/contratos/novo`, `/alertas`, `/:id` :210-212 | NewContract, ContractAlerts, ContractDetails | ROUTED (auth) | NO_MENU | LEG-016 |
| `/parecer/novo`, `/analytics`, `/:id` :213-215 | NewLegalOpinion, LegalOpinionsAnalytics, LegalOpinionDetails | ROUTED (auth) | NO_MENU | LEG-012 |
| `/auditoria` :195 | ActivityReport | ROUTED (auth) | NO_MENU | LEG-004 |
| `/gestao-departamento` :196 | DepartmentManagement | ROUTED (auth) | NO_MENU | LEG-018 |
| `/analytics` :240 | Analytics | ROUTED (auth) | NO_MENU | LEG-019 |
| `/admin` :241 | Admin | ROUTED (auth) | NO_MENU | LEG-027 |
| `/personalizacao-documentos` :193 | DocumentSettings | ROUTED (auth) | NO_MENU | LEG-030 |
| `/admin/propostas` :243 = `/gestao-comercial` :189 | CommercialManagement | ROUTED (auth), duplicado | NO_MENU | ferramenta admin (fora de R2) |
| `/admin/documentos` :244, `/admin/ai-costs` :196, `/admin/publication-logs` :198 | AdminDocuments, AIUsageDashboard, PublicationLogs | ROUTED (auth) | NO_MENU | ferramentas admin; PublicationLogs usa stub e link quebrado `/process/:id` (:206) |
| `/direct-contracts/*`, `/contracts/*`, `/parecer-juridico/*` :220-231 | LegacyRedirect | REDIRECTED | — | LEG-031 |
| `/processo/:id` :238, `/novo-processo` :192, `/modulos` :180 | Redirect | REDIRECTED | — | LEG-031 |
| `/admin/assinaturas`, `/admin/inadimplencia`, `/admin/contratos-limite`, `/admin/relatorios-financeiros`, `/audit-logs` :242-250 | — | COMMENTED_OUT | — | inerte |

**Páginas não roteadas** (nenhum importador; LEG-007):
- `ProcessDetails.tsx`;
- `Dashboard.tsx`;
- `NewProcess.tsx`;
- `ModuleSelectionDashboard.tsx`;
- `Modules.tsx`;
- `Home.tsx`;
- `Contracts.tsx`;
- `DirectContracts.tsx`;
- `LegalOpinions.tsx`;
- `ComponentShowcase.tsx`.

Há também backups versionados: `server/routers.ts.backup` e `server/routers/proposalRouter.ts.backup`.

**Links quebrados em páginas roteadas** (fora de R2; registro):
- `PublicationLogs.tsx:206` → `/process/:id`;
- `TaskCalendar.tsx:152` → `/gestao/tarefas/:id`.

## 6. Inventário de API

| Router (mount) | Procs | Auth | Tenant | Callers ativos | LEG |
|---|---|---|---|---|---|
| `collaboration` (:97) | 9 | T | ctx | 0 | LEG-001 |
| `processes` (:92) | 15 | T | ctx/pai | list, getActivityLogs | LEG-002/003/004/005/006 |
| `documents` (:93) | 16 | T | ctx (3 inserts sem orgId) | 0 | LEG-008/009 |
| `procurementProcess.updateStage` (:152) | 1 | OR(operator) | ctx | 0 | LEG-010 |
| `procurementProcess.importPriceResearch` | 1 | OR(operator) | ctx | 1 | LEG-013 |
| `directProcurement.updateStage` | 1 | T | ctx | 0 | LEG-011 |
| `directProcurement.importPriceResearch` | 1 | T | ctx | 1 | LEG-014 |
| `legalOpinions` (:116) | 14 | T/P | ctx | 12 | LEG-012 |
| `directContracts` (:114) | ~36 | T | ctx/pai | 21 | LEG-015 |
| `contracts` (:115) | 23 | T | ctx/pai | 15 | LEG-016 |
| `tasks` (:108) | 12 | T | ctx | 0 | LEG-017 |
| `departmentTasks` (vínculo legado) | 3 de 13 | T | ctx | 3 | LEG-018 |
| `analytics` (:103) | 1 | T | ctx | 1 | LEG-019 |
| `comments` (:100) | 4 | T | ctx | 0 | LEG-020 |
| `downloads` (:113) + `platforms.generatePublicationPackage` | 5 | P | owner | 0 | LEG-021 |
| `aiAssistant` (:117) | 6 | T | ctx | 0 | LEG-022 |
| `editalParameters` (:95) | 2 | T | ctx | 0 | LEG-023 |
| `notifications` (:98) | 4 | P | usuário | 0 | LEG-024 |
| `activities` (:96) | 1 | T | ctx | 0 | LEG-025 |
| `catmat` (:107) | 4 | T | ctx | 0 | LEG-026 |
| `admin` + listas legadas | — | P + admin | ctx | `/admin` | LEG-027 |
| routers em memória (12) | — | P/T | **input** | 0 | LEG-028 |
| routers de plataforma sem caller (22) | — | T/P/OR | ctx / **nulo** | 0 | LEG-029 |
| `contact` (:84) | 1 | **público** | — | 0 | LEG-032 |
| `lgpd` (:101) | 4 | P | usuário | 0 | LEG-033 |

`publicProcedure` fora de R2 (registro): `system.health` expõe env, versão e Node sem autenticação (`_core/systemRouter.ts:33`). O restante dos procedures públicos é o fluxo de autenticação, convite e comercial, com rate limit.

## 7. Inventário de callers (resumo)

- **ACTIVE_CALLER em superfície legada:**
  - LEG-003 (`processes.list`);
  - LEG-004;
  - LEG-012;
  - LEG-013;
  - LEG-015;
  - LEG-016;
  - LEG-018;
  - LEG-019;
  - LEG-027;
  - LEG-030.
- **Só UNROUTED_CALLER:** LEG-001, LEG-005, LEG-009, LEG-017, LEG-020, LEG-021, LEG-022, LEG-024, LEG-025, LEG-026, parte de LEG-028.
- **NO_CALLER:**
  - LEG-006;
  - LEG-008 (SEM-018);
  - LEG-010 (SEM-015);
  - LEG-011;
  - LEG-023;
  - LEG-029;
  - LEG-032;
  - LEG-033;
  - `legalOpinions.getBySource`/`delete`;
  - `documents.generateNext`/`list`.
- **Procedures chamadas pelo cliente que não existem no servidor** (falham em runtime):
  - `directContracts.documents.generate` (`DocumentsTab.tsx:18`);
  - `directContracts.quotations.add` e `quotations.delete` (`QuotationsTab.tsx:21-22`);
  - SEM-071 registra casos semelhantes em Gestão.
- **Páginas canônicas** (`DirectProcurement`, `ContratosWorkspace`, `ParecerJuridico`, `CentroOperacoes`, `ExecutiveDashboard`) **não** chamam procedure legada nem linkam para rota legada. O único link de entrada para legado parte de uma página legada (`DirectContractDetails.tsx:45,57`).

## 8. Alternativas canônicas

| Legado | Canônico | Cobertura |
|---|---|---|
| `legalOpinions` | `legalOpinionWorkspace` + `legalOpinionWorkspaceService` + `documentEngine.exportInstitutional` | PARTIAL. Sem analytics; sem parecer com origem em processo licitatório ou "outro"; sem endpoint de verificação de assinatura; sem etapa de aprovação nem checagem autor ≠ signatário (UNKNOWN se aplicada em outro ponto) |
| `documents.approve/submit/reject` | `documentReview.*` (`documentReviewService`) | YES (mesma tabela `documents`) |
| `documents` autoria/export | `procurementProcess.generate*`/`saveDFD`/`saveReviewableDraft`/`exportDocument`, `documentEngine.*` | PARTIAL (ata sem equivalente; `restoreVersion` sem router) |
| `procurementProcess.updateStage` | `issueProcess` | YES |
| `processes.*` | `procurementProcess.*` | PARTIAL (sem busca; itens via `itemIntelligence`/`procurementItems`/`ingestion`) |
| colagem no Processo | `DocumentIngestionLauncher` + `ingestion.*` (staging → revisão → aprovação → promoção) | YES |
| colagem na Contratação Direta | — | **NO** |
| `directContracts` | `directProcurement` + `contractWorkspace.createFromDirectProcurement` | PARTIAL (pacote presencial, checklists, CNPJ, catálogo de artigos, analytics, export de auditoria) |
| `contracts` | `contractWorkspace` | PARTIAL (validação de 25%/prazo do aditivo, alertas de vencimento, exports Excel) |
| `collaboration` | `responsibleUser`/`participants` + RBAC por órgão | PARTIAL (sem membros por processo nem responsável por etapa) |
| `tasks` | `departmentTasks` | YES |
| `analytics`, `/auditoria` | `departmentOperation` (Centro de Operações) | PARTIAL |

## 9. Classificações (totais por reachability; 33 superfícies)

| Reachability | Qtde | IDs |
|---|---|---|
| CANONICAL_ACTIVE | 1 | LEG-014 |
| LEGACY_UI_REACHABLE | 0 | — |
| LEGACY_API_REACHABLE | 8 | LEG-006, 008, 010, 011, 023, 029, 032, 033 |
| LEGACY_UI_AND_API_REACHABLE | 10 | LEG-003, 004, 012, 013, 015, 016, 018, 019, 027, 030 |
| LEGACY_UNROUTED_BUT_API_REACHABLE | 10 | LEG-001, 005, 009, 017, 020, 021, 022, 025, 026, 028 |
| LEGACY_INERT | 2 | LEG-002, LEG-007 |
| COMPATIBILITY_LAYER | 2 | LEG-024, LEG-031 |
| UNKNOWN | 0 | — |
| **Total** | **33** | |

Cada superfície entra numa única classe, a predominante. LEG-028 agrupa routers em memória, alguns com caller não roteado e outros sem caller; LEG-031 aponta para destinos do grupo UI_AND_API.

**Tratamentos:**
- **Congelados no plano (preservados sem reclassificação):**
  - LEG-008 / SEM-018 **DISABLE** (PR-02);
  - LEG-010 / SEM-015 **DISABLE** (PR-02);
  - LEG-012 / SEM-016, SEM-017 **CUTOVER** (PR-03);
  - LEG-013 / SEM-005 **CUTOVER** (PR-04);
  - LEG-015 / SEM-012 **CUTOVER** (PR-14, só a saída de valores);
  - LEG-002 DISABLE já aplicado;
  - LEG-031 CUTOVER já aplicado.
- **Propostos, com decisão humana pendente:** todos os demais.

## 10. Dependências

- **PR-02** (LEG-008, LEG-010):
  - não quebra nenhum caller de UI (NO_CALLER);
  - `rc-c01a-legacy-freeze.test.ts:119` exige 2 `docType z.enum` em `documentsRouter.ts` (`generateDocument` e `uploadDocument`), sem impacto;
  - candidatos de extensão: LEG-005, 006, 009, 011 (decisão humana).
- **PR-03** (LEG-012): depende de R2.3 (uso de `legal_opinions`) para definir o histórico legível; não há mapeamento de id legado (int) para workspace (varchar).
- **PR-04** (LEG-013):
  - depende de R2.2 (`FF_CANONICAL_INGESTION` por tenant);
  - deve incluir guard de servidor, porque hoje a API ignora a flag;
  - LEG-014 usa o mesmo código de sobrescrita (FCC-01);
  - testes que fixam o painel legado: `ingestion-ui-guards.test.ts:117-118`, `procurement-presentation-fallbacks.test.ts:31-37`.
- **PR-14** (LEG-015/SEM-012): depende de R2.3 (uso de `direct_contracts`).
- **Tabelas que não podem ser desativadas:**
  - `activity_logs` (infra canônica, 14+ escritores);
  - `documents` (mesma tabela governada por `documentReviewService`);
  - `processes` (lido por rotas ativas: `/gestao-departamento`, `/analytics`, `/parecer/novo`, `/admin`).
- **Testes que fixam rotas legadas:** `g8-canonical-navigation.test.ts:28-96`.

## 11. Correções factuais candidatas (FACTUAL_CORRECTION_CANDIDATE)

Nenhuma foi aplicada ao plano; todas são para decisão humana.

| ID | Onde | Fato observado | Efeito |
|---|---|---|---|
| FCC-01 | Plano §3 (SEM-005, CUTOVER → PR-04) | O mesmo código de sobrescrita (`priceResearch.ts:50-52,80-82`, `db/procurement.ts:162-175`) é usado por `directProcurement.importPriceResearch` (LEG-014), um canal **canônico** e ativo, com `tenantProcedure` (viewer escreve), sem transação e sem alternativa de ingestão canônica. O baseline (§ SEM-005) marca `canônico` e propõe um FIX (id por importação). | A CUTOVER da PR-04 não fecha SEM-005 na Contratação Direta. O escopo da PR-04 ou uma PR adicional precisa de decisão. |
| FCC-02 | Plano §3 (SEM-015) | `directProcurement.updateStage` repete o padrão de salto genérico de etapa com `tenantProcedure` (sem papel mínimo) e NO_CALLER (LEG-011). Não está no baseline. | Candidato a incluir na PR-02 ou a registrar como achado novo. |
| FCC-03 | Plano §3 (SEM-005, "quando a ingestão está desligada") | A flag só governa a UI: `procurementProcess.importPriceResearch` não checa `FF_CANONICAL_INGESTION`, então o fallback continua API-reachable com a flag ON. | A PR-04 deve fechar o endpoint no servidor, não só esconder o painel. |
| FCC-04 | `legacyBoundaries.ts:209` e cabeçalho `processesRouter.ts:2-7` | Dizem que o CRUD de itens legado e o router estão "VIVOS no fluxo canônico". O grafo de imports mostra que só são alcançáveis via `ProcessDetails` (não roteado). | Comentários desatualizados (doc de código), a corrigir numa PR funcional futura; não altera tratamento. |
| FCC-05 | Plano §3 (SEM-018 "LEGACY_INERT (API montada)") | Na taxonomia desta execução, API montada sem caller = `LEGACY_API_REACHABLE`; `LEGACY_INERT` fica reservado a quem não executa efeito. | Só nomenclatura; o tratamento DISABLE não muda. |

## 12. Riscos

- **Superfícies de escrita alcançáveis só por API**, sem caller de UI e fora dos serviços canônicos:
  - LEG-005/006/009 (processos e documentos legados, incluindo inserts sem `organizationId` e envio de e-mail);
  - LEG-011;
  - LEG-033.
- **LEG-033** (`lgpd.deleteMyAccount`): qualquer usuário autenticado pode apagar, por API, processos, documentos e **a trilha de `activity_logs`** que possui. Isso conflita com a regra de rastreabilidade obrigatória e pode conflitar com retenção legal. **Candidato a achado novo (NEW-002, severidade a triar)**; ainda não registrado no ledger, aguardando triagem humana.
- **LEG-028:** vários routers recebem `organizationId` do cliente (viola INV-03); o impacto é limitado porque os dados ficam em memória. **LEG-029:** `institutionalRag`/`ragGovernance` operam com organização nula.
- **LEG-015/016:** o legado tem capacidades que o canônico não tem (validação de 25% do aditivo, alertas de vencimento, pacote presencial, checklists, CNPJ). Uma CUTOVER sem cobri-las reduz controles.
- **LEG-024:** notificações são gravadas, mas não há UI roteada que as mostre.
- **Registrados de R1 (sem ação aqui):**
  - `stage_assignments` sem chave única;
  - possíveis duplicatas históricas;
  - `unassignStage` fora do lock;
  - fallback da SPA responde 200 em caminhos inexistentes.

## 13. Pontos que exigem decisão humana

1. **LEG-001 (colaboração):** a superfície tem função estratégica (FIX; manter e eventualmente roteá-la) ou é só legado alcançável por API (DISABLE governado)? Não há responsável por etapa no canônico.
2. **Extensão da PR-02:** incluir LEG-005, LEG-006, LEG-009 (processos e documentos legados) e LEG-011 (`directProcurement.updateStage`)? E estender o DISABLE de SEM-018 a `submitForReview` e `rejectDocument` (LEG-008)?
3. **FCC-01 / LEG-014:** SEM-005 na Contratação Direta. FIX (id por importação) ou CUTOVER para uma ingestão canônica ainda inexistente? Em qual PR?
4. **LEG-015/016:** aceitar a CUTOVER com as lacunas canônicas listadas, ou exigir paridade antes? A decisão depende de R2.3.
5. **LEG-003/004/018/019/027/030:** CUTOVER das páginas por deep link (`/admin`, `/auditoria`, `/gestao-departamento`, `/analytics`, `/personalizacao-documentos`) para os equivalentes canônicos?
6. **LEG-017/020/021/022/023/025/026/028:** DISABLE dos routers legados e experimentais sem UI roteada?
7. **LEG-029:** política para routers de plataforma montados sem caller (manter, DISABLE, ou isolar por flag).
8. **LEG-024:** notificações: expor UI ou manter sem UI?
9. **LEG-032/LEG-033:** mutation pública de contato sem UI; exclusão de conta LGPD com hard delete de trilha de auditoria (a LEG-033 exige análise jurídica).
10. **LEG-007:** remoção do código de UI morto (inclui `.backup`).
11. **R2.2** (fora de R2.1): decisão por tenant sobre `FF_CANONICAL_INGESTION`.
    - Sabido: default OFF, fail-closed; a flag gateia todo o `ingestion.*` no servidor, mas não o endpoint legado.
    - Pergunta registrada: *"Para cada tenant de produção, a ingestão canônica deve ser ativada (100%), antes ou junto da PR-04 que retira o painel legado e fecha o endpoint no servidor?"*
    - Observação: `percentage` < 100 gera comportamento aleatório por instância (`featureFlagService.ts:73`).

## 14. Conclusão objetiva sobre R2.1

| Critério (definição R2.1) | Situação |
|---|---|
| 1. Superfícies legadas montadas inventariadas | ✅ 33 superfícies (LEG-001…LEG-033) |
| 2. Rotas verificadas | ✅ §5 |
| 3. Menus verificados | ✅ §3 |
| 4. Callers verificados | ✅ §7 (grafo de imports) |
| 5. APIs verificadas | ✅ §6 |
| 6. Alternativas canônicas verificadas | ✅ §8 |
| 7. Reachability classificada | ✅ §9 (0 UNKNOWN) |
| 8. Achados associados | ✅ tabela §4 |
| 9. FIX/CUTOVER/DISABLE congelado **ou** decisão humana registrada, para cada superfície | ❌ 7 superfícies congeladas (LEG-002, 008, 010, 012, 013, 015-parcial, 031); **26** com tratamento só **proposto** e HDR = YES (§13) |
| 10. Zero UNKNOWN relevante | ✅ (há UNKNOWNs de dado de produção, que são de R2.3, não de R2.1) |
| 11. Nenhuma produção consultada | ✅ |
| 12. Documento versionado em PR documental | ✅ nesta PR (pendente de merge) |

**R2.1 = IN_PROGRESS.** O inventário está completo, mas o critério 9 exige decisão humana formal para as superfícies sem tratamento congelado (§13). R2.1 vira PASS quando essas decisões forem registradas no plano, em nova versão do plano caso alterem escopo de PR.
