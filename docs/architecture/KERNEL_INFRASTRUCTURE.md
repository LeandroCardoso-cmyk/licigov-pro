# Kernel Infrastructure — Consolidação (RC-3.5)

> **Fonte oficial da verdade:** [PRODUCT_NORTH_STAR.md](./PRODUCT_NORTH_STAR.md).
> A RC-3.5 consolida a infraestrutura permanente do Cognitive Kernel: execução de IA,
> camada de providers, storage, documentos oficiais, banco e autenticação. Nada de
> regra de negócio ou fluxo operacional foi alterado — apenas a base técnica foi unificada.

A RC-3.5 registra **três novos componentes permanentes do Cognitive Kernel**:
`ai_execution_engine`, `provider_adapter` e `storage_service`.

---

## 1. AIExecutionEngine (`ai_execution_engine`)

Pipeline **ÚNICO e oficial** de toda inferência de IA. Nenhum Business Domain fala
diretamente com um Provider — fala com o AIExecutionEngine.

```
Task → Policy → Prompt → Grounding → Knowledge Graph → RAG →
Provider → LLM → Reasoning → Explainability → Result
```

- **Arquivo:** `server/services/aiExecutionEngine.ts` — `executeAITask(input)`.
- Determinístico e **replay-safe** (`replayHash` via sha256 dos insumos).
- **Multi-tenant** (`organizationId`).
- **Kernel-gated:** quando o domínio é informado, o acesso é validado contra
  `requiredKernelServices` via `assertKernelAccess(domain, "ai_orchestration")`.
- Cada etapa é registrada em `stages[]` (aplicada/pulada) para observabilidade.

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
- **Gemini** e **mock** estão implementados; **Claude/OpenAI** ficam **preparados**
  (Future Evolution) — a arquitetura existe, a implementação não. Não há remoção do
  suporte existente (compatibilidade preservada com `getProvider`/`setProvider` e `invokeLLM`).
- Cadeia de fallback: preferido → fallback → mock determinístico (nunca quebra).

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

---

## 4. Document Engine → Storage Service

O **Document Engine** (`documentEngineService.ts`) **nunca conhece o S3**: toda a
comunicação passa pelo Storage Service.

```
Business Domain → OfficialDocument → Document Engine → Storage Service → Amazon S3 → Signed URL → Download
```

- `renderOfficialDocument(...)`: gera o binário (DOCX/PDF via `documentConverter`),
  faz `storagePut`, obtém a URL assinada e **persiste as referências** no `OfficialDocument`
  (`storageKey/mimeType/size/hash`). Quando o storage não está configurado, degrada para
  base64 (nunca binário no banco).

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

## Garantias verificadas por teste (`rc35-kernel-infrastructure.test.ts`, ORG 11300)

- AIExecutionEngine: 11 etapas na ordem oficial, replay-safe, explicabilidade, Kernel gate.
- Provider Adapter: gemini/mock implementados, claude/openai preparados, fallback → mock.
- AI Execution Policy: campos obrigatórios, Gemini preferido, seleção só na política.
- Storage Service: contrato completo; `@aws-sdk` só em `storage.ts`.
- OfficialDocument: `storageKey/mimeType/size/hash` presentes (default vazio).
- Document Engine: fala com Storage Service, nunca com S3 direto.
- JWT: nunca vazio; sem `JWT_SECRET` a init é bloqueada.
- Isolamento: nenhum Business Domain importa `@aws-sdk`, `../storage` ou `_core/ai/provider`.
