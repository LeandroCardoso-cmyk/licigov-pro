# Motor de Importação — Import Engine

## Princípio Fundamental

> **Raw extraction NUNCA persiste diretamente em tabelas de domínio.**  
> Todo dado importado passa por: arquivo → staging → validação → normalização → revisão humana → aprovação

## Pipeline Completo

```
[Upload de Arquivo]
       │
       ▼
FileIngestionService.validateFile()
  ├── checksum SHA-256
  ├── mime type check
  └── tamanho máximo (50MB)
       │
       ▼
createImportSession() → import_sessions (status: uploaded)
       │
       ▼
ImportQueueService.enqueueImport()
       │
       ▼
[Queue Processing]
  │
  ▼
ParserRegistry.resolve(mimeType, filename)
  ├── CsvParser   (text/csv, .csv)
  ├── XlsxParser  (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, .xlsx)
  ├── PdfParser   (application/pdf, .pdf) [stub Sprint 2.8]
  └── DocxParser  (application/vnd.openxmlformats-officedocument.wordprocessingml.document, .docx) [stub]
       │
       ▼
parser.safeParse(buffer, options)
  → ParseResult { items[], warnings[], errors[], summary, rawMetadata }
       │
       ▼
ImportStagingService.persistStagingItems()
  → import_staging_items (reviewStatus: pending, expiresAt: +30 dias)
       │
       ▼
updateSessionStatus(awaiting_review)
       │
       ▼
[Revisão Humana]
  ├── reviewStagingItem(approved)
  ├── reviewStagingItem(rejected)
  └── reviewStagingItem(skipped)
       │
       ▼
[Sprint 3: Aprovados → Domínio]
```

## Lifecycle do ImportSession

```
uploaded → queued → parsing → extracted → normalized → awaiting_review
                                                              │
                                               ┌─────────────┼──────────────┐
                                               ▼             ▼              ▼
                                           approved       rejected       archived
                                               
failed ──────────────────────────────────────► queued (retry, máx 3)
failed (esgotado) ───────────────────────────► archived
```

## Confidence Infrastructure

Todo item extraído carrega `ConfidenceMetadata`:

| Nível | Score | Interpretação |
|-------|-------|--------------|
| high | ≥ 0.85 | Campo claramente estruturado |
| medium | ≥ 0.60 | Campo reconhecível mas ambíguo |
| low | ≥ 0.35 | Campo com incerteza significativa |
| uncertain | < 0.35 | Requer revisão obrigatória |

**O sistema nunca esconde incerteza.** Itens de baixa confiança aparecem na revisão com indicador visual — não são silenciosamente descartados.

## ExtractionProvenance

Rastreabilidade completa de cada item:

```typescript
interface ExtractionProvenance {
  sourceFileId: string;     // storage key do arquivo
  sourceFileName: string;
  sourceMimeType: string;
  sourceChecksum: string;   // SHA-256 do arquivo
  location: CellLocation;   // sheet, row, col, page, cell
  parserType: string;
  parserVersion: string;
  extractedAt: string;      // ISO timestamp
}
```

## CanonicalUnits Registry

25 unidades canônicas PT-BR com normalização multi-estratégia:

```
normalizeUnit("unidade") → { canonical: "UN", source: "alias", confidence: 0.95 }
normalizeUnit("U.N.")    → { canonical: "UN", source: "fuzzy",  confidence: 0.75 }
normalizeUnit("LITRO")   → { canonical: "L",  source: "alias",  confidence: 0.95 }
normalizeUnit("XYZABC")  → { canonical: null, source: "none",   confidence: 0 }
```

## Retry e Dead Letter Queue

```
Job falha (tentativa 1) → aguarda 1s  → retry
Job falha (tentativa 2) → aguarda 2s  → retry  
Job falha (tentativa 3) → aguarda 4s  → retry
Job falha (tentativa 4) → DLQ → retryJob() manual
```

## Roadmap Sprint 3

- Extração real PDF (`pdf-parse`) e DOCX (`mammoth`)
- Matching semântico com CATMAT/CATSER
- Normalização de descrição e preços
- Interface de revisão humana
- Fila persistente com BullMQ + Redis
- ItemTR integration (aprovação → domínio)
