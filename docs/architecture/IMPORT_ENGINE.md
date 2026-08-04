# LiciGov Pro — Arquitetura do Motor de Importação (Ingestão Canônica)

> Documento de arquitetura real do motor de importação. Complementa o guia funcional em
> [`docs/imports/README.md`](../imports/README.md). Atualizado na PR B.2.1.

## Princípio inegociável

> **Raw extraction NUNCA persiste diretamente no domínio.**

```
Upload → Ingestão → Parsing → Staging → Validação → Revisão Humana → Aprovação → (Promoção — futura)
```

Cada dado importado carrega proveniência completa e passa por revisão humana antes de qualquer
efeito no domínio. A promoção ao domínio é uma etapa **posterior** (não implementada na B.2.1).

## Camadas

```
Cliente (workspaces canônicos — futura B.2.2)
   │  createSession (metadados) + presigned-less upload + polling de status
API tRPC  ─ server/routers/ingestionRouter.ts ......... superfície canônica (tenantProcedure, flag-gated)
Rota Express ─ server/routes/ingestionUploadRoute.ts .. byte-upload cru (application/octet-stream)
Serviços ─ server/services/
   ├─ fileIngestionService ...... sessões, validação, transições de status, dedup por checksum
   ├─ ingestionUploadService .... sniff de conteúdo (magic bytes), chave S3 anti path-traversal, flag
   ├─ importQueueService ........ fila in-memory (retry backoff + DLQ) → parse → staging
   └─ importStagingService ...... persistência de staging + revisão humana (approve/reject/skip)
Domínio ─ server/domain/import*.ts, canonicalUnits, extractionEvidence, importReviewState
Storage ─ server/storage.ts (Amazon S3, ponto único de acesso)
Persistência ─ import_sessions / import_staging_items / import_review_transitions
```

## Estado do schema (PR B.2.1)

`import_sessions` ganhou 3 colunas **aditivas/nullable**, criadas pela migration **formal e
versionada** [`drizzle/0288_import_session_canonical_fields.sql`](../../drizzle/0288_import_session_canonical_fields.sql):

| Coluna | Tipo | Uso |
|---|---|---|
| `checksum` | `varchar(64)` | Dedup sha256 (índice de busca `import_sessions_org_checksum_idx`, NÃO único — sem unicidade global) |
| `processId` | `int` | Vínculo/lineage com o processo licitatório (ownership validado no serviço: processId + organizationId) |
| `importPurpose` | `varchar(50)` | Finalidade da importação (orienta a promoção futura) |

A migration é puramente aditiva (sem backfill, sem NOT NULL, sem UNIQUE). O `checksum` é calculado
pelo **servidor** (SHA-256); um valor informado pelo cliente é apenas expectativa a validar.

O `ensureSchema` (`server/bootstrap.ts`) **não** cria mais essas colunas — apenas **verifica** a
presença e, se ausentes, emite falha acionável em produção/staging (aviso em dev), sem mutar o
schema silenciosamente. `runMigrations()` roda antes do `ensureSchema()`, então em boot normal as
colunas já existem. `schema-audit` compara `drizzle/schema.ts` com o banco real.

## Feature flag

`FF_CANONICAL_INGESTION` — tenant-aware via `featureFlagService.isFeatureEnabled`, **fail-closed**
(desabilitada por padrão, inclusive em produção). Toda a superfície tRPC e a rota de upload são
bloqueadas (`FORBIDDEN`) quando a flag está desligada para o tenant.

## Upload de bytes (multipart streaming, fora do tRPC)

- base64 no tRPC é proibido (custo + memória) e o Storage Service **não** expõe presigned PUT.
- A rota `POST /api/ingestion/upload/:sessionId` recebe **multipart/form-data em streaming** (busboy):
  1. autentica igual ao tRPC (JWT cookie → user → tenant) e checa a flag **ANTES** de consumir o corpo;
  2. impõe o teto de tamanho **durante** o streaming e aborta imediatamente ao exceder;
  3. calcula o SHA-256 incrementalmente (autoridade do servidor);
  4. valida magic bytes × MIME declarado assim que os primeiros bytes chegam;
  5. usa a **chave de objeto gerada no servidor** no createSession
     (`imports/{orgId}/{yyyymmdd}/{uuid}-{nome-sanitizado}` — nome nunca vem do cliente);
  6. faz **streaming direto para o S3** via `@aws-sdk/lib-storage` (multipart) — nenhum Buffer com o
     arquivo completo, backpressure preservado (`stream.pipeline`);
  7. em qualquer falha, faz **cleanup do objeto parcial** em `finally`.

## Fila e replay-safety

`importQueueService` é uma fila **in-memory** (retry com backoff exponencial + DLQ). O **job carrega
apenas identificadores/metadados seguros** — `sessionId`, `organizationId`, `storageKey`,
`correlationId`, `attempt` — **nunca o Buffer**. O binário é recuperado do storage durável
(`storageGetBytes`) **no worker**, no momento do parse, com limite rígido de tamanho (limitação
documentada: os parsers atuais exigem Buffer completo; parsing em streaming remove isso).

`enqueueProcessing` é replay-safe por status (não re-enfileira em voo; conflito em estado terminal)
e dedup in-flight por sessão. Após restart, `recoverStuckImportSessions` reidrata sessões presas
(`queued`/`parsing`): **claim atômico no banco** (`claimSessionForRecovery`, impede execução
concorrente duplicada via row-lock), respeita o limite de tentativas, encaminha à **DLQ** quando
esgota, preserva correlationId/lineage e é **fail-closed por tenant**.

## Fora do escopo da B.2.1

Promoção ao domínio (DFD/ETP/Pesquisa de Preços/TR), parser real de PDF/DOCX, wiring de workspaces
e remoção do caminho legado (`processes.parseItemsFile`).
