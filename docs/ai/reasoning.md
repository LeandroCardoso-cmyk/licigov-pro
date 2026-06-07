# AI Reasoning Engine — Sprint 4.2

## Visão geral

Sistema de raciocínio estruturado em etapas com detecção de contradições e ambiguidades.

## Componentes

- `aiReasoning.ts` — ReasoningStage, ReasoningTrace, funções de detecção

## Tipos de stage

| StageType | Descrição |
|-----------|-----------|
| premise_extraction | Extração de premissas do contexto |
| evidence_linking | Ligação de evidências às premissas |
| contradiction_check | Verificação de contradições |
| inference | Inferência a partir das premissas |
| conclusion | Conclusão final |
| validation | Validação da conclusão |
| citation | Geração de citações |

## Confiança

| Score | Label |
|-------|-------|
| ≥ 0.9 | certain |
| ≥ 0.7 | probable |
| ≥ 0.5 | possible |
| ≥ 0.3 | uncertain |
| < 0.3 | unknown |

## Propagação de confiança

Confiança decai com fator 0.9 a cada stage: `stage[n].confidence *= 0.9`.
Isso garante que stages finais não superestimem a certeza acumulada.
