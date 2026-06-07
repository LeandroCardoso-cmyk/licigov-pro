# Context Engine — Sprint 4.2

## Visão geral

O Context Engine é o mecanismo de montagem, ranqueamento e compressão de contexto contextual para as operações de IA do LiciGov Pro. Opera de forma determinística, multi-tenant e replay-safe.

## Componentes principais

- `contextAssembly.ts` — tipos e funções de montagem de janelas de contexto
- `contextAssemblyService.ts` — serviço de alto nível para montagem completa
- `contextRankingService.ts` — ranqueamento ponderado de fragments
- `semanticCompressionService.ts` — compressão semântica por Jaccard + prioridade

## Fluxo de montagem

1. Fontes de entrada: legalRefs, workflowId, retrievalResults, memories, documentRefs, userContext
2. Cada fonte vira um `ContextFragment` com prioridade mapeada
3. Fragments são agrupados em `ContextLayer` por source
4. `assembleContext` deduplica, ordena, aplica hard token limit

## Prioridades por fonte

| Fonte | Priority | RelevanceScore base |
|-------|----------|---------------------|
| legalRefs | critical | 0.95 |
| workflowId | high | 0.85 |
| retrievalResults | medium | score da busca |
| memories | low | confidence da memória |
| documentRefs | low | 0.60 |
| userContext | background | 0.50 |

## Determinismo

`replayKey = sha256(sorted fragment replayKeys + organizationId)` — mesma entrada sempre produz mesma saída.
