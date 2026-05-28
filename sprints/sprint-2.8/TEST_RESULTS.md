# Sprint 2.8 — Resultados dos Testes

## Arquivo de Testes
`server/__tests__/integration/sprint28-import-foundation.test.ts`

## Resultado: 99 testes | 100% passando

### Distribuição por funcionalidade

| Funcionalidade | Testes |
|---------------|--------|
| importTypes (lifecycle, transitions, mime) | 13 |
| importProvenance | 4 |
| importConfidence | 6 |
| importExtraction | 3 |
| canonicalUnits | 14 |
| fileIngestionService (validateFile) | 8 |
| CsvParser | 7 |
| XlsxParser | 4 |
| PdfParser | 3 |
| DocxParser | 2 |
| ParserRegistry | 7 |
| BaseParser.validate | 3 |
| importQueueService | 3 |

## Correções de Testes

### Corrigido: `isTerminalStatus("rejected")` → false
`rejected` pode ser reprocessado via `uploaded`. Não é terminal por design.

### Corrigido: `extractedAt` é string ISO, não Date
`ExtractionProvenance.extractedAt` é `string` (ISO 8601). Teste alterado para verificar `typeof === "string"`.

### Corrigido: `fieldScores` → `fieldConfidences`
A propriedade correta em `ConfidenceMetadata` é `fieldConfidences`.

### Corrigido: `strategy` → `source`
A propriedade em `UnitNormalizationResult` é `source`, não `strategy`.

### Corrigido: canonical de unidade desconhecida → null
`normalizeUnit("XYZABC")` retorna `{ canonical: null, matched: false }`, não o raw.

### Corrigido: `FILE_TOO_LARGE` → `SIZE_EXCEEDED`
O código de erro correto no `BaseParser.validate` é `SIZE_EXCEEDED`.

## Total acumulado após Sprint 2.8: 537 testes (100% passando)
