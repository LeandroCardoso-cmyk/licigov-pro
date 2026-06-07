# Context Ranking — Sprint 4.2

## Visão geral

Ranqueamento multi-dimensional de fragments de contexto com pesos configuráveis.

## Fórmula de score

```
score = priorityScore * 0.30
      + relevanceScore * 0.25
      + legalScore * legalWeight
      + recencyScore * recencyWeight
      + confidenceScore * confidenceWeight
```

## Mapeamento de prioridade

| Priority | PriorityScore |
|----------|---------------|
| critical | 1.0 |
| high | 0.8 |
| medium | 0.6 |
| low | 0.4 |
| background | 0.2 |

## RecencyScore

| Idade | Score |
|-------|-------|
| < 1h | 1.0 |
| < 24h | 0.8 |
| < 7d | 0.6 |
| < 30d | 0.4 |
| ≥ 30d | 0.2 |

## LegalScore

- `legalBasis != null` → 1.0
- `source === "legal"` → 0.8
- outros → 0.3
