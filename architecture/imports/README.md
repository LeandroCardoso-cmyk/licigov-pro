# Imports Architecture

Ver [../IMPORT_ENGINE.md](../IMPORT_ENGINE.md) para documentação completa do motor de importação.

## Resumo do Fluxo

```
Arquivo (CSV/XLSX/PDF/DOCX)
    │
    ▼
FileIngestionService.validateFile()
    │
    ▼
import_sessions (status: uploaded)
    │
    ▼
ImportQueueService.enqueueImport()
    │
    ▼
ParserRegistry.resolve() → parser.safeParse()
    │
    ▼
import_staging_items (reviewStatus: pending)
    │
    ▼
[Revisão Humana] → approved/rejected/skipped
    │
    ▼ [Sprint 3]
Domínio (ItemTR, etc.)
```

## Parsers Disponíveis

| Parser | Formato | Status |
|--------|---------|--------|
| CsvParser | .csv, text/csv | ✅ Funcional |
| XlsxParser | .xlsx, .xls | ✅ Funcional |
| PdfParser | .pdf | 🔧 Stub (Sprint 3) |
| DocxParser | .docx, .doc | 🔧 Stub (Sprint 3) |

## Confidence Levels

| Nível | Score | Ação Recomendada |
|-------|-------|-----------------|
| high | ≥ 0.85 | Aprovação rápida |
| medium | ≥ 0.60 | Revisar com atenção |
| low | ≥ 0.35 | Verificar campo a campo |
| uncertain | < 0.35 | Revisão obrigatória |
