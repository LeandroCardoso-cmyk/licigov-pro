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

> **Caso especial — não se encaixa na Classe 1/2/3 abaixo.** Nos demais módulos
> legados deste inventário, o Business Domain canônico já está ligado à navegação
> oficial e o legado sobrevive só por compatibilidade de URL. Aqui é o oposto: o
> **legado é o sistema ativo em produção/staging** e o canônico é código que ainda
> não foi ligado ao frontend. Descoberto na auditoria arquitetural da Sprint C0
> (2026-07-20) e endereçado parcialmente na Sprint C0.1A (congelamento formal,
> sem migração).

### Legado ativo (uso real hoje)
- **Frontend:** `client/src/pages/Dashboard.tsx` (rota `/processos`, **no menu principal**
  como "Processo Licitatório"), `client/src/pages/ProcessDetails.tsx` (rota `/processo/:id`),
  `client/src/pages/NewProcess.tsx` (rota `/novo-processo`).
- **Backend:** `server/routers/documentsRouter.ts`, `server/routers/processesRouter.ts`.
- **Geração de IA:** `server/services/gemini.ts` (chamada direta a `@google/generative-ai`,
  já classificado como LEGACY (AI) em `legacyBoundaries.ts`).
- **Tabela:** `documents` (linhas gravadas com `organizationId = NULL` — sem isolamento
  multi-tenant completo).
- **Autorização:** `protectedProcedure` — baseada em usuário/dono (`ownerId`/membership),
  não em organização.
- **Lacunas confirmadas:** ausência de `correlationId`, ausência de replay/idempotência,
  ausência de lifecycle de versionamento canônico (append-only), observabilidade fraca
  (erro de geração de DFD é engolido silenciosamente em `processesRouter.ts`).

### Canônico arquitetural — ainda não ativo no frontend
- **Backend:** `server/routers/procurementProcessRouter.ts`, `server/services/procurementProcessService.ts`,
  `server/services/workspaceOrchestratorService.ts` (`orchestrateMultiCopilot`),
  `server/services/documentEngineService.ts`, `server/services/officialDocumentLifecycleService.ts`.
- **Tabelas:** `procurement_processes`, `generated_documents`, `official_documents`
  (versionamento append-only, `replayHash`, `lineageId`).
- **Autorização:** `tenantProcedure` — `organizationId` sempre resolvido no servidor.
- **Frontend correspondente existe mas está órfão:** `client/src/components/procurement/*`
  (`ProcessoLicitatorioHome`, `DFDWorkspace`, `ETPWorkspace`, `TRWorkspace`, `EditalWorkspace`)
  — nenhuma rota em `App.tsx` monta esses componentes.

### Estado atual (registrado explicitamente)
- O legado documental **está ativo em produção/staging** — é o único caminho pelo qual o
  usuário hoje gera DFD, ETP, TR, Edital, Ata e Parecer a partir de um processo licitatório.
- O canônico **está órfão do frontend** — existe, compila, tem testes, mas nenhuma tela o alcança.
- **O legado NÃO pode ser removido ainda** (não há substituto funcional ligado à UI).
- **O legado NÃO pode receber novas features** — a partir da Sprint C0.1A, este módulo
  entra em estado `MAINTENANCE_ONLY` (ver `legacyBoundaries.ts`): hotfix crítico, correção
  de segurança e correção de indisponibilidade são permitidos; novos tipos documentais,
  novos consumidores, novas rotas e novas chamadas diretas ao provider são proibidos.
- **DFD** e **Ata** possuem lacunas de paridade: o canônico só *importa* DFD (`importDFD`),
  não gera por IA; **Ata não existe** no enum canônico `OfficialDocumentType`
  (`server/domain/officialDocument.ts`) — só existe no legado.
- O **provider de runtime** do fluxo canônico (`procurementProcessService` → `orchestrateMultiCopilot`)
  ainda precisa de decisão: pode produzir rascunho consolidado de copilotos (mock/grounding-only)
  em vez de texto Gemini real, dependendo da policy/`AI_CONFIG.provider` em runtime — não
  validado nesta sprint.
- A migração (ligar o frontend ao canônico, cobrir DFD/Ata, decidir o provider) ocorrerá
  em **sprint dedicada futura (C1 em diante)** — fora do escopo de C0.1A.

### Critério de saída (quando o legado poderá ser bloqueado)
O legado documental só poderá ser bloqueado quando, cumulativamente:
1. o frontend oficial estiver ligado ao pipeline canônico (`components/procurement/*` montado em rota);
2. DFD possuir geração canônica (não só importação);
3. Ata estiver definida no canônico ou formalmente aposentada por decisão de produto;
4. o provider real (Gemini, não mock) estiver validado no caminho canônico;
5. o versionamento for compatível com o histórico existente em `documents`;
6. o histórico legado estiver preservado (read-only, não deletado);
7. os testes MySQL e o smoke funcional do caminho canônico estiverem verdes;
8. um plano de rollback estiver definido.

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
  `server/services/{directContractDocuments,directContractPackage,directContractAuditReport}.ts`
- **Tabelas:** `direct_contracts` (preservar).

### LegalOpinions  → substituído por **Legal Opinion Workspace** (`/parecer`)
- **Classe:** 3 (remover após RC-5)
- **Frontend:** `client/src/pages/{LegalOpinions,NewLegalOpinion,LegalOpinionDetails,LegalOpinionsAnalytics}.tsx`
- **Rotas (compat):** `/parecer-juridico`, `/parecer-juridico/novo`, `/parecer-juridico/:id`, `/parecer-juridico/analytics`
- **Backend (não remover):** `server/routers/legalOpinionsRouter.ts`, `server/db/legalOpinions.ts`,
  `server/services/{legalOpinionService,legalOpinionExportService}.ts`
- **Tabelas:** `legal_opinions` (preservar).

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
| `server/routers/procurementProcessRouter.ts`, `server/services/{procurementProcessService,workspaceOrchestratorService,documentEngineService,officialDocumentLifecycleService}.ts`, `client/src/components/procurement/*` | **CANONICAL_NOT_YET_WIRED** | correto arquiteturalmente, sem consumidor de frontend (RC-C0.1A) |

> A classificação é aplicada por dados (não por comentários espalhados) e é a fonte única de
> exceções arquiteturais, validada pelos testes de fronteira.

---

## Correções de segurança aplicadas a módulos legados (RC-C0.1A)

| Data | Componente | Problema | Correção |
|---|---|---|---|
| 2026-07-20 | `contractsRouter.ts` (analytics.getOverview) | Vazamento multi-tenant: agregava `COUNT`/`SUM` de **todas** as organizações, sem filtro de `organizationId`. Consumido por `Admin.tsx` e `ModuleSelectionDashboard.tsx`. | Migrado de `protectedProcedure` para `tenantProcedure`; `organizationId` resolvido no servidor e aplicado em todas as 6 sub-queries de `server/db/contracts.ts::getContractsOverview`. Contrato de resposta preservado. Testes MySQL reais em `server/__tests__/integration/contracts-tenant-isolation-mysql-smoke.test.ts`. |

> Correções de segurança em módulos legados são permitidas mesmo sob `MAINTENANCE_ONLY`
> (ver critérios de congelamento acima) — não constituem nova funcionalidade.
