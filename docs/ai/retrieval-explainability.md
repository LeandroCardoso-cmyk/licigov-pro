# Retrieval Explainability — Sprint 4.6

## Components
- **RetrievalExplanation**: Explicação completa de uma sessão de retrieval
- **Evidence Breakdown**: Decomposição de scores por chunk
- **Trace Breakdown**: Decomposição temporal por estágio
- **Reasoning**: Explicação textual da decisão de ranking

## Human-Readable Format
`formatExplanationForHuman()` gera Markdown com:
- Query e estratégia
- Top 5 resultados com scores decompostos
- Reasoning da decisão

## Comparison
`compareExplanations()` identifica diferenças entre duas execuções de retrieval.
