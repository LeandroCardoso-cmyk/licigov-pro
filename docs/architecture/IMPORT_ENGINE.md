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

`import_sessions` ganhou 3 colunas **aditivas/nullable** — aplicadas via `ensureSchema`
(`server/bootstrap.ts`, idempotente a cada boot), **não** por migration numerada, seguindo a
convenção do projeto para alterações em tabelas preexistentes (ver cabeçalho de `drizzle/0285` e
`drizzle/0287`):

| Coluna | Tipo | Uso |
|---|---|---|
| `checksum` | `varchar(64)` | Dedup sha256 (índice de busca `import_sessions_org_checksum_idx`, NÃO único) |
| `processId` | `int` | Vínculo/lineage com o processo licitatório (autorização por processo) |
| `importPurpose` | `varchar(50)` | Finalidade da importação (orienta a promoção futura) |

`schema-audit` compara `drizzle/schema.ts` com o **banco real** (não com snapshots); como o
`ensureSchema` aplica as colunas no boot, o schema fica alinhado sem migration.

## Feature flag

`FF_CANONICAL_INGESTION` — tenant-aware via `featureFlagService.isFeatureEnabled`, **fail-closed**
(desabilitada por padrão, inclusive em produção). Toda a superfície tRPC e a rota de upload são
bloqueadas (`FORBIDDEN`) quando a flag está desligada para o tenant.

## Upload de bytes (por que fora do tRPC)

- base64 no tRPC é proibido (custo + memória) e o Storage Service **não** expõe presigned PUT.
- A rota `POST /api/ingestion/upload/:sessionId` recebe o binário cru via `express.raw` (streaming
  com teto de 50 MB), autentica igual ao tRPC (JWT cookie → user → tenant), valida server-side
  (magic bytes × MIME declarado, checksum, tamanho), gera a **chave de objeto no servidor**
  (`imports/{orgId}/{yyyymmdd}/{uuid}-{nome-sanitizado}` — nome nunca controlado pelo cliente) e
  grava no S3 pelo Storage Service.

## Fila e replay-safety

`importQueueService` é uma fila **in-memory** (retry com backoff exponencial + DLQ). `enqueueProcessing`
é replay-safe por status: não re-enfileira sessões em voo (`queued/parsing/…`), rejeita estados
terminais e realimenta os bytes a partir do storage durável (`storageGetBytes`). Persistência
distribuída da fila é evolução futura (hoje o replay pós-restart depende de re-`enqueueProcessing`).

## Fora do escopo da B.2.1

Promoção ao domínio (DFD/ETP/Pesquisa de Preços/TR), parser real de PDF/DOCX, wiring de workspaces
e remoção do caminho legado (`processes.parseItemsFile`).
