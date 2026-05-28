# Prompts de Importação

Prompts relacionados ao motor de importação de arquivos.

## Prompts Desta Pasta

- Design do `ImportSession` aggregate e lifecycle
- Design da `ConfidenceInfrastructure`
- Design do `CanonicalUnits` registry
- Design da `ExtractionProvenance`
- Parsers: CSV, XLSX, PDF stub, DOCX stub
- `FileIngestionService`, `ImportStagingService`, `ImportQueueService`

## Princípios que Guiam os Prompts de Importação

1. Raw extraction NUNCA persiste no domínio
2. Confidence é explícita, não filtro silencioso
3. Staging como barreira de qualidade obrigatória
4. Revisão humana é o portão de entrada no domínio
