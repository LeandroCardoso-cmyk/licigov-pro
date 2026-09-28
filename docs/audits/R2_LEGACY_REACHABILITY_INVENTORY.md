# R2.1 — Inventário congelado de superfícies legadas montadas

> Programa: **Remediação da Auditoria Semântica** · roadmap **v1.0** · fase **R2 — Legacy Reachability & Cutover** ·
> checkpoint **R2.1**. Baseline de código: main **`141bcad`** (contém #260/SEM-001, #261/PR-01A/NEW-001, migration 0307).
> Decisões humanas congeladas em **27/09/2026** (§13) · **R2.1 = PASS**.
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
- tratamento FIX/CUTOVER/DISABLE: já congelado no plano, ou **decidido por humano em 27/09/2026** (§13).

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
- **HDR:** decisão humana requerida para a disposição em R2.1. Após 27/09/2026 é NO em todas as linhas.
- **Tratamento:** a coluna "Current Treatment" traz a disposição decidida; "Proposed Treatment" traz as condições e a direção registradas.

| Surface ID | Domain | Legacy Surface | Finding(s) | Frontend Route | Menu | Frontend Caller | API Router | Procedure(s) | API Mounted | Auth Boundary | Tenant Boundary | Data/Table | Canonical Alternative | Reachability | Current Treatment | Proposed Treatment | HDR | Future PR | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LEG-001 | Colaboração | membros e responsáveis por etapa do processo legado | SEM-001 (corrigido #260), NEW-001 (corrigido #261) | nenhuma (`ProcessDetails` não roteado) | NO_MENU | UNROUTED_CALLER (`MembersDialog.tsx:72-106`, `StageAssignmentPanel.tsx:28-49`) | `collaboration` | 9 procedures | API_MOUNTED (`routers.ts:97`) | T | ctx (#260) | `process_members`, `stage_assignments`, `notifications`, `activity_logs` | PARTIAL: `procurement_processes.responsibleUser`/`participants` (`schema.ts:5164-5165`), sem gestão de membros nem responsável por etapa | LEGACY_UNROUTED_BUT_API_REACHABLE | **FIX estratégico / RETAIN** (decidido 2026-09-27); FIX de SEM-001/NEW-001 aplicado | manter API; não reativar `ProcessDetails`; integrar colaboração e responsáveis por etapa ao workflow canônico | NO | frente própria (integração canônica) | `collaborationRouter.ts:147-345` | o plano deixou "desativação avaliada em R2" (§3, SEM-001) |
| LEG-002 | Processo (legado) | `processes.create` | — | nenhuma (`/novo-processo` → `/processos`) | NO_MENU | UNROUTED_CALLER (`NewProcess.tsx:46`) | `processes` | create | API_MOUNTED (`routers.ts:92`) | T | — | nenhuma escrita | YES: `procurementProcess.createProcess` (`procurementProcessRouter.ts:73`) | LEGACY_INERT (erro governado) | **DISABLE** (já aplicado) | — | NO | — | `processesRouter.ts:67-84`, `legacyPipeline.ts:23-37` | não conclui nada sobre os demais endpoints |
| LEG-003 | Processo (legado) | leitura de processos legados | — | `/admin` (App:241), `/parecer/novo` (App:213) | NO_MENU (deep link) | ACTIVE_CALLER (`Admin.tsx:24`, `NewLegalOpinion.tsx:46`) | `processes` | list, search, getById | API_MOUNTED | T | ctx | `processes` | YES: `procurementProcess.listProcesses`/`loadProcess` (:143/:129); busca NO | LEGACY_UI_AND_API_REACHABLE | **CUTOVER PROGRESSIVO** (decidido) | migrar callers um a um; `/parecer/novo` acompanha PR-03, `/admin` depois; list/search/getById só desligam após retirar os callers; legado necessário → HISTORICAL_READ via R2.3 | NO | PR-03 + a definir | `processesRouter.ts:43,47,87` | `search` e `getById` só UNROUTED/TEST |
| LEG-004 | Auditoria | relatório de atividades por processo legado | SEM-046 (P2) | `/auditoria` (App:195) | NO_MENU | ACTIVE_CALLER (`ActivityReport.tsx:16`) | `processes` | getActivityLogs | API_MOUNTED | T | ctx (N+1) | `processes` + `activity_logs` | PARTIAL: `departmentOperation.timeline` (`departmentOperationRouter.ts:60`), timeline por processo (`loadProcess`) | LEGACY_UI_AND_API_REACHABLE | **CUTOVER** → auditoria canônica / Centro de Operações (decidido) | preservar `activity_logs` e correlation IDs; sem segunda trilha; legado HISTORICAL_READ quando necessário | NO | R10 (SEM-046) | `processesRouter.ts:53-65` | ignora logs canônicos: sem processos legados, a página tende a vir vazia |
| LEG-005 | Processo (legado) | itens do TR e sugestões CATMAT legadas | — | nenhuma | NO_MENU | UNROUTED_CALLER (`TRItemsModal`, `ImportItemsModal`, `CatmatSuggestionsModal`, `EditItemDialog`) | `processes` | addItemsToTR, getProcessItems, parseItemsFile, generate/get/approve/rejectCatmatSuggestion(s), update/deleteProcessItem | API_MOUNTED | T | pai; **generateCatmatSuggestions chama a IA antes de checar a organização** | `process_items`, `catmat_suggestions`, `activity_logs` (sem orgId) | PARTIAL: `itemIntelligence.*`, `procurementItems.*`, `ingestion.*` | LEGACY_UNROUTED_BUT_API_REACHABLE | **DISABLE** (decidido) | fora da PR-02, em PR separada e subordinada | NO | PR separada (subordinada, fora da PR-02) | `processesRouter.ts:97-340`; `processItems.ts:126-142` | `legacyBoundaries.ts:209` diz "VIVO no fluxo canônico" — FCC-04 |
| LEG-006 | Processo (legado) | mudança de status do processo legado | — | nenhuma | NO_MENU | NO_CALLER (só TEST) | `processes` | updateStatus | API_MOUNTED | T | ctx | `processes`, `activity_logs`, e-mail | YES: `procurementProcess.issueProcess` (e ver LEG-010) | LEGACY_API_REACHABLE | **DISABLE** (decidido) | — | NO | PR-02 | `processesRouter.ts:341-362` | envia e-mail real (`sendStatusChangeEmail`) |
| LEG-007 | UI (legado) | subárvore de `ProcessDetails` e páginas mortas | — | nenhuma; `/processo/:id` → `/processos` (App:238) | NO_MENU | DEAD (sem importador) | vários | — | n/a | — | — | — | YES: `/processos` (`ProcessoLicitatorio`) | LEGACY_INERT (UI) | **DISABLE / REMOVE DEAD UI** (decidido) | remover só código comprovadamente morto (inclui `.backup`); preservar redirects; não inferir desligamento de API | NO | PR de limpeza (R10) | `App.tsx:15-18`; páginas mortas: `Dashboard`, `NewProcess`, `ModuleSelectionDashboard`, `Modules`, `Home`, `Contracts`, `DirectContracts`, `LegalOpinions`, `ComponentShowcase` | remover a UI não fecha as APIs (LEG-001/005/008/018–022) |
| LEG-008 | Documentos (legado) | revisão/aprovação legada | **SEM-018** | nenhuma | NO_MENU | NO_CALLER (o painel usa `documentReview.*`) | `documents` | approveDocument (SEM-018); submitForReview, rejectDocument | API_MOUNTED (`routers.ts:93`) | T (dono do processo, sem papel) | ctx | `documents.documentStatus` (a mesma coluna do canônico, sem ledger) | YES: `documentReview.submitForReview/approve/reject` (`documentReviewRouter.ts:37-63`) | LEGACY_API_REACHABLE | **DISABLE** (SEM-018 congelado; escopo ampliado por decisão) | approveDocument + submitForReview + rejectDocument → `documentReview.*` | NO | PR-02 | `documentsRouter.ts:720-761`; `db/processes.ts:235-247` | o plano §3 usa "LEGACY_INERT (API montada)": taxonomia (FCC-05) |
| LEG-009 | Documentos (legado) | autoria/versão/export legados | SEM-079 (P1, restoreVersion) | nenhuma | NO_MENU | UNROUTED_CALLER (`useProcessDocuments.ts`, `VersionHistoryDialog.tsx`, `useDocumentDownload.ts`); save/getByType TEST_ONLY; generateNext/list NO_CALLER | `documents` | listByProcess, list, save, getByType, generateNext, updateDocument, generateDocument, uploadDocument, getDownloadUrl, getVersionHistory, restoreVersion, downloadDocx, downloadPdf | API_MOUNTED | T (dono/membro) | ctx; 3 inserts **sem organizationId** (:484, :541, :605) | `documents`, `processes.status`, S3, Gemini direto | PARTIAL: `procurementProcess.generate*`/`saveDFD`/`saveReviewableDraft`/`exportDocument`, `documentEngine.*`; ata: NONE | LEGACY_UNROUTED_BUT_API_REACHABLE | **DISABLE** (decidido) | fora da PR-02 (S3, Gemini, autoria, versões, export, restore); preservar dados e histórico | NO | PR separada (fora da PR-02) | `documentsRouter.ts:112-716` | `rc-c01a-legacy-freeze.test.ts:119` fixa a forma do router |
| LEG-010 | Processo (canônico) | salto genérico de etapa | **SEM-015** | nenhuma | NO_MENU | NO_CALLER | `procurementProcess` | updateStage | API_MOUNTED (`routers.ts:152`) | OR(operator) | ctx | `procurement_processes`, `process_timeline` | YES: `issueProcess` (OR(manager) + Edital oficial, :633-650) | LEGACY_API_REACHABLE (endpoint de router canônico sem uso) | **DISABLE** (SEM-015 congelado) | — | NO | PR-02 | `procurementProcessRouter.ts:151-162`; domain `procurementProcess.ts:131-141` | sem `stage`, avança REVIEW → ISSUED/"emitido" |
| LEG-011 | Contratação Direta (canônico) | salto genérico de etapa | — (não está no baseline) · FCC-02 aceita | nenhuma | NO_MENU | NO_CALLER | `directProcurement` | updateStage | API_MOUNTED | **T (sem papel)** | ctx | workspace canônico | PARTIAL: transições específicas (`ratify`, `publish`) | LEGACY_API_REACHABLE | **DISABLE** (decidido; FCC-02 aceita) | fechar na PR-02, sem criar achado novo no baseline | NO | PR-02 | `directProcurementRouter.ts:97-100` | FCC-02 |
| LEG-012 | Parecer (legado) | parecer legado e páginas por deep link | **SEM-016, SEM-017** | `/parecer/novo`, `/parecer/analytics`, `/parecer/:id` (App:213-215) + LegacyRedirect `/parecer-juridico/*` (:228-231) | NO_MENU (menu só `/parecer` canônico) | ACTIVE_CALLER (`NewLegalOpinion.tsx:43-51`, `LegalOpinionDetails.tsx:24-88`, `SetSignaturePasswordDialog.tsx:33`, `LegalOpinionsAnalytics.tsx:17`); único link: `DirectContractDetails.tsx:45` | `legalOpinions` | 14 procedures (list, getById, getBySource, create, update, delete, exportPDF, exportDOCX, generateOpinion, sign, verifySignature, getAnalytics, set/hasSignaturePassword, getSignatureHistory) | API_MOUNTED (`routers.ts:116`) | T (+P em signaturePassword) | ctx; `signature_history` sem orgId | `legal_opinions`, `signature_history`, `digital_signatures`, `users.signaturePassword` | PARTIAL/YES: `legalOpinionWorkspace.*` (`legalOpinionWorkspaceRouter.ts:34-192`), export `documentEngine.exportInstitutional`. NO: analytics, parecer para processo licitatório, verificação de assinatura | LEGACY_UI_AND_API_REACHABLE | **CUTOVER** (SEM-016/017 congelado) | lacunas canônicas são requisitos do cutover, não reabrem a decisão; uso e histórico via R2.3 | NO | PR-03 | `legalOpinionsRouter.ts:65-527`; update :145-181, delete :192, generateOpinion :266-311 | nenhum código canônico lê `legal_opinions`; o servidor não bloqueia SEM-016/017 |
| LEG-013 | Pesquisa de Preços | colagem legada no Processo Licitatório | **SEM-005** · FCC-03 aceita | `/processos` (aba Pesquisa de Preços) | MENU_VISIBLE (`/processos`) | ACTIVE_CALLER (`PesquisaPrecosWorkspace.tsx:40-120`), exibido quando a flag está OFF **ou** a consulta de capabilities falha (:139-165) | `procurementProcess` | importPriceResearch | API_MOUNTED | OR(operator) | ctx | `price_research`, `price_research_items`, `intelligent_items` | YES: `DocumentIngestionLauncher` (`allowPaste`) → `ingestion.*` supervisionado | LEGACY_UI_AND_API_REACHABLE | **CUTOVER** (SEM-005 congelado) | PR-04 inclui guard server-side do endpoint legado (FCC-03); depende de R2.2 | NO | PR-04 | `procurementProcessRouter.ts:362-405`; `priceResearch.ts:50-52,80-82`; `db/procurement.ts:152-175` | o guard da flag é só de UI: o fallback continua API-reachable (FCC-03) |
| LEG-014 | Contratação Direta (canônico) | colagem de pesquisa na justificativa de preço | SEM-005 (o mesmo código de sobrescrita) — FCC-01 · FCC-01 aceita | `/contratacao-direta` | MENU_VISIBLE | ACTIVE_CALLER (`PriceJustificationWorkspace.tsx:22,41`) | `directProcurement` | importPriceResearch | API_MOUNTED | **T (viewer escreve)** | ctx | `price_research*` (sem transação, `directProcurementService.ts:55-73`) | NO: não há ingestão canônica para Contratação Direta | CANONICAL_ACTIVE | **FIX** (decidido; FCC-01 aceita) | id por importação; contrato de idempotência e replay; lineage; dedup governado por `contentHash`; sem sobrescrita silenciosa; transação só para persistência local determinística; RBAC (viewer não escreve) | NO | PR-04A (subordinada à PR-04) | `directProcurementRouter.ts:139-146` | a CUTOVER do LEG-013 **não** cobre este caminho |
| LEG-015 | Contratação Direta (legado) | contratação direta legada e páginas por deep link | SEM-012 (analytics em centavos), SEM-072 (P1, pacote) | `/contratacao-direta/novo`, `/analytics`, `/:id` (App:207-209) + LegacyRedirect `/direct-contracts/*` (:220-223) | NO_MENU | ACTIVE_CALLER (`NewDirectContract.tsx:70-79`, `DirectContractDetails.tsx:22` + tabs/modais, `DirectContractsAnalytics.tsx:19-22`, `Admin.tsx:25`, `NewLegalOpinion.tsx:47`); 3 procedures inexistentes chamadas via `as any` | `directContracts` | ~36 procedures (create, list, getById, update, assistant.*, legalArticles.*, documents.*, quotations.*, generate.*, presential.*, platforms.*, validation.*, audit.*, checklist.*, analytics.*) | API_MOUNTED (`routers.ts:114`) | T | ctx/pai; serviços usam `getDirectContractById` sem escopo após o guard | `direct_contracts` e filhas (sem FK) | PARTIAL: `directProcurement.*` (tabelas próprias, ids string). NO: pacote presencial, checklists de plataforma, CNPJ, catálogo de artigos, export de auditoria, analytics de valor | LEGACY_UI_AND_API_REACHABLE | **CUTOVER CONTROLADO** (decidido); SEM-012 → PR-14 (congelado) | condicionado a R2.3; cada capacidade classificada MIGRATE / RETIRE / HISTORICAL_READ; não desligar antes | NO | PR-14 (só SEM-012) + a definir após R2.3 | `directContractsRouter.ts:91-1222` | não é SHARED_INFRA: o canônico não lê nem grava `direct_contracts` |
| LEG-016 | Contratos (legado) | contratos legados e páginas por deep link | — (SEM-011/084 tratam limites no canônico) | `/contratos/novo`, `/alertas`, `/:id` (App:210-212) + LegacyRedirect `/contracts/*` (:224-227) | NO_MENU | ACTIVE_CALLER (`NewContract.tsx:66`, `ContractDetails.tsx:35-82`, `NewAmendmentModal.tsx:47`, `NewApostilleModal.tsx:45`, `ContractAlerts.tsx:17-46`, `Admin.tsx:26`, `NewLegalOpinion.tsx:51`); link `DirectContractDetails.tsx:57` | `contracts` | 23 procedures (create, getById, list, update, amendments.*, apostilles.*, documents.*, audit.*, analytics.*, generation.*, notifications.*, reports.*) | API_MOUNTED (`routers.ts:115`) | T | ctx/pai | `contracts`, `contract_amendments`, `contract_apostilles`, `contract_documents`, `contract_audit_logs` | PARTIAL: `contractWorkspace.*` (tabelas próprias). NO: validação de 25%/prazo do aditivo, alertas/checkExpirations, exports Excel | LEGACY_UI_AND_API_REACHABLE | **CUTOVER CONTROLADO** (decidido) | condicionado a R2.3; cada capacidade classificada MIGRATE / RETIRE / HISTORICAL_READ / LEGAL_REVIEW; regras normativas não são copiadas sem revisão jurídica | NO | a definir após R2.3 | `contractsRouter.ts:55-782` | `NewContract` envia reais onde a origem está em centavos e descarta originType/originId |
| LEG-017 | Gestão | router `tasks` duplicado | — | nenhuma | NO_MENU | UNROUTED_CALLER (`ModuleSelectionDashboard.tsx`) | `tasks` | 12 | API_MOUNTED (`routers.ts:108`) | T | ctx | `tasks` (a mesma camada `db/tasks.ts` de `departmentTasks`) | YES: `departmentTasks.*` | LEGACY_UNROUTED_BUT_API_REACHABLE | **DISABLE** (decidido) | desligar só a API duplicada; preservar dados de `tasks`; `departmentTasks` é o canônico; migrar diferenças antes | NO | a definir | `server/routers.ts:108`; `db/tasks.ts` | |
| LEG-018 | Gestão | vínculo de tarefa com processo legado e página por deep link | SEM-071 (P1) | `/gestao-departamento` (App:196) | NO_MENU | ACTIVE_CALLER (`TaskDetailModal.tsx:25-31`) | `departmentTasks` | listProcesses, getProcess, linkProcess (o resto do router é gestão de tarefas) | API_MOUNTED | T | ctx | `tasks`, **`processes` legado** | PARTIAL: `/centro-operacoes` (`LEGACY_INVENTORY.md:195-198` "substituído") | LEGACY_UI_AND_API_REACHABLE | **CUTOVER** → Processo Licitatório canônico (decidido) | preservar vínculos históricos; sem dual-write permanente; backfill ou mapeamento determinístico, tenant-scoped e auditável | NO | a definir | `departmentTasksRouter.ts:266-296` | |
| LEG-019 | Analytics | analytics de processos/documentos legados | — | `/analytics` (App:240) | NO_MENU | ACTIVE_CALLER (`Analytics.tsx:26`) | `analytics` | getOverview | API_MOUNTED (`routers.ts:103`) | T | ctx | `processes`, `documents` (`db/admin.ts:127,138`) | PARTIAL: indicadores de `departmentOperation` | LEGACY_UI_AND_API_REACHABLE | **CUTOVER** → Centro de Operações (decidido) | preservar histórico quando necessário; métricas novas só de fontes canônicas, com lineage, fonte e período; sem dashboards concorrentes | NO | a definir | `analyticsRouter.ts:20` | não reflete processos canônicos |
| LEG-020 | Colaboração (legado) | comentários sobre documento/processo legado | — | nenhuma | NO_MENU | UNROUTED_CALLER (`CommentsSection.tsx`) | `comments` | 4 | API_MOUNTED (`routers.ts:100`) | T | ctx | comentários sobre ids legados | NO (sem comentário canônico roteado) | LEGACY_UNROUTED_BUT_API_REACHABLE | **DISABLE** da implementação legada (decidido) | preservar dados; comentários e threads como capacidade futura do workflow canônico | NO | a definir | `commentsRouter.ts:10-43` | |
| LEG-021 | Pacotes (legado) | downloads e pacote de publicação | SEM-072 (P1) | nenhuma | NO_MENU | UNROUTED_CALLER (`ProcessDetails.tsx`, `PublicationPackageModal.tsx`) | `downloads`, `platforms.generatePublicationPackage` | 4 + 1 | API_MOUNTED (`routers.ts:113`) | P (dono) | ownerId, não organização | `processes`, `documents`, `process_items` | PARTIAL: `procurementProcess.exportDocument`, `documentEngine.exportInstitutional` | LEGACY_UNROUTED_BUT_API_REACHABLE | **DISABLE** da implementação legada (decidido) | pacote e publicação como capacidade futura do Document Engine, sobre snapshots e versões governadas, com lineage | NO | a definir | `downloadRouter.ts:18-20`; `platformsRouter.ts:111-114`; `zipService.ts:41,85` | grava activity log sem orgId (SEM-046) |
| LEG-022 | IA (legado) | assistente de IA sobre processo legado | — | nenhuma | NO_MENU | UNROUTED_CALLER (`AiAssistantPanel.tsx`) | `aiAssistant` | 6 | API_MOUNTED (`routers.ts:117`) | T | ctx | `processes`, `documents`, `activity_logs` | YES: IA canônica via Kernel em `procurementProcess.*` (`legacyBoundaries.ts:116-126`) | LEGACY_UNROUTED_BUT_API_REACHABLE | **DISABLE** (decidido) | toda IA institucional passa só por AIExecutionEngine / Kernel; nenhum fallback legado | NO | a definir | `aiAssistantRouter.ts:21-116` | |
| LEG-023 | Edital (legado) | parâmetros do Edital sobre processo legado | — | nenhuma | NO_MENU | NO_CALLER | `editalParameters` | 2 | API_MOUNTED (`routers.ts:95`) | T | ctx | `edital_parameters` sobre `processes` | YES: parâmetros do Edital no fluxo canônico (`procurementProcess`) | LEGACY_API_REACHABLE | **DISABLE** (decidido) | preservar dados; sem DROP de tabela | NO | a definir | `editalParametersRouter.ts:25-51` | |
| LEG-024 | Notificações | leitura de notificações sem UI roteada | — | nenhuma | NO_MENU | UNROUTED_CALLER (`NotificationBell.tsx:21-37`) | `notifications` | list, unreadCount, markAsRead, markAllAsRead | API_MOUNTED (`routers.ts:98`) | P | por usuário | `notifications` (gravadas por collaboration e outros, 8 call sites) | NO | COMPATIBILITY_LAYER | **FIX estratégico / RETAIN** (decidido) | manter a infra; UI canônica futura; não reativar `NotificationBell`; eventos persistem sem UI; marcar como lido não apaga | NO | a definir (UI canônica) | `notificationsRouter.ts:9-27` | notificações são gravadas e nunca vistas na UI roteada |
| LEG-025 | Atividades (legado) | atividades por processo legado | — | nenhuma | NO_MENU | UNROUTED_CALLER (`ProcessDetails.tsx:64`, `StageAssignmentPanel.tsx`) | `activities` | listByProcess | API_MOUNTED (`routers.ts:96`) | T | ctx | `activity_logs` | PARTIAL: timeline canônica | LEGACY_UNROUTED_BUT_API_REACHABLE | **DISABLE** da API legada (decidido) | preservar integralmente `activity_logs`; consultas futuras por timeline canônica | NO | a definir | `activitiesRouter.ts:11` | a tabela `activity_logs` é infra canônica e **não** pode ser desativada |
| LEG-026 | CATMAT (legado) | busca CATMAT direta | — | nenhuma | NO_MENU | UNROUTED_CALLER (`CatmatSearch.tsx`, `useCatalogSearch.ts`) | `catmat` | 4 (queries) | API_MOUNTED (`routers.ts:107`) | T | ctx | catálogo | YES: `itemIntelligence.*` (usado em `ProcurementItemPanel.tsx:87`) | LEGACY_UNROUTED_BUT_API_REACHABLE | **DISABLE** (decidido) | preservar catálogo; CATMAT/CATSER via `itemIntelligence`; IA não classifica sem aprovação humana | NO | a definir | `catmatRouter.ts:33-175` | somente leitura |
| LEG-027 | Admin | página `/admin` sobre listas legadas | — | `/admin` (App:241), guarda só no cliente (`Admin.tsx:36`) | NO_MENU | ACTIVE_CALLER (`Admin.tsx:24-26`) | `admin`, `processes`, `directContracts`, `contracts` | admin.listUsers/promote/demote + listas legadas | API_MOUNTED | P + checagem de admin no corpo | ctx | `users`, tabelas legadas | PARTIAL: `/admin/organizacoes`, `/usuarios` | LEGACY_UI_AND_API_REACHABLE | **CUTOVER PROGRESSIVO** (decidido) | não desabilitar o `adminRouter` inteiro; autorização crítica no servidor; `/admin` termina como redirect ou removida | NO | a definir | `Admin.tsx:24-36,91-93` | |
| LEG-028 | Diversos | APIs experimentais em memória (sem banco) | — | nenhuma (`ReviewWorkspacePage`, `OperationalDashboardPage`, `ClauseWorkspacePage` sem importador) | NO_MENU | UNROUTED_CALLER / NO_CALLER | `itemTr`, `reviewWorkspace`, `trComposition`, `approvalWorkflow`, `collaborationComments`, `exports`, `structuredExports`, `webhooks`, `clauses`, `pilotReadiness`, `productionReadiness`, `itemAnalytics` (mock) | vários | API_MOUNTED | P ou T | **input** (a organização vem do cliente em vários: `itemTrRouter.ts:254`, `trCompositionRouter.ts:91`, `webhookRouter.ts:59-80`); approvalWorkflow approve/reject sem checar organização (`humanApprovalService.ts:80-97`) | `Map` em memória | NO (experimental) | LEGACY_UNROUTED_BUT_API_REACHABLE / LEGACY_API_REACHABLE | **DISABLE EM PRODUÇÃO** (decidido) | nunca fallback institucional; dev/lab só com isolamento explícito por ambiente ou capability; nada de estado institucional em memória | NO | a definir | ver `§6` | dado volátil, impacto baixo, mas viola INV-03 |
| LEG-029 | Plataforma | routers montados sem nenhum caller de cliente | — | nenhuma | NO_MENU | NO_CALLER | `onboarding`, `context`, `promptOrchestration`, `legalReasoning`, `drafting`, `agentExecution`, `providers`, `providerGovernance`, `semanticRetrieval`, `semanticGovernance`, `ontology`, `workspace`, `workspaceGovernance`, `copilot`, `copilotGovernance`, `knowledgeGraph`, `businessDomain`, `moduleLicensing`, `adaptiveRecommendation`, `institutionalRequest`, `institutionalRag`, `ragGovernance` | vários | API_MOUNTED | T / P / OR | ctx; `institutionalRag`/`ragGovernance` usam `ctx.organizationId!` sob `protectedProcedure` (**nulo**, `_core/context.ts:44`) | vários | n/a (não são legado nominal; parte é roadmap) | LEGACY_API_REACHABLE (montado, sem caller) | **FIX estratégico / RETAIN** (decidido) | exposição em produção fail-closed por capability/flag explícita, default fechado; corrigir o boundary de tenant antes de ativar (`institutionalRag`/`ragGovernance`); readiness por router; sem mega-refactor | NO | frente de readiness posterior | `server/routers.ts:128-160` | não classificar por nome: exige decisão de produto |
| LEG-030 | Configurações | página duplicada de personalização documental | — | `/personalizacao-documentos` (App:193), sem shell | NO_MENU (único link a partir de `Modules.tsx`, morto) | ACTIVE_CALLER (`DocumentSettings.tsx`) | `documentSettings` | get, save | API_MOUNTED | OR | ctx | `document_settings` | YES: `/configuracoes` (`Settings.tsx`, menu) | LEGACY_UI_AND_API_REACHABLE (a API é canônica) | **CUTOVER** → `/configuracoes` (decidido) | `documentSettings` segue como API canônica; redirect governado; preservar deep links na transição | NO | a definir | `App.tsx:193,239` | |
| LEG-031 | Navegação | redirects de compatibilidade | — | `/direct-contracts/*`, `/contracts/*`, `/parecer-juridico/*` → rotas pt-BR; `/processo/:id`, `/novo-processo` → `/processos`; `/modulos` → `/dashboard` | NO_MENU | n/a | — | — | n/a | — | — | — | YES (destino) | COMPATIBILITY_LAYER | **COMPATIBILITY_LAYER** (CUTOVER já aplicado) | preservar redirects | NO | — | `App.tsx:180,192,220-231,238` | `g8-canonical-navigation.test.ts:28-96` fixa as rotas legadas |
| LEG-032 | Público | formulário de contato público sem UI | — | nenhuma (`landing/ContactForm.tsx` inalcançável) | NO_MENU | NO_CALLER efetivo | `contact` | submitContactForm | API_MOUNTED (`routers.ts:84`) | **público** | — | notifica o dono | YES: `commercial.create` (`/solicitar-proposta`) | LEGACY_API_REACHABLE | **DISABLE** (decidido) | `/solicitar-proposta` é o canal comercial público canônico; um futuro endpoint público exige rate limit, anti-abuso e observabilidade | NO | a definir | `contactRouter.ts:7` | mutation pública |
| LEG-033 | LGPD | exclusão de conta sem UI | — · **NEW-002 (P0, fora do baseline)** | nenhuma | NO_MENU | NO_CALLER | `lgpd` | deleteMyAccount, exportMyData, … | API_MOUNTED (`routers.ts:101`) | P | usuário | **hard delete** de `processes`, `documents`, `activity_logs` (trilha de auditoria), `comments`, `process_members`, `notifications` | NO | LEGACY_API_REACHABLE | **DISABLE** (decidido); **NEW-002 P0** | workflow governado de solicitação; retenção ou anonimização quando juridicamente cabível; nunca apagar evidência institucional; revisão jurídica do desenho final | NO | a definir (+ revisão jurídica) | `lgpdRouter.ts:37-42`; `db/lgpd.ts:43-71` | candidato a achado novo (§12) |

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

**Tratamentos** (todos decididos; §13):

| Tratamento | Qtde | IDs |
|---|---|---|
| FIX (estratégico / RETAIN) | 4 | LEG-001, 014, 024, 029 |
| CUTOVER (inclui progressivo e controlado) | 10 | LEG-003, 004, 012, 013, 015, 016, 018, 019, 027, 030 |
| DISABLE (inclui já aplicado, dead UI e "em produção") | 18 | LEG-002, 005, 006, 007, 008, 009, 010, 011, 017, 020, 021, 022, 023, 025, 026, 028, 032, 033 |
| COMPATIBILITY_LAYER (CUTOVER já aplicado, preservar) | 1 | LEG-031 |
| **Total** | **33** | |

- Preservados sem reclassificação:
  - SEM-018 e SEM-015: DISABLE / PR-02;
  - SEM-016 e SEM-017: CUTOVER / PR-03;
  - SEM-005: CUTOVER / PR-04;
  - SEM-012: CUTOVER / PR-14.
- "DISABLE" aqui significa **desligar a superfície de forma governada**, com erro governado e sem apagar dados. Nenhuma decisão autoriza DROP de tabela, delete ou backfill.

## 10. Dependências

- **PR-02** (escopo humano congelado): LEG-006, LEG-008 (approveDocument + submitForReview + rejectDocument), LEG-010 e LEG-011, todos DISABLE.
  - Não quebra nenhum caller de UI: todos são NO_CALLER.
  - `rc-c01a-legacy-freeze.test.ts:119` exige 2 `docType z.enum` em `documentsRouter.ts` (`generateDocument` e `uploadDocument`); não é afetado.
  - **LEG-005 e LEG-009 ficam fora da PR-02**, em PRs separadas e subordinadas (DISABLE).
- **PR-03** (LEG-012; também leva o caller `/parecer/novo` de LEG-003):
  - depende de R2.3 (uso de `legal_opinions`) para o histórico legível;
  - não existe mapeamento de id legado (int) para workspace (varchar).
- **PR-04** (LEG-013):
  - depende de R2.2 (`FF_CANONICAL_INGESTION` por tenant);
  - **guard de servidor obrigatório** (FCC-03);
  - testes que fixam o painel legado: `ingestion-ui-guards.test.ts:117-118`, `procurement-presentation-fallbacks.test.ts:31-37`.
- **PR-04A** (LEG-014):
  - FIX da pesquisa da Contratação Direta canônica: id por importação, idempotência/replay, lineage, dedup, transação local, RBAC;
  - subordinada à PR-04 e **sem checkpoint novo** dos 87.
- **PR-14** (LEG-015/SEM-012): depende de R2.3 (uso de `direct_contracts`).
- **LEG-015/016:** CUTOVER controlado; depende de R2.3. Cada capacidade recebe uma classificação (MIGRATE / RETIRE / HISTORICAL_READ e, para contratos, LEGAL_REVIEW) antes de qualquer desligamento.
- **Tabelas preservadas** (nenhuma decisão as desativa):
  - `activity_logs` (infra canônica, 14+ escritores);
  - `documents` (a mesma tabela governada por `documentReviewService`);
  - `processes` (lido por rotas ativas até o fim dos cutovers);
  - `tasks`, `notifications` e catálogos.
- **Testes que fixam rotas legadas:** `g8-canonical-navigation.test.ts:28-96`.

## 11. Correções factuais (FACTUAL_CORRECTION)

Todas foram **aceitas** por decisão humana (2026-09-27). Nenhuma altera o baseline histórico (92/26/54/12).

| ID | Onde | Fato observado | Status / efeito |
|---|---|---|---|
| FCC-01 | Plano §3 (SEM-005, CUTOVER → PR-04) | O mesmo código de sobrescrita (`priceResearch.ts:50-52,80-82`, `db/procurement.ts:162-175`) é usado por `directProcurement.importPriceResearch` (LEG-014), um canal **canônico** e ativo, com `tenantProcedure` (viewer escreve) e sem transação. | **ACEITA:** LEG-014 recebe FIX na **PR-04A**. |
| FCC-02 | Plano §3 (SEM-015) | `directProcurement.updateStage` repete o padrão de salto genérico de etapa, com `tenantProcedure` e NO_CALLER (LEG-011). | **ACEITA:** LEG-011 DISABLE na **PR-02**, sem criar achado novo no baseline. |
| FCC-03 | Plano §3 (SEM-005) | A flag só governa a UI: `procurementProcess.importPriceResearch` não checa `FF_CANONICAL_INGESTION`. | **ACEITA:** a PR-04 deve fechar o endpoint legado **no servidor**, não só a UI. |
| FCC-04 | `legacyBoundaries.ts:209` e cabeçalho `processesRouter.ts:2-7` | Dizem que o CRUD legado de itens e o router estão "VIVOS no fluxo canônico". O grafo de imports mostra que só são alcançáveis via `ProcessDetails`, que não é roteado. | **ACEITA** como correção documental futura dos comentários de código; não muda tratamento. |
| FCC-05 | Plano §3 (SEM-018 "LEGACY_INERT (API montada)") | Pela taxonomia, API montada sem caller = `LEGACY_API_REACHABLE`. | **ACEITA** como correção de taxonomia; SEM-018 continua DISABLE/PR-02. |

## 12. Riscos (registrados; nenhum corrigido nesta PR)

- **Superfícies de escrita alcançáveis só por API** até as PRs de DISABLE:
  - LEG-005/006/009 (inserts sem `organizationId`, envio de e-mail);
  - LEG-011;
  - LEG-033.
- **NEW-002 (P0, fora do baseline):** `lgpd.deleteMyAccount` (LEG-033). Qualquer usuário autenticado pode, por API, fazer hard delete de `activity_logs`, dos processos legados que possui, dos documentos relacionados, de comentários, notificações, `process_members`, consentimentos e do próprio usuário.
  - Viola auditabilidade, rastreabilidade, retenção institucional e irreversibilidade supervisionada.
  - Tratamento: DISABLE decidido, **não implementado**.
  - Registrado no plano, §9.2.
- **LEG-028:** vários routers recebem `organizationId` do cliente (viola INV-03); o impacto é limitado porque os dados ficam em memória. Decisão: DISABLE em produção.
- **LEG-029:** `institutionalRag`/`ragGovernance` operam com organização nula. Decisão: corrigir o boundary antes de qualquer ativação (fail-closed).
- **LEG-015/016:** o legado tem capacidades que o canônico não tem (validação de 25% do aditivo, alertas de vencimento, pacote presencial, checklists, CNPJ). Decisão: CUTOVER controlado; cada capacidade é classificada após R2.3; regras normativas passam por LEGAL_REVIEW.
- **LEG-024:** notificações são gravadas sem UI roteada. Decisão: RETAIN, com UI canônica futura.
- **Herdados de R1** (sem ação aqui):
  - `stage_assignments` sem chave única;
  - possíveis duplicatas históricas;
  - corrida entre `assignStage` e `unassignStage`;
  - fallback da SPA respondendo 200 em caminhos inexistentes.

## 13. Decisões humanas congeladas em 27/09/2026

Todas as disposições de R2.1 estão decididas. **Não resta decisão humana pendente para R2.1.** Continuam existindo dependências futuras, que **não reabrem** R2.1 porque a disposição da superfície já está decidida:
- R2.2 (flag);
- R2.3 (uso real em produção);
- LEGAL_REVIEW;
- implementação.

| ID | Decisão | PR / frente | Condições registradas |
|---|---|---|---|
| LEG-001 | FIX estratégico / RETAIN | frente própria | Manter a API. Não reativar `ProcessDetails`. Integrar colaboração e responsáveis por etapa ao workflow canônico, preservando isolamento de tenant, RBAC/SoD, correlation IDs, auditabilidade e replay safety. Os riscos estruturais conhecidos seguem para frente própria. |
| LEG-002 | DISABLE (mantido) | — | — |
| LEG-003 | CUTOVER progressivo | PR-03 + a definir | Preservar a tabela enquanto houver consumidores autorizados. Migrar callers um a um: `/parecer/novo` com a PR-03, `/admin` depois. list/search/getById só desligam após a retirada dos callers. Legado necessário vira HISTORICAL_READ via R2.3. |
| LEG-004 | CUTOVER → auditoria canônica / Centro de Operações | R10 (SEM-046) | Preservar `activity_logs`, correlation IDs e histórico. Sem segunda trilha. Legado HISTORICAL_READ quando necessário. |
| LEG-005 | DISABLE | PR separada, subordinada, **fora da PR-02** | Tamanho da superfície. |
| LEG-006 | DISABLE | **PR-02** | — |
| LEG-007 | DISABLE / REMOVE DEAD UI | limpeza (R10) | Remover só código comprovadamente morto, incluindo os `.backup`. Preservar redirects. Não inferir desligamento de API. |
| LEG-008 | DISABLE | **PR-02** | approveDocument + submitForReview + rejectDocument; alternativa `documentReview.*`. |
| LEG-009 | DISABLE | PR separada, **fora da PR-02** | Escopo amplo (S3, Gemini, autoria, versões, export, restore). Preservar dados e histórico conforme governança. |
| LEG-010 | DISABLE (SEM-015) | **PR-02** | — |
| LEG-011 | DISABLE (FCC-02 aceita) | **PR-02** | Sem novo achado no baseline. |
| LEG-012 | CUTOVER (SEM-016/017, mantido) | PR-03 | R2.3 necessário para uso e histórico reais. As lacunas canônicas são requisitos do cutover. |
| LEG-013 | CUTOVER (SEM-005, mantido) | PR-04 | FCC-03: guard server-side obrigatório. Depende de R2.2, que **não** é executada agora. |
| LEG-014 | FIX (FCC-01 aceita) | **PR-04A** (subordinada à PR-04; sem checkpoint novo) | Id por importação; contrato de idempotência e replay; lineage; dedup governado por `contentHash`; sem sobrescrita silenciosa; transação só para persistência local determinística; viewer não escreve pesquisa institucional. |
| LEG-015 | CUTOVER controlado | PR-14 (só SEM-012) + a definir | Condicionado a R2.3. Capacidades classificadas MIGRATE / RETIRE / HISTORICAL_READ. Não desligar antes. |
| LEG-016 | CUTOVER controlado | a definir | Condicionado a R2.3. Capacidades classificadas MIGRATE / RETIRE / HISTORICAL_READ / LEGAL_REVIEW. Regras normativas não são copiadas para o canônico sem revisão jurídica. |
| LEG-017 | DISABLE | a definir | Preservar dados de `tasks`. `departmentTasks` é o canônico. Desligar só a API duplicada, migrando antes qualquer diferença funcional. |
| LEG-018 | CUTOVER → Processo canônico | a definir | Preservar vínculos históricos. Sem dual-write permanente. Backfill ou mapeamento determinístico, tenant-scoped e auditável. |
| LEG-019 | CUTOVER → Centro de Operações | a definir | Preservar histórico quando necessário. Métricas novas só de fontes canônicas, com lineage, fonte e período. Sem dashboards concorrentes. |
| LEG-020 | DISABLE (implementação legada) | a definir | Preservar dados. Comentários e threads são capacidade futura do workflow canônico. Não reativar o router legado. |
| LEG-021 | DISABLE (implementação legada) | a definir | Pacote e publicação como capacidade futura do Document Engine, sobre snapshots e versões governadas, com lineage. Não reativar `ProcessDetails`. |
| LEG-022 | DISABLE | a definir | Toda IA institucional passa só por AIExecutionEngine / Kernel, com supervisão, approval-awareness, explicabilidade, observabilidade, contexto de tenant e replay safety. Nenhum fallback legado. |
| LEG-023 | DISABLE | a definir | Preservar dados. Sem DROP de tabela. `procurementProcess` é o fluxo canônico. |
| LEG-024 | FIX estratégico / RETAIN | a definir | Manter a infra. UI canônica futura. Não reativar `NotificationBell`. Eventos persistem mesmo sem UI. Marcar como lido não apaga o evento. |
| LEG-025 | DISABLE (API legada) | a definir | Preservar integralmente `activity_logs`. Consultas futuras por timeline e visões canônicas. Sem trilha paralela. |
| LEG-026 | DISABLE | a definir | Preservar o catálogo. CATMAT/CATSER via `itemIntelligence`. Migrar antes qualquer capability necessária. IA não define classificação sem aprovação humana. |
| LEG-027 | CUTOVER progressivo | a definir | Não desabilitar o `adminRouter` inteiro. Autorização crítica no servidor. `/admin` termina como redirect ou removida. |
| LEG-028 | DISABLE em produção | a definir | Nunca fallback institucional. Dev/lab só com isolamento explícito por ambiente ou capability. Nada de estado institucional em memória. |
| LEG-029 | FIX estratégico / RETAIN | readiness posterior | Exposição em produção fail-closed por capability/flag explícita, default fechado. Corrigir o boundary de tenant antes de ativar: `institutionalRag`/`ragGovernance` não podem presumir `ctx.organizationId!`. Sem mega-refactor. |
| LEG-030 | CUTOVER → `/configuracoes` | a definir | `documentSettings` segue como API canônica. Redirect governado. Preservar deep links na transição. |
| LEG-031 | COMPATIBILITY_LAYER (mantido) | — | Preservar redirects. |
| LEG-032 | DISABLE | a definir | `/solicitar-proposta` é o canal comercial público canônico. Um futuro endpoint público exige rate limit, anti-abuso e observabilidade. |
| LEG-033 | DISABLE; **NEW-002 P0** (fora do baseline) | a definir | Não implementado nesta PR. Direção: workflow governado de solicitação; retenção ou anonimização quando juridicamente cabível; sem apagar evidência institucional. A revisão jurídica do desenho final continua necessária. |

**Fora de R2.1 (continua TODO):** R2.2, a decisão por tenant sobre `FF_CANONICAL_INGESTION`.
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
| 8. Achados associados | ✅ tabela §4 (inclui NEW-002 e FCC-01/02/03) |
| 9. FIX/CUTOVER/DISABLE congelado **ou** decisão humana registrada, para cada superfície | ✅ 33/33 decididas (§13); 0 HDR pendente |
| 10. Zero UNKNOWN relevante | ✅ (os UNKNOWNs restantes são de dado de produção e pertencem a R2.3) |
| 11. Nenhuma produção consultada | ✅ |
| 12. Documento versionado em PR documental | ✅ PR #262 |

**R2.1 = PASS.**
- Os 12 critérios estão atendidos.
- As decisões não alteram checkpoints, fases, o total de 87 nem o baseline, então o roadmap continua **v1.0**. Entram no plano de PRs do mesmo modo que a PR-01A: escopo congelado da PR-02, PR-04A subordinada e PRs separadas para LEG-005/009.
- A implementação de cada decisão pertence às PRs e checkpoints seguintes (R2.4–R2.7 e frentes indicadas).
