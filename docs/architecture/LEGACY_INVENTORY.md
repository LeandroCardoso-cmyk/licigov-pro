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

## Módulos legados

### Contracts  → substituído por **Contract Workspace** (`/contratos`)
- **Classe:** 3 (remover após RC-5)
- **Frontend:** `client/src/pages/{Contracts,NewContract,ContractDetails,ContractAlerts}.tsx`
- **Rotas (compat):** `/contracts`, `/contracts/new`, `/contracts/:id`, `/contracts/alerts`
- **Backend (não remover):** `server/routers/contractsRouter.ts`, `server/db/contracts.ts`,
  `server/services/{contractDocuments,contractNotifications,contractReports,contractValidation}.ts`
- **Tabelas:** `contracts`, `contract_documents`, `contract_apostilles` (preservar).

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

> A classificação é aplicada por dados (não por comentários espalhados) e é a fonte única de
> exceções arquiteturais, validada pelos testes de fronteira.
