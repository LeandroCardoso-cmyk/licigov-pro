# Kernel Infrastructure — Consolidação (RC-3.5 / RC-3.5.1)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A RC-3.5 consolidou a infraestrutura permanente do Cognitive Kernel; a **RC-3.5.1**
> refina a separação de responsabilidades: extrai o **ciclo de vida documental** do
> Document Engine, torna o **Provider Adapter** o único instanciador de providers e
> formaliza a **Storage Policy**. Nenhuma regra de negócio, fluxo ou UX foi alterado.

Componentes permanentes registrados no Cognitive Kernel:
`ai_execution_engine`, `provider_adapter`, `storage_service` (RC-3.5) e
`official_document_lifecycle` (RC-3.5.1).

## Responsabilidade única (mapa definitivo)

| Componente | Responsabilidade | Fronteira |
|---|---|---|
| **AIExecutionEngine** | Executa tarefas cognitivas (pipeline de IA). | **única porta cognitiva** |
| **AIExecutionPolicy** | Decide provider, modelo, grounding, KG, temperature, contexto, explicabilidade. | única responsável por decisões cognitivas |
| **Provider Adapter** | Seleciona e instancia o Provider. | **única porta para Providers** |
| **Document Engine** | **Apenas gera documentos** (recebe conteúdo → converte → renderiza → retorna artefato). | **única porta documental** |
| **OfficialDocumentLifecycleService** | Ciclo de vida documental (versão, timeline, hash, metadados, Storage, Signed URL). | **única porta do ciclo documental** |
| **Storage Service** | Armazenamento (única porta AWS/S3 + Storage Policy). | **única porta de armazenamento** |
| **Embeddings** | `text-embedding-004` — infraestrutura exclusiva do **Knowledge Graph** (NÃO é IA cognitiva). | fora do AIExecutionEngine |
| **Legacy Exporters** | Compatibilidade apenas (allowlist central). | não removidos, não migrados |
| **Business Domains** | Apenas consomem serviços do Kernel. | nunca cruzam fronteiras |

Nenhum componente conhece detalhes de implementação de outro. Cada um tem responsabilidade única.

## Fronteiras OBRIGATÓRIAS (RC-3.5.2 — Boundary Enforcement)

A arquitetura deixou de ser conceitual e passou a ser **aplicada pelo código**. Toda
fronteira é validada por teste automatizado (`rc352-boundary-enforcement.test.ts`), e toda
exceção vive em um **ponto único**: `server/kernel/architecture/legacyBoundaries.ts`
(nunca espalhada pelo projeto).

Regras obrigatórias enforçadas:

- **Nenhum Business Domain** chega a um Provider sem passar pelo **AIExecutionEngine**
  (o copiloto — `copilotReasoningService` — roteia por `executeAITask`, não por `generateText`).
- **Somente o Provider Adapter** instancia Providers (`new GeminiProvider`).
- **Somente o AIExecutionEngine** acessa a AIExecutionPolicy.
- **Somente o Document Engine** (+ legados na allowlist) chama o **DocumentConverter**
  (renderer interno — nunca API pública).
- **Somente o OfficialDocumentLifecycleService** versiona/timeline/persiste.
- **Somente o Storage Service** acessa o AWS SDK.
- **OfficialExportEngine** permanece interno (renderer especializado); nenhum novo componente o usa.
- **Legacy Exporters** (`documentsRouter`, `zipService`, `pdfChecklistService`,
  `legalOpinionExportService`, `directContractAuditReport`) só existem na allowlist.

> Adicionar um caminho a uma allowlist é uma **decisão arquitetural explícita e revisável**
> — não um atalho para contornar a fronteira.

---

## 1. AIExecutionEngine (`ai_execution_engine`)

Pipeline **ÚNICO e oficial** de toda inferência de IA. Nenhum Business Domain fala
diretamente com um Provider — fala com o AIExecutionEngine.

```
Task → Policy → Prompt → Grounding → Knowledge Graph → RAG →
Provider → LLM → Reasoning → Explainability → Result
```

- **Arquivo:** `server/services/aiExecutionEngine.ts` — `executeAITask(input)` (baixo nível)
  e **`executeCognitiveTask(input)`** (RC-4.0 — pipeline cognitivo).
- Determinístico e **replay-safe** (`replayHash` via sha256 dos insumos).
- **Multi-tenant** (`organizationId`).
- **Kernel-gated:** quando o domínio é informado, o acesso é validado contra
  `requiredKernelServices` via `assertKernelAccess(domain, "ai_orchestration")`.
- Cada etapa é registrada em `stages[]` (aplicada/pulada) para observabilidade.

> **RC-4.0 — Fase Cognitiva:** o AIExecutionEngine é o **cérebro institucional**. Os
> Business Domains solicitam **Cognitive Tasks** (13 oficiais) e recebem uma **Cognitive
> Response** estruturada, com Explainability obrigatória, contexto de execução e
> observabilidade. Ver [COGNITIVE_ARCHITECTURE.md](./COGNITIVE_ARCHITECTURE.md),
> [AI_EXECUTION_ENGINE.md](./AI_EXECUTION_ENGINE.md) e
> [COGNITIVE_PIPELINE.md](./COGNITIVE_PIPELINE.md).

> **RC-4.0.1 — Contrato cognitivo definitivo:** o `CognitiveResponse` é o **contrato
> universal** da IA (texto **ou** `structuredData` estruturado — nunca presume texto). O
> **Replay Hash** é semântico (só execução lógica; nunca output/tempo/tokens). A **validação
> é obrigatória**: nenhuma resposta inválida sai do Engine (`InvalidCognitiveResponse`). O
> contrato Business Domains → AIExecutionEngine → Provider Adapter → LLM está **estável**.

> **RC-4.1 — Ativação cognitiva:** o AIExecutionEngine é agora o **ÚNICO ponto de entrada
> cognitiva do produto**. Todos os Business Domains passam por `executeCognitiveTask` (via
> orquestrador + copilotos). `executeAITask` **aposentado** (sem callers oficiais); `invokeLLM`
> restrito ao legado allowlistado. **Mock Provider** ativo (replay determinístico, sem APIs
> externas). Fronteiras validadas por `rc41-cognitive-activation.test.ts`.

> **RC-4.2 — Institutional Reasoning Framework:** separa **Conhecimento → Raciocínio →
> Resposta**. O Engine constrói um **InstitutionalReasoningPlan** (12 etapas declarativas) a
> partir das **Institutional Rules** (regras declarativas) + grounding/KG, **antes** de
> responder. Explainability expandida (regras aplicadas, alternativas consideradas/descartadas
> com motivo). Determinístico. Ver [INSTITUTIONAL_REASONING.md](./INSTITUTIONAL_REASONING.md).

> **RC-4.2.1 — Production Readiness:** resolve as pendências operacionais **sem alterar o
> Kernel**. **Observabilidade persistente** (tabela `cognitive_observability`, recuperável por
> correlationId — não depende só de memória); **Health Check institucional**
> (`operationalHealthService`); **validação de ambiente explícita** (AWS obrigatório em produção,
> sem fallback silencioso); **Storage/Provider readiness** (diagnóstico, sem conectar providers);
> Legacy classificado (mantém/migração/remoção futura). Ver [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).

> **RC-4.2.2 — Production Monitoring:** o **Monitor Operacional Institucional**
> (`productionMonitoringService`) verifica automaticamente a saúde do ambiente e responde "está
> apto para operar?" — **sem executar IA/Providers, sem gerar documentos, sem expor secrets**.
> Health Score **determinístico** (100/90/70/50/0), Production Report por módulo
> (status/mensagem/detalhe/recomendação), endpoint read-only `/system/health` e observabilidade
> do health check com retenção simples. Ver [PRODUCTION_MONITORING.md](./PRODUCTION_MONITORING.md).

> **RC-4.3 — Institutional Operating Model:** inaugura a fase de **Conhecimento Institucional**.
> Ontologia operacional permanente do Departamento de Licitações (`server/domain/institutional/`):
> **papéis, objetos, estados, eventos, dependências, relacionamentos, regras operacionais** —
> declarativa, determinística, sem conteúdo jurídico. Reutilizável por toda a camada cognitiva
> (somente consulta). Ver [INSTITUTIONAL_OPERATING_MODEL.md](./INSTITUTIONAL_OPERATING_MODEL.md).

> **RC-4.3.1 — Ontology Validation:** a Ontologia Operacional foi validada exaustivamente
> (integridade por seção, **20 cenários representáveis**, cobertura 100%, zero ciclos, resiliência,
> determinismo) — **sem alterações estruturais**. Ver [INSTITUTIONAL_ONTOLOGY_VALIDATION.md](./INSTITUTIONAL_ONTOLOGY_VALIDATION.md).

> **RC-4.4 — Institutional Legal Ontology:** modela a **estrutura do conhecimento jurídico**
> (não o conteúdo) — tipos normativos, hierarquia (Lei→Decreto→IN→Portaria→…), estrutura interna
> (Título→…→Item), conceitos, relacionamentos (11) e classificações. Declarativa, determinística,
> acíclica e **independente de qualquer lei/tribunal/país**. Ver [INSTITUTIONAL_LEGAL_ONTOLOGY.md](./INSTITUTIONAL_LEGAL_ONTOLOGY.md).

### AI Execution Policy

Cada tarefa declara **sua** política — e a **decisão de provider ocorre SOMENTE aqui**,
nunca dentro dos Business Domains.

- **Arquivo:** `server/_core/ai/executionPolicy.ts`.
- Campos: `task, preferredProvider, fallbackProvider, requiresGrounding,
  requiresKnowledgeGraph, requiresExplainability, maxContext, maxCost, temperature, model`.
- Gemini é o provider preferido canônico em todas as políticas.

---

## 2. Provider Adapter (`provider_adapter`)

Camada **agnóstica** de resolução de provider:

```
AIExecutionEngine → Provider Adapter → Gemini | Claude | OpenAI | Future
```

- **Arquivo:** `server/_core/ai/providerAdapter.ts`.
- `resolveProviderByName(name)` e `selectProvider(preferred, fallback)`.
- **Único instanciador de providers (RC-3.5.1):** somente o Provider Adapter executa
  `new GeminiProvider(...)`. `provider.ts` (`getProvider`/`setProvider`) apenas reexporta o
  provider ativo do Adapter — compatibilidade com `invokeLLM`/`generateText` preservada.
- **Gemini** e **mock** implementados; **Claude/OpenAI** existem como **contratos**
  (`placeholderProviders.ts`) que lançam `ProviderNotImplemented` se usados — Future
  Evolution, sem chamadas reais. Não há remoção de suporte existente.
- Cadeia de fallback: preferido → fallback → mock determinístico (nunca quebra); a seleção
  automática nunca escolhe claude/openai (não implementados).

---

## 3. Storage Service (`storage_service`)

**ÚNICO** ponto de acesso ao **Amazon S3** em todo o sistema. Nenhum outro módulo
(Document Engine, Business Domains, routers, healthcheck) fala diretamente com a AWS.

- **Arquivo:** `server/storage.ts`.
- Contrato oficial: `storagePut` (upload), `storageGet`/`storageSignedUrl` (download +
  URL assinada), `storageDelete` (delete), `storageExists` (exists), `storageHealthCheck`.
- Chaves organizadas por `{modulo}/{escopo}/{id}-{filename}`.
- **Nunca binários no banco — apenas referências** (`storageKey`) + URL assinada (1h).
- Regra de teste garantida: `@aws-sdk` é importado **exclusivamente** por `server/storage.ts`.

### Amazon S3 (oficial)

- **Upload:** `storagePut(key, buffer, contentType)`.
- **Download:** `storageGet(key)` → URL **pré-assinada** privada (expira em 1h).
- **Signed URL:** `storageSignedUrl(key, expiresInSeconds)`.
- **Delete/Exists:** `storageDelete(key)` (idempotente) / `storageExists(key)`.
- **Versionamento futuro:** o `OfficialDocument` já guarda `storageKey/mimeType/size/hash`
  por versão — versionamento nativo de bucket é evolução futura.

### Storage Policy (RC-3.5.1)

A decisão sobre armazenamento vive **exclusivamente** no Storage Service — nenhum Business
Domain a conhece:

- **Development/Testes:** é permitido `Buffer`/Base64 (`storageFallbackAllowed()` → true).
- **Production/Staging:** o Storage Service **deve** estar operacional. Sem storage,
  `assertStorageUsable()` **falha explicitamente** na geração do documento oficial — **nunca**
  há fallback automático para Base64.

---

## 4. Document Engine → OfficialDocumentLifecycleService → Storage Service

**Fluxo oficial (RC-3.5.1):**

```
Business Domain → Document Engine → OfficialDocumentLifecycleService → Storage Service → Amazon S3 → Signed URL → OfficialDocument
```

### Document Engine — apenas gera (`documentEngineService.ts`)

Responsabilidade única: **receber conteúdo → converter → renderizar → retornar artefato**.
O Document Engine **NÃO** versiona, **NÃO** registra timeline, **NÃO** faz upload, **NÃO**
acessa o Storage e **NÃO** conhece o Amazon S3. `renderOfficialDocument` apenas converte
(via `documentConverter`) e entrega o buffer ao Lifecycle.

### OfficialDocumentLifecycleService (`official_document_lifecycle`)

Componente **permanente** com responsabilidade exclusiva pelo ciclo de vida:

```
receber documento → versionar → registrar timeline → calcular hash →
persistir metadados → utilizar Storage Service → armazenar StorageKey →
gerar Signed URL → devolver OfficialDocument
```

- **Arquivo:** `server/services/officialDocumentLifecycleService.ts`.
- `createDocument(...)` (versão + timeline + hash + persistência) e
  `storeRenderedArtifact(...)` (hash + Storage Policy + `storagePut` + Signed URL +
  persistência das referências + timeline).
- É o **único** consumidor do Storage Service no fluxo documental.

### OfficialDocument — referências de storage

`server/domain/officialDocument.ts` — além dos campos uniformes, armazena por versão:
`documentId (id)`, `version`, `storageKey`, `mimeType`, `size`, `hash`, `lineageId`,
`correlationId`, `replayHash`. **Nunca armazena binários — apenas referências.**
Migration `0282_official_documents_storage_refs`.

### Classificação dos Document Engines (RC-3.5)

| Componente | Classificação | Papel |
|---|---|---|
| `documentConverter` | **OFICIAL** | Conversor canônico Markdown → DOCX/PDF (usado pelo Document Engine). |
| `officialExportEngine` | **INTERNO** | Renderizador estruturado (sections → DOCX/PDF) do `exports` router. |
| `documentRenderService` | **LEGADO** | Render antigo (HTML, tabela `documents`) — só compatibilidade. |

---

## 5. Banco de Dados — MySQL (oficial)

O LiciGov Pro usa **MySQL (Railway)** como banco oficial e único
(`drizzle-orm/mysql2`). Não há PostgreSQL. Documentos antigos que citavam PostgreSQL
foram corrigidos; embeddings/RAG usam colunas JSON no MySQL.

## 6. Autenticação — JWT obrigatório

Eliminado o antigo fallback de string vazia (`JWT_SECRET` nunca é vazio):

- **Arquivo:** `server/config/auth.ts` — `resolveJwtSecret()`.
- Em **produção/staging**, a ausência de `JWT_SECRET` **FALHA na inicialização** — o
  sistema jamais inicia com segredo vazio.
- Em desenvolvimento/testes, usa um fallback determinístico explícito (nunca vazio).
- Segunda barreira em `validateRequiredEnv()` (bootstrap), que exige `JWT_SECRET` ≥ 32 chars.

---

## Garantias verificadas por teste

**`rc35-kernel-infrastructure.test.ts` (ORG 11300):**
- AIExecutionEngine: 11 etapas na ordem oficial, replay-safe, explicabilidade, Kernel gate.
- Provider Adapter: gemini/mock implementados, claude/openai como contratos, fallback → mock.
- AI Execution Policy: campos obrigatórios, Gemini preferido, seleção só na política.
- Storage Service: contrato completo; `@aws-sdk` só em `storage.ts`.
- OfficialDocument: `storageKey/mimeType/size/hash` presentes (default vazio).
- JWT: nunca vazio; sem `JWT_SECRET` a init é bloqueada.

**`rc351-kernel-refinement.test.ts` (ORG 11400):**
- OfficialDocumentLifecycleService controla o ciclo (createDocument, storeRenderedArtifact).
- Document Engine NÃO faz upload, NÃO versiona, NÃO registra timeline, NÃO acessa Storage.
- Provider Adapter é o único a instanciar `GeminiProvider`; Claude/OpenAI lançam `ProviderNotImplemented`.
- Fronteira: só a camada de IA importa `@google/generative-ai` / chama `model.generateContent`.
- Storage Policy: Base64 só em dev; produção/staging exigem storage.
- Isolamento: nenhum Business Domain importa `@aws-sdk`, `../storage`, `_core/ai/provider`,
  `@google/generative-ai` nem chama `model.generateContent`.

**`rc352-boundary-enforcement.test.ts` (fronteiras obrigatórias, via allowlist central):**
- Allowlist central íntegra (sem entradas obsoletas).
- Só o Provider Adapter instancia Providers; só a camada de IA acessa o SDK do modelo.
- Só o AIExecutionEngine acessa a AIExecutionPolicy; o CopilotReasoning roteia por `executeAITask`.
- Só o Document Engine (+ legados) chama o DocumentConverter; só o Lifecycle versiona.
- Só o Storage Service acessa o AWS SDK; OfficialExportEngine permanece interno.
- Legacy Exporters carregam classificação LEGACY; Embeddings fora do AIExecutionEngine.
- Nenhum Business Domain oficial cruza qualquer fronteira do Kernel.
