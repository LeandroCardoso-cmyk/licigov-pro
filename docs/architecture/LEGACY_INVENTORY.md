# Inventário de Código Legado (RC-2)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A arquitetura oficial do produto é **Cognitive Kernel + Business Domains + Centro de
> Operações**. Este documento registra oficialmente os módulos legados que **permanecem
> apenas por compatibilidade** e **não são utilizados pelo usuário** durante o piloto.

## Princípio

A partir da RC-2, a operação do LiciGov Pro ocorre **exclusivamente** pela navegação
oficial (Home portal, Sidebar, página Modules), que aponta **somente** para os Business
Domains. Os módulos legados continuam **compilando, funcionando e acessíveis por URL
direta**, mas **saíram da navegação principal**. Nenhum código legado foi removido nesta RC.

## Classificação

- **Classe 1 — Pode permanecer indefinidamente** (infra compartilhada / não conflita).
- **Classe 2 — Depende de migração futura** (sem equivalente pleno em Business Domain ainda).
- **Classe 3 — Pode ser removido após a RC-5** (substituído por um Business Domain equivalente).

---

## Licitação / Processo Licitatório / Geração Documental (RC-C0.1A)

> **Reconciliado (Architecture — Reconcile Procurement Legacy Boundaries).** A auditoria de
> call graph atual corrige o registro anterior desta seção. Diferente do que a Sprint C0.1A
> registrou (legado ativo / canônico órfão), hoje o **canônico do Processo Licitatório JÁ ESTÁ
> LIGADO** à navegação oficial; a geração cognitiva legada (`documentsRouter.generate*` →
> `gemini.ts`) **não** tem entrada pela navegação oficial. O legado permanece
> `LEGACY_ACTIVE_MAINTENANCE_ONLY` apenas por responsabilidades NÃO-cognitivas ainda vivas e por
> compatibilidade de URL, com retirada GOVERNADA futura. **Nenhuma migração/remoção nesta PR.**

### Estado real atual (call graph)
- **Rota oficial:** `/processos` → `client/src/pages/ProcessoLicitatorio.tsx` (no menu "Processo
  Licitatório"), que monta os workspaces canônicos (`ProcessoLicitatorioHome`, `DFDWorkspace`,
  `ETPWorkspace`, `TRWorkspace`, `EditalWorkspace`, `PesquisaPrecosWorkspace`, `ItemIntelligenceWorkspace`).
- **Redirects de compatibilidade:** `/novo-processo` → `/processos`; `/processo/:id` → `/processos`.
- **Backend canônico (LIGADO):** `procurementProcessRouter` → `procurementProcessService`. Cognição:
  **ETP/TR via Kernel** (`assertKernelAccess` + `orchestrateMultiCopilot`); **DFD determinístico**
  (template supervisionado, sem IA); **Edital** por composição/validação via **Document Engine**
  (`documentEngineService.generateOfficialDocument` — render/lifecycle, **NÃO** cognição) →
  `officialDocumentLifecycleService` (versionamento append-only `official_documents`).
- **Autorização:** `tenantProcedure` (`organizationId` resolvido no servidor).

### Legado — estado real
- **Páginas fora de rota (não são entrada oficial):** `Dashboard.tsx`, `ProcessDetails.tsx`,
  `NewProcess.tsx` — nenhuma rota as monta (Dashboard/NewProcess saíram da navegação; `/processo/:id`
  e `/novo-processo` redirecionam a `/processos`). `ProcessDetails` é o único caller de
  `useProcessDocuments` (→ `documents.generateDocument`).
- **Geração cognitiva legada órfã:** `documentsRouter.generate*`/`generateNext` → `gemini.ts`
  (AI SDK) — **sem caller na navegação oficial**. **NÃO** é alvo de shadow/cutover (não há tráfego
  institucional a migrar — ver `AI_LEGACY_MIGRATION_PLAN.md`).
- **Responsabilidades legadas NÃO-cognitivas ainda VIVAS (preservar):**
  - `documentsRouter`: version history/approval/upload/download (consumidores no baseline congelado
    de `rc-c01a-legacy-freeze.test.ts`).
  - `processesRouter`: **CRUD de itens** usado pelo fluxo canônico (`CatmatSuggestionsModal`,
    `TRItemsModal`, `ImportItemsModal`, `EditItemDialog` → `trpc.processes.*`).
- **Tabela:** `documents` (legada) preservada (read-only histórico).

### Classificação de fronteira (reconciliada)
- `LEGACY_ACTIVE_MAINTENANCE_ONLY` (congelado, sem novas features/consumidores; retirada
  governada procedure-by-procedure): `documentsRouter`, `processesRouter`, `gemini.ts`,
  `Dashboard.tsx`, `ProcessDetails.tsx`, `NewProcess.tsx`.
- `CANONICAL_NOT_YET_WIRED`: **agora VAZIO** — o pipeline canônico foi reconciliado como
  **ativo/ligado** (ver `legacyBoundaries.ts`). A constante permanece como mecanismo de guarda.

### Critério de saída (retirada GOVERNADA, caller-aware)
A remoção do legado é **procedure-by-procedure**, não de router inteiro — `documentsRouter` e
`processesRouter` ainda têm procedures não-cognitivas vivas. Só se pode retirar uma procedure quando,
cumulativamente:
1. auditoria confirmar **zero caller vivo** dessa procedure na navegação oficial;
2. eventual equivalente canônico (quando aplicável) estiver ligado e verde em teste;
3. o histórico legado estiver preservado (read-only, não deletado);
4. houver plano de rollback e rastreabilidade;
5. **Ata** (só no legado; ausente do enum canônico `OfficialDocumentType`) esteja formalmente
   aposentada ou coberta por decisão de produto.

---

## Módulos legados

### Contracts  → substituído por **Contract Workspace** (`/contratos`)
- **Classe:** 3 (remover após RC-5)
- **Frontend:** `client/src/pages/{Contracts,NewContract,ContractDetails,ContractAlerts}.tsx`
- **Rotas (compat):** `/contracts`, `/contracts/new`, `/contracts/:id`, `/contracts/alerts`
- **Backend (não remover):** `server/routers/contractsRouter.ts`, `server/db/contracts.ts`,
  `server/services/{contractDocuments,contractNotifications,contractReports,contractValidation}.ts`
- **Tabelas:** `contracts`, `contract_documents`, `contract_apostilles` (preservar).

#### Auditoria e isolamento multi-tenant completo (RC-C0.1A.1)

Todas as **23 procedures** do `contractsRouter` foram auditadas e migradas de
`protectedProcedure` para `tenantProcedure` — `organizationId` sempre resolvido no
servidor, nunca aceito do cliente. Nenhum endpoint foi bloqueado (todos corrigíveis
sem grande refatoração); nenhum permanece ativo com a vulnerabilidade original.

| Endpoint | Antes | Depois | Consumer |
|---|---|---|---|
| `create` | sem `organizationId` gravado | grava `ctx.organizationId` | NewContract.tsx |
| `getById` | sem filtro | `getContractByIdForOrganization` | ContractDetails.tsx |
| `list` | filtrava por `createdBy` (dono), não org | `listContractsByOrganization` | Contracts.tsx, ContractAlerts.tsx, NewLegalOpinion.tsx |
| `update` | sem filtro | `updateContractForOrganization` | sem consumer |
| `amendments.*`, `apostilles.*`, `documents.*`, `audit.*` | sem filtro; tabelas filhas sem coluna `organizationId` | valida o contrato-pai dentro da organização antes de ler/gravar (camada de repositório) | ContractDetails.tsx, NewAmendmentModal.tsx, NewApostilleModal.tsx |
| `analytics.getOverview` | agregação global (Sprint C0.1A) | `tenantProcedure` (já corrigido) | Contracts.tsx, Admin.tsx, ModuleSelectionDashboard.tsx |
| `analytics.getRecent` | sem filtro | `getRecentContractsForOrganization` | sem consumer |
| `generation.*` | sem filtro | valida contrato-pai antes de gerar/persistir | ContractDetails.tsx (Minuta/Rescisão) |
| `notifications.*`, `reports.*` | consultavam/exportavam TODAS as organizações | escopados à organização do chamador | ContractAlerts.tsx, ContractDetails.tsx |

**Exceção documentada:** `getContractById` (sem filtro) permanece por ser consumida
por `legalOpinionsRouter.ts` (também `protectedProcedure`, fora do escopo desta
sprint) — nenhum código novo deve usá-la; todo o `contractsRouter` usa
`getContractByIdForOrganization`.

**Router ainda `LEGACY_ACTIVE_MAINTENANCE_ONLY`** — nenhuma funcionalidade nova foi
adicionada; apenas correções de segurança/isolamento e observabilidade mínima
(`correlationId`/`organizationId`/ator/duração via log estruturado, sem persistência
em `contract_audit_logs`, que não tem essas colunas — mudança de schema fora de
escopo). Testes: `contracts-tenant-isolation-mysql-smoke.test.ts` (Sprint C0.1A, 8
testes de `analytics.getOverview`) + `contracts-legacy-full-isolation-mysql-smoke.test.ts`
(18 testes das 22 procedures restantes) + `rc-c01a1-contracts-legacy-freeze.test.ts`
(8 testes arquiteturais, allowlist congelada de consumers/endpoints/tabelas).

### DirectContracts  → substituído por **Direct Procurement** (`/contratacao-direta`)
- **Classe:** 3 (remover após RC-5)
- **Frontend:** `client/src/pages/{DirectContracts,NewDirectContract,DirectContractDetails,DirectContractsAnalytics}.tsx`
- **Rotas (compat):** `/direct-contracts`, `/direct-contracts/new`, `/direct-contracts/:id`, `/direct-contracts/analytics`
- **Backend (não remover):** `server/routers/directContractsRouter.ts`, `server/db/directContracts.ts`,
  `server/services/{directContractDocuments,directContractPackage,directContractAuditReport,legalFrameworkAssistant}.ts`
- **Tabelas:** `direct_contracts` (preservar).
- **IA:** `directContractDocuments`/`legalFrameworkAssistant` usam `invokeLLM` legado (resultado efetivo
  **apenas** neste fluxo compat). O fluxo oficial `/contratacao-direta` **não** os usa — já roda no Kernel
  (`orchestrateMultiCopilot`).
- **C.3A shadow (`FF_DIRECT_CONTRACT_SHADOW`, OFF):** existe **apenas como observabilidade de legado** —
  reclassificado em C.3A-CLOSE (classificação C). **Não** é migração de tráfego e **não** habilita cutover.
  Retirada futura é **governada** (auditoria de callers + ausência de uso operacional); **não remover ainda**.
  Ver `AI_LEGACY_MIGRATION_PLAN.md` §5.2 e `handoffs/C3A_FINAL_RECLASSIFICATION_AND_CLOSURE.md`.

### LegalOpinions  → substituído por **Legal Opinion Workspace** (`/parecer`)
- **Classe:** 3 (remover após RC-5)
- **Frontend:** `client/src/pages/{LegalOpinions,NewLegalOpinion,LegalOpinionDetails,LegalOpinionsAnalytics}.tsx`
- **Rotas (compat):** `/parecer-juridico`, `/parecer-juridico/novo`, `/parecer-juridico/:id`, `/parecer-juridico/analytics`
- **Backend (não remover):** `server/routers/legalOpinionsRouter.ts`, `server/db/legalOpinions.ts`,
  `server/services/{legalOpinionService,legalOpinionExportService}.ts`
- **Tabelas:** `legal_opinions` (preservar).

#### Auditoria e isolamento multi-tenant completo (RC-LEGAL-SEC-001)

Todas as **15 procedures** do `legalOpinionsRouter` foram auditadas. **13 migradas**
de `protectedProcedure` para `tenantProcedure`; `organizationId` sempre resolvido no
servidor. `setSignaturePassword`/`hasSignaturePassword` permanecem em
`protectedProcedure` deliberadamente — escopo é `ctx.user.id` (credencial pessoal),
sem dado organizacional, sem vazamento cross-tenant possível.

| Endpoint | Antes | Depois | Consumer |
|---|---|---|---|
| `list`, `getBySource`, `getAnalytics` | agregação/listagem global (todas as organizações) | `getLegalOpinionsByOrganization`/`getLegalOpinionsBySourceForOrganization`/4 funções `*ForOrganization` | LegalOpinions.tsx, LegalOpinionsAnalytics.tsx |
| `getById`, `update`, `delete`, `exportPDF`, `exportDOCX`, `verifySignature`, `getSignatureHistory` | sem filtro por ID | `getLegalOpinionByIdForOrganization`/`updateLegalOpinionForOrganization`/`deleteLegalOpinionForOrganization`/`getSignatureHistoryForOrganization` | LegalOpinionDetails.tsx |
| `create` | não validava contrato-fonte nem gravava `organizationId` | grava `ctx.organizationId`; valida que `sourceType="contract"` pertence à organização antes de vincular | NewLegalOpinion.tsx |
| `generateOpinion` | usava `getContractById` sem filtro (achado original do LEGAL-SEC-001) | usa `getContractByIdForOrganization`; parecer-pai validado por `requireOpinionForOrg` | NewLegalOpinion.tsx, LegalOpinionDetails.tsx |
| `sign` | `signature_history` (sem coluna `organizationId` própria) sem validação de parecer-pai | valida parecer-pai dentro da organização antes de gravar assinatura (`addSignatureToHistoryForOrganization`) | LegalOpinionDetails.tsx |

**Achado adicional (auditado, não corrigido — fora de escopo real):** `getDigitalSignatureById`
só é chamado a partir de `opinion.signatureId`, campo **inexistente** no schema de
`legal_opinions` — o branch que o invoca nunca executa em produção.
`getDigitalSignatureByDocument`/`invalidateDigitalSignature`/`createDigitalSignature`
não têm nenhum consumidor no repositório inteiro. Nenhuma leitura cross-tenant é
alcançável por esse caminho; documentado em `server/db/legalOpinions.ts`.

**Complementação (mesma sprint):** `create` e `generateOpinion` agora validam as
**4 origens institucionais** do enum `sourceType` (`contract`, `process`,
`direct_contract`, `other`) dentro da organização — não apenas `contract` do
achado original. Novas funções `getProcessByIdForOrganization`
(`server/db/processes.ts`) e `getDirectContractByIdForOrganization`
(`server/db/directContracts.ts`) — mesmo padrão de `getContractByIdForOrganization`:
as funções globais antigas (`getProcessById`, `getDirectContractById`) permanecem
apenas para seus consumidores externos pré-existentes (`processesRouter`,
`directContractsRouter` e domínios relacionados), fora do escopo desta correção.
`generateOpinion` revalida a fonte em profundidade mesmo após a validação de
`create`, para nunca gerar conteúdo a partir de registro cross-tenant pré-existente.

**Risco remanescente registrado (genuinamente fora do escopo — pertence a outros
routers, não a `legalOpinionsRouter`):** `getProcessById` e `getDirectContractById`
continuam sem filtro de organização para os consumidores do próprio domínio
(`processesRouter`, `platforms.ts`, `directContractsRouter` e todo o domínio de
contratação direta — geração de termos, auditoria, documentos). `processesRouter`
já está classificado como `LEGACY_ACTIVE_MAINTENANCE_ONLY` (RC-C0.1A);
`directContractsRouter` ainda não foi auditado. Candidatos a sprints dedicadas
futuras (fora do escopo de `legalOpinionsRouter`).

**Router ainda `LEGACY_ACTIVE_MAINTENANCE_ONLY`** — nenhuma funcionalidade nova
adicionada; apenas correções de segurança/isolamento. Testes:
`legal-opinions-tenant-isolation-mysql-smoke.test.ts` (26 testes MySQL reais) +
`rc-legal-sec-001-legal-opinions-freeze.test.ts` (10 testes arquiteturais).

### DepartmentManagement  → substituído por **Centro de Operações** (`/centro-operacoes`)
- **Classe:** 3 (remover após RC-5)
- **Frontend:** `client/src/pages/DepartmentManagement.tsx`
- **Rotas (compat):** `/gestao-departamento`

### Commercial / Propostas Comerciais
- **Classe:** 2 (depende de migração futura — sem Business Domain equivalente pleno)
- **Frontend:** `client/src/pages/CommercialManagement.tsx`
- **Rotas (compat):** `/gestao-comercial`, `/admin/propostas`
- **Backend (não remover):** `server/routers/commercialRouter.ts`, `server/services/proposalGenerator.ts`
- **Observação:** trata de propostas comerciais de fornecedores no contexto de licitação
  (não é ERP). Reavaliar em RC futura se vira Business Domain ou permanece ferramenta.

### Camada de raciocínio jurídico / IA (legalReasoning, RAG, KG, provider)
- **Classe:** 1 (permanece — é infraestrutura do Kernel, reutilizada pelos copilotos)

### Núcleo compartilhado (auth, RBAC, documentos, importação, templates, admin)
- **Classe:** 1 (permanece — base do produto, não conflita com Business Domains)

---

## Arquivos claramente mortos (candidatos a remoção — **não nesta RC**)
- `server/routers/proposalRouter.ts.backup`
- `server/routers.ts.backup`

> Estes `.backup` são resíduos e podem ser removidos numa limpeza futura (após RC-5),
> junto da desativação dos módulos Classe 3.

---

## Regra de navegação (RC-2)
- **Home (Business Domain Portal):** apenas Business Domains.
- **Sidebar:** Dashboard · Centro de Operações · Business Domains · Templates · Configurações.
- **Página Modules:** apenas rotas canônicas dos Business Domains.
- **App.tsx:** rotas legadas mantidas, mas marcadas como *compatibilidade* — nunca entradas oficiais.

---

## Classificação dos Document Engines (RC-3.5)

| Componente | Classe | Papel |
|---|---|---|
| `server/services/documentConverter.ts` | **OFICIAL** | Conversor canônico Markdown → DOCX/PDF, usado pelo Document Engine oficial. |
| `server/services/officialExportEngine.ts` | **INTERNO** | Renderizador estruturado (sections → DOCX/PDF) do router `exports`. Não é o pipeline oficial. |
| `server/services/documentRenderService.ts` | **LEGADO** | Render antigo (HTML, tabela `documents`). Substituído pelo Document Engine — só compatibilidade, não usar em novos módulos. |

> Nenhum código foi removido: o legado permanece por compatibilidade. Novos módulos usam
> exclusivamente o Document Engine oficial (`documentEngineService` + `documentConverter`).

---

## Callers legados de IA (RC-3.5.1)

Acessam o Gemini **diretamente** (anterior ao Provider Adapter/AIExecutionEngine). Mantidos
por compatibilidade; usados apenas por routers legados — **nunca** pelos Business Domains
oficiais. Novos fluxos DEVEM usar `AIExecutionEngine → Provider Adapter`.

| Componente | Classe | Consumido por |
|---|---|---|
| `server/services/gemini.ts` | **LEGADO** | `documentsRouter`, `processesRouter` |
| `server/services/ai/suggestions.ts` | **LEGADO** | `aiAssistantRouter` |

> `server/services/embeddings.ts` **não** é legado: é infraestrutura de **embeddings**
> (`text-embedding-004`), um concern distinto da geração de texto do Provider Adapter.
> Ambos os legados constam na allowlist explícita dos testes de fronteira
> (`rc351-kernel-refinement.test.ts`) — qualquer novo acesso direto a provider falha o teste.

---

## Inventário classificado (RC-4.2.1)

Classificação oficial (dados em `server/kernel/architecture/legacyBoundaries.ts` →
`BOUNDARY_CLASSIFICATIONS`). **Nenhuma remoção nesta fase** — apenas classificação.

| Componente | Classe | Disposição |
|---|---|---|
| `server/services/gemini.ts` | LEGACY (AI) | migração futura → AIExecutionEngine |
| `server/services/ai/suggestions.ts` | LEGACY (AI) | migração futura → AIExecutionEngine |
| `server/services/legalFrameworkAssistant.ts` | LEGACY (invokeLLM) | migração futura |
| `server/services/catmatMatcher.ts` | LEGACY (invokeLLM) | migração futura (CATMAT_MATCHING) |
| `server/services/directContractDocuments.ts` | LEGACY (invokeLLM) | migração futura |
| `server/services/legalOpinionService.ts` | LEGACY (invokeLLM) | migração futura |
| `server/services/examples/legalValidationExample.ts` | EXAMPLE | remoção futura |
| `server/services/documentRenderService.ts` | ORPHAN/LEGACY | remoção futura (pós-RC-5) |
| `server/services/officialExportEngine.ts` | INTERNAL SPECIALIZED RENDERER | mantém |
| `server/services/documentConverter.ts` | INTERNAL RENDERER | mantém |
| `server/services/{zipService,pdfChecklistService,legalOpinionExportService,directContractAuditReport}.ts` | LEGACY EXPORTERS | mantém (compatibilidade) |
| `server/routers/documentsRouter.ts` | LEGACY | mantém (compatibilidade) |
| `server/_core/ai/placeholderProviders.ts` (Claude/OpenAI) | FUTURE EVOLUTION | mantém (preparado) |
| `server/services/aiExecutionEngine.ts` → `executeAITask` | DEPRECATED (aposentado, 0 callers) | mantém (definição/testes) |
| `server/routers/proposalRouter.ts.backup`, `server/routers.ts.backup` | BACKUP | remoção futura (pós-RC-5) |
| `server/routers/{documentsRouter,processesRouter}.ts`, `server/services/gemini.ts`, `client/src/pages/{Dashboard,ProcessDetails,NewProcess}.tsx` | **LEGACY_ACTIVE_MAINTENANCE_ONLY** | congelado (RC-C0.1A) — ver seção "Licitação / Processo Licitatório / Geração Documental" acima |
| `server/routers/procurementProcessRouter.ts`, `server/services/{procurementProcessService,workspaceOrchestratorService,documentEngineService,officialDocumentLifecycleService}.ts`, `client/src/components/procurement/*` | **RECONCILIADO → canônico ATIVO** (`CANONICAL_NOT_YET_WIRED` agora vazio) | wired a `/processos` → `ProcessoLicitatorio` → `procurementProcess.*` (ETP/TR via Kernel; DFD determinístico; Edital via Document Engine) |

> A classificação é aplicada por dados (não por comentários espalhados) e é a fonte única de
> exceções arquiteturais, validada pelos testes de fronteira.

---

## Correções de segurança aplicadas a módulos legados (RC-C0.1A)

| Data | Componente | Problema | Correção |
|---|---|---|---|
| 2026-07-20 | `contractsRouter.ts` (analytics.getOverview) | Vazamento multi-tenant: agregava `COUNT`/`SUM` de **todas** as organizações, sem filtro de `organizationId`. Consumido por `Admin.tsx` e `ModuleSelectionDashboard.tsx`. | Migrado de `protectedProcedure` para `tenantProcedure`; `organizationId` resolvido no servidor e aplicado em todas as 6 sub-queries de `server/db/contracts.ts::getContractsOverview`. Contrato de resposta preservado. Testes MySQL reais em `server/__tests__/integration/contracts-tenant-isolation-mysql-smoke.test.ts`. |

> Correções de segurança em módulos legados são permitidas mesmo sob `MAINTENANCE_ONLY`
> (ver critérios de congelamento acima) — não constituem nova funcionalidade.
