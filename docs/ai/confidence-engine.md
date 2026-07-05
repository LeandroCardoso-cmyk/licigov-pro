# Confidence Engine — Motor de Confiança

## Visão Geral

O Confidence Engine calcula um score de confiança multidimensional para cada resposta gerada. Ele combina 5 dimensões independentes em um score consolidado.

## Dimensões de Confiança

| Dimensão | Peso Padrão | Cálculo |
|----------|-------------|---------|
| Retrieval | 25% | Média de similaridade dos chunks recuperados |
| Evidence | 25% | Média de confiança das evidências selecionadas |
| Legal | 20% | Média de confiança das referências legais |
| Grounding | 15% | Score de grounding da sessão |
| Response | 15% | Média de confiança da validação + cobertura de grounding |

## Score Consolidado

```
consolidated = Σ (score_i × weight_i) / Σ weight_i
```

Os pesos são configuráveis mas possuem valores padrão otimizados para o contexto de licitações públicas.

## Interpretação dos Scores

| Score | Interpretação | Ação |
|-------|--------------|------|
| > 0.8 | Alta confiança | Aprovação automática possível |
| 0.6 - 0.8 | Confiança moderada | Revisão recomendada |
| 0.4 - 0.6 | Confiança baixa | Revisão obrigatória |
| < 0.4 | Confiança muito baixa | Rejeição automática |

## Cálculo Individual

- **retrievalConfidence**: média aritmética de `similarity` de todos os chunks. 0 se vazio.
- **evidenceConfidence**: média aritmética de `confidence` de todas as evidências. 0 se vazio.
- **legalConfidence**: média aritmética de `confidence` de todas as referências legais. 0 se vazio.
- **groundingConfidence**: score direto (0-1), clamped.
- **responseConfidence**: média de `confidence` e `groundingCoverage` da validação.
