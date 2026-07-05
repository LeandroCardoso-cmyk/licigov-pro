# Citation Engine — Motor de Citações

## Visão Geral

O Citation Engine gera citações automáticas para cada trecho da resposta que é baseado em evidências ou chunks recuperados. Garante rastreabilidade completa da origem de cada informação.

## Tipos de Citação

| Tipo | Descrição | Similaridade |
|------|-----------|-------------|
| direct_quote | Citação direta do texto fonte | > 80% |
| paraphrase | Paráfrase do conteúdo | 50-80% |
| legal_reference | Referência a artigo/lei | Variável |
| data_reference | Referência a dados/números | Variável |
| cross_reference | Referência cruzada entre fontes | < 50% |

## Algoritmo de Matching

1. A resposta é dividida em sentenças
2. Para cada sentença, calcula-se a sobreposição de palavras com cada evidência e chunk
3. O melhor match (>30% sobreposição) gera uma citação
4. O tipo é determinado pelo nível de similaridade

## Validação de Citações

`validateAllCitations` verifica se o texto citado realmente existe na fonte referenciada. Citações inválidas são marcadas para revisão.

## Formatação

O `formatCitationBlock` gera uma lista numerada de referências:
```
[1] Lei 14.133/2021, Art. 18 — "O estudo técnico preliminar..."
[2] TR-2024-0042, p. 3 — "A especificação técnica deve ser..."
```

## Agrupamento

Citações podem ser agrupadas por:
- Tipo (`groupCitationsByType`)
- Fonte (`groupBySource` no domain)
