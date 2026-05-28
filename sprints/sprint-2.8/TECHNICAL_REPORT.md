# Sprint 2.8 — Relatório Técnico

## Arquivos Criados

### Domínio
- `server/domain/importTypes.ts` — tipos, lifecycle, MIME registry
- `server/domain/importProvenance.ts` — rastreabilidade por célula
- `server/domain/importConfidence.ts` — infraestrutura de confiança
- `server/domain/importExtraction.ts` — RawExtractedItem aggregate
- `server/domain/canonicalUnits.ts` — 25 unidades PT-BR

### Parsers
- `server/parsers/baseParser.ts` — contrato BaseParser
- `server/parsers/parserRegistry.ts` — ParserRegistry com auto-registro
- `server/parsers/csvParser.ts` — CsvParser (puro Node.js)
- `server/parsers/xlsxParser.ts` — XlsxParser (SheetJS)
- `server/parsers/pdfParser.ts` — PdfParser stub + DocxParser stub

### Serviços
- `server/services/fileIngestionService.ts`
- `server/services/importStagingService.ts`
- `server/services/importQueueService.ts`

### Migrações
- `drizzle/0054_import_sessions.sql`
- `drizzle/0055_import_staging.sql`

## Notas de Implementação

### ParserRegistry — auto-registro
O arquivo `parserRegistry.ts` importa e registra todos os parsers na inicialização do módulo. Qualquer arquivo que importe `parserRegistry` receberá o registry já populado.

### ImportQueueService — memória vs Redis
Fila implementada em memória com `setImmediate` para drain assíncrona. API desenhada para ser drop-in substituída por BullMQ na Sprint 3 sem alterar chamadores.

### CsvParser — auto-detect delimiter
Conta ocorrências de `,`, `;`, `\t`, `|` nas primeiras 5 linhas. Delimiter com maior contagem é selecionado. Suporta aspas com escape de aspas duplas (`""` dentro de campo entre aspas).

### XlsxParser — dynamic import
`xlsx` é importado via `await import("xlsx")` para evitar falhas em test runner sem a biblioteca. Retorna erro `UNSUPPORTED_FORMAT` se não disponível.
