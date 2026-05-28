# Sprint 2.8 — Import Foundation Layer

**Status:** Concluída  
**Data:** Maio 2026  
**Impacto:** Fundação completa do motor de importação de arquivos

---

## Objetivo

Implementar a camada de fundação do motor de importação: pipeline completo desde recepção do arquivo até staging para revisão humana. Base para pesquisa de preços, TR e CATMAT nas sprints 3+.

## Princípio Fundamental

> Raw extraction NUNCA persiste diretamente em tabelas de domínio.  
> Pipeline obrigatório: **arquivo → staging → validação → normalização → revisão humana → aprovação**

## Entregas

### Domínio

#### ImportSession Aggregate
- 10 status de lifecycle: `uploaded → queued → parsing → extracted → normalized → awaiting_review → approved/rejected/failed/archived`
- ImportType: `price_research | tr_items | catmat | generic`
- Transições válidas definidas em `IMPORT_TRANSITIONS`

#### Confidence Infrastructure
- `ConfidenceMetadata` por campo e por item
- `scoreToLevel`: high (≥0.85) / medium (≥0.60) / low (≥0.35) / uncertain (<0.35)
- `aggregateConfidence()`: média ponderada por campos
- O sistema **nunca esconde incerteza**: toda extração carrega metadados de confiança explícitos

#### ExtractionProvenance
- Rastreabilidade completa: `sourceFileId`, `sourceFileName`, `location` (sheet/row/col/page/cell)
- Permite replay, reprocessamento e auditoria
- `formatLocation()`: serialização legível da localização

#### RawExtractedItem
- Campos brutos: `rawDescription`, `rawQuantity`, `rawUnit`, `rawUnitPrice`, `rawTotalPrice`
- Metadados: `sourceLocation`, `parserMetadata`, `confidenceMetadata`, `extractionWarnings`
- `createRawItem()`, `summarizeItems()`

#### CanonicalUnits Registry
- 25 unidades canônicas PT-BR: UN, CX, PCT, EMB, FD, KG, G, T, L, ML, M3, M, CM, M2, HA, H, DIA, MES, ANO, SV, VB, CONJ, PAR, ROL, RESMA
- Normalização por estratégia: `exact → alias → fuzzy → prefix`
- `normalizeUnit(raw)` → `{ canonical, confidence, matched, source }`

### Parsers

#### BaseParser (contrato)
- `validate(buffer, mimeType)` — tamanho + mime
- `safeParse(buffer, options)` — wraps parse com error handling e observabilidade
- `emptySummary()`, `buildSummary()` — summaries padronizados

#### CsvParser
- Auto-detecção de delimitador: `,`, `;`, `\t`, `|`
- Header inference (primeira linha não-numérica)
- Mapeamento de colunas por padrões PT-BR/EN

#### XlsxParser
- SheetJS (biblioteca `xlsx`) 
- Sheet-targeting por nome ou índice
- Header inference, merged cells, sparse row detection

#### PdfParser (stub)
- Verificação de magic bytes `%PDF`
- Extração completa: Sprint 3 com `pdf-parse`

#### DocxParser (stub)
- Verificação de magic bytes ZIP (`0x50 0x4B`)
- Extração completa: Sprint 3 com `mammoth`

#### ParserRegistry
- Registro e resolução de parsers
- Resolve por: hint explícito → mime type → extensão de arquivo

### Serviços

#### FileIngestionService
- `validateFile()`: checksum SHA-256 + mime + tamanho
- `createImportSession()`: insert + logActivity
- `getImportSession()`, `listImportSessions()`
- `updateSessionStatus()`: transições genéricas com extras
- `startIngestion()`: valida + enfileira
- `cancelImportSession()`: arquiva sessão

#### ImportStagingService
- `persistStagingItems()`: bulk insert com TTL de 30 dias
- `getStagingItems()`, `getStagingItem()`
- `reviewStagingItem()`: approved | rejected | skipped
- `bulkReviewStagingItems()`: revisão em lote
- `getStagingSummary()`: contadores por status
- `deleteSessionStaging()`: limpeza por sessão

#### ImportQueueService
- Fila em memória (Sprint 3 → BullMQ/Redis)
- `enqueueImport()` → retorna `jobId`
- `processJob()`: parse → staging → status update
- Retry com backoff exponencial: 1s, 2s, 4s (máx 3 tentativas)
- Dead Letter Queue (DLQ) para jobs que esgotaram retries
- `retryJob()`: reprocessamento manual da DLQ

## Migrações
- `0054_import_sessions.sql`
- `0055_import_staging.sql`

## Testes
- 99 testes de integração: `sprint28-import-foundation.test.ts`
- Total acumulado: **537 testes** (100% passando)

## Impacto Arquitetural

Criou a **foundation layer** do motor de importação. Sprint 3 constrói sobre esta base: extração real PDF/DOCX, normalização, matching CATMAT, e interface de revisão humana.
