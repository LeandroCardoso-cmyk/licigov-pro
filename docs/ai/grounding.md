# Grounding Engine — Sprint 4.2

## Visão geral

O sistema de grounding garante que outputs de IA sejam fundamentados em fontes verificáveis, reduzindo risco de alucinações.

## Componentes

- `groundingExpansionService.ts` — expansão de evidências, grafo de proveniência, risco de alucinação

## Tipos de fontes

| sourceType | Descrição |
|------------|-----------|
| legal_text | Textos de lei (Lei 14133/2021) |
| precedent | Acórdãos TCU, decisões anteriores |
| document | Documentos do processo |
| institutional | Conhecimento institucional |
| external_ref | Referências externas verificadas |

## Cálculo de risco de alucinação

```
risk = 1 - mean(authority * (isVerified ? 1.0 : 0.5))
```

Fontes sem verificação têm peso reduzido. Fontes vazias → risco = 1.0.

## Grafo de proveniência

`buildProvenanceGraph(sources)` mapeia `sourceId → provenance[]` para rastreabilidade completa.
